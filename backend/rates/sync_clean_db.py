"""
Sync raw block-level rate data → hourly aggregated clean_rates.db.

Reads from aave_rates.db (per-block), aggregates into hourly buckets,
and writes to clean_rates.db (hourly_stats table) for API serving.

Handles:
  - Protocol rates (USDC, DAI, USDT via legacy tables)
  - ETH prices
  - sUSDe exchange rate → APY conversion
  - SOFR rates
"""

import sqlite3
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from config import ASSETS, DB_PATH, CLEAN_DB_PATH

RAW_DB_PATH = DB_PATH

# Column mapping for assets → hourly_stats columns
SYMBOL_MAP = {
    "USDC": "usdc_rate",
    "DAI": "dai_rate",
    "USDT": "usdt_rate",
    "SOFR": "sofr_rate",
    "sUSDe": "susde_yield",
}


def _ensure_tables(cursor):
    """Create tables if they don't exist (idempotent)."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS hourly_stats (
            timestamp INTEGER PRIMARY KEY,
            eth_price REAL,
            usdc_rate REAL,
            dai_rate REAL,
            usdt_rate REAL,
            sofr_rate REAL,
            susde_yield REAL
        )
    """)
    # Migrate: add susde_yield column if missing
    try:
        cursor.execute("ALTER TABLE hourly_stats ADD COLUMN susde_yield REAL")
    except Exception:
        pass  # Column already exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY, value TEXT
        )
    """)


def _get_sync_state(cursor, key, default="0"):
    """Read a value from sync_state."""
    cursor.execute("SELECT value FROM sync_state WHERE key=?", (key,))
    row = cursor.fetchone()
    return row[0] if row else default


def _set_sync_state(cursor, key, value):
    """Write a value to sync_state."""
    cursor.execute(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
        (key, str(value))
    )


def _sync_eth_prices_incremental(conn_raw, cursor_clean, since_ts):
    """Sync ETH prices newer than since_ts, with a 48h safety lookback."""
    lookback = since_ts - (48 * 3600)
    hour_floor = (lookback // 3600) * 3600

    cursor_raw = conn_raw.cursor()
    try:
        cursor_raw.execute(
            "SELECT timestamp, price FROM eth_prices WHERE timestamp >= ?",
            (hour_floor,)
        )
    except Exception:
        return 0
    rows = cursor_raw.fetchall()

    if not rows:
        return 0

    # Group by hour and average
    hourly: dict[int, list[float]] = {}
    for ts, price in rows:
        hour_ts = (ts // 3600) * 3600
        if hour_ts not in hourly:
            hourly[hour_ts] = []
        hourly[hour_ts].append(price)

    count = 0
    for hour_ts, prices in hourly.items():
        avg_price = sum(prices) / len(prices)
        cursor_clean.execute("""
            INSERT INTO hourly_stats (timestamp, eth_price) VALUES (?, ?)
            ON CONFLICT(timestamp) DO UPDATE SET eth_price=excluded.eth_price
        """, (hour_ts, avg_price))
        count += 1

    return count


def _sync_asset_incremental(conn_raw, cursor_clean, table, col_name, since_ts):
    """Sync asset rates newer than since_ts."""
    hour_floor = (since_ts // 3600) * 3600

    cursor_raw = conn_raw.cursor()
    try:
        cursor_raw.execute(
            f"SELECT timestamp, apy FROM {table} WHERE timestamp >= ?",
            (hour_floor,)
        )
    except Exception:
        return 0
    rows = cursor_raw.fetchall()

    if not rows:
        return 0

    # Group by hour and average
    hourly: dict[int, list[float]] = {}
    for ts, apy in rows:
        hour_ts = (ts // 3600) * 3600
        if hour_ts not in hourly:
            hourly[hour_ts] = []
        hourly[hour_ts].append(apy)

    count = 0
    for hour_ts, apys in hourly.items():
        avg_apy = sum(apys) / len(apys)
        cursor_clean.execute(f"""
            INSERT INTO hourly_stats (timestamp, {col_name}) VALUES (?, ?)
            ON CONFLICT(timestamp) DO UPDATE SET {col_name}=excluded.{col_name}
        """, (hour_ts, avg_apy))
        count += 1

    return count


def _sync_susde_yield(conn_raw, cursor_clean, since_ts):
    """Convert sUSDe exchange rate deltas into annualized APY.

    sUSDe is an ERC-4626 vault. The exchange rate (USDe per sUSDe) increases
    as yield accrues. APY = ((rate_now / rate_past) - 1) * (365 / days_elapsed) * 100

    The on-chain rate updates every ~8 hours (Ethena keeper), so we use
    a 24h lookback window for stable APY calculation.
    """
    hour_floor = (since_ts // 3600) * 3600

    cursor_raw = conn_raw.cursor()
    try:
        # Get recent exchange rates
        cursor_raw.execute(
            "SELECT timestamp, exchange_rate FROM susde_rates WHERE timestamp >= ? ORDER BY timestamp ASC",
            (hour_floor - 86400,)  # Extra 24h lookback for delta calculation
        )
    except Exception:
        return 0
    rows = cursor_raw.fetchall()

    if not rows:
        return 0

    # Group by hour — take the last exchange rate per hour
    hourly_rates: dict[int, float] = {}
    for ts, rate in rows:
        hour_ts = (ts // 3600) * 3600
        hourly_rates[hour_ts] = rate  # Last value wins (most recent in hour)

    if not hourly_rates:
        return 0

    sorted_hours = sorted(hourly_rates.keys())

    count = 0
    for hour_ts in sorted_hours:
        if hour_ts < hour_floor:
            continue  # Only for lookback reference, don't write

        current_rate = hourly_rates[hour_ts]

        # Find rate from ~24h ago
        target_ts = hour_ts - 86400
        best_ref = None
        best_diff = 6 * 3600  # 6h tolerance

        for ref_ts in sorted_hours:
            diff = abs(ref_ts - target_ts)
            if diff < best_diff:
                best_diff = diff
                best_ref = hourly_rates[ref_ts]

        if best_ref and best_ref > 0:
            # Annualize the 24h change
            daily_return = (current_rate / best_ref) - 1
            apy = daily_return * 365 * 100
            # Sanity: sUSDe yield is typically 5-30% APY
            if -5 < apy < 200:
                cursor_clean.execute("""
                    INSERT INTO hourly_stats (timestamp, susde_yield) VALUES (?, ?)
                    ON CONFLICT(timestamp) DO UPDATE SET susde_yield=excluded.susde_yield
                """, (hour_ts, apy))
                count += 1

    return count


def sync_clean_db(force_full=False):
    """Sync raw rate data to hourly aggregated clean DB.

    Incremental by default: only processes data since last sync.
    Set force_full=True for initial bootstrap or recovery.
    """
    start = time.time()

    if not os.path.exists(RAW_DB_PATH):
        print("❌ Raw Database not found!")
        return

    conn_raw = sqlite3.connect(f'file:{RAW_DB_PATH}?mode=ro', uri=True)
    conn_clean = sqlite3.connect(CLEAN_DB_PATH)
    cursor_clean = conn_clean.cursor()

    _ensure_tables(cursor_clean)
    conn_clean.commit()

    # Determine sync mode
    last_synced_ts = int(_get_sync_state(cursor_clean, 'last_synced_timestamp', '0'))
    is_incremental = last_synced_ts > 0 and not force_full

    if is_incremental:
        print(f"🔄 INCREMENTAL SYNC (since ts={last_synced_ts})...")
    else:
        print("🔄 FULL SYNC...")
        last_synced_ts = 1677801600  # March 3, 2023 (genesis)

    # 1. Sync ETH Prices
    eth_count = _sync_eth_prices_incremental(conn_raw, cursor_clean, last_synced_ts)
    if eth_count:
        print(f"   ETH prices: {eth_count} hourly records")

    # 2. Sync protocol asset rates
    for symbol, config in ASSETS.items():
        col_name = SYMBOL_MAP.get(symbol)
        if not col_name or symbol == "sUSDe":
            continue  # sUSDe handled separately
        count = _sync_asset_incremental(conn_raw, cursor_clean, config['table'], col_name, last_synced_ts)
        if count:
            print(f"   {symbol}: {count} hourly records")

    # 3. Sync sUSDe yield (exchange rate → APY)
    susde_count = _sync_susde_yield(conn_raw, cursor_clean, last_synced_ts)
    if susde_count:
        print(f"   sUSDe: {susde_count} hourly records")

    # 4. Update sync timestamps
    now_ts = int(time.time())
    _set_sync_state(cursor_clean, 'last_synced_timestamp', now_ts)

    # 5. Update last_block_number from raw DB
    try:
        cursor_raw = conn_raw.cursor()
        cursor_raw.execute("SELECT MAX(block_number) FROM rates")
        latest_block = cursor_raw.fetchone()[0]
        if latest_block:
            _set_sync_state(cursor_clean, 'last_block_number', latest_block)
    except Exception as e:
        print(f"   ⚠️ Error reading latest block: {e}")

    conn_clean.commit()
    conn_raw.close()
    conn_clean.close()

    elapsed = time.time() - start
    print(f"✅ Sync complete ({elapsed:.2f}s)")


if __name__ == "__main__":
    force = "--full" in sys.argv
    sync_clean_db(force_full=force)
