"""
Comprehensive Indexer Database Layer — PostgreSQL.

Thread-safe connection pool with schema-per-simulation isolation.
All writes go through write_batch() for single-transaction-per-block atomicity.
All reads go through get_conn() which pulls from the pool.
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

# ============================================
# Connection Pool (module-level singleton)
# ============================================

_pool: Optional[ThreadedConnectionPool] = None
_sim_schema: str = "sim_default"


def _sanitize_schema(sim_id: str) -> str:
    """Sanitize sim_id into a valid Postgres schema name."""
    clean = re.sub(r"[^a-z0-9_]", "_", sim_id.lower())
    return f"sim_{clean}"


def init_db(db_url: str = None, sim_id: str = "default"):
    """Initialize connection pool, create schema, and run migrations.
    
    Args:
        db_url: PostgreSQL connection string. Defaults to DB_URL env var.
        sim_id: Simulation identifier for schema isolation. Defaults to SIM_ID env var.
    """
    global _pool, _sim_schema

    if db_url is None:
        db_url = os.environ.get(
            "DB_URL",
            "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer",
        )

    _sim_schema = _sanitize_schema(sim_id)
    _pool = ThreadedConnectionPool(minconn=2, maxconn=10, dsn=db_url)

    # Create schema + tables
    conn = _pool.getconn()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {_sim_schema}")
        conn.autocommit = False
        _run_migrations(conn)
        conn.commit()
    finally:
        _pool.putconn(conn)

    logger.info(f"✅ PostgreSQL DB initialized (schema={_sim_schema})")


def close_db():
    """Close the connection pool."""
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None


@contextmanager
def get_conn():
    """Get a read connection from the pool with search_path set.
    
    Usage:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT ...")
    """
    conn = _pool.getconn()
    try:
        conn.cursor().execute(f"SET search_path TO {_sim_schema}, public")
        yield conn
    finally:
        try:
            conn.rollback()  # Ensure clean state is returned to pool
        except Exception:
            pass
        _pool.putconn(conn)


@contextmanager
def write_batch():
    """Single transaction context for all writes in a block snapshot.
    
    Usage:
        with write_batch() as conn:
            cur = conn.cursor()
            _insert_block_state(cur, ...)
            _insert_pool_state(cur, ...)
        # auto-commits on success, rolls back on exception
    """
    conn = _pool.getconn()
    try:
        conn.cursor().execute(f"SET search_path TO {_sim_schema}, public")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


# ============================================
# Schema Migration
# ============================================

def _run_migrations(conn):
    """Create all tables if they don't exist."""
    with conn.cursor() as cur:
        cur.execute(f"SET search_path TO {_sim_schema}, public")

        # Block-level market state snapshots
        cur.execute("""
            CREATE TABLE IF NOT EXISTS block_state (
                id BIGSERIAL PRIMARY KEY,
                block_number BIGINT NOT NULL,
                block_timestamp BIGINT,
                market_id TEXT NOT NULL,
                normalization_factor TEXT,
                total_debt TEXT,
                last_update_timestamp BIGINT,
                index_price TEXT,
                UNIQUE(block_number, market_id)
            )
        """)

        # V4 pool state per block
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pool_state (
                id BIGSERIAL PRIMARY KEY,
                block_number BIGINT NOT NULL,
                pool_id TEXT NOT NULL,
                token0 TEXT,
                token1 TEXT,
                sqrt_price_x96 TEXT,
                tick INTEGER,
                liquidity TEXT,
                mark_price DOUBLE PRECISION,
                fee_growth_global0 TEXT,
                fee_growth_global1 TEXT,
                token0_balance TEXT,
                token1_balance TEXT,
                UNIQUE(block_number, pool_id)
            )
        """)

        # Events log
        cur.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id BIGSERIAL PRIMARY KEY,
                block_number BIGINT NOT NULL,
                tx_hash TEXT NOT NULL,
                log_index INTEGER,
                event_name TEXT NOT NULL,
                contract_address TEXT,
                market_id TEXT,
                data JSONB,
                timestamp BIGINT
            )
        """)

        # Broker positions per block
        cur.execute("""
            CREATE TABLE IF NOT EXISTS broker_positions (
                id BIGSERIAL PRIMARY KEY,
                block_number BIGINT NOT NULL,
                broker_address TEXT NOT NULL,
                market_id TEXT NOT NULL,
                collateral TEXT,
                debt TEXT,
                collateral_value TEXT,
                debt_value TEXT,
                health_factor DOUBLE PRECISION,
                debt_principal TEXT,
                UNIQUE(block_number, broker_address, market_id)
            )
        """)

        # V4 LP positions per block
        cur.execute("""
            CREATE TABLE IF NOT EXISTS lp_positions (
                id BIGSERIAL PRIMARY KEY,
                block_number BIGINT NOT NULL,
                broker_address TEXT NOT NULL,
                token_id BIGINT NOT NULL,
                liquidity TEXT,
                tick_lower INTEGER,
                tick_upper INTEGER,
                entry_tick INTEGER,
                entry_price DOUBLE PRECISION,
                mint_block BIGINT,
                is_active BOOLEAN DEFAULT FALSE,
                UNIQUE(block_number, broker_address, token_id)
            )
        """)

        # Transactions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGSERIAL PRIMARY KEY,
                block_number BIGINT NOT NULL,
                tx_hash TEXT NOT NULL UNIQUE,
                tx_index INTEGER,
                from_address TEXT NOT NULL,
                to_address TEXT,
                value TEXT,
                gas_used BIGINT,
                gas_price TEXT,
                input_data TEXT,
                method_id TEXT,
                method_name TEXT,
                decoded_args JSONB,
                timestamp BIGINT,
                status INTEGER DEFAULT 1
            )
        """)

        # Indexer state (singleton row)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS indexer_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_indexed_block BIGINT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Bond positions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bonds (
                broker_address TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                bond_factory TEXT,
                notional TEXT,
                hedge TEXT,
                duration INTEGER,
                created_block BIGINT,
                created_timestamp BIGINT,
                created_tx TEXT,
                closed_block BIGINT,
                closed_timestamp BIGINT,
                closed_tx TEXT,
                collateral_returned TEXT,
                position_returned TEXT,
                status TEXT DEFAULT 'active'
            )
        """)

        # 5-Minute OHLC candles
        cur.execute("""
            CREATE TABLE IF NOT EXISTS price_candles_5m (
                ts BIGINT PRIMARY KEY,
                index_open  DOUBLE PRECISION,
                index_high  DOUBLE PRECISION,
                index_low   DOUBLE PRECISION,
                index_close DOUBLE PRECISION,
                mark_open   DOUBLE PRECISION,
                mark_high   DOUBLE PRECISION,
                mark_low    DOUBLE PRECISION,
                mark_close  DOUBLE PRECISION,
                nf_close    DOUBLE PRECISION,
                debt_close  DOUBLE PRECISION,
                sample_count INTEGER DEFAULT 0
            )
        """)

        # Indexes
        _create_indexes(cur)


