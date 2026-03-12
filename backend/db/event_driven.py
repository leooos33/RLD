"""
Event-Driven Indexer Database Layer — PostgreSQL.

Two-layer design:
  1. `events`          — immutable append-only audit log of every chain event
  2. State projections — one row per entity, upserted on each relevant event:
       market_meta, market_state, broker_state, pool_state,
       lp_position_state, twamm_order_state, bond_state, price_candles_5m

All writes go through write_batch() for single-transaction-per-block atomicity.
All reads use get_conn() from the shared ThreadedConnectionPool.
"""
import logging
import json
import os
import re
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────
# Connection Pool
# ──────────────────────────────────────────────────────────────

import threading as _threading

_pool: Optional[ThreadedConnectionPool] = None
_pool_sem: Optional[_threading.Semaphore] = None  # guards pool slot acquisition
_schema: str = "sim_default"


def _sanitize_schema(sim_id: str) -> str:
    clean = re.sub(r"[^a-z0-9_]", "_", sim_id.lower())
    return f"sim_{clean}"


def init_db(db_url: str = None, sim_id: str = "default"):
    """Initialize connection pool, create schema, run migrations."""
    global _pool, _schema, _pool_sem

    if db_url is None:
        db_url = os.environ.get(
            "DB_URL",
            "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer",
        )

    _schema = _sanitize_schema(sim_id)
    max_conn = int(os.environ.get("DB_POOL_MAX", "20"))
    _pool = ThreadedConnectionPool(minconn=3, maxconn=max_conn, dsn=db_url)
    _pool_sem = _threading.Semaphore(max_conn)

    conn = _pool.getconn()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {_schema}")
        conn.autocommit = False
        _run_migrations(conn)
        conn.commit()
    finally:
        _pool.putconn(conn)

    logger.info(f"✅ Event-Driven DB initialized (schema={_schema}, pool_max={max_conn})")


def close_db():
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None


@contextmanager
def get_conn():
    """Read connection from pool (max-wait 5s to avoid deadlock)."""
    if not _pool_sem.acquire(timeout=5):
        raise RuntimeError("DB pool exhausted — no connection available within 5s")
    conn = _pool.getconn()
    try:
        conn.cursor().execute(f"SET search_path TO {_schema}, public")
        yield conn
    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        _pool.putconn(conn)
        _pool_sem.release()


@contextmanager
def write_batch():
    """Single transaction for all writes in one block snapshot."""
    if not _pool_sem.acquire(timeout=10):
        raise RuntimeError("DB pool exhausted for write_batch")
    conn = _pool.getconn()
    try:
        conn.cursor().execute(f"SET search_path TO {_schema}, public")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)
        _pool_sem.release()


# ──────────────────────────────────────────────────────────────
# Schema Migrations
# ──────────────────────────────────────────────────────────────

