#!/usr/bin/env python3
"""
run_anvil.py — One-shot: bulk-load events from Anvil → process → report.

1. Applies fresh schema (including raw_events)
2. Bulk loads all events from the Anvil fork into raw_events
3. Runs the processor until all events are done
4. Prints per-broker state + LP positions + block states

Usage:
    DATABASE_URL="postgresql://rld:rld_dev_password@localhost:5432/rld_indexer" \
    python3 scripts/indexer_v2/run_anvil.py
"""
import asyncio
import asyncpg
import json
import logging
import os
import sys

from web3 import Web3

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from processor import run_processor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)-12s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("anvil")

DB_URL = os.environ.get("DATABASE_URL", "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer")
RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
CONFIG_PATH = os.environ.get("CONFIG", "docker/deployment.json")
SCHEMA_SQL = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "backend", "indexers", "schema.sql"))
# Start block — just before deployment
FROM_BLOCK = int(os.environ.get("FROM_BLOCK", "24626989"))


async def apply_schema(pool: asyncpg.Pool) -> None:
    with open(SCHEMA_SQL) as f:
        sql = f.read()
    async with pool.acquire() as conn:
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
    log.info("Schema applied")


def load_addresses(config_path: str) -> tuple[list[str], dict[str, str]]:
    """Load watched addresses and labels from deployment.json."""
    with open(config_path) as f:
        cfg = json.load(f)
    addresses = set()
    labels = {}
    for key, val in cfg.items():
        if isinstance(val, str) and val.startswith("0x") and len(val) == 42:
            cs = Web3.to_checksum_address(val)
            addresses.add(cs)
            labels[val.lower()] = key
        elif isinstance(val, dict):
            for k2, v2 in val.items():
                if isinstance(v2, str) and v2.startswith("0x") and len(v2) == 42:
                    cs = Web3.to_checksum_address(v2)
                    addresses.add(cs)
                    labels[v2.lower()] = k2
    return list(addresses), labels


async def bulk_ingest(pool: asyncpg.Pool, w3: Web3, addresses: list[str], labels: dict[str, str]) -> int:
    """One-shot: fetch all logs from Anvil and insert into raw_events."""
    latest = w3.eth.block_number
    log.info("Fetching logs from block %d → %d across %d addresses", FROM_BLOCK, latest, len(addresses))

    logs = w3.eth.get_logs({
        "fromBlock": FROM_BLOCK,
        "toBlock": latest,
        "address": addresses,
    })
    log.info("Fetched %d raw logs from chain", len(logs))

    # Cache block timestamps
    ts_cache: dict[int, int] = {}
    inserted = 0

    async with pool.acquire() as conn:
        for le in logs:
            topics = le.get("topics", [])
            if not topics:
                continue

            bn = le["blockNumber"]
            if bn not in ts_cache:
                block = w3.eth.get_block(bn)
                ts_cache[bn] = block["timestamp"]
            ts = ts_cache[bn]

            t0 = topics[0].hex() if isinstance(topics[0], bytes) else topics[0]
            t1 = topics[1].hex() if len(topics) > 1 and isinstance(topics[1], bytes) else (topics[1] if len(topics) > 1 else None)
            t2 = topics[2].hex() if len(topics) > 2 and isinstance(topics[2], bytes) else (topics[2] if len(topics) > 2 else None)
            t3 = topics[3].hex() if len(topics) > 3 and isinstance(topics[3], bytes) else (topics[3] if len(topics) > 3 else None)

            data_hex = le["data"].hex() if isinstance(le["data"], bytes) else le["data"]
            tx_hash = le["transactionHash"].hex() if isinstance(le["transactionHash"], bytes) else le["transactionHash"]

            try:
                await conn.execute("""
                    INSERT INTO raw_events (block_number, block_timestamp, tx_hash, log_index,
                                            contract, topic0, topic1, topic2, topic3, data, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
                    ON CONFLICT (tx_hash, log_index) DO NOTHING
                """,
                    bn, ts, tx_hash, le["logIndex"],
                    le["address"].lower(),
                    "0x" + t0 if not t0.startswith("0x") else t0,
                    "0x" + t1 if t1 and not t1.startswith("0x") else t1,
                    "0x" + t2 if t2 and not t2.startswith("0x") else t2,
                    "0x" + t3 if t3 and not t3.startswith("0x") else t3,
                    data_hex,
                )
                inserted += 1
            except Exception as e:
                log.warning("Insert error for tx=%s log=%d: %s", tx_hash[:16], le["logIndex"], e)

    log.info("Inserted %d events into raw_events", inserted)
    return inserted