def _create_indexes(cur):
    """Create indexes. Safe to re-run (IF NOT EXISTS)."""
    indexes = [
        ("idx_block_state_block", "block_state", "block_number"),
        ("idx_block_state_market", "block_state", "market_id"),
        ("idx_pool_state_block", "pool_state", "block_number"),
        ("idx_events_block", "events", "block_number"),
        ("idx_events_name", "events", "event_name"),
        ("idx_events_ts", "events", "timestamp"),
        ("idx_broker_pos_block", "broker_positions", "block_number"),
        ("idx_broker_pos_addr", "broker_positions", "broker_address"),
        ("idx_lp_pos_block", "lp_positions", "block_number"),
        ("idx_lp_pos_broker", "lp_positions", "broker_address"),
        ("idx_lp_pos_token", "lp_positions", "token_id"),
        ("idx_tx_block", "transactions", "block_number"),
        ("idx_tx_from", "transactions", "from_address"),
        ("idx_tx_to", "transactions", "to_address"),
        ("idx_tx_method", "transactions", "method_id"),
        ("idx_bonds_owner", "bonds", "owner"),
        ("idx_bonds_status", "bonds", "status"),
        ("idx_candles_5m_ts", "price_candles_5m", "ts"),
    ]
    for idx_name, table, col in indexes:
        cur.execute(
            f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({col})"
        )


