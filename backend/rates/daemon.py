#!/usr/bin/env python3
"""
Continuous Rate Indexer Daemon.

Runs continuously to:
1. On startup: repair gaps from the last 7 days
2. Continuously: index new blocks every ~12 seconds via protocol adapters
3. After each batch: sync to clean_rates.db

Architecture:
  - Protocol adapters (rates/adapters/) define how to build RPC calls and decode results
  - This daemon orchestrates the loop, batching, and DB writes
  - Only protocols with enabled=True in config.PROTOCOLS are indexed

Environment:
    MAINNET_RPC_URL - Primary Ethereum RPC
    RESERVE_RPC_URL - Backup RPC (optional)
"""

import sqlite3
import requests
import time
import os
import sys
import signal
import logging
from datetime import datetime, timezone

# Ensure we can import config
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from config import (
    PROTOCOLS, STANDALONE_SOURCES, ASSETS,
    DB_PATH, CLEAN_DB_PATH,
    AAVE_POOL_ADDRESS,
)
from rates.adapters import get_adapter

from dotenv import load_dotenv

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("RateIndexerDaemon")

# --- CONFIGURATION ---
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "../../contracts/.env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "../../frontend/.env"))

DB_FILE = DB_PATH
CLEAN_DB_FILE = CLEAN_DB_PATH

# RPC Configuration
RPC_URLS = [
    os.getenv("MAINNET_RPC_URL"),
    os.getenv("RESERVE_RPC_URL"),
    "https://eth.llamarpc.com",  # Public fallback
]
RPC_URLS = [url for url in RPC_URLS if url]

# Daemon settings
POLL_INTERVAL = 12       # seconds (1 Ethereum block)
BATCH_SIZE = 50          # Blocks per RPC batch
SYNC_INTERVAL = 60       # Full hourly aggregation every 60s
BLOCKS_7D = int(7 * 24 * 3600 / 12)  # ~50400 blocks
SOFR_SYNC_INTERVAL = 86400   # Daily SOFR sync
SOFR_GENESIS = "2023-03-01"
SOFR_API_URL = "https://markets.newyorkfed.org/api/rates/secured/sofr/search.json"

# ETH Price Configuration (Uniswap V3 USDC/ETH)
ETH_POOL_ADDRESS = STANDALONE_SOURCES["ETH"]["pool_address"]
SLOT0_SELECTOR = STANDALONE_SOURCES["ETH"]["slot0_selector"]
Q192 = 2 ** 192
DECIMAL_ADJUST = 10 ** 12  # 10^(WETH_dec - USDC_dec) = 10^(18-6)

# sUSDe Configuration (ERC-4626 vault)
SUSDE_ADDRESS = STANDALONE_SOURCES["sUSDe"]["address"]
SUSDE_SELECTOR = STANDALONE_SOURCES["sUSDe"]["selector"]
# convertToAssets(1e18) — encode uint256 argument
SUSDE_CALLDATA = SUSDE_SELECTOR + hex(10**18)[2:].zfill(64)

# Graph URL for historical ETH prices
ETH_PRICE_GRAPH_URL_LOCAL = os.getenv("ETH_PRICE_GRAPH_URL")

# Graceful shutdown
running = True

def signal_handler(signum, frame):
    global running
    logger.info("🛑 Received shutdown signal. Exiting gracefully...")
    running = False

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ─────────────────────────────────────────────────────────────
# RPC
# ─────────────────────────────────────────────────────────────

def call_rpc(payload):
    """Attempts to call RPCs in order. Returns response json or None."""
    for url in RPC_URLS:
        try:
            response = requests.post(url, json=payload, timeout=20)
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.warning(f"RPC {url[:40]}... failed: {e}")
            continue
    return None


def get_current_chain_block() -> int | None:
    """Get the current block number from the chain."""
    payload = {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1}
    result = call_rpc(payload)
    if result and 'result' in result:
        try:
            return int(result['result'], 16)
        except (ValueError, TypeError):
            pass
    return None