def _run_migrations(conn):
    with conn.cursor() as cur:
        cur.execute(f"SET search_path TO {_schema}, public")

        # ── Indexer checkpoint ─────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS indexer_state (
                id                 INTEGER PRIMARY KEY CHECK (id = 1),
                last_indexed_block BIGINT NOT NULL DEFAULT 0,
                last_indexed_ts    BIGINT
            )
        """)

        # ── Immutable audit log ────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id            BIGSERIAL PRIMARY KEY,
                block_number  BIGINT NOT NULL,
                block_ts      BIGINT NOT NULL,
                tx_hash       TEXT NOT NULL,
                log_index     INTEGER NOT NULL,
                event_name    TEXT NOT NULL,
                contract_addr TEXT NOT NULL,
                market_id     TEXT,
                data          JSONB,
                UNIQUE (tx_hash, log_index)
            )
        """)

        # ── Market metadata (one row per market) ──────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_meta (
                market_id                TEXT PRIMARY KEY,
                tx_hash                  TEXT,
                collateral_token         TEXT,
                underlying_token         TEXT,
                underlying_pool          TEXT,
                rate_oracle              TEXT,
                spot_oracle              TEXT,
                curator                  TEXT,
                liquidation_module       TEXT,
                position_token           TEXT,
                position_token_symbol    TEXT,
                min_col_ratio            NUMERIC,
                maintenance_margin       NUMERIC,
                liquidation_close_factor NUMERIC,
                funding_period           INTEGER,
                debt_cap                 NUMERIC,
                broker_verifier          TEXT,
                deployment_block         BIGINT,
                deployment_ts            BIGINT
            )
        """)

        # ── Market state (one row per market, upserted on FundingApplied / PositionModified) ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_state (
                market_id              TEXT PRIMARY KEY,
                normalization_factor   NUMERIC NOT NULL DEFAULT 1000000000000000000,
                total_debt             NUMERIC NOT NULL DEFAULT 0,
                last_update_ts         BIGINT,
                last_block             BIGINT
            )
        """)

        # ── Broker state (one row per broker) ─────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS broker_state (
                broker_address  TEXT PRIMARY KEY,
                market_id       TEXT,
                owner           TEXT,
                debt_principal  NUMERIC NOT NULL DEFAULT 0,
                -- ERC20 token balances (updated from Transfer events)
                collateral_balance  NUMERIC NOT NULL DEFAULT 0,
                position_balance    NUMERIC NOT NULL DEFAULT 0,
                last_block          BIGINT,
                last_updated_ts     BIGINT
            )
        """)

        # ── Pool state (one row per pool, upserted on Swap / ModifyLiquidity) ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pool_state (
                pool_id           TEXT PRIMARY KEY,
                market_id         TEXT,
                sqrt_price_x96    NUMERIC,
                tick              INTEGER,
                liquidity         NUMERIC,
                mark_price        DOUBLE PRECISION,
                fee_growth0       NUMERIC DEFAULT 0,
                fee_growth1       NUMERIC DEFAULT 0,
                token0_balance    NUMERIC DEFAULT 0,
                token1_balance    NUMERIC DEFAULT 0,
                last_block        BIGINT
            )
        """)

        # ── LP position state (one row per NFT token_id) ──────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS lp_position_state (
                token_id        BIGINT PRIMARY KEY,
                broker_address  TEXT,
                pool_id         TEXT,
                tick_lower      INTEGER NOT NULL DEFAULT 0,
                tick_upper      INTEGER NOT NULL DEFAULT 0,
                liquidity       NUMERIC NOT NULL DEFAULT 0,
                mint_block      BIGINT,
                last_block      BIGINT
            )
        """)

        # ── TWAMM order state ──────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS twamm_order_state (
                order_id        TEXT PRIMARY KEY,
                pool_id         TEXT,
                owner           TEXT,
                amount_in       NUMERIC,
                zero_for_one    BOOLEAN,
                sell_rate       NUMERIC,
                status          TEXT DEFAULT 'active',
                start_epoch     BIGINT,
                settled_amount  NUMERIC DEFAULT 0,
                open_block      BIGINT,
                close_block     BIGINT
            )
        """)

        # ── Bond / BasisTrade state ────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bond_state (
                broker_address      TEXT PRIMARY KEY,
                owner               TEXT,
                factory             TEXT,
                bond_type           TEXT DEFAULT 'bond',
                notional            NUMERIC,
                hedge               NUMERIC,
                duration            INTEGER,
                status              TEXT DEFAULT 'active',
                collateral_returned NUMERIC DEFAULT 0,
                position_returned   NUMERIC DEFAULT 0,
                open_block          BIGINT,
                open_ts             BIGINT,
                open_tx             TEXT,
                close_block         BIGINT,
                close_ts            BIGINT,
                close_tx            TEXT
            )
        """)

        # ── 5-minute OHLCV candles (written only on Swap events) ──
        _CANDLE_SCHEMA = """
            CREATE TABLE IF NOT EXISTS {table} (
                ts          BIGINT NOT NULL,
                pool_id     TEXT NOT NULL,
                mark_open   DOUBLE PRECISION,
                mark_high   DOUBLE PRECISION,
                mark_low    DOUBLE PRECISION,
                mark_close  DOUBLE PRECISION,
                index_open  DOUBLE PRECISION,
                index_high  DOUBLE PRECISION,
                index_low   DOUBLE PRECISION,
                index_close DOUBLE PRECISION,
                volume      NUMERIC DEFAULT 0,
                swap_count  INTEGER DEFAULT 0,
                PRIMARY KEY (ts, pool_id)
            )
        """
        for _tbl in ("price_candles_5m", "price_candles_15m",
                     "price_candles_1h", "price_candles_4h", "price_candles_1d"):
            cur.execute(_CANDLE_SCHEMA.format(table=_tbl))

        # ── Block-indexed state log (sparse: written only on state-changing blocks) ──
        cur.execute("""
            CREATE TABLE IF NOT EXISTS block_state (
                block_number          BIGINT           PRIMARY KEY,
                block_ts              BIGINT           NOT NULL,
                -- market snapshot
                normalization_factor  NUMERIC,
                total_debt            NUMERIC,
                -- pool snapshot
                sqrt_price_x96        NUMERIC,
                tick                  INTEGER,
                liquidity             NUMERIC,
                mark_price            DOUBLE PRECISION,
                -- oracle price (from rates-indexer, with stale flag)
                index_price           DOUBLE PRECISION,
                price_stale           BOOLEAN          NOT NULL DEFAULT FALSE,
                -- which event names fired in this block
                events                JSONB            NOT NULL DEFAULT '[]'
            )
        """)

        _create_indexes(cur)


def _create_indexes(cur):
    indexes = [
        ("idx_events_block",      "events",              "block_number"),
        ("idx_events_name",       "events",              "event_name"),
        ("idx_events_market",     "events",              "market_id"),
        ("idx_events_ts",         "events",              "block_ts"),
        ("idx_broker_market",     "broker_state",        "market_id"),
        ("idx_lp_active",         "lp_position_state",   "pool_id"),
        ("idx_lp_broker",         "lp_position_state",   "broker_address"),
        ("idx_twamm_status",      "twamm_order_state",   "status"),
        ("idx_twamm_owner",       "twamm_order_state",   "owner"),
        ("idx_bond_owner",        "bond_state",          "owner"),
        ("idx_bond_status",       "bond_state",          "status"),
        ("idx_candles_5m",        "price_candles_5m",    "pool_id, ts DESC"),
        ("idx_candles_15m",       "price_candles_15m",   "pool_id, ts DESC"),
        ("idx_candles_1h",        "price_candles_1h",    "pool_id, ts DESC"),
        ("idx_candles_4h",        "price_candles_4h",    "pool_id, ts DESC"),
        ("idx_candles_1d",        "price_candles_1d",    "pool_id, ts DESC"),
        # block_state index (may not exist on old DBs — savepoint handles it)
        ("idx_block_state_ts",    "block_state",         "block_ts"),
    ]
    for idx_name, table, col in indexes:
        try:
            cur.execute("SAVEPOINT idx_sp")
            cur.execute(
                f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({col})"
            )
            cur.execute("RELEASE SAVEPOINT idx_sp")
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT idx_sp")


# ──────────────────────────────────────────────────────────────
# Sim Data Reset (called on simulation restart)
# ──────────────────────────────────────────────────────────────

def clear_sim_data():
    """Truncate all projection tables. Called when simulation is restarted.
    Preserves table structure; only removes rows."""
    TABLES = [
        "block_state", "price_candles_5m", "price_candles_15m",
        "price_candles_1h", "price_candles_4h", "price_candles_1d",
        "bond_state", "twamm_order_state", "lp_position_state",
        "broker_state", "pool_state", "market_state", "market_meta",
        "events", "indexer_state",
    ]
    with write_batch() as conn:
        cur = conn.cursor()
        for t in TABLES:
            cur.execute(f"TRUNCATE TABLE {t} CASCADE")
    logger.info(f"🗑️  Cleared all event-driven data in schema {_schema}")


# ──────────────────────────────────────────────────────────────
# Indexer State
# ──────────────────────────────────────────────────────────────

def get_last_indexed_block() -> int:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT last_indexed_block FROM indexer_state WHERE id = 1")
        row = cur.fetchone()
        return row[0] if row else 0


def update_last_indexed_block(block_number: int, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO indexer_state (id, last_indexed_block)
            VALUES (1, %s)
            ON CONFLICT (id) DO UPDATE SET last_indexed_block = EXCLUDED.last_indexed_block
        """, (block_number,))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


