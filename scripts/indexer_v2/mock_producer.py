#!/usr/bin/env python3
"""
mock_producer.py — Generates realistic RLD event stream into raw_events table.

Simulates a deployment scenario:
  Block 1: MarketCreated
  Block 2-4: BrokerCreated × 3 users
  Block 5-7: ERC20_Transfer (deposits into each broker)
  Block 8-10: PositionModified (each broker borrows)
  Block 11: ModifyLiquidity (LP position)
  Block 12+: Continuous Swap, FundingApplied, MarketStateUpdated
"""
import asyncio
import asyncpg
import logging
import os
import time

from event_map import topic0_for

log = logging.getLogger(__name__)

# ── Mock addresses ───────────────────────────────────────────────────────────

MARKET_ID   = "0x" + "ab" * 32
RLD_CORE    = "0xCORE000000000000000000000000000000000001"
FACTORY     = "0xFACT000000000000000000000000000000000002"
POOL_MGR    = "0xPOOL000000000000000000000000000000000003"
WAUSDC      = "0xWAUS000000000000000000000000000000000004"
WRLP        = "0xWRLP000000000000000000000000000000000005"

USERS = [
    "0xUSER_A00000000000000000000000000000000000A",
    "0xUSER_B00000000000000000000000000000000000B",
    "0xUSER_C00000000000000000000000000000000000C",
]
BROKERS = [
    "0xBROK_A00000000000000000000000000000000001",
    "0xBROK_B00000000000000000000000000000000002",
    "0xBROK_C00000000000000000000000000000000003",
]

# ── Helpers ──────────────────────────────────────────────────────────────────

def pad32(addr: str) -> str:
    """Left-pad an address to 32 bytes (64 hex chars)."""
    clean = addr.replace("0x", "").lower()
    return "0x" + clean.zfill(64)

def encode_uint256(val: int) -> str:
    """Encode uint256 as 32-byte hex."""
    return "0x" + hex(val)[2:].zfill(64)

def encode_int256(val: int) -> str:
    """Encode int256 as 32-byte hex (two's complement)."""
    if val < 0:
        val = val + 2**256
    return "0x" + hex(val)[2:].zfill(64)


async def insert_raw(
    conn: asyncpg.Connection,
    block: int,
    tx_idx: int,
    log_idx: int,
    contract: str,
    event_sig: str,
    topics: list[str | None],
    data: str = "",
) -> None:
    """Insert one mock event into raw_events."""
    t0 = topic0_for(event_sig)
    tx_hash = f"0xmock_{block:06d}_{tx_idx:04d}"
    ts = int(time.time()) + block  # monotonic mock timestamps

    await conn.execute("""
        INSERT INTO raw_events (block_number, block_timestamp, tx_hash, log_index,
                                contract, topic0, topic1, topic2, topic3, data, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        ON CONFLICT (tx_hash, log_index) DO NOTHING
    """,
        block, ts, tx_hash, log_idx,
        contract.lower(), t0,
        topics[0] if len(topics) > 0 else None,
        topics[1] if len(topics) > 1 else None,
        topics[2] if len(topics) > 2 else None,
        data,
    )


# ── Event Generators ─────────────────────────────────────────────────────────

async def emit_market_created(conn: asyncpg.Connection, block: int) -> None:
    """MarketCreated(bytes32 indexed marketId, address rldCore, address wausdc, address wrlp)"""
    data = pad32(RLD_CORE)[2:] + pad32(WAUSDC)[2:] + pad32(WRLP)[2:]
    await insert_raw(conn, block, 0, 0, RLD_CORE,
        "MarketCreated(bytes32,address,address,address)",
        [MARKET_ID], "0x" + data)
    log.info("Block %d: MarketCreated", block)


async def emit_broker_created(conn: asyncpg.Connection, block: int, idx: int) -> None:
    """BrokerCreated(address indexed broker, address indexed owner, uint256 tokenId)"""
    token_id = idx + 1
    data = encode_uint256(token_id)
    await insert_raw(conn, block, 0, idx, FACTORY,
        "BrokerCreated(address,address,uint256)",
        [pad32(BROKERS[idx]), pad32(USERS[idx])], data)
    log.info("Block %d: BrokerCreated broker=%s owner=%s", block, BROKERS[idx], USERS[idx])


async def emit_transfer(conn: asyncpg.Connection, block: int, log_idx: int,
                         token: str, from_addr: str, to_addr: str, amount: int) -> None:
    """Transfer(address indexed from, address indexed to, uint256 value)"""
    data = encode_uint256(amount)
    await insert_raw(conn, block, 0, log_idx, token,
        "Transfer(address,address,uint256)",
        [pad32(from_addr), pad32(to_addr)], data)
    log.info("Block %d: Transfer %s → %s amount=%d", block, from_addr[:10], to_addr[:10], amount)


async def emit_position_modified(conn: asyncpg.Connection, block: int, log_idx: int,
                                  broker: str, col_delta: int, debt_delta: int) -> None:
    """PositionModified(bytes32 indexed marketId, address indexed account, int256 colDelta, int256 debtDelta)"""
    data = encode_int256(col_delta)[2:] + encode_int256(debt_delta)[2:]
    await insert_raw(conn, block, 0, log_idx, RLD_CORE,
        "PositionModified(bytes32,address,int256,int256)",
        [MARKET_ID, pad32(broker)], "0x" + data)
    log.info("Block %d: PositionModified broker=%s col=%d debt=%d", block, broker[:10], col_delta, debt_delta)


