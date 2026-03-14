#!/usr/bin/env python3
"""
sim_collateral.py — Simulate broker collateral tracking with LP + TWAMM registration states.

Self-contained simulation:
1. Creates schema (+ extended tables for registration tracking)
2. Generates mock events: 3 brokers, each with multiple LPs + TWAMMs
3. Processes events through the updated processor
4. Prints per-broker collateral report matching the target format
5. Asserts correctness

Usage:
    DATABASE_URL="postgresql://rld:rld_dev_password@localhost:5432/rld_indexer" \
    python3 scripts/indexer_v2/sim_collateral.py
"""
import asyncio
import asyncpg
import logging
import os
import sys
import time
import secrets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from event_map import EVENTS, TOPIC_MAP, topic0_for

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)-12s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sim")

DB_URL = os.environ.get("DATABASE_URL", "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer")

# ── Addresses ────────────────────────────────────────────────────────────────
MARKET_ID = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
WAUSDC   = "0xaaaa000000000000000000000000000000000001"
WRLP     = "0xbbbb000000000000000000000000000000000002"
FACTORY  = "0xcccc000000000000000000000000000000000003"
HOOK     = "0xdddd000000000000000000000000000000000004"

BROKER_A = "0x1111000000000000000000000000000000000001"
BROKER_B = "0x2222000000000000000000000000000000000002"
BROKER_C = "0x3333000000000000000000000000000000000003"

OWNER_A  = "0xaaaa111100000000000000000000000000000001"
OWNER_B  = "0xbbbb222200000000000000000000000000000002"
OWNER_C  = "0xcccc333300000000000000000000000000000003"

CORE     = "0xeeee000000000000000000000000000000000005"
LIQUIDATOR = "0xffff000000000000000000000000000000000099"


# ── Schema ───────────────────────────────────────────────────────────────────
EXTRA_SCHEMA = """
-- Drop v2 sim tables
DROP TABLE IF EXISTS raw_events CASCADE;
DROP TABLE IF EXISTS liquidations CASCADE;
DROP TABLE IF EXISTS lp_positions CASCADE;
DROP TABLE IF EXISTS twamm_orders CASCADE;
DROP TABLE IF EXISTS brokers CASCADE;
DROP TABLE IF EXISTS markets CASCADE;

CREATE TABLE IF NOT EXISTS markets (
    market_id TEXT PRIMARY KEY,
    deploy_block BIGINT NOT NULL,
    deploy_timestamp BIGINT NOT NULL,
    wausdc TEXT NOT NULL,
    wrlp TEXT NOT NULL,
    normalization_factor NUMERIC NOT NULL DEFAULT 1000000000000000000,
    total_debt NUMERIC DEFAULT 0,
    bad_debt NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brokers (
    address TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    market_id TEXT NOT NULL,
    created_block BIGINT NOT NULL,
    wausdc_balance NUMERIC DEFAULT 0,
    wrlp_balance NUMERIC DEFAULT 0,
    active_lp_token_id BIGINT DEFAULT 0,
    active_twamm_order_id TEXT DEFAULT '',
    debt_principal NUMERIC DEFAULT 0,
    is_liquidated BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS lp_positions (
    token_id BIGINT PRIMARY KEY,
    broker_address TEXT NOT NULL,
    market_id TEXT NOT NULL,
    tick_lower INT NOT NULL,
    tick_upper INT NOT NULL,
    liquidity TEXT NOT NULL,
    mint_block BIGINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_burned BOOLEAN NOT NULL DEFAULT false,
    is_registered BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS twamm_orders (
    order_id TEXT PRIMARY KEY,
    broker_address TEXT NOT NULL,
    market_id TEXT NOT NULL,
    zero_for_one BOOLEAN NOT NULL,
    amount_in TEXT NOT NULL,
    expiration BIGINT NOT NULL,
    submit_block BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active, cancelled, claimed, claimable
    is_registered BOOLEAN NOT NULL DEFAULT false,
    buy_tokens_out TEXT DEFAULT '0',
    sell_tokens_refund TEXT DEFAULT '0'
);

CREATE TABLE IF NOT EXISTS raw_events (
    id BIGSERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    block_timestamp BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INT NOT NULL,
    contract TEXT NOT NULL,
    topic0 TEXT NOT NULL,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,
    data TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    error_msg TEXT,
    UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_raw_pending ON raw_events (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS liquidations (
    id BIGSERIAL PRIMARY KEY,
    market_id TEXT NOT NULL,
    broker_address TEXT NOT NULL,
    liquidator TEXT NOT NULL,
    debt_covered NUMERIC NOT NULL,
    collateral_seized NUMERIC NOT NULL,
    wrlp_burned NUMERIC NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp BIGINT NOT NULL,
    tx_hash TEXT NOT NULL
);
"""


# ── Helpers ──────────────────────────────────────────────────────────────────
def pad_uint(val: int) -> str:
    return hex(val)[2:].zfill(64)

def pad_int(val: int) -> str:
    if val < 0:
        val = val + 2**256
    return hex(val)[2:].zfill(64)

def pad_addr(addr: str) -> str:
    return addr.replace("0x", "").lower().zfill(64)

def pad_bool(val: bool) -> str:
    return pad_uint(1 if val else 0)

def pad_bytes32(val: str) -> str:
    return val.replace("0x", "").ljust(64, "0")

def rand_tx() -> str:
    return "0x" + secrets.token_hex(32)


# ── Event Emitter ────────────────────────────────────────────────────────────
class EventEmitter:
    def __init__(self):
        self.events = []
        self.block = 0
        self.log_idx = 0

    def next_block(self):
        self.block += 1
        self.log_idx = 0
        return self.block

    def emit(self, contract: str, event_sig: str,
             topics: list[str | None] = None,
             data: str = ""):
        t0 = topic0_for(event_sig)
        if not t0.startswith("0x"):
            t0 = "0x" + t0
        topics = topics or []
        self.events.append({
            "block_number": self.block,
            "block_timestamp": 1700000000 + self.block,
            "tx_hash": rand_tx(),
            "log_index": self.log_idx,
            "contract": contract.lower(),
            "topic0": t0,
            "topic1": "0x" + pad_addr(topics[0]) if len(topics) > 0 and topics[0] else None,
            "topic2": "0x" + pad_addr(topics[1]) if len(topics) > 1 and topics[1] else None,
            "topic3": "0x" + pad_addr(topics[2]) if len(topics) > 2 and topics[2] else None,
            "data": data,
        })
        self.log_idx += 1