async def report(pool: asyncpg.Pool, labels: dict[str, str]) -> None:
    """Print final indexed state with full collateral lifecycle."""
    async with pool.acquire() as conn:
        raw_total = await conn.fetchval("SELECT COUNT(*) FROM raw_events")
        raw_pending = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
        raw_done = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'done'")
        raw_error = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'error'")

        print()
        print("=" * 80)
        print(f"  RAW EVENTS:  total={raw_total}  pending={raw_pending}  done={raw_done}  error={raw_error}")
        print()

        # Markets
        markets = await conn.fetch("SELECT * FROM markets")
        print(f"  MARKETS ({len(markets)}):")
        for m in markets:
            nf = m.get('normalization_factor') or 0
            td = m.get('total_debt_raw') or 0
            bd = m.get('bad_debt') or 0
            print(f"    market_id = {m['market_id'][:18]}...")
            print(f"    waUSDC    = {m['wausdc']}")
            print(f"    wRLP      = {m['wrlp']}")
            print(f"    NF        = {nf}  (true_debt = principal × NF/1e18)")
            print(f"    totalDebt = {td}")
            print(f"    badDebt   = {bd}")
            print(f"    block     = {m['deploy_block']}")
            print()

        # Brokers
        brokers = await conn.fetch("SELECT * FROM brokers ORDER BY created_block")
        print(f"  BROKERS ({len(brokers)}):")
        for b in brokers:
            owner_label = labels.get(b['owner'], b['owner'][:16])
            broker_label = labels.get(b['address'], b['address'][:16])
            wausdc = b['wausdc_balance'] or 0
            wrlp = b['wrlp_balance'] or 0
            debt = b.get('debt_principal') or 0
            is_liq = b.get('is_liquidated', False)
            active_lp = b.get('active_lp_token_id') or 0
            active_twamm = b.get('active_twamm_order_id') or ''

            # Format balances
            wausdc_f = float(wausdc)
            wrlp_f = float(wrlp)
            debt_f = float(debt)

            print(f"    ┌── [{broker_label}] {'🔴 LIQUIDATED' if is_liq else ''}")
            print(f"    │  address:      {b['address']}")
            print(f"    │  owner:        {b['owner']} ({owner_label})")
            print(f"    │  waUSDC:       {wausdc_f / 1e6:,.2f} USDC")
            print(f"    │  wRLP:         {wrlp_f / 1e18:,.6f} wRLP")
            print(f"    │  debt_principal: {debt_f / 1e18:,.6f} wRLP")
            print(f"    │  active_lp:    #{active_lp}")
            print(f"    │  active_twamm: {active_twamm[:18] + '...' if len(str(active_twamm)) > 18 else active_twamm}")

            # LP Positions for this broker
            lps = await conn.fetch(
                "SELECT * FROM lp_positions WHERE broker_address = $1 ORDER BY token_id",
                b['address'])
            if lps:
                print(f"    │  LP POSITIONS ({len(lps)}):")
                for lp in lps:
                    status = "BURNED" if lp['is_burned'] else ("REG" if lp.get('is_registered') else "HELD")
                    print(f"    │    #{lp['token_id']}  [{lp['tick_lower']},{lp['tick_upper']}]  liq={lp['liquidity']}  {status}")

            # TWAMM Orders for this broker
            twamms = await conn.fetch(
                "SELECT * FROM twamm_orders WHERE broker_address = $1 ORDER BY block_number",
                b['address'])
            if twamms:
                print(f"    │  TWAMM ORDERS ({len(twamms)}):")
                for t in twamms:
                    reg_flag = " ★REG" if t.get('is_registered') else ""
                    direction = "sell→buy" if t['zero_for_one'] else "buy→sell"
                    print(f"    │    {t['order_id'][:18]}..  {direction}  {t.get('status', '?')}{reg_flag}")

            print(f"    └──")
            print()

        # Block states
        state_count = await conn.fetchval("SELECT COUNT(*) FROM block_states")
        latest_state = await conn.fetchrow("SELECT * FROM block_states ORDER BY block_number DESC LIMIT 1")
        print(f"  BLOCK STATES: {state_count} total")
        if latest_state:
            print(f"    latest block: {latest_state['block_number']}")
            print(f"    mark_price:   {latest_state['mark_price']}")
            print(f"    tick:         {latest_state['tick']}")
            print(f"    NF:           {latest_state['normalization_factor']}")
        print()

        # Liquidations
        liqs = await conn.fetch("SELECT * FROM liquidations ORDER BY block_number")
        print(f"  LIQUIDATIONS ({len(liqs)}):")
        for liq in liqs:
            print(f"    block={liq['block_number']}  user={liq['user_address'][:16]}..  liquidator={liq['liquidator_address'][:16]}..")
            print(f"      debt_covered={liq['debt_covered']}  collateral_seized={liq['collateral_seized']}  wrlp_burned={liq['wrlp_burned']}")
        print()

        # Errors
        errors = await conn.fetch("SELECT id, topic0, error_msg FROM raw_events WHERE status = 'error' LIMIT 10")
        if errors:
            print(f"  ERRORS ({len(errors)}):")
            for e in errors:
                print(f"    id={e['id']}  topic0={e['topic0'][:18]}..  err={e['error_msg'][:80]}")
            print()

        print("=" * 80)


