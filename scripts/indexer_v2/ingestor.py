#!/usr/bin/env python3
"""
ingestor.py — Real-chain event ingestor.

Polls eth_getLogs every (block_time / 2) and writes raw logs into
the raw_events queue table. Zero decode logic — just fetch and store.

Usage:
    python3 scripts/indexer_v2/ingestor.py [--rpc URL] [--config PATH] [--interval SECS]
"""
import asyncio
import argparse
import asyncpg
import json
import logging
import os
import sys

from web3 import Web3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)-12s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ingestor")

DB_URL = os.environ.get("DATABASE_URL", "postgresql://rld:rld@localhost:5432/rld")


def load_watched_addresses(config_path: str) -> list[str]:
    """Extract all 0x addresses from deployment.json."""
    with open(config_path) as f:
        cfg = json.load(f)

    addresses = set()
    for key, val in cfg.items():
        if isinstance(val, str) and val.startswith("0x") and len(val) == 42:
            addresses.add(Web3.to_checksum_address(val))
        elif isinstance(val, dict):
            for k2, v2 in val.items():
                if isinstance(v2, str) and v2.startswith("0x") and len(v2) == 42:
                    addresses.add(Web3.to_checksum_address(v2))

    return list(addresses)


async def run_ingestor(
    rpc_url: str,
    config_path: str,
    interval: float = 1.0,
    db_url: str = DB_URL,
) -> None:
    """Continuously poll chain for logs and insert into raw_events."""
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    if not w3.is_connected():
        log.error("Cannot connect to %s", rpc_url)
        return

    addresses = load_watched_addresses(config_path)
    log.info("Watching %d addresses from %s", len(addresses), config_path)

    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)

    # Start from last known block or current
    async with pool.acquire() as conn:
        last = await conn.fetchval(
            "SELECT COALESCE(MAX(block_number), 0) FROM raw_events"
        )
    cursor = last + 1 if last > 0 else w3.eth.block_number
    log.info("Starting from block %d", cursor)

    try:
        while True:
            try:
                latest = w3.eth.block_number
                if cursor > latest:
                    await asyncio.sleep(interval)
                    continue

                # Fetch logs for the range [cursor, latest]
                # Cap batch size to avoid RPC limits
                to_block = min(cursor + 500, latest)

                logs = w3.eth.get_logs({
                    "fromBlock": cursor,
                    "toBlock": to_block,
                    "address": addresses,
                })

                if logs:
                    async with pool.acquire() as conn:
                        for le in logs:
                            topics = le.get("topics", [])
                            if not topics:
                                continue

                            block = w3.eth.get_block(le["blockNumber"])
                            ts = block["timestamp"]

                            t0 = topics[0].hex() if isinstance(topics[0], bytes) else topics[0]
                            t1 = topics[1].hex() if len(topics) > 1 and isinstance(topics[1], bytes) else (topics[1] if len(topics) > 1 else None)
                            t2 = topics[2].hex() if len(topics) > 2 and isinstance(topics[2], bytes) else (topics[2] if len(topics) > 2 else None)
                            t3 = topics[3].hex() if len(topics) > 3 and isinstance(topics[3], bytes) else (topics[3] if len(topics) > 3 else None)

                            data_hex = le["data"].hex() if isinstance(le["data"], bytes) else le["data"]
                            tx_hash = le["transactionHash"].hex() if isinstance(le["transactionHash"], bytes) else le["transactionHash"]

                            await conn.execute("""
                                INSERT INTO raw_events (block_number, block_timestamp,
                                    tx_hash, log_index, contract, topic0,
                                    topic1, topic2, topic3, data, status)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
                                ON CONFLICT (tx_hash, log_index) DO NOTHING
                            """,
                                le["blockNumber"], ts,
                                tx_hash, le["logIndex"],
                                le["address"].lower(),
                                "0x" + t0 if not t0.startswith("0x") else t0,
                                "0x" + t1 if t1 and not t1.startswith("0x") else t1,
                                "0x" + t2 if t2 and not t2.startswith("0x") else t2,
                                "0x" + t3 if t3 and not t3.startswith("0x") else t3,
                                data_hex,
                            )

                    log.info("Ingested %d logs from blocks %d→%d", len(logs), cursor, to_block)

                cursor = to_block + 1

            except Exception as e:
                log.error("Ingestor error: %s", e)
                await asyncio.sleep(interval * 2)
                continue

            await asyncio.sleep(interval)

    finally:
        await pool.close()


def main():
    parser = argparse.ArgumentParser(description="RLD Event Ingestor")
    parser.add_argument("--rpc", default="http://127.0.0.1:8545")
    parser.add_argument("--config", default="docker/deployment.json")
    parser.add_argument("--interval", type=float, default=1.0, help="Poll interval in seconds")
    parser.add_argument("--db", default=DB_URL, help="PostgreSQL connection string")
    args = parser.parse_args()

    asyncio.run(run_ingestor(args.rpc, args.config, args.interval, args.db))


if __name__ == "__main__":
    main()