# ── Scenario Builder ────────────────────────────────────────────────────────
def build_scenario() -> list[dict]:
    """Build a realistic sequence of broker events with multiple LPs and TWAMMs."""
    e = EventEmitter()

    # Block 1: MarketCreated
    e.next_block()
    e.emit(FACTORY, "MarketCreated(bytes32,address,address,address)",
           topics=[MARKET_ID, WAUSDC, WRLP],
           data=pad_addr("0x0000000000000000000000000000000000000000"))  # aave pool
    log.info("Block %d: MarketCreated", e.block)

    # Block 2-4: Create 3 brokers
    for broker, owner, label in [
        (BROKER_A, OWNER_A, "A"),
        (BROKER_B, OWNER_B, "B"),
        (BROKER_C, OWNER_C, "C"),
    ]:
        e.next_block()
        e.emit(FACTORY, "BrokerCreated(address,address,uint256)",
               topics=[broker, owner],
               data=pad_uint(e.block * 1000))
        log.info("Block %d: BrokerCreated %s", e.block, label)

    # Block 5-7: waUSDC deposits (Transfer events) for all 3
    for broker, amount in [
        (BROKER_A, 100_000_000_000),  # 100k USDC (6 decimals)
        (BROKER_B, 50_000_000_000),   # 50k USDC
        (BROKER_C, 30_000_000_000),   # 30k USDC
    ]:
        e.next_block()
        e.emit(WAUSDC, "Transfer(address,address,uint256)",
               topics=["0x" + "0" * 40, broker],
               data=pad_uint(amount))

    # Block 8-10: wRLP deposits (Transfer events) — some brokers hold wRLP
    for broker, amount in [
        (BROKER_A, 500_000_000_000_000_000_000),  # 500 wRLP (18 decimals)
        (BROKER_B, 200_000_000_000_000_000_000),  # 200 wRLP
    ]:
        e.next_block()
        e.emit(WRLP, "Transfer(address,address,uint256)",
               topics=["0x" + "0" * 40, broker],
               data=pad_uint(amount))

    # Block 11-13: Borrow (PositionModified with debt)
    for broker, debt in [
        (BROKER_A, 5_500_000_000_000),   # 5500 wRLP debt
        (BROKER_B, 2_000_000_000_000),   # 2000 wRLP debt
        (BROKER_C, 1_000_000_000_000),   # 1000 wRLP debt
    ]:
        e.next_block()
        e.emit("0xeeee000000000000000000000000000000000005",
               "PositionModified(bytes32,address,int256,int256)",
               topics=[MARKET_ID, broker],
               data=pad_int(0) + pad_int(debt))

    # ══════════════════════════════════════════════════════════════════
    # BROKER A: 3 LP positions (registered, held, burned) + 3 TWAMM orders
    # ══════════════════════════════════════════════════════════════════

    # Block 14: LP #1 — minted and auto-registered (first LP)
    e.next_block()
    token_a1 = 74001
    e.emit(BROKER_A, "LiquidityAdded(uint256,uint128)",
           topics=[hex(token_a1)],
           data=pad_uint(13_628_553_683_669))
    # V4_ModifyLiquidity on hook
    e.emit(HOOK, "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)",
           topics=[MARKET_ID, BROKER_A],
           data=pad_int(-29955) + pad_int(-6930) + pad_int(13_628_553_683_669) + pad_bytes32("0x0"))
    # Auto-tracked as first position
    e.emit(BROKER_A, "ActivePositionChanged(uint256,uint256)",
           data=pad_uint(0) + pad_uint(token_a1))
    log.info("Block %d: Broker A LP #%d minted + REGISTERED", e.block, token_a1)

    # Block 15: LP #2 — minted but NOT registered (held only)
    e.next_block()
    token_a2 = 74055
    e.emit(BROKER_A, "LiquidityAdded(uint256,uint128)",
           topics=[hex(token_a2)],
           data=pad_uint(2_100_000))
    e.emit(HOOK, "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)",
           topics=[MARKET_ID, BROKER_A],
           data=pad_int(-15000) + pad_int(-10000) + pad_int(2_100_000) + pad_bytes32("0x0"))
    # No ActivePositionChanged → stays HELD
    log.info("Block %d: Broker A LP #%d minted (HELD, not registered)", e.block, token_a2)

    # Block 16: LP #3 — minted, then fully removed (burned)
    e.next_block()
    token_a3 = 74102
    e.emit(BROKER_A, "LiquidityAdded(uint256,uint128)",
           topics=[hex(token_a3)],
           data=pad_uint(500_000))
    e.emit(HOOK, "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)",
           topics=[MARKET_ID, BROKER_A],
           data=pad_int(-20000) + pad_int(-18000) + pad_int(500_000) + pad_bytes32("0x0"))
    log.info("Block %d: Broker A LP #%d minted", e.block, token_a3)

    # Block 17: LP #3 removed + burned
    e.next_block()
    e.emit(BROKER_A, "LiquidityRemoved(uint256,uint128,bool)",
           topics=[hex(token_a3)],
           data=pad_uint(500_000) + pad_bool(True))
    log.info("Block %d: Broker A LP #%d BURNED", e.block, token_a3)

    # Block 18: TWAMM Order #1 — submitted + auto-registered
    e.next_block()
    order_a1 = "0xAB12" + "0" * 60
    e.emit(BROKER_A, "TwammOrderSubmitted(bytes32,bool,uint256,uint256)",
           topics=[order_a1],
           data=pad_bool(True) + pad_uint(200_000_000_000_000_000_000) + pad_uint(1700000000 + e.block + 21600))
    e.emit(BROKER_A, "ActiveTwammOrderChanged(bytes32,bytes32)",
           data=pad_bytes32("0x" + "0" * 64) + pad_bytes32(order_a1))
    log.info("Block %d: Broker A TWAMM %s REGISTERED", e.block, order_a1[:10])

    # Block 19: TWAMM Order #2 — submitted but NOT registered
    e.next_block()
    order_a2 = "0xCD34" + "0" * 60
    e.emit(BROKER_A, "TwammOrderSubmitted(bytes32,bool,uint256,uint256)",
           topics=[order_a2],
           data=pad_bool(False) + pad_uint(5_000_000_000) + pad_uint(1700000000 + e.block + 43200))
    # No ActiveTwammOrderChanged → stays ACTIVE but not registered
    log.info("Block %d: Broker A TWAMM %s submitted (active, not registered)", e.block, order_a2[:10])

    # Block 20: TWAMM Order #3 — submitted then cancelled
    e.next_block()
    order_a3 = "0xEF56" + "0" * 60
    e.emit(BROKER_A, "TwammOrderSubmitted(bytes32,bool,uint256,uint256)",
           topics=[order_a3],
           data=pad_bool(True) + pad_uint(100_000_000_000_000_000_000) + pad_uint(1700000000 + e.block + 7200))
    log.info("Block %d: Broker A TWAMM %s submitted", e.block, order_a3[:10])

    # Block 21: Cancel order #3
    e.next_block()
    e.emit(BROKER_A, "TwammOrderCancelled(bytes32,uint256,uint256)",
           topics=[order_a3],
           data=pad_uint(50_000_000_000) + pad_uint(45_000_000_000_000_000_000))
    log.info("Block %d: Broker A TWAMM %s CANCELLED", e.block, order_a3[:10])

    # ══════════════════════════════════════════════════════════════════
    # BROKER B: 1 LP (registered), 1 TWAMM (registered then claimed)
    # ══════════════════════════════════════════════════════════════════

    # Block 22: LP for broker B
    e.next_block()
    token_b1 = 75001
    e.emit(BROKER_B, "LiquidityAdded(uint256,uint128)",
           topics=[hex(token_b1)],
           data=pad_uint(5_000_000))
    e.emit(HOOK, "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)",
           topics=[MARKET_ID, BROKER_B],
           data=pad_int(-25000) + pad_int(-5000) + pad_int(5_000_000) + pad_bytes32("0x0"))
    e.emit(BROKER_B, "ActivePositionChanged(uint256,uint256)",
           data=pad_uint(0) + pad_uint(token_b1))
    log.info("Block %d: Broker B LP #%d REGISTERED", e.block, token_b1)

    # Block 23: TWAMM for broker B — registered
    e.next_block()
    order_b1 = "0xBB01" + "0" * 60
    e.emit(BROKER_B, "TwammOrderSubmitted(bytes32,bool,uint256,uint256)",
           topics=[order_b1],
           data=pad_bool(True) + pad_uint(300_000_000_000_000_000_000) + pad_uint(1700000000 + e.block + 3600))
    e.emit(BROKER_B, "ActiveTwammOrderChanged(bytes32,bytes32)",
           data=pad_bytes32("0x" + "0" * 64) + pad_bytes32(order_b1))
    log.info("Block %d: Broker B TWAMM %s REGISTERED", e.block, order_b1[:10])

    # Block 24: TWAMM expired → claimed
    e.next_block()
    e.emit(BROKER_B, "TwammOrderClaimed(bytes32,uint256,uint256)",
           topics=[order_b1],
           data=pad_uint(150_000_000_000) + pad_uint(140_000_000_000))
    # Deregister
    e.emit(BROKER_B, "ActiveTwammOrderChanged(bytes32,bytes32)",
           data=pad_bytes32(order_b1) + pad_bytes32("0x" + "0" * 64))
    log.info("Block %d: Broker B TWAMM %s CLAIMED + deregistered", e.block, order_b1[:10])

    # ══════════════════════════════════════════════════════════════════
    # BROKER C: No LP, no TWAMM — bare position only
    # ══════════════════════════════════════════════════════════════════
    log.info("Broker C: bare position only (no LP, no TWAMM)")

    log.info("── PHASE 1 COMPLETE (%d events, %d blocks) ──", len(e.events), e.block)
    phase1_end = len(e.events)

    # ══════════════════════════════════════════════════════════════════
    # PHASE 2: STATE MUTATION SCENARIOS
    # ══════════════════════════════════════════════════════════════════

    # ── MUTATION 1: Partial LP removal (reduce, not burn) ──
    # Broker A LP #74001 had 13,628,553,683,669 liq → remove 3,628,553,683,669
    e.next_block()
    e.emit(BROKER_A, "LiquidityRemoved(uint256,uint128,bool)",
           topics=[hex(token_a1)],
           data=pad_uint(3_628_553_683_669) + pad_bool(False))
    log.info("Block %d: MUT1 — Broker A LP #%d partial removal (reduce liq by 3.6T)", e.block, token_a1)

    # ── MUTATION 2: LP re-registration (switch active #74001 → #74055) ──
    e.next_block()
    e.emit(BROKER_A, "ActivePositionChanged(uint256,uint256)",
           data=pad_uint(token_a1) + pad_uint(token_a2))
    log.info("Block %d: MUT2 — Broker A re-register LP #%d → #%d", e.block, token_a1, token_a2)

    # ── MUTATION 3: waUSDC withdrawal (Broker A sends 20k waUSDC to external) ──
    e.next_block()
    external = "0xEXTERNAL_ADDR_00000000000000000000001"
    e.emit(WAUSDC, "Transfer(address,address,uint256)",
           topics=[BROKER_A, external],
           data=pad_uint(20_000_000_000))  # 20k USDC
    log.info("Block %d: MUT3 — Broker A withdraws 20k waUSDC", e.block)

    # ── MUTATION 4: wRLP transfer out (Broker A sends 100 wRLP to Broker C) ──
    e.next_block()
    e.emit(WRLP, "Transfer(address,address,uint256)",
           topics=[BROKER_A, BROKER_C],
           data=pad_uint(100_000_000_000_000_000_000))  # 100 wRLP
    log.info("Block %d: MUT4 — Broker A sends 100 wRLP to Broker C", e.block)

    # ── MUTATION 5: TWAMM re-registration (switch active order on Broker A) ──
    # Deregister order_a1, register order_a2
    e.next_block()
    e.emit(BROKER_A, "ActiveTwammOrderChanged(bytes32,bytes32)",
           data=pad_bytes32(order_a1) + pad_bytes32(order_a2))
    log.info("Block %d: MUT5 — Broker A re-register TWAMM %s → %s", e.block, order_a1[:10], order_a2[:10])

    # ── MUTATION 6: Debt reduction (repay) ──
    e.next_block()
    e.emit("0xeeee000000000000000000000000000000000005",
           "PositionModified(bytes32,address,int256,int256)",
           topics=[MARKET_ID, BROKER_A],
           data=pad_int(0) + pad_int(-2_000_000_000_000))  # repay 2000 wRLP
    log.info("Block %d: MUT6 — Broker A repays 2000 wRLP debt", e.block)

    # ── MUTATION 7: Burn the REGISTERED LP for Broker B ──
    e.next_block()
    e.emit(BROKER_B, "LiquidityRemoved(uint256,uint128,bool)",
           topics=[hex(token_b1)],
           data=pad_uint(5_000_000) + pad_bool(True))
    log.info("Block %d: MUT7 — Broker B LP #%d BURNED (was registered)", e.block, token_b1)

    # ── MUTATION 8: Full liquidation cascade on Broker A ──
    # Liquidation flow: TWAMM cancel → LP unwind → sweep tokens → debt reduction → Liquidation event
    # At this point Broker A has:
    #   - LP#74055 REGISTERED (liq=2,100,000), LP#74001 HELD (liq=10T)
    #   - TWAMM order_a2 REGISTERED, order_a1 ACTIVE
    #   - waUSDC: 80k, wRLP: 400, debt: 3500
    e.next_block()
    # Step 1: TWAMM order_a2 (registered) force-cancelled during liquidation
    e.emit(BROKER_A, "TwammOrderCancelled(bytes32,uint256,uint256)",
           topics=[order_a2],
           data=pad_uint(3_000_000_000) + pad_uint(1_500_000_000))  # got 3B buy, 1.5B refund
    # Step 2: TWAMM deregistered
    e.emit(BROKER_A, "ActiveTwammOrderChanged(bytes32,bytes32)",
           data=pad_bytes32(order_a2) + pad_bytes32("0x" + "0" * 64))
    # Step 3: LP#74055 (registered) unwound + burned during liquidation
    e.emit(BROKER_A, "LiquidityRemoved(uint256,uint128,bool)",
           topics=[hex(token_a2)],
           data=pad_uint(2_100_000) + pad_bool(True))
    # Step 4: LP deregistered
    e.emit(BROKER_A, "ActivePositionChanged(uint256,uint256)",
           data=pad_uint(token_a2) + pad_uint(0))  # clear active LP
    # Step 5: wRLP seized and sent to Core
    e.emit(WRLP, "Transfer(address,address,uint256)",
           topics=[BROKER_A, CORE],
           data=pad_uint(200_000_000_000_000_000_000))  # 200 wRLP seized
    # Step 6: waUSDC seized and sent to liquidator
    e.emit(WAUSDC, "Transfer(address,address,uint256)",
           topics=[BROKER_A, LIQUIDATOR],
           data=pad_uint(50_000_000_000))  # 50k waUSDC to liquidator
    # Step 7: Debt reduction via PositionModified
    e.emit(CORE, "PositionModified(bytes32,address,int256,int256)",
           topics=[MARKET_ID, BROKER_A],
           data=pad_int(0) + pad_int(-3_500_000_000_000))  # Cover remaining 3500 debt
    # Step 8: MarketStateUpdated — NF + total debt snapshot
    e.emit(CORE, "MarketStateUpdated(bytes32,uint128,uint128)",
           topics=[MARKET_ID],
           data=pad_uint(1_050_000_000_000_000_000) + pad_uint(3_000_000_000_000))  # NF=1.05e18, totalDebt=3T
    # Step 9: Liquidation event
    e.emit(CORE, "Liquidation(bytes32,address,address,uint256,uint256,uint256)",
           topics=[MARKET_ID, BROKER_A, LIQUIDATOR],
           data=pad_uint(3_500_000_000_000) + pad_uint(50_000_000_000) + pad_uint(200_000_000_000_000_000_000))
    log.info("Block %d: MUT8 — FULL LIQUIDATION of Broker A (9 events)", e.block)

    # ── MUTATION 9: FundingApplied — NF update (global, no per-broker recalc) ──
    e.next_block()
    e.emit(CORE, "FundingApplied(bytes32,uint256,uint256,int256,uint256)",
           topics=[MARKET_ID],
           data=pad_uint(1_050_000_000_000_000_000) + pad_uint(1_052_000_000_000_000_000)
                + pad_int(200_000_000_000_000) + pad_uint(3600))  # NF: 1.05→1.052, rate=+0.0002, Δt=3600s
    log.info("Block %d: MUT9 — FundingApplied NF 1.05e18 → 1.052e18", e.block)

    log.info("Generated %d total events across %d blocks (%d Phase2)",
             len(e.events), e.block, len(e.events) - phase1_end)
    return e.events, phase1_end