# ──────────────────────────────────────────────────────────────
# Block-Indexed State Log
# ──────────────────────────────────────────────────────────────

def upsert_block_state(
    block_number: int,
    block_ts: int,
    normalization_factor: Optional[float],
    total_debt: Optional[float],
    sqrt_price_x96: Optional[int],
    tick: Optional[int],
    liquidity: Optional[int],
    mark_price: Optional[float],
    index_price: Optional[float],
    price_stale: bool,
    events: List[str],
    cur=None,
):
    """Write one block_state row. Idempotent (ON CONFLICT DO UPDATE)."""
    def _do(c):
        c.execute("""
            INSERT INTO block_state (
                block_number, block_ts,
                normalization_factor, total_debt,
                sqrt_price_x96, tick, liquidity, mark_price,
                index_price, price_stale, events
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (block_number) DO UPDATE SET
                block_ts             = EXCLUDED.block_ts,
                normalization_factor = COALESCE(EXCLUDED.normalization_factor, block_state.normalization_factor),
                total_debt           = COALESCE(EXCLUDED.total_debt,           block_state.total_debt),
                sqrt_price_x96       = COALESCE(EXCLUDED.sqrt_price_x96,       block_state.sqrt_price_x96),
                tick                 = COALESCE(EXCLUDED.tick,                 block_state.tick),
                liquidity            = COALESCE(EXCLUDED.liquidity,            block_state.liquidity),
                mark_price           = COALESCE(EXCLUDED.mark_price,           block_state.mark_price),
                index_price          = COALESCE(EXCLUDED.index_price,          block_state.index_price),
                price_stale          = EXCLUDED.price_stale,
                events               = EXCLUDED.events
        """, (
            block_number, block_ts,
            str(normalization_factor) if normalization_factor is not None else None,
            str(total_debt) if total_debt is not None else None,
            str(sqrt_price_x96) if sqrt_price_x96 is not None else None,
            tick, str(liquidity) if liquidity is not None else None,
            mark_price, index_price, price_stale,
            json.dumps(events),
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_block_state(block_number: int) -> Optional[Dict]:
    """Return state at block_number, or the nearest prior block if exact not found."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT * FROM block_state
            WHERE block_number <= %s
            ORDER BY block_number DESC
            LIMIT 1
        """, (block_number,))
        row = cur.fetchone()
        return dict(row) if row else None


def get_latest_block_state() -> Optional[Dict]:
    """Return the most recent block_state row."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM block_state ORDER BY block_number DESC LIMIT 1")
        row = cur.fetchone()
        return dict(row) if row else None


# ──────────────────────────────────────────────────────────────
# Events (audit log)
# ──────────────────────────────────────────────────────────────

def insert_event(block_number: int, block_ts: int, tx_hash: str, log_index: int,
                 event_name: str, contract_addr: str, market_id: Optional[str],
                 data: Dict, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO events
                (block_number, block_ts, tx_hash, log_index, event_name,
                 contract_addr, market_id, data)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tx_hash, log_index) DO NOTHING
        """, (block_number, block_ts, tx_hash, log_index, event_name,
              contract_addr, market_id,
              json.dumps(data) if isinstance(data, dict) else data))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_events(from_block: int = None, to_block: int = None,
               event_name: str = None, market_id: str = None,
               limit: int = 200) -> List[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses, params = [], []
        if from_block is not None:
            clauses.append("block_number >= %s"); params.append(from_block)
        if to_block is not None:
            clauses.append("block_number <= %s"); params.append(to_block)
        if event_name:
            clauses.append("event_name = %s"); params.append(event_name)
        if market_id:
            clauses.append("market_id = %s"); params.append(market_id)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        cur.execute(
            f"SELECT * FROM events {where} ORDER BY block_number DESC, log_index ASC LIMIT %s",
            params + [limit]
        )
        return [dict(r) for r in cur.fetchall()]


# ──────────────────────────────────────────────────────────────
# Market Projections
# ──────────────────────────────────────────────────────────────

def upsert_market_meta(market_id: str, data: Dict, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO market_meta (
                market_id, tx_hash, collateral_token, underlying_token,
                underlying_pool, rate_oracle, spot_oracle, curator,
                liquidation_module, position_token, position_token_symbol,
                min_col_ratio, maintenance_margin, liquidation_close_factor,
                funding_period, debt_cap, broker_verifier,
                deployment_block, deployment_ts
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (market_id) DO UPDATE SET
                collateral_token         = COALESCE(EXCLUDED.collateral_token,         market_meta.collateral_token),
                underlying_token         = COALESCE(EXCLUDED.underlying_token,         market_meta.underlying_token),
                underlying_pool          = COALESCE(EXCLUDED.underlying_pool,          market_meta.underlying_pool),
                rate_oracle              = COALESCE(EXCLUDED.rate_oracle,              market_meta.rate_oracle),
                spot_oracle              = COALESCE(EXCLUDED.spot_oracle,              market_meta.spot_oracle),
                curator                  = COALESCE(EXCLUDED.curator,                  market_meta.curator),
                liquidation_module       = COALESCE(EXCLUDED.liquidation_module,       market_meta.liquidation_module),
                position_token           = COALESCE(EXCLUDED.position_token,           market_meta.position_token),
                position_token_symbol    = COALESCE(EXCLUDED.position_token_symbol,    market_meta.position_token_symbol),
                min_col_ratio            = COALESCE(EXCLUDED.min_col_ratio,            market_meta.min_col_ratio),
                maintenance_margin       = COALESCE(EXCLUDED.maintenance_margin,       market_meta.maintenance_margin),
                liquidation_close_factor = COALESCE(EXCLUDED.liquidation_close_factor, market_meta.liquidation_close_factor),
                funding_period           = COALESCE(EXCLUDED.funding_period,           market_meta.funding_period),
                debt_cap                 = COALESCE(EXCLUDED.debt_cap,                 market_meta.debt_cap),
                broker_verifier          = COALESCE(EXCLUDED.broker_verifier,          market_meta.broker_verifier),
                deployment_block         = COALESCE(EXCLUDED.deployment_block,         market_meta.deployment_block),
                deployment_ts            = COALESCE(EXCLUDED.deployment_ts,            market_meta.deployment_ts)
        """, (
            market_id,
            data.get("tx_hash"), data.get("collateral_token"), data.get("underlying_token"),
            data.get("underlying_pool"), data.get("rate_oracle"), data.get("spot_oracle"),
            data.get("curator"), data.get("liquidation_module"), data.get("position_token"),
            data.get("position_token_symbol"),
            data.get("min_col_ratio"), data.get("maintenance_margin"),
            data.get("liquidation_close_factor"), data.get("funding_period"),
            data.get("debt_cap"), data.get("broker_verifier"),
            data.get("deployment_block"), data.get("deployment_ts"),
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def upsert_market_state(market_id: str, normalization_factor: int,
                        total_debt: int, last_update_ts: int,
                        block_number: int, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO market_state (market_id, normalization_factor, total_debt, last_update_ts, last_block)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (market_id) DO UPDATE SET
                normalization_factor = EXCLUDED.normalization_factor,
                total_debt           = EXCLUDED.total_debt,
                last_update_ts       = EXCLUDED.last_update_ts,
                last_block           = EXCLUDED.last_block
        """, (market_id, normalization_factor, total_debt, last_update_ts, block_number))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_all_markets() -> List[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT m.*, s.normalization_factor, s.total_debt,
                   s.last_update_ts, s.last_block as state_block
            FROM market_meta m
            LEFT JOIN market_state s ON s.market_id = m.market_id
            ORDER BY m.deployment_ts DESC
        """)
        return [dict(r) for r in cur.fetchall()]


def get_market(market_id: str) -> Optional[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT m.*, s.normalization_factor, s.total_debt,
                   s.last_update_ts, s.last_block as state_block
            FROM market_meta m
            LEFT JOIN market_state s ON s.market_id = m.market_id
            WHERE m.market_id = %s
        """, (market_id,))
        row = cur.fetchone()
        return dict(row) if row else None


# ──────────────────────────────────────────────────────────────
# Broker State Projections
# ──────────────────────────────────────────────────────────────

def upsert_broker_state(broker_address: str, market_id: str = None,
                        owner: str = None, debt_delta: int = 0,
                        collateral_delta: int = 0, position_delta: int = 0,
                        block_number: int = 0, block_ts: int = 0, cur=None):
    """
    Register broker (if new) and apply signed deltas from PositionModified / Transfer events.
    Debt, collateral, position balances accumulate — never set directly from events.
    """
    def _do(c):
        # Ensure broker row exists
        c.execute("""
            INSERT INTO broker_state (broker_address, market_id, owner, last_block, last_updated_ts)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (broker_address) DO UPDATE SET
                market_id       = COALESCE(EXCLUDED.market_id, broker_state.market_id),
                owner           = COALESCE(EXCLUDED.owner, broker_state.owner),
                last_block      = GREATEST(broker_state.last_block, EXCLUDED.last_block),
                last_updated_ts = EXCLUDED.last_updated_ts
        """, (broker_address, market_id, owner, block_number, block_ts))

        # Apply deltas (separate update so we don't override with 0s)
        if debt_delta != 0:
            c.execute("""
                UPDATE broker_state
                SET debt_principal = GREATEST(0, debt_principal + %s)
                WHERE broker_address = %s
            """, (debt_delta, broker_address))
        if collateral_delta != 0:
            c.execute("""
                UPDATE broker_state
                SET collateral_balance = GREATEST(0, collateral_balance + %s)
                WHERE broker_address = %s
            """, (collateral_delta, broker_address))
        if position_delta != 0:
            c.execute("""
                UPDATE broker_state
                SET position_balance = GREATEST(0, position_balance + %s)
                WHERE broker_address = %s
            """, (position_delta, broker_address))

    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_broker(broker_address: str) -> Optional[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM broker_state WHERE broker_address = %s",
                    (broker_address,))
        row = cur.fetchone()
        return dict(row) if row else None


def get_all_brokers(market_id: str = None) -> List[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if market_id:
            cur.execute("SELECT * FROM broker_state WHERE market_id = %s ORDER BY last_block DESC",
                        (market_id,))
        else:
            cur.execute("SELECT * FROM broker_state ORDER BY last_block DESC")
        return [dict(r) for r in cur.fetchall()]


# ──────────────────────────────────────────────────────────────
# Pool State Projections
# ──────────────────────────────────────────────────────────────

def upsert_pool_state(pool_id: str, market_id: str, state: Dict, block_number: int, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO pool_state (
                pool_id, market_id, sqrt_price_x96, tick, liquidity,
                mark_price, fee_growth0, fee_growth1,
                token0_balance, token1_balance, last_block
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (pool_id) DO UPDATE SET
                market_id      = COALESCE(EXCLUDED.market_id,      pool_state.market_id),
                sqrt_price_x96 = EXCLUDED.sqrt_price_x96,
                tick           = EXCLUDED.tick,
                liquidity      = EXCLUDED.liquidity,
                mark_price     = EXCLUDED.mark_price,
                fee_growth0    = COALESCE(EXCLUDED.fee_growth0,    pool_state.fee_growth0),
                fee_growth1    = COALESCE(EXCLUDED.fee_growth1,    pool_state.fee_growth1),
                token0_balance = COALESCE(EXCLUDED.token0_balance, pool_state.token0_balance),
                token1_balance = COALESCE(EXCLUDED.token1_balance, pool_state.token1_balance),
                last_block     = EXCLUDED.last_block
        """, (
            pool_id, market_id,
            str(state.get("sqrt_price_x96", 0)),
            state.get("tick", 0),
            str(state.get("liquidity", 0)),
            state.get("mark_price"),
            str(state.get("fee_growth0", 0)),
            str(state.get("fee_growth1", 0)),
            str(state.get("token0_balance", 0)),
            str(state.get("token1_balance", 0)),
            block_number,
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_pool(pool_id: str) -> Optional[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM pool_state WHERE pool_id = %s", (pool_id,))
        row = cur.fetchone()
        return dict(row) if row else None


# ──────────────────────────────────────────────────────────────
# LP Position State Projections
# ──────────────────────────────────────────────────────────────

def upsert_lp_position(token_id: int, broker_address: str = None,
                       pool_id: str = None, tick_lower: int = None,
                       tick_upper: int = None, liquidity_delta: int = 0,
                       mint_block: int = None, block_number: int = 0, cur=None):
    """
    Apply a liquidity delta from a ModifyLiquidity event.
    Tick bounds are set on first insert (mint), never changed after.
    Liquidity accumulates (can go negative → floor at 0 = fully removed).
    """
    def _do(c):
        c.execute("""
            INSERT INTO lp_position_state
                (token_id, broker_address, pool_id, tick_lower, tick_upper,
                 liquidity, mint_block, last_block)
            VALUES (%s, %s, %s, %s, %s, GREATEST(0, %s), %s, %s)
            ON CONFLICT (token_id) DO UPDATE SET
                broker_address = COALESCE(EXCLUDED.broker_address, lp_position_state.broker_address),
                pool_id        = COALESCE(EXCLUDED.pool_id,        lp_position_state.pool_id),
                tick_lower     = COALESCE(EXCLUDED.tick_lower,     lp_position_state.tick_lower),
                tick_upper     = COALESCE(EXCLUDED.tick_upper,     lp_position_state.tick_upper),
                liquidity      = GREATEST(0, lp_position_state.liquidity + %s),
                mint_block     = COALESCE(lp_position_state.mint_block, EXCLUDED.mint_block),
                last_block     = EXCLUDED.last_block
        """, (
            token_id, broker_address, pool_id,
            tick_lower or 0, tick_upper or 0,
            liquidity_delta, mint_block, block_number,
            # Second liquidity_delta for the ON CONFLICT SET clause
            liquidity_delta,
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def update_lp_owner(token_id: int, new_owner: str, block_number: int, cur=None):
    """Handle ERC721 Transfer → update ownership."""
    def _do(c):
        c.execute("""
            UPDATE lp_position_state
            SET broker_address = %s, last_block = %s
            WHERE token_id = %s
        """, (new_owner, block_number, token_id))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_lp_distribution(pool_id: str) -> List[Dict]:
    """Compute liquidity distribution from local state. Zero RPC calls."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT tick_lower, tick_upper,
                   SUM(liquidity)::TEXT as liquidity,
                   COUNT(*) as position_count
            FROM lp_position_state
            WHERE pool_id = %s AND liquidity > 0
            GROUP BY tick_lower, tick_upper
            ORDER BY tick_lower
        """, (pool_id,))
        return [dict(r) for r in cur.fetchall()]


def get_broker_lp_positions(broker_address: str) -> List[Dict]:
    """Get all active LP positions for a broker. Zero RPC calls."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT * FROM lp_position_state
            WHERE broker_address = %s AND liquidity > 0
            ORDER BY token_id
        """, (broker_address,))
        return [dict(r) for r in cur.fetchall()]


# ──────────────────────────────────────────────────────────────
# TWAMM Order State
# ──────────────────────────────────────────────────────────────

def upsert_twamm_order(order_id: str, data: Dict, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO twamm_order_state
                (order_id, pool_id, owner, amount_in, zero_for_one, sell_rate,
                 status, start_epoch, open_block)
            VALUES (%s,%s,%s,%s,%s,%s,'active',%s,%s)
            ON CONFLICT (order_id) DO UPDATE SET
                status         = COALESCE(EXCLUDED.status, twamm_order_state.status),
                settled_amount = COALESCE(EXCLUDED.settled_amount, twamm_order_state.settled_amount),
                close_block    = COALESCE(EXCLUDED.close_block, twamm_order_state.close_block)
        """, (
            order_id,
            data.get("pool_id"), data.get("owner"),
            data.get("amount_in", 0), data.get("zero_for_one", False),
            data.get("sell_rate", 0), data.get("start_epoch", 0),
            data.get("open_block", 0),
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def close_twamm_order(order_id: str, status: str, block_number: int,
                      settled_amount: int = 0, cur=None):
    def _do(c):
        c.execute("""
            UPDATE twamm_order_state
            SET status = %s, close_block = %s, settled_amount = settled_amount + %s
            WHERE order_id = %s
        """, (status, block_number, settled_amount, order_id))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_active_orders(pool_id: str = None) -> List[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if pool_id:
            cur.execute("SELECT * FROM twamm_order_state WHERE status='active' AND pool_id=%s",
                        (pool_id,))
        else:
            cur.execute("SELECT * FROM twamm_order_state WHERE status='active'")
        return [dict(r) for r in cur.fetchall()]


# ──────────────────────────────────────────────────────────────
# Bond / BasisTrade State
# ──────────────────────────────────────────────────────────────

def upsert_bond(broker_address: str, data: Dict, cur=None):
    def _do(c):
        c.execute("""
            INSERT INTO bond_state
                (broker_address, owner, factory, bond_type, notional, hedge,
                 duration, status, open_block, open_ts, open_tx)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s)
            ON CONFLICT (broker_address) DO NOTHING
        """, (
            broker_address.lower(),
            data.get("owner", "").lower(),
            (data.get("factory") or "").lower(),
            data.get("bond_type", "bond"),
            data.get("notional", 0), data.get("hedge", 0),
            data.get("duration", 0),
            data.get("open_block", 0), data.get("open_ts", 0),
            data.get("open_tx", ""),
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def close_bond(broker_address: str, status: str, block_number: int,
               block_ts: int, tx_hash: str,
               collateral_returned: int = 0, position_returned: int = 0, cur=None):
    def _do(c):
        c.execute("""
            UPDATE bond_state SET
                status              = %s,
                close_block         = %s,
                close_ts            = %s,
                close_tx            = %s,
                collateral_returned = %s,
                position_returned   = %s
            WHERE broker_address = %s
        """, (status, block_number, block_ts, tx_hash,
              collateral_returned, position_returned,
              broker_address.lower()))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_active_bonds(bond_type: str = None) -> List[Dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if bond_type:
            cur.execute("SELECT * FROM bond_state WHERE status='active' AND bond_type=%s",
                        (bond_type,))
        else:
            cur.execute("SELECT * FROM bond_state WHERE status='active'")
        return [dict(r) for r in cur.fetchall()]


# ──────────────────────────────────────────────────────────────
# Price Candles
# ──────────────────────────────────────────────────────────────

def upsert_candle(pool_id: str, block_ts: int, mark_price: float,
                  index_price: float = None, swap_volume: int = 0, cur=None):
    """Upsert into the 5-minute candle bucket containing block_ts."""
    bucket = (block_ts // 300) * 300  # floor to 5-min

    def _do(c):
        c.execute("""
            INSERT INTO price_candles_5m
                (ts, pool_id, mark_open, mark_high, mark_low, mark_close,
                 index_open, index_high, index_low, index_close,
                 volume, swap_count)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1)
            ON CONFLICT (ts, pool_id) DO UPDATE SET
                mark_high   = GREATEST(price_candles_5m.mark_high,  EXCLUDED.mark_close),
                mark_low    = LEAST(price_candles_5m.mark_low,      EXCLUDED.mark_close),
                mark_close  = EXCLUDED.mark_close,
                index_high  = GREATEST(price_candles_5m.index_high, EXCLUDED.index_close),
                index_low   = LEAST(price_candles_5m.index_low,     EXCLUDED.index_close),
                index_close = EXCLUDED.index_close,
                volume      = price_candles_5m.volume + EXCLUDED.volume,
                swap_count  = price_candles_5m.swap_count + 1
        """, (
            bucket, pool_id,
            mark_price, mark_price, mark_price, mark_price,
            index_price, index_price, index_price, index_price,
            swap_volume,
        ))
    if cur:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_candles(pool_id: str, from_ts: int = None, to_ts: int = None,
                limit: int = 500, resolution: str = "5m") -> List[Dict]:
    """
    Get OHLCV candles for a pool at the requested resolution.
    resolution must be one of: 5m, 15m, 1h, 4h, 1d
    """
    _valid = {"5m", "15m", "1h", "4h", "1d"}
    if resolution not in _valid:
        raise ValueError(f"Invalid resolution '{resolution}'. Must be one of: {_valid}")
    table = f"price_candles_{resolution}"

    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = ["pool_id = %s"]
        params = [pool_id]
        if from_ts:
            clauses.append("ts >= %s"); params.append(from_ts)
        if to_ts:
            clauses.append("ts <= %s"); params.append(to_ts)
        cur.execute(
            f"SELECT * FROM {table} WHERE {' AND '.join(clauses)} "
            f"ORDER BY ts ASC LIMIT %s",
            params + [limit]
        )
        return [dict(r) for r in cur.fetchall()]




# ──────────────────────────────────────────────────────────────
# API Compatibility Shims
# (drop-in replacements for deprecated db.comprehensive functions)
# ──────────────────────────────────────────────────────────────

def get_bonds_by_owner(owner: str, status_filter: str = None) -> List[Dict]:
    """Get bonds for a specific owner address. Compatible with indexer_api.py."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        params = [owner.lower()]
        q = "SELECT * FROM bond_state WHERE LOWER(owner) = %s"
        if status_filter:
            q += " AND status = %s"
            params.append(status_filter)
        q += " ORDER BY open_block DESC"
        cur.execute(q, params)
        return [dict(r) for r in cur.fetchall()]


def get_all_bonds(status_filter: str = None, limit: int = 100) -> List[Dict]:
    """Get all bonds, optionally filtered by status. Compatible with indexer_api.py."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if status_filter:
            cur.execute(
                "SELECT * FROM bond_state WHERE status = %s ORDER BY open_block DESC LIMIT %s",
                (status_filter, limit)
            )
        else:
            cur.execute(
                "SELECT * FROM bond_state ORDER BY open_block DESC LIMIT %s",
                (limit,)
            )
        return [dict(r) for r in cur.fetchall()]


def get_bond(broker_address: str) -> Optional[Dict]:
    """Get a single bond by its broker address. Compatible with indexer_api.py."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM bond_state WHERE LOWER(broker_address) = LOWER(%s) LIMIT 1",
            (broker_address,)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_lp_positions(pool_id: str = None, active_only: bool = True) -> List[Dict]:
    """Get LP positions, optionally filtered by pool and active status.
    Compatible with the lp-distribution endpoint in indexer_api.py.
    Returns rows with 'current_liquidity' alias so API code works unmodified.
    """
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = []
        params: list = []
        if pool_id:
            clauses.append("pool_id = %s"); params.append(pool_id)
        if active_only:
            clauses.append("liquidity > 0")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        cur.execute(
            f"SELECT *, liquidity AS current_liquidity FROM lp_position_state {where} ORDER BY token_id",
            params
        )
        return [dict(r) for r in cur.fetchall()]


def get_latest_summary() -> Dict:
    """Get the latest market/pool/broker snapshot. Compatible with graphql_schema.py.

    Schema (all single-row or small tables keyed by ID):
      market_state: market_id, last_block, last_update_ts, normalization_factor, total_debt
      pool_state:   pool_id, last_block, sqrt_price_x96, tick, liquidity, mark_price, ...
      broker_state: broker_address, last_block, collateral_balance, debt_principal, ...
    """
    try:
        with get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            # Market state (keyed by market_id — single row per market)
            cur.execute("SELECT *, last_block AS block_number, last_update_ts AS block_timestamp FROM market_state LIMIT 1")
            ms = cur.fetchone()
            # Pool state (keyed by pool_id)
            cur.execute("SELECT *, last_block AS block_number FROM pool_state LIMIT 1")
            ps = cur.fetchone()
            # All active brokers — rename columns to match graphql_schema expectations
            cur.execute("""
                SELECT *,
                       collateral_balance AS collateral,
                       debt_principal     AS debt,
                       collateral_balance AS collateral_value,
                       debt_principal     AS debt_value,
                       CASE WHEN debt_principal = 0 THEN 999.0
                            ELSE collateral_balance::float / debt_principal::float END AS health_factor
                FROM broker_state ORDER BY broker_address
            """)
            brokers = cur.fetchall()
            block_number = (ms or {}).get("last_block", 0)
            return {
                "block_number": block_number,
                "market_states": [dict(ms)] if ms else [],
                "pool_states": [dict(ps)] if ps else [],
                "broker_positions": [dict(b) for b in brokers],
            }
    except Exception as e:
        return {"error": str(e), "block_number": 0,
                "market_states": [], "pool_states": [], "broker_positions": []}


def get_block_summary(block_number: int) -> Dict:
    """Get market/pool/broker snapshot at a specific block. Compatible with graphql_schema.py."""
    try:
        with get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("""
                SELECT *, last_block AS block_number, last_update_ts AS block_timestamp
                FROM market_state WHERE last_block <= %s ORDER BY last_block DESC LIMIT 1
            """, (block_number,))
            ms = cur.fetchone()
            cur.execute("""
                SELECT *, last_block AS block_number
                FROM pool_state WHERE last_block <= %s ORDER BY last_block DESC LIMIT 1
            """, (block_number,))
            ps = cur.fetchone()
            cur.execute("""
                SELECT *,
                       collateral_balance AS collateral,
                       debt_principal     AS debt,
                       collateral_balance AS collateral_value,
                       debt_principal     AS debt_value,
                       CASE WHEN debt_principal = 0 THEN 999.0
                            ELSE collateral_balance::float / debt_principal::float END AS health_factor
                FROM broker_state ORDER BY broker_address
            """)
            brokers = cur.fetchall()
            return {
                "block_number": block_number,
                "market_states": [dict(ms)] if ms else [],
                "pool_states": [dict(ps)] if ps else [],
                "broker_positions": [dict(b) for b in brokers],
            }
    except Exception as e:
        return {"error": str(e), "block_number": block_number,
                "market_states": [], "pool_states": [], "broker_positions": []}


def get_all_latest_lp_positions() -> List[Dict]:
    """Get all active LP positions across all brokers. Compatible with graphql_schema.py."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT *, liquidity AS current_liquidity
            FROM lp_position_state
            WHERE liquidity > 0
            ORDER BY broker_address, token_id
        """)
        return [dict(r) for r in cur.fetchall()]