def clear_sim_data():
    """Truncate all tables in the current simulation schema.
    Used when a simulation restarts and needs a clean DB."""
    with write_batch() as conn:
        cur = conn.cursor()
        tables = [
            "price_candles_5m", "bonds", "indexer_state", "transactions",
            "lp_positions", "broker_positions", "events", "pool_state",
            "block_state",
        ]
        for t in tables:
            cur.execute(f"TRUNCATE TABLE {t} CASCADE")
    logger.info(f"🗑️  Cleared all data in schema {_sim_schema}")


# ============================================
# Block State Operations
# ============================================

def insert_block_state(block_number: int, block_timestamp: int, market_id: str,
                       state: Dict[str, Any], cur=None):
    """Insert a block-level market state snapshot.
    If cur is provided, uses it directly (batch mode). Otherwise opens a connection."""
    def _do(c):
        c.execute("""
            INSERT INTO block_state (
                block_number, block_timestamp, market_id,
                normalization_factor, total_debt, last_update_timestamp, index_price
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (block_number, market_id) DO UPDATE SET
                block_timestamp = EXCLUDED.block_timestamp,
                normalization_factor = EXCLUDED.normalization_factor,
                total_debt = EXCLUDED.total_debt,
                last_update_timestamp = EXCLUDED.last_update_timestamp,
                index_price = EXCLUDED.index_price
        """, (
            block_number, block_timestamp, market_id,
            str(state.get('normalization_factor', 0)),
            str(state.get('total_debt', 0)),
            state.get('last_update_timestamp', 0),
            str(state.get('index_price', 0)),
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_block_state(block_number: int, market_id: str) -> Optional[Dict]:
    """Get market state at a specific block."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM block_state WHERE block_number = %s AND market_id = %s",
            (block_number, market_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_latest_block_state(market_id: str) -> Optional[Dict]:
    """Get the latest state snapshot for a market."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM block_state WHERE market_id = %s ORDER BY block_number DESC LIMIT 1",
            (market_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


# ============================================
# Pool State Operations
# ============================================

def insert_pool_state(block_number: int, pool_id: str, state: Dict[str, Any], cur=None):
    """Insert V4 pool state snapshot."""
    def _do(c):
        c.execute("""
            INSERT INTO pool_state (
                block_number, pool_id, token0, token1,
                sqrt_price_x96, tick, liquidity, mark_price,
                fee_growth_global0, fee_growth_global1,
                token0_balance, token1_balance
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (block_number, pool_id) DO UPDATE SET
                token0 = EXCLUDED.token0,
                token1 = EXCLUDED.token1,
                sqrt_price_x96 = EXCLUDED.sqrt_price_x96,
                tick = EXCLUDED.tick,
                liquidity = EXCLUDED.liquidity,
                mark_price = EXCLUDED.mark_price,
                fee_growth_global0 = EXCLUDED.fee_growth_global0,
                fee_growth_global1 = EXCLUDED.fee_growth_global1,
                token0_balance = EXCLUDED.token0_balance,
                token1_balance = EXCLUDED.token1_balance
        """, (
            block_number, pool_id,
            state.get('token0'), state.get('token1'),
            str(state.get('sqrt_price_x96', 0)),
            state.get('tick', 0),
            str(state.get('liquidity', 0)),
            state.get('mark_price', 0.0),
            str(state.get('fee_growth_global0', 0)),
            str(state.get('fee_growth_global1', 0)),
            str(state.get('token0_balance', 0)),
            str(state.get('token1_balance', 0)),
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_pool_state(block_number: int, pool_id: str) -> Optional[Dict]:
    """Get pool state at a specific block."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM pool_state WHERE block_number = %s AND pool_id = %s",
            (block_number, pool_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_latest_pool_state(pool_id: str) -> Optional[Dict]:
    """Get the latest pool state."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM pool_state WHERE pool_id = %s ORDER BY block_number DESC LIMIT 1",
            (pool_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


# ============================================
# Events Operations
# ============================================

def insert_event(block_number: int, tx_hash: str, log_index: int,
                 event_name: str, contract_address: str, market_id: str,
                 data: Dict, timestamp: int, cur=None):
    """Insert an event into the log."""
    def _do(c):
        c.execute("""
            INSERT INTO events (
                block_number, tx_hash, log_index, event_name,
                contract_address, market_id, data, timestamp
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            block_number, tx_hash, log_index, event_name,
            contract_address, market_id,
            json.dumps(data) if isinstance(data, dict) else data,
            timestamp,
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_events(from_block: int = None, to_block: int = None,
               event_name: str = None, market_id: str = None,
               limit: int = 100) -> List[Dict]:
    """Query events with filters."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = []
        params = []

        if from_block:
            clauses.append("block_number >= %s")
            params.append(from_block)
        if to_block:
            clauses.append("block_number <= %s")
            params.append(to_block)
        if event_name:
            clauses.append("event_name = %s")
            params.append(event_name)
        if market_id:
            clauses.append("market_id = %s")
            params.append(market_id)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        query = f"SELECT * FROM events {where} ORDER BY block_number DESC, log_index ASC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        results = []
        for row in cur.fetchall():
            d = dict(row)
            # data is JSONB — Postgres returns it as a dict already
            if isinstance(d.get('data'), str):
                d['data'] = json.loads(d['data'])
            results.append(d)
        return results


# ============================================
# Transaction Operations
# ============================================

def insert_transaction(block_number: int, tx_hash: str, tx_index: int,
                       from_address: str, to_address: str, value: str,
                       gas_used: int, gas_price: str, input_data: str,
                       method_id: str, method_name: str, decoded_args: Dict,
                       timestamp: int, status: int = 1, cur=None):
    """Insert a transaction record."""
    def _do(c):
        c.execute("""
            INSERT INTO transactions (
                block_number, tx_hash, tx_index, from_address, to_address,
                value, gas_used, gas_price, input_data, method_id, method_name,
                decoded_args, timestamp, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tx_hash) DO NOTHING
        """, (
            block_number, tx_hash, tx_index, from_address, to_address,
            value, gas_used, gas_price, input_data, method_id, method_name,
            json.dumps(decoded_args) if decoded_args else None,
            timestamp, status,
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_transactions(from_block: int = None, to_block: int = None,
                     from_address: str = None, to_address: str = None,
                     method_id: str = None, limit: int = 100) -> List[Dict]:
    """Query transactions with filters."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = []
        params = []

        if from_block:
            clauses.append("block_number >= %s")
            params.append(from_block)
        if to_block:
            clauses.append("block_number <= %s")
            params.append(to_block)
        if from_address:
            clauses.append("from_address = %s")
            params.append(from_address.lower())
        if to_address:
            clauses.append("to_address = %s")
            params.append(to_address.lower())
        if method_id:
            clauses.append("method_id = %s")
            params.append(method_id)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        query = f"SELECT * FROM transactions {where} ORDER BY block_number DESC, tx_index ASC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        results = []
        for row in cur.fetchall():
            d = dict(row)
            # decoded_args is JSONB
            if isinstance(d.get('decoded_args'), str):
                d['decoded_args'] = json.loads(d['decoded_args'])
            results.append(d)
        return results


# ============================================
# Broker Position Operations
# ============================================

def insert_broker_position(block_number: int, broker_address: str,
                           market_id: str, position: Dict[str, Any], cur=None):
    """Insert broker position snapshot."""
    def _do(c):
        c.execute("""
            INSERT INTO broker_positions (
                block_number, broker_address, market_id,
                collateral, debt, collateral_value, debt_value, health_factor
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (block_number, broker_address, market_id) DO UPDATE SET
                collateral = EXCLUDED.collateral,
                debt = EXCLUDED.debt,
                collateral_value = EXCLUDED.collateral_value,
                debt_value = EXCLUDED.debt_value,
                health_factor = EXCLUDED.health_factor
        """, (
            block_number, broker_address, market_id,
            str(position.get('collateral', 0)),
            str(position.get('debt', 0)),
            str(position.get('collateral_value', 0)),
            str(position.get('debt_value', 0)),
            position.get('health_factor', 0.0),
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_broker_position(block_number: int, broker_address: str,
                        market_id: str) -> Optional[Dict]:
    """Get broker position at a specific block."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM broker_positions WHERE block_number = %s AND broker_address = %s AND market_id = %s",
            (block_number, broker_address, market_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_broker_history(broker_address: str, market_id: str = None,
                       limit: int = 100) -> List[Dict]:
    """Get position history for a broker."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = ["broker_address = %s"]
        params = [broker_address]
        if market_id:
            clauses.append("market_id = %s")
            params.append(market_id)

        where = "WHERE " + " AND ".join(clauses)
        query = f"SELECT * FROM broker_positions {where} ORDER BY block_number DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        return [dict(row) for row in cur.fetchall()]


# ============================================
# LP Position Operations
# ============================================

def insert_lp_position(block_number: int, broker_address: str,
                       position: Dict[str, Any], cur=None):
    """Insert an LP position snapshot."""
    def _do(c):
        c.execute("""
            INSERT INTO lp_positions (
                block_number, broker_address, token_id,
                liquidity, tick_lower, tick_upper,
                entry_tick, entry_price, mint_block, is_active
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (block_number, broker_address, token_id) DO UPDATE SET
                liquidity = EXCLUDED.liquidity,
                tick_lower = EXCLUDED.tick_lower,
                tick_upper = EXCLUDED.tick_upper,
                entry_tick = EXCLUDED.entry_tick,
                entry_price = EXCLUDED.entry_price,
                mint_block = EXCLUDED.mint_block,
                is_active = EXCLUDED.is_active
        """, (
            block_number, broker_address,
            position.get('token_id', 0),
            str(position.get('liquidity', 0)),
            position.get('tick_lower', 0),
            position.get('tick_upper', 0),
            position.get('entry_tick'),
            position.get('entry_price'),
            position.get('mint_block'),
            bool(position.get('is_active')),
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_lp_positions(broker_address: str, block_number: int = None) -> List[Dict]:
    """Get LP positions for a broker. If block_number is None, returns latest."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if block_number:
            cur.execute("""
                SELECT * FROM lp_positions
                WHERE broker_address = %s AND block_number = %s
                ORDER BY token_id ASC
            """, (broker_address, block_number))
        else:
            cur.execute("""
                SELECT * FROM lp_positions
                WHERE broker_address = %s AND block_number = (
                    SELECT MAX(block_number) FROM lp_positions WHERE broker_address = %s
                )
                ORDER BY is_active DESC, token_id ASC
            """, (broker_address, broker_address))
        results = []
        for row in cur.fetchall():
            d = dict(row)
            d['liquidity'] = int(d.get('liquidity') or 0)
            results.append(d)
        return results


def get_all_latest_lp_positions() -> List[Dict]:
    """Get latest LP positions across all brokers."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT lp.* FROM lp_positions lp
            INNER JOIN (
                SELECT broker_address, MAX(block_number) as max_block
                FROM lp_positions GROUP BY broker_address
            ) latest ON lp.broker_address = latest.broker_address
                    AND lp.block_number = latest.max_block
            WHERE lp.liquidity != '0'
            ORDER BY lp.is_active DESC, lp.token_id ASC
        """)
        results = []
        for row in cur.fetchall():
            d = dict(row)
            d['liquidity'] = int(d.get('liquidity') or 0)
            results.append(d)
        return results


# ============================================
# Bond Position Operations
# ============================================

def insert_bond(broker_address: str, owner: str, bond_factory: str,
                notional: str, hedge: str, duration: int,
                created_block: int, created_timestamp: int, created_tx: str,
                cur=None):
    """Insert a new bond from a BondMinted event."""
    def _do(c):
        c.execute("""
            INSERT INTO bonds (
                broker_address, owner, bond_factory, notional, hedge, duration,
                created_block, created_timestamp, created_tx, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'active')
            ON CONFLICT (broker_address) DO NOTHING
        """, (
            broker_address.lower(), owner.lower(), bond_factory.lower(),
            str(notional), str(hedge), duration,
            created_block, created_timestamp, created_tx,
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def update_bond_closed(broker_address: str, closed_block: int,
                       closed_timestamp: int, closed_tx: str,
                       collateral_returned: str = '0',
                       position_returned: str = '0', cur=None):
    """Mark a bond as closed from a BondClosed event."""
    def _do(c):
        c.execute("""
            UPDATE bonds SET
                status = 'closed',
                closed_block = %s,
                closed_timestamp = %s,
                closed_tx = %s,
                collateral_returned = %s,
                position_returned = %s
            WHERE broker_address = %s
        """, (
            closed_block, closed_timestamp, closed_tx,
            str(collateral_returned), str(position_returned),
            broker_address.lower(),
        ))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


def get_bonds_by_owner(owner: str, status: str = None) -> List[Dict]:
    """Get all bonds for an owner, optionally filtered by status."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = ["owner = %s"]
        params = [owner.lower()]
        if status and status != 'all':
            clauses.append("status = %s")
            params.append(status)
        where = "WHERE " + " AND ".join(clauses)
        cur.execute(f"SELECT * FROM bonds {where} ORDER BY created_block DESC", params)
        return [dict(row) for row in cur.fetchall()]


def get_bond(broker_address: str) -> Optional[Dict]:
    """Get a single bond by its broker address."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM bonds WHERE broker_address = %s",
                    (broker_address.lower(),))
        row = cur.fetchone()
        return dict(row) if row else None


def get_all_bonds(status: str = None, limit: int = 100) -> List[Dict]:
    """Get all bonds, optionally filtered by status."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = []
        params = []
        if status and status != 'all':
            clauses.append("status = %s")
            params.append(status)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(limit)
        cur.execute(f"SELECT * FROM bonds {where} ORDER BY created_block DESC LIMIT %s", params)
        return [dict(row) for row in cur.fetchall()]


# ============================================
# Indexer State Operations
# ============================================

def get_last_indexed_block() -> int:
    """Get the last indexed block number."""
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT last_indexed_block FROM indexer_state WHERE id = 1")
            row = cur.fetchone()
            return row[0] if row else 0
    except Exception:
        return 0


def update_last_indexed_block(block_number: int, cur=None):
    """Update the last indexed block."""
    def _do(c):
        c.execute("""
            INSERT INTO indexer_state (id, last_indexed_block, updated_at)
            VALUES (1, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO UPDATE SET
                last_indexed_block = EXCLUDED.last_indexed_block,
                updated_at = CURRENT_TIMESTAMP
        """, (block_number,))

    if cur is not None:
        _do(cur)
    else:
        with write_batch() as conn:
            _do(conn.cursor())


# ============================================
# Utility Functions
# ============================================

def get_block_summary(block_number: int) -> Dict:
    """Get a complete summary of state at a specific block."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("SELECT * FROM block_state WHERE block_number = %s", (block_number,))
        market_states = [dict(row) for row in cur.fetchall()]

        cur.execute("SELECT * FROM pool_state WHERE block_number = %s", (block_number,))
        pool_states = [dict(row) for row in cur.fetchall()]

        cur.execute("SELECT * FROM events WHERE block_number = %s", (block_number,))
        events = []
        for row in cur.fetchall():
            d = dict(row)
            if isinstance(d.get('data'), str):
                d['data'] = json.loads(d['data'])
            events.append(d)

        cur.execute("SELECT * FROM broker_positions WHERE block_number = %s", (block_number,))
        broker_positions = [dict(row) for row in cur.fetchall()]

        return {
            'block_number': block_number,
            'market_states': market_states,
            'pool_states': pool_states,
            'events': events,
            'broker_positions': broker_positions,
        }


def get_latest_summary() -> Dict:
    """Get summary of the latest indexed block."""
    last_block = get_last_indexed_block()
    if last_block == 0:
        return {'error': 'No blocks indexed yet'}
    return get_block_summary(last_block)


# ============================================
# Paginated Query Functions (for API)
# ============================================

def get_block_states(market_id: str = None, from_block: int = None,
                     to_block: int = None, limit: int = 100) -> List[Dict]:
    """Get historical block states with optional filters."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = []
        params = []

        if market_id:
            clauses.append("market_id = %s")
            params.append(market_id)
        if from_block:
            clauses.append("block_number >= %s")
            params.append(from_block)
        if to_block:
            clauses.append("block_number <= %s")
            params.append(to_block)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        query = f"SELECT * FROM block_state {where} ORDER BY block_number DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        results = []
        for row in cur.fetchall():
            d = dict(row)
            d['normalization_factor'] = int(d.get('normalization_factor') or 0)
            d['total_debt'] = int(d.get('total_debt') or 0)
            d['index_price'] = int(d.get('index_price') or 0)
            results.append(d)
        return results


def get_pool_states(pool_id: str = None, from_block: int = None,
                    to_block: int = None, limit: int = 100) -> List[Dict]:
    """Get historical pool states with optional filters."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = []
        params = []

        if pool_id:
            clauses.append("pool_id = %s")
            params.append(pool_id)
        if from_block:
            clauses.append("block_number >= %s")
            params.append(from_block)
        if to_block:
            clauses.append("block_number <= %s")
            params.append(to_block)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        query = f"SELECT * FROM pool_state {where} ORDER BY block_number DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        results = []
        for row in cur.fetchall():
            d = dict(row)
            d['sqrt_price_x96'] = int(d.get('sqrt_price_x96') or 0)
            d['liquidity'] = int(d.get('liquidity') or 0)
            d['fee_growth_global0'] = int(d.get('fee_growth_global0') or 0)
            d['fee_growth_global1'] = int(d.get('fee_growth_global1') or 0)
            results.append(d)
        return results


def get_broker_position_history(broker_address: str, market_id: str = None,
                                from_block: int = None, to_block: int = None,
                                limit: int = 100) -> List[Dict]:
    """Get historical broker positions."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        clauses = ["broker_address = %s"]
        params = [broker_address]

        if market_id:
            clauses.append("market_id = %s")
            params.append(market_id)
        if from_block:
            clauses.append("block_number >= %s")
            params.append(from_block)
        if to_block:
            clauses.append("block_number <= %s")
            params.append(to_block)

        where = "WHERE " + " AND ".join(clauses)
        query = f"SELECT * FROM broker_positions {where} ORDER BY block_number DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        results = []
        for row in cur.fetchall():
            d = dict(row)
            d['collateral'] = int(d.get('collateral') or 0)
            d['debt'] = int(d.get('debt') or 0)
            d['debt_principal'] = int(d.get('debt_principal') or 0) if d.get('debt_principal') else 0
            d['collateral_value'] = int(d.get('collateral_value') or 0)
            d['debt_value'] = int(d.get('debt_value') or 0)
            results.append(d)
        return results


# ============================================
# 5-Minute Candle Builder
# ============================================

FIVE_MIN = 300  # seconds per bucket


def build_5m_candles(since_ts: int = 0, cur=None) -> int:
    """Aggregate raw block_state + pool_state into price_candles_5m.

    Returns the number of candles written.
    """
    def _do(c):
        lookback_ts = max(0, since_ts - FIVE_MIN * 2)

        c.execute("""
            WITH BucketedBlocks AS (
                SELECT
                    bs.block_number,
                    bs.block_timestamp,
                    (bs.block_timestamp / %s) * %s AS bucket_ts,
                    CAST(bs.index_price AS DOUBLE PRECISION) / 1e18 AS index_price,
                    CAST(bs.normalization_factor AS DOUBLE PRECISION) / 1e18 AS nf,
                    CAST(bs.total_debt AS DOUBLE PRECISION) / 1e6 AS debt,
                    ps.mark_price
                FROM block_state bs
                LEFT JOIN pool_state ps ON ps.block_number = bs.block_number
                WHERE bs.block_timestamp >= %s
            ),
            BucketBoundaries AS (
                SELECT
                    bucket_ts,
                    MIN(block_timestamp) as first_ts,
                    MAX(block_timestamp) as last_ts,
                    COUNT(*) as sample_count,
                    MAX(index_price) as index_high,
                    MIN(index_price) as index_low,
                    MAX(mark_price) as mark_high,
                    MIN(mark_price) as mark_low
                FROM BucketedBlocks
                GROUP BY bucket_ts
            )
            SELECT
                bb.bucket_ts AS ts,
                bb.index_high,
                bb.index_low,
                bb.mark_high,
                bb.mark_low,
                bb.sample_count,
                (SELECT index_price FROM BucketedBlocks b WHERE b.bucket_ts = bb.bucket_ts AND b.block_timestamp = bb.first_ts LIMIT 1) AS index_open,
                (SELECT index_price FROM BucketedBlocks b WHERE b.bucket_ts = bb.bucket_ts AND b.block_timestamp = bb.last_ts LIMIT 1) AS index_close,
                (SELECT mark_price FROM BucketedBlocks b WHERE b.bucket_ts = bb.bucket_ts AND b.block_timestamp = bb.first_ts LIMIT 1) AS mark_open,
                (SELECT mark_price FROM BucketedBlocks b WHERE b.bucket_ts = bb.bucket_ts AND b.block_timestamp = bb.last_ts LIMIT 1) AS mark_close,
                (SELECT nf FROM BucketedBlocks b WHERE b.bucket_ts = bb.bucket_ts AND b.block_timestamp = bb.last_ts LIMIT 1) AS nf_close,
                (SELECT debt FROM BucketedBlocks b WHERE b.bucket_ts = bb.bucket_ts AND b.block_timestamp = bb.last_ts LIMIT 1) AS debt_close
            FROM BucketBoundaries bb
        """, (FIVE_MIN, FIVE_MIN, lookback_ts))

        rows = c.fetchall()
        if not rows:
            return 0

        upserted = 0
        for r in rows:
            c.execute("""
                INSERT INTO price_candles_5m (
                    ts,
                    index_open, index_high, index_low, index_close,
                    mark_open,  mark_high,  mark_low,  mark_close,
                    nf_close, debt_close,
                    sample_count
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT(ts) DO UPDATE SET
                    index_open   = EXCLUDED.index_open,
                    index_high   = EXCLUDED.index_high,
                    index_low    = EXCLUDED.index_low,
                    index_close  = EXCLUDED.index_close,
                    mark_open    = EXCLUDED.mark_open,
                    mark_high    = EXCLUDED.mark_high,
                    mark_low     = EXCLUDED.mark_low,
                    mark_close   = EXCLUDED.mark_close,
                    nf_close     = EXCLUDED.nf_close,
                    debt_close   = EXCLUDED.debt_close,
                    sample_count = EXCLUDED.sample_count
            """, (
                r[0],           # ts
                r[6], r[1], r[2], r[7],   # index OHLC
                r[8], r[3], r[4], r[9],   # mark OHLC
                r[10], r[11],              # nf_close, debt_close
                r[5],                      # sample_count
            ))
            upserted += 1

        return upserted

    if cur is not None:
        return _do(cur)
    else:
        with write_batch() as conn:
            return _do(conn.cursor())


# ============================================
# Legacy compatibility aliases
# ============================================

# These exist so callers that imported the old names still work
init_comprehensive_db = init_db
DB_PATH = None  # No longer meaningful — kept to avoid ImportError
COMPREHENSIVE_DB_PATH = None  # Same
