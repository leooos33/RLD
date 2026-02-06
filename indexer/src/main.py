#!/usr/bin/env python3
"""
RLD Indexer - Main Entry Point

Usage:
    python -m src.main [--mode MODE] [--start-block BLOCK]

Modes:
    indexer  - Run the block indexer (default)
    api      - Run the API server
    backfill - Backfill historical data
"""
import asyncio
import argparse
import logging
import signal
import sys
from typing import Optional

import asyncpg
import structlog

from .config import IndexerConfig
from .rpc import RPCClient
from .indexer import Indexer, BlockProcessor
from .contracts import EventDecoder
from .reconciliation.engine import ReconciliationEngine, InvariantChecker

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer() if sys.stdout.isatty() else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)


async def create_db_pool(config: IndexerConfig) -> asyncpg.Pool:
    """Create database connection pool"""
    return await asyncpg.create_pool(
        host=config.db.host,
        port=config.db.port,
        user=config.db.user,
        password=config.db.password,
        database=config.db.database,
        min_size=2,
        max_size=10,
    )


async def run_indexer(config: IndexerConfig):
    """Run the main indexer loop"""
    logger.info("Starting RLD Indexer", 
                chain_id=config.chain.chain_id,
                rpc=config.rpc.url,
                read_only=config.read_only_mode)
    
    # Initialize components
    db = await create_db_pool(config)
    rpc = RPCClient(
        url=config.rpc.url,
        batch_size=config.rpc.batch_size,
        timeout=config.rpc.timeout_seconds,
    )
    
    reconciler = ReconciliationEngine(rpc, config) if config.safety.dual_source_mode else None
    processor = BlockProcessor(config, rpc, db, reconciler)
    
    # Determine starting block
    async with db.acquire() as conn:
        last_block = await conn.fetchval(
            "SELECT MAX(block_number) FROM blocks WHERE reorged = FALSE"
        )
    
    start_block = (last_block + 1) if last_block else config.chain.start_block
    current_block = start_block
    
    logger.info("Starting from block", block=current_block)
    
    # Main loop
    running = True
    
    def shutdown_handler(sig, frame):
        nonlocal running
        logger.info("Shutdown signal received")
        running = False
    
    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)
    
    try:
        while running:
            try:
                # Get chain head
                head = await rpc.eth_block_number()
                safe_block = head - config.chain.finality_blocks
                
                # Process blocks up to finality
                blocks_processed = 0
                while current_block <= safe_block and running:
                    result = await processor.process_block(current_block)
                    
                    if result.events_processed > 0 or result.reorg_detected:
                        logger.info(
                            "Block processed",
                            block=current_block,
                            events=result.events_processed,
                            reorg=result.reorg_detected,
                        )
                    
                    current_block += 1
                    blocks_processed += 1
                    
                    # Periodic progress log
                    if blocks_processed % 100 == 0:
                        logger.info("Progress", current=current_block, head=head)
                
                # Wait for new blocks
                await asyncio.sleep(config.poll_interval_seconds)
                
            except Exception as e:
                logger.error("Processing error", error=str(e))
                await asyncio.sleep(5)
                
    finally:
        await rpc.close()
        await db.close()
        logger.info("Indexer stopped")


async def run_api(config: IndexerConfig):
    """Run the API server"""
    import uvicorn
    from fastapi import FastAPI
    from .api.handlers import APIHandlers
    
    app = FastAPI(
        title="RLD Indexer API",
        version="1.0.0",
        description="Position tracking and market data for RLD Protocol"
    )
    
    db = await create_db_pool(config)
    api = APIHandlers(db)
    
    @app.get("/api/v1/brokers/{address}")
    async def get_broker(address: str):
        return await api.get_broker(address)
    
    @app.get("/api/v1/markets/{market_id}")
    async def get_market(market_id: str):
        return await api.get_market(market_id)
    
    @app.get("/api/v1/status")
    async def get_status():
        return await api.get_system_status()
    
    @app.get("/api/v1/brokers/at-risk")
    async def get_at_risk():
        return await api.get_at_risk_brokers()
    
    uvicorn_config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8080,
        log_level="info",
    )
    server = uvicorn.Server(uvicorn_config)
    await server.serve()


def main():
    parser = argparse.ArgumentParser(description="RLD Indexer")
    parser.add_argument("--mode", choices=["indexer", "api"], default="indexer")
    parser.add_argument("--start-block", type=int, default=None)
    args = parser.parse_args()
    
    config = IndexerConfig.from_env()
    
    if args.start_block:
        config.chain.start_block = args.start_block
    
    if args.mode == "indexer":
        asyncio.run(run_indexer(config))
    elif args.mode == "api":
        asyncio.run(run_api(config))


if __name__ == "__main__":
    main()