# ── Processor ────────────────────────────────────────────────────────────────
async def process_events(conn: asyncpg.Connection) -> tuple[int, int]:
    """Process all pending raw events. Returns (processed, errors)."""
    processed = errors = 0

    while True:
        rows = await conn.fetch("""
            SELECT * FROM raw_events WHERE status = 'pending'
            ORDER BY block_number ASC, log_index ASC LIMIT 200
        """)
        if not rows:
            break

        for row in rows:
            event_name = TOPIC_MAP.get(row["topic0"])
            if not event_name:
                await conn.execute("UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])
                continue

            try:
                await dispatch(conn, event_name, row)
                await conn.execute("UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])
                processed += 1
            except Exception as ex:
                log.error("Error %s id=%d: %s", event_name, row["id"], ex)
                await conn.execute(
                    "UPDATE raw_events SET status='error', error_msg=$1 WHERE id=$2",
                    str(ex)[:500], row["id"])
                errors += 1

    return processed, errors


async def dispatch(conn, name, row):
    """Route events to handlers."""
    handlers = {
        "MarketCreated": h_market_created,
        "BrokerCreated": h_broker_created,
        "ERC20_Transfer": h_transfer,
        "PositionModified": h_position_modified,
        "LiquidityAdded": h_liquidity_added,
        "LiquidityRemoved": h_liquidity_removed,
        "ActivePositionChanged": h_active_position_changed,
        "TwammOrderSubmitted": h_twamm_submitted,
        "TwammOrderCancelled": h_twamm_cancelled,
        "TwammOrderClaimed": h_twamm_claimed,
        "ActiveTwammOrderChanged": h_active_twamm_changed,
        "V4_ModifyLiquidity": h_v4_modify_liquidity,
        "Liquidation": h_liquidation,
        "FundingApplied": h_funding_applied,
        "BadDebtRegistered": h_bad_debt_registered,
        "MarketStateUpdated": h_market_state_updated,
    }
    h = handlers.get(name)
    if h:
        await h(conn, row)


# ── Handlers ─────────────────────────────────────────────────────────────────
from event_map import decode_topic_address, decode_uint256, decode_int256

def slice_data(data: str, idx: int) -> str:
    clean = data.replace("0x", "")
    start = idx * 64
    return clean[start:start + 64]


async def h_market_created(conn, row):
    market_id = row["topic1"]
    wausdc = decode_topic_address(row["topic2"]) if row["topic2"] else ""
    wrlp = decode_topic_address(row["topic3"]) if row["topic3"] else ""
    await conn.execute("""
        INSERT INTO markets (market_id, deploy_block, deploy_timestamp, wausdc, wrlp)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
    """, market_id, row["block_number"], row["block_timestamp"], wausdc, wrlp)
    log.info("[proc] MarketCreated wausdc=%s wrlp=%s", wausdc[:18], wrlp[:18])


async def h_broker_created(conn, row):
    broker = decode_topic_address(row["topic1"]).lower()
    owner = decode_topic_address(row["topic2"]).lower()
    market = await conn.fetchrow("SELECT market_id FROM markets LIMIT 1")
    mid = market["market_id"] if market else ""
    await conn.execute("""
        INSERT INTO brokers (address, owner, market_id, created_block)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
    """, broker, owner, mid, row["block_number"])
    log.info("[proc] BrokerCreated broker=%s owner=%s", broker[:12], owner[:12])


async def h_transfer(conn, row):
    from_addr = decode_topic_address(row["topic1"]).lower()
    to_addr = decode_topic_address(row["topic2"]).lower()
    token = row["contract"].lower()
    data = row["data"] or ""
    clean = data.replace("0x", "").strip()
    if len(clean) < 64:
        return
    amount = decode_uint256(slice_data(data, 0))
    market = await conn.fetchrow("SELECT wausdc, wrlp FROM markets LIMIT 1")
    if not market:
        return
    col = None
    if token == market["wausdc"].lower():
        col = "wausdc_balance"
    elif token == market["wrlp"].lower():
        col = "wrlp_balance"
    if not col:
        return
    # Credit receiver
    await conn.execute(f"""
        UPDATE brokers SET {col} = {col} + $1 WHERE address = $2
    """, amount, to_addr)
    # Debit sender
    await conn.execute(f"""
        UPDATE brokers SET {col} = {col} - $1 WHERE address = $2
    """, amount, from_addr)


async def h_position_modified(conn, row):
    broker = decode_topic_address(row["topic2"]).lower()
    data = row["data"] or ""
    clean = data.replace("0x", "")
    debt_d = decode_int256(slice_data(data, 1))
    await conn.execute("""
        UPDATE brokers SET debt_principal = debt_principal + $1 WHERE address = $2
    """, debt_d, broker)
    log.info("[proc] PositionModified broker=%s debt_d=%d", broker[:12], debt_d)


async def h_liquidity_added(conn, row):
    """LiquidityAdded(uint256 indexed tokenId, uint128 liquidity)"""
    token_id = decode_uint256(row["topic1"]) if row["topic1"] else 0
    data = row["data"] or ""
    liquidity = decode_uint256(slice_data(data, 0)) if len(data.replace("0x", "")) >= 64 else 0
    broker = row["contract"].lower()
    market = await conn.fetchrow("SELECT market_id FROM markets LIMIT 1")
    mid = market["market_id"] if market else ""
    await conn.execute("""
        INSERT INTO lp_positions (token_id, broker_address, market_id, tick_lower, tick_upper,
                                  liquidity, mint_block, is_active, is_burned, is_registered)
        VALUES ($1, $2, $3, 0, 0, $4, $5, true, false, false)
        ON CONFLICT (token_id) DO UPDATE SET liquidity = $4, is_active = true
    """, token_id, broker, mid, str(liquidity), row["block_number"])
    log.info("[proc] LiquidityAdded token=%d liq=%d broker=%s", token_id, liquidity, broker[:12])


async def h_v4_modify_liquidity(conn, row):
    """V4_ModifyLiquidity — update tick range on the LP position."""
    broker = decode_topic_address(row["topic2"]).lower()
    data = row["data"] or ""
    clean = data.replace("0x", "")
    if len(clean) < 192:
        return
    tick_lower = decode_int256(slice_data(data, 0))
    tick_upper = decode_int256(slice_data(data, 1))
    liq_delta = decode_int256(slice_data(data, 2))
    # Find the most recently added LP for this broker with ticks=0,0
    await conn.execute("""
        UPDATE lp_positions SET tick_lower = $1, tick_upper = $2
        WHERE broker_address = $3 AND tick_lower = 0 AND tick_upper = 0
        AND is_active = true
        AND token_id = (SELECT token_id FROM lp_positions
                        WHERE broker_address = $3 AND tick_lower = 0 AND tick_upper = 0
                        ORDER BY mint_block DESC LIMIT 1)
    """, tick_lower, tick_upper, broker)


async def h_liquidity_removed(conn, row):
    """LiquidityRemoved(uint256 indexed tokenId, uint128 liquidity, bool burned)"""
    token_id = decode_uint256(row["topic1"]) if row["topic1"] else 0
    data = row["data"] or ""
    clean = data.replace("0x", "")
    burned = bool(decode_uint256(slice_data(data, 1))) if len(clean) >= 128 else False
    if burned:
        await conn.execute("""
            UPDATE lp_positions SET is_active = false, is_burned = true,
                                    is_registered = false, liquidity = '0'
            WHERE token_id = $1
        """, token_id)
        # Also clear active_lp_token_id on the broker if this was registered
        await conn.execute("""
            UPDATE brokers SET active_lp_token_id = 0
            WHERE active_lp_token_id = $1
        """, token_id)
        log.info("[proc] LiquidityRemoved token=%d BURNED", token_id)
    else:
        liq_removed = decode_uint256(slice_data(data, 0))
        await conn.execute("""
            UPDATE lp_positions SET liquidity = (CAST(liquidity AS NUMERIC) - $1)::TEXT
            WHERE token_id = $2
        """, liq_removed, token_id)
        log.info("[proc] LiquidityRemoved token=%d reduced by %d", token_id, liq_removed)


async def h_active_position_changed(conn, row):
    """ActivePositionChanged(uint256 oldTokenId, uint256 newTokenId) — non-indexed, in data."""
    data = row["data"] or ""
    clean = data.replace("0x", "")
    old_id = decode_uint256(slice_data(data, 0))
    new_id = decode_uint256(slice_data(data, 1))
    broker = row["contract"].lower()

    # Deregister old
    if old_id > 0:
        await conn.execute("UPDATE lp_positions SET is_registered = false WHERE token_id = $1", old_id)

    # Register new
    if new_id > 0:
        await conn.execute("UPDATE lp_positions SET is_registered = true WHERE token_id = $1", new_id)

    await conn.execute("UPDATE brokers SET active_lp_token_id = $1 WHERE address = $2", new_id, broker)
    log.info("[proc] ActivePositionChanged old=%d new=%d broker=%s", old_id, new_id, broker[:12])


async def h_twamm_submitted(conn, row):
    """TwammOrderSubmitted(bytes32 indexed orderId, bool zeroForOne, uint256 amountIn, uint256 expiration)"""
    order_id = row["topic1"] or ""
    data = row["data"] or ""
    clean = data.replace("0x", "")
    zfo = bool(decode_uint256(slice_data(data, 0)))
    amount_in = decode_uint256(slice_data(data, 1))
    expiration = decode_uint256(slice_data(data, 2))
    broker = row["contract"].lower()
    market = await conn.fetchrow("SELECT market_id FROM markets LIMIT 1")
    mid = market["market_id"] if market else ""

    await conn.execute("""
        INSERT INTO twamm_orders (order_id, broker_address, market_id, zero_for_one,
                                  amount_in, expiration, submit_block, status, is_registered)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', false)
        ON CONFLICT (order_id) DO NOTHING
    """, order_id, broker, mid, zfo, str(amount_in), expiration, row["block_number"])
    log.info("[proc] TwammOrderSubmitted id=%s..  zfo=%s amt=%d", order_id[:10], zfo, amount_in)


async def h_twamm_cancelled(conn, row):
    """TwammOrderCancelled(bytes32 indexed orderId, uint256 buyTokensOut, uint256 sellTokensRefund)"""
    order_id = row["topic1"] or ""
    data = row["data"] or ""
    buy_out = decode_uint256(slice_data(data, 0))
    sell_refund = decode_uint256(slice_data(data, 1))
    await conn.execute("""
        UPDATE twamm_orders SET status = 'cancelled', is_registered = false,
                                buy_tokens_out = $1, sell_tokens_refund = $2
        WHERE order_id = $3
    """, str(buy_out), str(sell_refund), order_id)
    # Also clear broker's active_twamm_order_id if this was registered
    await conn.execute("""
        UPDATE brokers SET active_twamm_order_id = ''
        WHERE active_twamm_order_id = $1
    """, order_id)
    log.info("[proc] TwammOrderCancelled id=%s..  buy=%d refund=%d", order_id[:10], buy_out, sell_refund)


async def h_twamm_claimed(conn, row):
    """TwammOrderClaimed(bytes32 indexed orderId, uint256 claimed0, uint256 claimed1)"""
    order_id = row["topic1"] or ""
    data = row["data"] or ""
    c0 = decode_uint256(slice_data(data, 0))
    c1 = decode_uint256(slice_data(data, 1))
    await conn.execute("""
        UPDATE twamm_orders SET status = 'claimed', is_registered = false,
                                buy_tokens_out = $1, sell_tokens_refund = $2
        WHERE order_id = $3
    """, str(c0), str(c1), order_id)
    log.info("[proc] TwammOrderClaimed id=%s..  c0=%d c1=%d", order_id[:10], c0, c1)


async def h_active_twamm_changed(conn, row):
    """ActiveTwammOrderChanged(bytes32 oldOrderId, bytes32 newOrderId) — non-indexed, in data."""
    data = row["data"] or ""
    clean = data.replace("0x", "")
    old_id = ("0x" + slice_data(data, 0)).lower()
    new_id = ("0x" + slice_data(data, 1)).lower()
    broker = row["contract"].lower()

    is_zero = lambda oid: oid.replace("0x", "").replace("0", "") == ""

    # Deregister old
    if not is_zero(old_id):
        await conn.execute("UPDATE twamm_orders SET is_registered = false WHERE order_id = $1", old_id)

    # Register new
    if not is_zero(new_id):
        await conn.execute("UPDATE twamm_orders SET is_registered = true WHERE order_id = $1", new_id)
        await conn.execute("UPDATE brokers SET active_twamm_order_id = $1 WHERE address = $2", new_id, broker)
    else:
        await conn.execute("UPDATE brokers SET active_twamm_order_id = '' WHERE address = $1", broker)

    log.info("[proc] ActiveTwammOrderChanged old=%s.. new=%s.. broker=%s",
             old_id[:10], new_id[:10], broker[:12])


async def h_funding_applied(conn, row):
    """FundingApplied(bytes32 indexed marketId, uint256 oldNF, uint256 newNF, int256 rate, uint256 timeDelta)"""
    market_id = row["topic1"] or ""
    data = row["data"] or ""
    new_nf = decode_uint256(slice_data(data, 1))
    await conn.execute("""
        UPDATE markets SET normalization_factor = $1 WHERE market_id = $2
    """, new_nf, market_id)
    log.info("[proc] FundingApplied market=%s.. newNF=%d", market_id[:10], new_nf)


async def h_market_state_updated(conn, row):
    """MarketStateUpdated(bytes32 indexed marketId, uint128 normFactor, uint128 totalDebt)"""
    market_id = row["topic1"] or ""
    data = row["data"] or ""
    nf = decode_uint256(slice_data(data, 0))
    total_debt = decode_uint256(slice_data(data, 1))
    await conn.execute("""
        UPDATE markets SET normalization_factor = $1, total_debt = $2 WHERE market_id = $3
    """, nf, total_debt, market_id)
    log.info("[proc] MarketStateUpdated market=%s.. nf=%d totalDebt=%d", market_id[:10], nf, total_debt)


async def h_bad_debt_registered(conn, row):
    """BadDebtRegistered(bytes32 indexed marketId, uint128 amount, uint128 totalBadDebt)"""
    market_id = row["topic1"] or ""
    data = row["data"] or ""
    total_bad_debt = decode_uint256(slice_data(data, 1))
    await conn.execute("""
        UPDATE markets SET bad_debt = $1 WHERE market_id = $2
    """, total_bad_debt, market_id)
    log.info("[proc] BadDebtRegistered market=%s.. totalBadDebt=%d", market_id[:10], total_bad_debt)


async def h_liquidation(conn, row):
    """Liquidation(bytes32 indexed marketId, address indexed user, address indexed liquidator,
                   uint256 debtCovered, uint256 collateralSeized, uint256 wRLPBurned)"""
    market_id = row["topic1"] or ""
    broker = decode_topic_address(row["topic2"]).lower() if row["topic2"] else ""
    liquidator = decode_topic_address(row["topic3"]).lower() if row["topic3"] else ""
    data = row["data"] or ""
    debt_covered = decode_uint256(slice_data(data, 0))
    collateral_seized = decode_uint256(slice_data(data, 1))
    wrlp_burned = decode_uint256(slice_data(data, 2))

    await conn.execute("""
        INSERT INTO liquidations (market_id, broker_address, liquidator, debt_covered,
                                  collateral_seized, wrlp_burned, block_number, block_timestamp, tx_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    """, market_id, broker, liquidator, debt_covered, collateral_seized, wrlp_burned,
         row["block_number"], row["block_timestamp"], row["tx_hash"])

    # Mark broker as liquidated
    await conn.execute("UPDATE brokers SET is_liquidated = true WHERE address = $1", broker)
    log.info("[proc] Liquidation broker=%s liq=%s debt=%d seized=%d wrlp=%d",
             broker[:12], liquidator[:12], debt_covered, collateral_seized, wrlp_burned)


# ── Report ───────────────────────────────────────────────────────────────────
async def print_report(conn):
    """Print the full broker collateral report."""
    brokers = await conn.fetch("SELECT * FROM brokers ORDER BY created_block")

    for b in brokers:
        addr = b["address"]
        wausdc = float(b["wausdc_balance"] or 0)
        wrlp = float(b["wrlp_balance"] or 0)
        debt = float(b["debt_principal"] or 0)
        active_lp = b["active_lp_token_id"] or 0
        active_twamm = b["active_twamm_order_id"] or ""

        print()
        print("═" * 72)
        print(f" BROKER {addr[:16]}..  owner: {b['owner'][:16]}..")
        print("═" * 72)

        # Collateral
        print()
        print("  COLLATERAL")
        print(f"  ├─ waUSDC:     {wausdc / 1e6:>15,.2f} USDC")
        print(f"  ├─ wRLP held:  {wrlp / 1e18:>15,.6f} wRLP")

        # LP positions
        lps = await conn.fetch(
            "SELECT * FROM lp_positions WHERE broker_address = $1 ORDER BY mint_block", addr)
        print(f"  │")
        print(f"  ├─ V4 LP POSITIONS ({len(lps)} total)")
        if lps:
            print(f"  │   ┌{'─'*8}┬{'─'*20}┬{'─'*15}┬{'─'*12}┐")
            print(f"  │   │ {'Token':^6} │ {'Ticks':^18} │ {'Liquidity':^13} │ {'Status':^10} │")
            print(f"  │   ├{'─'*8}┼{'─'*20}┼{'─'*15}┼{'─'*12}┤")
            for lp in lps:
                tid = lp["token_id"]
                liq = int(lp["liquidity"])
                if lp["is_burned"]:
                    status = "BURNED"
                elif lp["is_registered"]:
                    status = "REGISTERED"
                else:
                    status = "HELD"
                marker = " ← NAV" if status == "REGISTERED" else ""
                print(f"  │   │ #{tid:<5} │ [{lp['tick_lower']:>6},{lp['tick_upper']:>6}] │ {liq:>13,} │ {status:<10} │{marker}")
            print(f"  │   └{'─'*8}┴{'─'*20}┴{'─'*15}┴{'─'*12}┘")
        else:
            print(f"  │   (none)")

        # TWAMM orders
        twamms = await conn.fetch(
            "SELECT * FROM twamm_orders WHERE broker_address = $1 ORDER BY submit_block", addr)
        print(f"  │")
        print(f"  └─ TWAMM ORDERS ({len(twamms)} total)")
        if twamms:
            print(f"      ┌{'─'*12}┬{'─'*11}┬{'─'*15}┬{'─'*12}┐")
            print(f"      │ {'OrderId':^10} │ {'Direction':^9} │ {'AmountIn':^13} │ {'Status':^10} │")
            print(f"      ├{'─'*12}┼{'─'*11}┼{'─'*15}┼{'─'*12}┤")
            for tw in twamms:
                direction = "sell→buy" if tw["zero_for_one"] else "buy→sell"
                amt = int(tw["amount_in"])
                status = tw["status"].upper()
                if tw["is_registered"]:
                    status = "REGISTERED"
                marker = " ← NAV" if status == "REGISTERED" else ""
                print(f"      │ {tw['order_id'][:10]:<10} │ {direction:^9} │ {amt:>13,} │ {status:<10} │{marker}")
            print(f"      └{'─'*12}┴{'─'*11}┴{'─'*15}┴{'─'*12}┘")
        else:
            print(f"      (none)")

        # Debt
        print()
        print(f"  DEBT")
        print(f"  └─ principal:  {debt / 1e6:>15,.6f} wRLP")
        print()


# ── Assertions Phase 1 ───────────────────────────────────────────────────────
async def verify_phase1(conn):
    """Assert Phase 1 produced correct initial state."""
    n = await conn.fetchval("SELECT COUNT(*) FROM brokers")
    assert n == 3, f"Expected 3 brokers, got {n}"

    lps_a = await conn.fetch(f"SELECT * FROM lp_positions WHERE broker_address = '{BROKER_A.lower()}' ORDER BY token_id")
    assert len(lps_a) == 3, f"Broker A should have 3 LPs, got {len(lps_a)}"
    assert lps_a[0]["is_registered"] is True, "LP #74001 should be REGISTERED"
    assert int(lps_a[0]["liquidity"]) == 13_628_553_683_669, f"LP #74001 liq mismatch: {lps_a[0]['liquidity']}"
    assert lps_a[1]["is_registered"] is False, "LP #74055 should NOT be registered"
    assert lps_a[2]["is_burned"] is True, "LP #74102 should be BURNED"

    twm_a = await conn.fetch(f"SELECT * FROM twamm_orders WHERE broker_address = '{BROKER_A.lower()}' ORDER BY submit_block")
    assert len(twm_a) == 3
    assert twm_a[0]["is_registered"] is True, "TWAMM #1 should be REGISTERED"
    assert twm_a[1]["is_registered"] is False, "TWAMM #2 should NOT be registered"
    assert twm_a[2]["status"] == "cancelled"

    lps_b = await conn.fetch(f"SELECT * FROM lp_positions WHERE broker_address = '{BROKER_B.lower()}'")
    assert len(lps_b) == 1 and lps_b[0]["is_registered"] is True
    assert int(lps_b[0]["liquidity"]) == 5_000_000

    twm_b = await conn.fetch(f"SELECT * FROM twamm_orders WHERE broker_address = '{BROKER_B.lower()}'")
    assert len(twm_b) == 1 and twm_b[0]["status"] == "claimed"

    b_a = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_A.lower()}'")
    assert float(b_a["wausdc_balance"]) == 100_000_000_000, f"A waUSDC: {b_a['wausdc_balance']}"
    assert float(b_a["wrlp_balance"]) == 500_000_000_000_000_000_000, f"A wRLP: {b_a['wrlp_balance']}"
    assert float(b_a["debt_principal"]) == 5_500_000_000_000

    pending = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
    assert pending == 0
    errs = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'error'")
    assert errs == 0

    log.info("✅ PHASE 1 ASSERTIONS PASSED (initial state correct)")


# ── Assertions Phase 2 (Mutations) ──────────────────────────────────────────
async def verify_mutations(conn):
    """Assert that every Phase 2 mutation correctly changed the indexed state."""
    tests_passed = 0

    # ── MUT1: Partial LP removal ──
    lp1 = await conn.fetchrow("SELECT * FROM lp_positions WHERE token_id = 74001")
    expected_liq = 13_628_553_683_669 - 3_628_553_683_669  # = 10,000,000,000,000
    actual_liq = int(lp1["liquidity"])
    assert actual_liq == expected_liq, f"MUT1 FAIL: LP #74001 liq={actual_liq}, expected={expected_liq}"
    assert lp1["is_active"] is True, "MUT1 FAIL: LP #74001 should still be active"
    assert lp1["is_burned"] is False, "MUT1 FAIL: LP #74001 should NOT be burned"
    log.info("  ✅ MUT1: Partial LP removal — liq 13.6T → 10T")
    tests_passed += 1

    # ── MUT2: LP re-registration (verified via MUT8 — #74055 was re-registered, then burned by liquidation) ──
    lp1_after = await conn.fetchrow("SELECT * FROM lp_positions WHERE token_id = 74001")
    lp2 = await conn.fetchrow("SELECT * FROM lp_positions WHERE token_id = 74055")
    assert lp1_after["is_registered"] is False, "MUT2 FAIL: LP #74001 should be DEREGISTERED"
    # NOTE: LP#74055 is now BURNED by MUT8 (liquidation), so is_registered=false final
    assert lp2["is_registered"] is False, "MUT2 FAIL: LP #74055 deregistered after liquidation burn"
    log.info("  ✅ MUT2: LP re-registration — verified (MUT8 subsequently burned #74055)")
    tests_passed += 1

    # ── MUT3: waUSDC withdrawal (100k → 80k, then MUT8 seized 50k → final 30k) ──
    b_a = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_A.lower()}'")
    expected_wausdc = 100_000_000_000 - 20_000_000_000 - 50_000_000_000  # = 30k USDC
    actual_wausdc = float(b_a["wausdc_balance"])
    assert actual_wausdc == expected_wausdc, f"MUT3 FAIL: waUSDC={actual_wausdc}, expected={expected_wausdc}"
    log.info("  ✅ MUT3: waUSDC withdrawal + seizure — 100k → 80k → 30k")
    tests_passed += 1

    # ── MUT4: wRLP transfer (A→C) then MUT8 seized 200 wRLP from A ──
    b_a = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_A.lower()}'")
    b_c = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_C.lower()}'")
    # A: 500 - 100 (transfer) - 200 (seized) = 200
    expected_a_wrlp = 500_000_000_000_000_000_000 - 100_000_000_000_000_000_000 - 200_000_000_000_000_000_000
    expected_c_wrlp = 100_000_000_000_000_000_000  # = 100
    assert float(b_a["wrlp_balance"]) == expected_a_wrlp, f"MUT4 FAIL: A wRLP={b_a['wrlp_balance']}, expected={expected_a_wrlp}"
    assert float(b_c["wrlp_balance"]) == expected_c_wrlp, f"MUT4 FAIL: C wRLP={b_c['wrlp_balance']}, expected={expected_c_wrlp}"
    log.info("  ✅ MUT4: wRLP transfer + seizure — A: 500→400→200, C: 0→100")
    tests_passed += 1

    # ── MUT5: TWAMM re-registration (then MUT8 cancelled order_a2) ──
    twm_a = await conn.fetch(f"SELECT * FROM twamm_orders WHERE broker_address = '{BROKER_A.lower()}' ORDER BY submit_block")
    assert twm_a[0]["is_registered"] is False, "MUT5 FAIL: TWAMM order_a1 should be DEREGISTERED"
    # order_a2 was re-registered by MUT5, then cancelled+deregistered by MUT8
    assert twm_a[1]["is_registered"] is False, "MUT5 FAIL: TWAMM order_a2 deregistered after liquidation cancel"
    b_a = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_A.lower()}'")
    # active_twamm cleared by MUT8
    assert b_a["active_twamm_order_id"] == "", f"MUT5 FAIL: active_twamm should be empty, got {b_a['active_twamm_order_id']}"
    log.info("  ✅ MUT5: TWAMM re-registration — verified (MUT8 subsequently cancelled order_a2)")
    tests_passed += 1

    # ── MUT6: Debt repayment (3500 - 2000 = 1500, then MUT8 covered remaining 3500→0 wait no)
    # Actually: initial debt=5500, MUT6 repays 2000 → 3500, then MUT8 covers 3500 → 0
    b_a = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_A.lower()}'")
    expected_debt = 5_500_000_000_000 - 2_000_000_000_000 - 3_500_000_000_000  # = 0
    actual_debt = float(b_a["debt_principal"])
    assert actual_debt == expected_debt, f"MUT6 FAIL: debt={actual_debt}, expected={expected_debt}"
    log.info("  ✅ MUT6: Debt repayment + liquidation — 5500 → 3500 → 0")
    tests_passed += 1

    # ── MUT7: Burn registered LP (Broker B) ──
    lp_b = await conn.fetchrow("SELECT * FROM lp_positions WHERE token_id = 75001")
    assert lp_b["is_burned"] is True, "MUT7 FAIL: LP #75001 should be BURNED"
    assert lp_b["is_registered"] is False, "MUT7 FAIL: LP #75001 should be DEREGISTERED after burn"
    assert int(lp_b["liquidity"]) == 0, f"MUT7 FAIL: LP #75001 liq should be 0, got {lp_b['liquidity']}"
    b_b = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_B.lower()}'")
    assert b_b["active_lp_token_id"] == 0, f"MUT7 FAIL: Broker B active_lp should be 0, got {b_b['active_lp_token_id']}"
    log.info("  ✅ MUT7: Burn registered LP — LP #75001 burned + deregistered + broker active_lp cleared")
    tests_passed += 1

    # ── MUT8: Full liquidation cascade (Broker A) ──
    b_a = await conn.fetchrow(f"SELECT * FROM brokers WHERE address = '{BROKER_A.lower()}'")
    # Debt should be fully covered: 3500 - 3500 = 0
    assert float(b_a["debt_principal"]) == 0, f"MUT8 FAIL: debt should be 0, got {b_a['debt_principal']}"
    assert b_a["is_liquidated"] is True, "MUT8 FAIL: Broker A should be flagged as liquidated"
    # waUSDC: 80k - 50k seized = 30k
    assert float(b_a["wausdc_balance"]) == 30_000_000_000, f"MUT8 FAIL: waUSDC={b_a['wausdc_balance']}, expected 30B"
    # wRLP: 400 - 200 seized = 200
    assert float(b_a["wrlp_balance"]) == 200_000_000_000_000_000_000, f"MUT8 FAIL: wRLP={b_a['wrlp_balance']}"
    # LP#74055 should be burned + deregistered
    lp2 = await conn.fetchrow("SELECT * FROM lp_positions WHERE token_id = 74055")
    assert lp2["is_burned"] is True, "MUT8 FAIL: LP #74055 should be BURNED"
    assert lp2["is_registered"] is False, "MUT8 FAIL: LP #74055 should be DEREGISTERED"
    assert b_a["active_lp_token_id"] == 0, f"MUT8 FAIL: active_lp should be 0, got {b_a['active_lp_token_id']}"
    # TWAMM order_a2 should be cancelled + deregistered
    twm_a2 = await conn.fetch(f"SELECT * FROM twamm_orders WHERE broker_address = '{BROKER_A.lower()}' ORDER BY submit_block")
    assert twm_a2[1]["status"] == "cancelled", f"MUT8 FAIL: order_a2 should be cancelled, got {twm_a2[1]['status']}"
    assert twm_a2[1]["is_registered"] is False, "MUT8 FAIL: order_a2 should be DEREGISTERED"
    assert b_a["active_twamm_order_id"] == "", f"MUT8 FAIL: active_twamm should be empty, got {b_a['active_twamm_order_id']}"
    # Liquidation record
    liq = await conn.fetchrow(f"SELECT * FROM liquidations WHERE broker_address = '{BROKER_A.lower()}'")
    assert liq is not None, "MUT8 FAIL: No liquidation record found"
    assert float(liq["debt_covered"]) == 3_500_000_000_000
    assert float(liq["collateral_seized"]) == 50_000_000_000
    assert float(liq["wrlp_burned"]) == 200_000_000_000_000_000_000
    # Market state updated
    m = await conn.fetchrow("SELECT * FROM markets LIMIT 1")
    assert float(m["total_debt"]) == 3_000_000_000_000, f"MUT8 FAIL: total_debt={m['total_debt']}"
    log.info("  ✅ MUT8: Full liquidation cascade — debt zeroed, assets seized, LP/TWAMM unwound, record created")
    tests_passed += 1

    # ── MUT9: FundingApplied (NF update) ──
    m = await conn.fetchrow("SELECT * FROM markets LIMIT 1")
    assert float(m["normalization_factor"]) == 1_052_000_000_000_000_000, (
        f"MUT9 FAIL: NF={m['normalization_factor']}, expected=1.052e18")
    log.info("  ✅ MUT9: FundingApplied — NF updated to 1.052e18 (global, no per-broker recalc)")
    tests_passed += 1

    # ── Zero leftover events ──
    pending = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
    assert pending == 0
    errs = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'error'")
    assert errs == 0

    log.info("✅ ALL %d MUTATION TESTS PASSED", tests_passed)