def get_last_indexed_block(cursor) -> int:
    """Get the highest block number across all rate tables."""
    try:
        cursor.execute("SELECT MAX(block_number) FROM rates")
        result = cursor.fetchone()
        return result[0] if result and result[0] else 0
    except Exception:
        return 0


# ─────────────────────────────────────────────────────────────
# BLOCK INDEXING (protocol-agnostic)
# ─────────────────────────────────────────────────────────────

def _ensure_tables(cursor):
    """Create all required tables (idempotent)."""
    # Legacy per-asset tables (kept for backward compat during transition)
    for symbol, cfg in ASSETS.items():
        if cfg.get("type") != "onchain":
            continue
        table = cfg["table"]
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                block_number INTEGER PRIMARY KEY,
                timestamp INTEGER,
                apy REAL
            )
        """)

    # ETH prices
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS eth_prices (
            timestamp INTEGER PRIMARY KEY,
            price REAL,
            block_number INTEGER
        )
    """)

    # sUSDe exchange rate (USDe per 1 sUSDe)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS susde_rates (
            block_number INTEGER PRIMARY KEY,
            timestamp INTEGER,
            exchange_rate REAL
        )
    """)


def index_block_range(start_block: int, end_block: int, cursor, conn) -> int:
    """Index a range of blocks for all enabled protocols + standalone sources."""
    if start_block >= end_block:
        return 0

    count = end_block - start_block
    logger.info(f"📡 Indexing blocks {start_block} -> {end_block} ({count} blocks)")

    # Load enabled adapters
    adapters = {}
    for proto_id, proto_cfg in PROTOCOLS.items():
        if not proto_cfg["enabled"]:
            continue
        try:
            adapters[proto_id] = get_adapter(proto_id, proto_cfg)
        except RuntimeError as e:
            logger.error(f"Skipping protocol {proto_id}: {e}")

    total_records = 0

    for batch_start in range(start_block, end_block, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, end_block)

        # Build batch RPC request
        payload = []
        id_map = {}  # req_id → metadata
        req_id = 0

        for block_num in range(batch_start, batch_end):
            hex_block = hex(block_num)

            # 1. Protocol adapter calls (e.g. Aave V3 getReserveData)
            for proto_id, adapter in adapters.items():
                calls = adapter.build_rpc_calls(hex_block)
                for call in calls:
                    meta = call.pop("_meta", {})
                    call["id"] = req_id
                    payload.append(call)
                    id_map[req_id] = {
                        "block": block_num,
                        "type": "rate",
                        "protocol": proto_id,
                        "symbol": meta.get("symbol"),
                    }
                    req_id += 1

            # 2. ETH price from Uniswap V3 slot0
            payload.append({
                "jsonrpc": "2.0", "method": "eth_call", "id": req_id,
                "params": [{"to": ETH_POOL_ADDRESS, "data": SLOT0_SELECTOR}, hex_block]
            })
            id_map[req_id] = {"block": block_num, "type": "eth_price"}
            req_id += 1

            # 3. sUSDe exchange rate from ERC-4626 convertToAssets
            payload.append({
                "jsonrpc": "2.0", "method": "eth_call", "id": req_id,
                "params": [{"to": SUSDE_ADDRESS, "data": SUSDE_CALLDATA}, hex_block]
            })
            id_map[req_id] = {"block": block_num, "type": "susde"}
            req_id += 1

            # 4. Block timestamp
            payload.append({
                "jsonrpc": "2.0", "method": "eth_getBlockByNumber", "id": req_id,
                "params": [hex_block, False]
            })
            id_map[req_id] = {"block": block_num, "type": "timestamp"}
            req_id += 1

        results = call_rpc(payload)
        if not results or not isinstance(results, list):
            continue

        # Parse results into per-block buckets
        block_timestamps: dict[int, int] = {}
        block_eth_prices: dict[int, float] = {}
        block_susde_rates: dict[int, float] = {}
        # protocol → block → [(symbol, apy)]
        block_rates: dict[str, dict[int, list]] = {}

        for res in results:
            rid = res.get("id")
            meta = id_map.get(rid)
            if not meta:
                continue
            if "error" in res or "result" not in res or not res["result"]:
                continue

            blk = meta["block"]

            if meta["type"] == "timestamp":
                try:
                    ts = int(res["result"]["timestamp"], 16)
                    block_timestamps[blk] = ts
                except (ValueError, TypeError, KeyError):
                    pass

            elif meta["type"] == "eth_price":
                try:
                    raw = res["result"][2:]
                    sqrtPriceX96 = int(raw[:64], 16)
                    if sqrtPriceX96 > 0:
                        price_raw = (sqrtPriceX96 ** 2) / Q192
                        eth_price = DECIMAL_ADJUST / price_raw
                        if 100 < eth_price < 100000:  # Sanity check
                            block_eth_prices[blk] = eth_price
                except (ValueError, IndexError):
                    pass

            elif meta["type"] == "susde":
                try:
                    raw = res["result"]
                    if raw and raw != "0x":
                        # convertToAssets returns uint256 (USDe per 1e18 sUSDe)
                        exchange_rate = int(raw, 16) / 10**18
                        if 0.9 < exchange_rate < 2.0:  # Sanity: should be ~1.0+
                            block_susde_rates[blk] = exchange_rate
                except (ValueError, TypeError):
                    pass

            elif meta["type"] == "rate":
                proto_id = meta["protocol"]
                symbol = meta["symbol"]
                # Route back to adapter for decoding
                adapter = adapters.get(proto_id)
                if adapter and symbol:
                    # Single-result decode
                    decoded = adapter.decode_results([{
                        "_meta": {"symbol": symbol},
                        "result": res.get("result"),
                    }])
                    for rec in decoded:
                        if proto_id not in block_rates:
                            block_rates[proto_id] = {}
                        if blk not in block_rates[proto_id]:
                            block_rates[proto_id][blk] = []
                        block_rates[proto_id][blk].append(rec)

        # Insert into DB
        for blk in range(batch_start, batch_end):
            ts = block_timestamps.get(blk)
            if ts is None:
                continue

            # Rates (per protocol/symbol → legacy tables)
            for proto_id, proto_blocks in block_rates.items():
                records = proto_blocks.get(blk, [])
                for rec in records:
                    # Write to legacy table for backward compat
                    table = ASSETS.get(rec.symbol, {}).get("table")
                    if table:
                        cursor.execute(
                            f"INSERT OR IGNORE INTO {table} VALUES (?, ?, ?)",
                            (blk, ts, rec.apy)
                        )
                        total_records += 1

            # ETH price
            if blk in block_eth_prices:
                cursor.execute(
                    "INSERT OR REPLACE INTO eth_prices (timestamp, price, block_number) VALUES (?, ?, ?)",
                    (ts, block_eth_prices[blk], blk)
                )
                total_records += 1

            # sUSDe exchange rate
            if blk in block_susde_rates:
                cursor.execute(
                    "INSERT OR REPLACE INTO susde_rates (block_number, timestamp, exchange_rate) VALUES (?, ?, ?)",
                    (blk, ts, block_susde_rates[blk])
                )
                total_records += 1

        conn.commit()
        time.sleep(0.05)  # Rate limit

    logger.info(f"✅ Indexed {total_records} records")
    return total_records


# ─────────────────────────────────────────────────────────────
# SYNC STATE
# ─────────────────────────────────────────────────────────────

def update_sync_state(latest_block: int):
    """Update last_block_number in clean_rates.db sync_state."""
    try:
        conn_clean = sqlite3.connect(CLEAN_DB_FILE)
        cur = conn_clean.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY, value TEXT
            )
        """)
        cur.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_block_number', ?)",
            (str(latest_block),)
        )
        conn_clean.commit()
        conn_clean.close()
    except Exception as e:
        logger.error(f"sync_state update error: {e}")


