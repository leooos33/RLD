#!/usr/bin/env python3
"""
run_simulation.py — Orchestrator for the two-process indexer simulation.

1. Connects to Postgres, applies schema (including raw_events)
2. Starts mock_producer in one asyncio.Task
3. Starts processor in another asyncio.Task
4. Prints state summary every 5s
5. Asserts final state correctness (Poka-Yoke)

Usage:
    python3 scripts/indexer_v2/run_simulation.py

Requires:
    - PostgreSQL running (default: localhost:5432, DB: rld)
    - pip install asyncpg web3
"""
import asyncio
import asyncpg
import logging
import os
import sys

# Add parent dir to path so we can import sibling modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mock_producer import run_producer
from processor import run_processor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)-12s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("simulation")

DB_URL = os.environ.get("DATABASE_URL", "postgresql://rld:rld@localhost:5432/rld")

SCHEMA_SQL = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "indexers", "schema.sql")


async def apply_schema(pool: asyncpg.Pool) -> None:
    """Apply the full schema including raw_events table."""
    schema_path = os.path.normpath(SCHEMA_SQL)
    with open(schema_path) as f:
        sql = f.read()

    async with pool.acquire() as conn:
        # Drop existing tables for clean simulation
        await conn.execute("""
            DROP TABLE IF EXISTS raw_events CASCADE;
            DROP TABLE IF EXISTS twamm_orders CASCADE;
            DROP TABLE IF EXISTS lp_positions CASCADE;
            DROP TABLE IF EXISTS candles CASCADE;
            DROP TABLE IF EXISTS liquidations CASCADE;
            DROP TABLE IF EXISTS events CASCADE;
            DROP TABLE IF EXISTS block_states CASCADE;
            DROP TABLE IF EXISTS brokers CASCADE;
            DROP TABLE IF EXISTS indexer_state CASCADE;
            DROP TABLE IF EXISTS markets CASCADE;
        """)
        await conn.execute(sql)
    log.info("Schema applied from %s", schema_path)


async def print_state(pool: asyncpg.Pool) -> None:
    """Print current state of all domain tables."""
    async with pool.acquire() as conn:
        raw_total = await conn.fetchval("SELECT COUNT(*) FROM raw_events")
        raw_pending = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
        raw_done = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'done'")
        raw_error = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'error'")

        market_count = await conn.fetchval("SELECT COUNT(*) FROM markets")
        broker_count = await conn.fetchval("SELECT COUNT(*) FROM brokers")
        lp_count = await conn.fetchval("SELECT COUNT(*) FROM lp_positions WHERE is_active = true")
        state_count = await conn.fetchval("SELECT COUNT(*) FROM block_states")

        print()
        print("=" * 70)
        print(f"  RAW EVENTS:  total={raw_total}  pending={raw_pending}  done={raw_done}  error={raw_error}")
        print(f"  DOMAIN:      markets={market_count}  brokers={broker_count}  lp_positions={lp_count}  block_states={state_count}")

        if broker_count > 0:
            brokers = await conn.fetch("SELECT address, owner, wausdc_balance, wrlp_balance FROM brokers ORDER BY address")
            for b in brokers:
                print(f"    broker={b['address'][:16]}..  owner={b['owner'][:16]}..  waUSDC={b['wausdc_balance']}  wRLP={b['wrlp_balance']}")

        if lp_count > 0:
            lps = await conn.fetch("SELECT token_id, broker_address, tick_lower, tick_upper, liquidity FROM lp_positions WHERE is_active = true")
            for lp in lps:
                print(f"    LP token={lp['token_id']}  broker={lp['broker_address'][:16]}..  ticks=[{lp['tick_lower']},{lp['tick_upper']}]  liq={lp['liquidity']}")

        print("=" * 70)
        print()


async def verify_final_state(pool: asyncpg.Pool) -> None:
    """Poka-Yoke: Assert the simulation produced correct state."""
    async with pool.acquire() as conn:
        # 1. All raw events processed
        pending = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
        assert pending == 0, f"FAIL: {pending} events still pending"

        errors = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'error'")
        assert errors == 0, f"FAIL: {errors} events in error state"

        # 2. Exactly 1 market
        markets = await conn.fetchval("SELECT COUNT(*) FROM markets")
        assert markets == 1, f"FAIL: expected 1 market, got {markets}"

        # 3. Exactly 3 brokers
        broker_count = await conn.fetchval("SELECT COUNT(*) FROM brokers")
        assert broker_count == 3, f"FAIL: expected 3 brokers, got {broker_count}"

        # 4. Each broker has non-zero waUSDC balance (from deposits)
        brokers = await conn.fetch("SELECT address, wausdc_balance FROM brokers")
        for b in brokers:
            assert b["wausdc_balance"] is not None and b["wausdc_balance"] != 0, \
                f"FAIL: broker {b['address'][:16]} has zero waUSDC"

        # 5. At least 1 active LP position
        lp_count = await conn.fetchval("SELECT COUNT(*) FROM lp_positions WHERE is_active = true")
        assert lp_count >= 1, f"FAIL: expected at least 1 LP position, got {lp_count}"

        # 6. Block states populated (from swaps + funding)
        state_count = await conn.fetchval("SELECT COUNT(*) FROM block_states")
        assert state_count > 0, f"FAIL: no block states recorded"

    log.info("✅ ALL ASSERTIONS PASSED")


async def main() -> None:
    log.info("Connecting to %s", DB_URL)
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    try:
        # 1. Apply schema
        await apply_schema(pool)

        # 2. Create stop signal
        producer_done = asyncio.Event()

        # 3. Start producer + processor as concurrent tasks
        async def producer_wrapper():
            await run_producer(pool, total_blocks=30, interval=0.3)
            producer_done.set()

        producer_task = asyncio.create_task(producer_wrapper())
        processor_task = asyncio.create_task(run_processor(pool, interval=0.2, stop_event=producer_done))

        # 4. Print state every 3 seconds while running
        monitor_task = asyncio.create_task(state_monitor(pool, producer_done))

        # 5. Wait for both to finish
        await asyncio.gather(producer_task, processor_task, monitor_task)

        # 6. Final state
        await print_state(pool)

        # 7. Verify
        await verify_final_state(pool)

    finally:
        await pool.close()


async def state_monitor(pool: asyncpg.Pool, stop_event: asyncio.Event) -> None:
    """Print state periodically until producer is done."""
    while not stop_event.is_set():
        await asyncio.sleep(3.0)
        await print_state(pool)
    # One more after done, with small delay for processor to drain
    await asyncio.sleep(1.0)


if __name__ == "__main__":
    asyncio.run(main())