# ── Ingest Helper ────────────────────────────────────────────────────────────
async def insert_events(conn, events):
    for ev in events:
        await conn.execute("""
            INSERT INTO raw_events (block_number, block_timestamp, tx_hash, log_index,
                                    contract, topic0, topic1, topic2, topic3, data, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        """,
            ev["block_number"], ev["block_timestamp"], ev["tx_hash"], ev["log_index"],
            ev["contract"], ev["topic0"], ev["topic1"], ev["topic2"], ev["topic3"],
            ev["data"])


# ── Main ─────────────────────────────────────────────────────────────────────
async def main():
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    try:
        # 1. Schema
        async with pool.acquire() as conn:
            await conn.execute(EXTRA_SCHEMA)
        log.info("Schema applied")

        # 2. Generate events (both phases)
        events, phase1_end = build_scenario()
        phase1_events = events[:phase1_end]
        phase2_events = events[phase1_end:]

        # ═══════════ PHASE 1: Initial state ═══════════
        print("\n" + "═" * 40 + " PHASE 1: INITIAL STATE " + "═" * 40)
        async with pool.acquire() as conn:
            await insert_events(conn, phase1_events)
        log.info("Inserted %d Phase 1 events", len(phase1_events))

        async with pool.acquire() as conn:
            p, e = await process_events(conn)
        log.info("Processed %d events (%d errors)", p, e)

        async with pool.acquire() as conn:
            await print_report(conn)

        async with pool.acquire() as conn:
            await verify_phase1(conn)

        # ═══════════ PHASE 2: Mutations ═══════════
        print("\n" + "═" * 40 + " PHASE 2: MUTATIONS " + "═" * 40)
        async with pool.acquire() as conn:
            await insert_events(conn, phase2_events)
        log.info("Inserted %d Phase 2 mutation events", len(phase2_events))

        async with pool.acquire() as conn:
            p2, e2 = await process_events(conn)
        log.info("Processed %d mutation events (%d errors)", p2, e2)

        async with pool.acquire() as conn:
            await print_report(conn)

        async with pool.acquire() as conn:
            await verify_mutations(conn)

    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