def sync_clean_db():
    """Trigger hourly aggregation sync to clean_rates.db (inlined call)."""
    try:
        from rates.sync_clean_db import sync_clean_db as do_sync
        do_sync()
        logger.info("🔄 Full hourly sync to clean_rates.db")
    except Exception as e:
        logger.error(f"Sync error: {e}")


# ─────────────────────────────────────────────────────────────
# STANDALONE SOURCES (ETH price via Graph, SOFR via NY Fed)
# ─────────────────────────────────────────────────────────────

def sync_eth_prices(conn):
    """Fetch ETH prices from The Graph and sync to database."""
    if not ETH_PRICE_GRAPH_URL_LOCAL:
        logger.warning("ETH_PRICE_GRAPH_URL not configured, skipping ETH price sync")
        return 0

    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS eth_prices (
            timestamp INTEGER PRIMARY KEY, price REAL, block_number INTEGER
        )
    """)

    cursor.execute("SELECT MAX(timestamp) FROM eth_prices")
    result = cursor.fetchone()
    last_ts = result[0] if result and result[0] else 0

    query = """
    {
      poolHourDatas(
        orderBy: periodStartUnix
        orderDirection: asc
        where: { pool: "%s", periodStartUnix_gt: %d }
        first: 100
      ) { periodStartUnix token0Price }
    }
    """ % (ETH_POOL_ADDRESS, last_ts)

    try:
        response = requests.post(ETH_PRICE_GRAPH_URL_LOCAL, json={'query': query}, timeout=30)
        response.raise_for_status()
        data = response.json()

        if 'errors' in data:
            logger.error(f"GraphQL error: {data['errors']}")
            return 0

        items = data.get('data', {}).get('poolHourDatas', [])
        if not items:
            return 0

        count = 0
        for item in items:
            ts = int(item['periodStartUnix'])
            price = float(item['token0Price'])
            cursor.execute(
                "INSERT OR REPLACE INTO eth_prices (timestamp, price) VALUES (?, ?)",
                (ts, price)
            )
            count += 1

        conn.commit()
        logger.info(f"💰 Synced {count} ETH prices")
        return count

    except Exception as e:
        logger.error(f"ETH price sync error: {e}")
        return 0


def sync_sofr_rates(conn):
    """Fetch daily SOFR rates from the NY Fed API."""
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sofr_rates (
            timestamp INTEGER PRIMARY KEY, apy REAL
        )
    """)

    cursor.execute("SELECT MAX(timestamp) FROM sofr_rates")
    result = cursor.fetchone()
    last_ts = result[0] if result and result[0] else 0

    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        start = SOFR_GENESIS if last_ts == 0 else datetime.fromtimestamp(last_ts, tz=timezone.utc).strftime("%Y-%m-%d")
        url = f"{SOFR_API_URL}?startDate={start}&endDate={today}"
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        rates = data.get("refRates", [])
        if not rates:
            return 0

        count = 0
        for item in rates:
            date_str = item.get("effectiveDate")
            rate = item.get("percentRate")
            if not date_str or rate is None:
                continue
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            ts = int(dt.timestamp())
            if ts > last_ts:
                cursor.execute(
                    "INSERT OR IGNORE INTO sofr_rates (timestamp, apy) VALUES (?, ?)",
                    (ts, float(rate))
                )
                count += 1

        conn.commit()
        if count:
            logger.info(f"📊 Synced {count} SOFR rates from NY Fed")
        return count

    except Exception as e:
        logger.error(f"SOFR sync error: {e}")
        return 0


