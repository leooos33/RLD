#!/usr/bin/env python3
import asyncio
import asyncpg
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("benchmark")

DB_URL = "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer"

async def benchmark():
    pool = await asyncpg.create_pool(DB_URL)
    
    # 1. Cleanup raw_events
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM raw_events")
        log.info("Cleared raw_events")

    # 2. Insert 1000 dummy Transfer events
    # Transfer(address indexed from, address indexed to, uint256 value)
    # topic0 for Transfer is 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    topic0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    # Dummy broker address
    broker = "0xae2c4a8558f3c27b6542130bf1fc30ab97b8f8ce"
    # Dummy non-broker
    user = "0x0000000000000000000000000000000000000001"
    
    log.info("Inserting 1000 events...")
    start_insert = time.monotonic()
    async with pool.acquire() as conn:
        for i in range(1000):
            await conn.execute("""
                INSERT INTO raw_events (block_number, block_timestamp, tx_hash, log_index, contract, topic0, topic1, topic2, data, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            """, 1000 + i, int(time.time()), f"0x{i:064x}", i, 
                "0x4200000000000000000000000000000000000006", # waUSDC or similar
                topic0, 
                "0x" + user[2:].zfill(64), # from
                "0x" + broker[2:].zfill(64), # to
                "0x" + hex(10**18)[2:].zfill(64)) # amount
    end_insert = time.monotonic()
    log.info(f"Inserted 1000 events in {end_insert - start_insert:.2f}s")

    # 3. Start processor for measurement
    from processor import run_processor
    stop_event = asyncio.Event()
    
    log.info("Starting processing benchmark...")
    start_proc = time.monotonic()
    
    # Run processor with 0 interval to max it out
    proc_task = asyncio.create_task(run_processor(pool, interval=0.01, stop_event=stop_event))
    
    # Poll until all are done
    while True:
        async with pool.acquire() as conn:
            pending = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
            if pending == 0:
                break
        await asyncio.sleep(0.1)
    
    stop_event.set()
    await proc_task
    end_proc = time.monotonic()
    
    total_time = end_proc - start_proc
    throughput = 1000 / total_time
    log.info("Benchmarking logic: Transfer event (1-2 DB updates per event)")
    log.info(f"Total time for 1000 events: {total_time:.2f}s")
    log.info(f"Throughput: {throughput:.2f} events/sec")
    
    await pool.close()

if __name__ == "__main__":
    asyncio.run(benchmark())