async def main() -> None:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        log.error("Cannot connect to %s", RPC_URL)
        return

    log.info("Connected to chain %d — latest block %d", w3.eth.chain_id, w3.eth.block_number)

    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    try:
        # 1. Fresh schema
        await apply_schema(pool)

        # 2. Load addresses
        config = os.path.join(os.path.dirname(__file__), "..", "..", CONFIG_PATH)
        addresses, labels = load_addresses(os.path.normpath(config))

        # 3. Bulk ingest from chain
        total = await bulk_ingest(pool, w3, addresses, labels)

        # 4. Run processor until all pending events are processed
        log.info("Processing %d events...", total)
        # Simple drain: keep processing until no pending remain
        from processor import HANDLERS, TOPIC_MAP as PROC_TOPIC_MAP
        processed = 0
        errors = 0
        async with pool.acquire() as conn:
            while True:
                rows = await conn.fetch("""
                    SELECT * FROM raw_events
                    WHERE status = 'pending'
                    ORDER BY block_number ASC, log_index ASC
                    LIMIT 200
                """)
                if not rows:
                    break

                for row in rows:
                    event_name = PROC_TOPIC_MAP.get(row["topic0"])
                    if not event_name:
                        await conn.execute(
                            "UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])
                        continue

                    handler = HANDLERS.get(event_name)
                    if handler:
                        try:
                            await handler(conn, row)
                            await conn.execute(
                                "UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])
                            processed += 1
                        except Exception as e:
                            log.error("Error %s id=%d: %s", event_name, row["id"], e)
                            await conn.execute(
                                "UPDATE raw_events SET status = 'error', error_msg = $1 WHERE id = $2",
                                str(e)[:500], row["id"])
                            errors += 1
                    else:
                        await conn.execute(
                            "UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])

        log.info("Processed %d events (%d errors)", processed, errors)

        # 4.5. Patch wRLP from deployment.json
        # MarketCreated.topic3 = underlying (USDC), NOT wRLP
        # wRLP is token1 in deployment.json
        config_path = os.path.normpath(config)
        with open(config_path) as f:
            cfg = json.load(f)
        wrlp_addr = cfg.get("token1", "").lower()
        if wrlp_addr:
            async with pool.acquire() as conn:
                await conn.execute("UPDATE markets SET wrlp = $1", wrlp_addr)
            log.info("Patched wRLP to %s from deployment.json", wrlp_addr)

        # 5. Report
        await report(pool, labels)

    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