# ─────────────────────────────────────────────────────────────
# GAP REPAIR
# ─────────────────────────────────────────────────────────────

def run_initial_repair(cursor, conn):
    """Repair gaps from the last 7 days on startup."""
    logger.info("🛠️  Running initial 7-day gap repair...")

    current_block = get_current_chain_block()
    if not current_block:
        logger.error("Could not get current block")
        return

    start_block = current_block - BLOCKS_7D

    for symbol, config in ASSETS.items():
        if config.get("type") != "onchain":
            continue

        table = config["table"]
        logger.info(f"   Checking {symbol} ({table})...")

        cursor.execute(
            f"SELECT block_number FROM {table} WHERE block_number >= ? ORDER BY block_number ASC",
            (start_block,)
        )
        rows = cursor.fetchall()
        existing_blocks = set(r[0] for r in rows)

        if not existing_blocks:
            logger.info(f"   ⚠️ No data for {symbol}. Filling from block {start_block}...")
            index_block_range(start_block, current_block, cursor, conn)
        else:
            sorted_blocks = sorted(existing_blocks)
            ranges_to_fill = []

            if sorted_blocks[0] > start_block:
                ranges_to_fill.append((start_block, sorted_blocks[0]))

            for i in range(1, len(sorted_blocks)):
                prev = sorted_blocks[i - 1]
                curr = sorted_blocks[i]
                if curr - prev > 1:
                    ranges_to_fill.append((prev + 1, curr))

            if sorted_blocks[-1] < current_block:
                ranges_to_fill.append((sorted_blocks[-1] + 1, current_block))

            total_missing = sum(e - s for s, e in ranges_to_fill)
            if total_missing > 0:
                logger.info(f"   ⚠️ {symbol}: {total_missing} missing blocks in {len(ranges_to_fill)} ranges")
                for start, end in ranges_to_fill:
                    index_block_range(start, end, cursor, conn)
            else:
                logger.info(f"   ✅ {symbol} is complete")

    logger.info("🛠️  Initial repair complete")