async def emit_modify_liquidity(conn: asyncpg.Connection, block: int, log_idx: int,
                                 sender: str, tick_lower: int, tick_upper: int,
                                 liquidity_delta: int) -> None:
    """ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)"""
    pool_id = "0x" + "cc" * 32
    tl = encode_int256(tick_lower)[2:]
    tu = encode_int256(tick_upper)[2:]
    ld = encode_int256(liquidity_delta)[2:]
    salt = "00" * 32
    data = "0x" + tl + tu + ld + salt
    await insert_raw(conn, block, 0, log_idx, POOL_MGR,
        "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)",
        [pool_id, pad32(sender)], data)
    log.info("Block %d: ModifyLiquidity sender=%s liq=%d", block, sender[:10], liquidity_delta)


async def emit_swap(conn: asyncpg.Connection, block: int, log_idx: int,
                     sender: str, amount0: int, amount1: int,
                     sqrt_price: int, liquidity: int, tick: int) -> None:
    """Swap(bytes32 indexed id, address indexed sender, int128 a0, int128 a1, uint160 sqrtPriceX96, uint128 liq, int24 tick, uint24 fee)"""
    pool_id = "0x" + "cc" * 32
    d = (encode_int256(amount0)[2:] + encode_int256(amount1)[2:] +
         encode_uint256(sqrt_price)[2:] + encode_uint256(liquidity)[2:] +
         encode_int256(tick)[2:] + encode_uint256(3000)[2:])
    await insert_raw(conn, block, 0, log_idx, POOL_MGR,
        "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
        [pool_id, pad32(sender)], "0x" + d)
    log.info("Block %d: Swap tick=%d", block, tick)


async def emit_funding(conn: asyncpg.Connection, block: int, log_idx: int,
                        norm_factor: int, total_debt: int, funding_rate: int) -> None:
    """FundingApplied(bytes32 indexed marketId, uint256 normFactor, uint256 totalDebt, int256 fundingRate, uint256 timestamp)"""
    ts = int(time.time()) + block
    d = (encode_uint256(norm_factor)[2:] + encode_uint256(total_debt)[2:] +
         encode_int256(funding_rate)[2:] + encode_uint256(ts)[2:])
    await insert_raw(conn, block, 0, log_idx, RLD_CORE,
        "FundingApplied(bytes32,uint256,uint256,int256,uint256)",
        [MARKET_ID], "0x" + d)


async def emit_market_state(conn: asyncpg.Connection, block: int, log_idx: int,
                             norm_factor: int, total_debt: int) -> None:
    """MarketStateUpdated(bytes32 indexed marketId, uint128 normFactor, uint128 totalDebt)"""
    d = encode_uint256(norm_factor)[2:] + encode_uint256(total_debt)[2:]
    await insert_raw(conn, block, 0, log_idx, RLD_CORE,
        "MarketStateUpdated(bytes32,uint128,uint128)",
        [MARKET_ID], "0x" + d)


# ── Main Producer Loop ───────────────────────────────────────────────────────

async def run_producer(pool: asyncpg.Pool, total_blocks: int = 30, interval: float = 0.5) -> None:
    """Generate a realistic event stream over `total_blocks` blocks."""
    log.info("Producer starting — %d blocks at %.1fs interval", total_blocks, interval)

    for block in range(1, total_blocks + 1):
        async with pool.acquire() as conn:
            if block == 1:
                await emit_market_created(conn, block)

            elif 2 <= block <= 4:
                idx = block - 2  # 0, 1, 2
                await emit_broker_created(conn, block, idx)

            elif 5 <= block <= 7:
                idx = block - 5
                # Deposit 10,000 waUSDC into each broker
                await emit_transfer(conn, block, 0, WAUSDC, USERS[idx], BROKERS[idx], 10_000 * 10**6)

            elif 8 <= block <= 10:
                idx = block - 8
                # Each broker opens a position: +5000 collateral, +2000 debt
                await emit_position_modified(conn, block, 0, BROKERS[idx], 5000 * 10**6, 2000 * 10**18)

            elif block == 11:
                # Broker A adds LP
                await emit_modify_liquidity(conn, block, 0, BROKERS[0], -60, 60, 1_000_000)

            elif block >= 12:
                # Continuous: swap every block, funding every 3 blocks
                tick = -100 + (block % 200)
                sqrt_price = 79228162514264337593543950336 + block * 10**20
                await emit_swap(conn, block, 0, USERS[block % 3], -(block * 10**5), block * 10**5,
                                sqrt_price, 1_000_000, tick)

                if block % 3 == 0:
                    norm = 10**18 + block * 10**14
                    debt = 6000 * 10**18 + block * 10**16
                    await emit_funding(conn, block, 1, norm, debt, 100 * block)
                    await emit_market_state(conn, block, 2, norm, debt)

        await asyncio.sleep(interval)

    log.info("Producer finished — %d blocks emitted", total_blocks)