# ─────────────────────────────────────────────────────────────
# MAIN DAEMON LOOP
# ─────────────────────────────────────────────────────────────

def run_daemon():
    """Main daemon loop."""
    # Log enabled protocols
    enabled = [pid for pid, p in PROTOCOLS.items() if p["enabled"]]
    logger.info("=" * 60)
    logger.info("🚀 Rate Indexer Daemon Started")
    logger.info(f"   DB Path: {DB_FILE}")
    logger.info(f"   Poll Interval: {POLL_INTERVAL}s")
    logger.info(f"   RPCs: {len(RPC_URLS)} configured")
    logger.info(f"   Protocols: {', '.join(enabled)}")
    logger.info(f"   Standalone: ETH price, sUSDe (on-chain), SOFR (NY Fed)")
    logger.info("=" * 60)

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # Ensure all tables exist
    _ensure_tables(cursor)
    conn.commit()

    # Initial repair + sync
    run_initial_repair(cursor, conn)
    sync_eth_prices(conn)
    sync_sofr_rates(conn)
    sync_clean_db()

    last_sync_time = time.time()
    last_sofr_sync = time.time()

    # Continuous loop
    while running:
        try:
            current_block = get_current_chain_block()
            if not current_block:
                logger.warning("Could not get current block. Retrying...")
                time.sleep(POLL_INTERVAL)
                continue

            last_indexed = get_last_indexed_block(cursor)

            if last_indexed < current_block:
                index_block_range(last_indexed + 1, current_block + 1, cursor, conn)

                # Update sync_state immediately (keeps block lag near zero)
                update_sync_state(current_block)

                # Full hourly aggregation periodically
                if time.time() - last_sync_time > SYNC_INTERVAL:
                    sync_clean_db()
                    last_sync_time = time.time()

                # Daily SOFR sync
                if time.time() - last_sofr_sync > SOFR_SYNC_INTERVAL:
                    sync_sofr_rates(conn)
                    last_sofr_sync = time.time()
            else:
                logger.debug(f"Up to date at block {current_block}")

            time.sleep(POLL_INTERVAL)

        except Exception as e:
            logger.error(f"Daemon error: {e}")
            time.sleep(POLL_INTERVAL)

    conn.close()
    logger.info("👋 Daemon stopped")


if __name__ == "__main__":
    run_daemon()
