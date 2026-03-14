#!/usr/bin/env python3
"""
processor.py — Polls raw_events WHERE status='pending', decodes each event,
updates domain tables (brokers, lp_positions, block_states), marks done.

Never touches the RPC. Reads exclusively from Postgres.
"""
import asyncio
import asyncpg
import logging
import time

from event_map import TOPIC_MAP, decode_topic_address, decode_uint256, decode_int256

log = logging.getLogger(__name__)


# ── Decode Data Helpers ──────────────────────────────────────────────────────

def slice_data(data_hex: str, slot: int) -> str:
    """Extract 32-byte slot from data (0-indexed). Returns '0x' + 64 hex chars."""
    clean = data_hex.replace("0x", "")
    start = slot * 64
    return "0x" + clean[start:start + 64]


# ── Event Handlers ───────────────────────────────────────────────────────────

async def handle_market_created(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """MarketCreated(MarketId indexed id, address indexed collateral, address indexed underlying, address pool)
    3 indexed → topics[1]=marketId, topics[2]=collateral(waUSDC), topics[3]=underlying(wRLP)
    data = pool (Aave pool address)
    """
    market_id = row["topic1"]
    # Collateral (waUSDC) and underlying (wRLP) are INDEXED → in topics, not data
    wausdc = decode_topic_address(row["topic2"]) if row["topic2"] else ""
    wrlp = decode_topic_address(row["topic3"]) if row["topic3"] else ""

    await conn.execute("""
        INSERT INTO markets (market_id, deploy_block, deploy_timestamp,
                             broker_factory, mock_oracle, twamm_hook,
                             wausdc, wausdc_symbol, wrlp, wrlp_symbol,
                             pool_id, pool_fee, tick_spacing,
                             min_col_ratio, maintenance_margin, liq_close_factor,
                             funding_period_sec, debt_cap, created_at)
        VALUES ($1, $2, $3, $4, '', '', $5, 'waUSDC', $6, 'wRLP',
                '', 3000, 60, '1500000000000000000', '1250000000000000000',
                '500000000000000000', 28800, '1000000000000000000000000', NOW())
        ON CONFLICT (market_id) DO NOTHING
    """, market_id, row["block_number"], row["block_timestamp"],
        row["contract"], wausdc, wrlp)

    # Also seed indexer_state
    await conn.execute("""
        INSERT INTO indexer_state (market_id, last_indexed_block, last_indexed_at, total_events)
        VALUES ($1, $2, NOW(), 0)
        ON CONFLICT (market_id) DO NOTHING
    """, market_id, row["block_number"])

    log.info("[proc] MarketCreated id=%s wausdc=%s wrlp=%s", market_id[:18], wausdc, wrlp)


async def handle_broker_created(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """BrokerCreated(address indexed broker, address indexed owner, uint256 tokenId)"""
    broker = decode_topic_address(row["topic1"])
    owner = decode_topic_address(row["topic2"])

    # Find the market_id from the factory address (use first market)
    market = await conn.fetchval("SELECT market_id FROM markets LIMIT 1")
    if not market:
        log.warning("[proc] BrokerCreated but no market exists yet — skipping")
        return

    await conn.execute("""
        INSERT INTO brokers (address, market_id, owner, created_block, created_tx,
                             wausdc_balance, wrlp_balance)
        VALUES ($1, $2, $3, $4, $5, 0, 0)
        ON CONFLICT (address) DO NOTHING
    """, broker.lower(), market, owner.lower(), row["block_number"], row["tx_hash"])

    log.info("[proc] BrokerCreated broker=%s owner=%s market=%s", broker, owner, market[:18])


async def handle_transfer(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """Transfer(address indexed from, address indexed to, uint256 value)
    Updates broker wausdc_balance or wrlp_balance if to/from is a broker."""
    from_addr = decode_topic_address(row["topic1"]).lower()
    to_addr = decode_topic_address(row["topic2"]).lower()
    token = row["contract"].lower()

    # Skip ERC721 Transfer events (same sig but empty/no data)
    data = row["data"] or ""
    clean = data.replace("0x", "").strip()
    if len(clean) < 64:
        return  # No uint256 value → ERC721, not ERC20

    amount = decode_uint256(slice_data(data, 0))

    # Check if the market's wausdc or wrlp matches this token
    market = await conn.fetchrow("SELECT market_id, wausdc, wrlp FROM markets LIMIT 1")
    if not market:
        return

    is_wausdc = (token == market["wausdc"].lower())
    is_wrlp = (token == market["wrlp"].lower())
    if not is_wausdc and not is_wrlp:
        return  # Not a token we track

    col = "wausdc_balance" if is_wausdc else "wrlp_balance"

    # Credit the receiver if it's a broker
    broker_to = await conn.fetchval("SELECT address FROM brokers WHERE address = $1", to_addr)
    if broker_to:
        await conn.execute(
            f"UPDATE brokers SET {col} = COALESCE({col}, 0) + $1 WHERE address = $2",
            amount, to_addr)

    # Debit the sender if it's a broker
    broker_from = await conn.fetchval("SELECT address FROM brokers WHERE address = $1", from_addr)
    if broker_from:
        await conn.execute(
            f"UPDATE brokers SET {col} = COALESCE({col}, 0) - $1 WHERE address = $2",
            amount, from_addr)


async def handle_position_modified(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """PositionModified(bytes32 indexed marketId, address indexed account, int256 colDelta, int256 debtDelta)"""
    market_id = row["topic1"]
    account = decode_topic_address(row["topic2"]).lower()
    debt_delta = decode_int256(slice_data(row["data"], 1))

    # Check if account is a broker
    broker = await conn.fetchval("SELECT address FROM brokers WHERE address = $1", account)
    if broker:
        await conn.execute("""
            UPDATE brokers
            SET debt_principal = COALESCE(debt_principal, 0) + $1
            WHERE address = $2
        """, debt_delta, account)
        log.info("[proc] PositionModified broker=%s debt_d=%d", account[:10], debt_delta)


async def handle_modify_liquidity(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)"""
    sender = decode_topic_address(row["topic2"]).lower()
    data = row["data"]
    tick_lower = decode_int256(slice_data(data, 0))
    tick_upper = decode_int256(slice_data(data, 1))
    liquidity_delta = decode_int256(slice_data(data, 2))

    market = await conn.fetchval("SELECT market_id FROM markets LIMIT 1")
    if not market:
        return

    # Use a deterministic token_id from block_number + log_index
    token_id = row["block_number"] * 1000 + row["log_index"]

    if liquidity_delta > 0:
        await conn.execute("""
            INSERT INTO lp_positions (token_id, market_id, broker_address, liquidity,
                                      tick_lower, tick_upper, mint_block, is_active, is_burned)
            VALUES ($1, $2, $3, $4, $5, $6, $7, true, false)
            ON CONFLICT (token_id) DO UPDATE SET liquidity = $4, is_active = true
        """, token_id, market, sender, str(liquidity_delta), tick_lower, tick_upper, row["block_number"])
        log.info("[proc] LP added sender=%s ticks=[%d,%d] liq=%d", sender[:10], tick_lower, tick_upper, liquidity_delta)
    else:
        # Liquidity removal — mark the position as burned
        await conn.execute("""
            UPDATE lp_positions SET is_active = false, is_burned = true
            WHERE broker_address = $1 AND market_id = $2 AND is_active = true
        """, sender, market)
        log.info("[proc] LP removed sender=%s", sender[:10])


async def handle_swap(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """Swap(bytes32 indexed id, address indexed sender, int128 a0, int128 a1, uint160 sqrtPriceX96, uint128 liq, int24 tick, uint24 fee)"""
    data = row["data"]
    amount0 = decode_int256(slice_data(data, 0))
    amount1 = decode_int256(slice_data(data, 1))
    sqrt_price = decode_uint256(slice_data(data, 2))
    liquidity = decode_uint256(slice_data(data, 3))
    tick = decode_int256(slice_data(data, 4))

    market = await conn.fetchval("SELECT market_id FROM markets LIMIT 1")
    if not market:
        return

    # Compute mark price from sqrtPriceX96
    # mark_price = (sqrtPriceX96 / 2^96)^2
    mark_price = (sqrt_price / (2**96)) ** 2

    await conn.execute("""
        INSERT INTO block_states (market_id, block_number, block_timestamp,
                                   sqrt_price_x96, tick, mark_price, liquidity)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (market_id, block_number) DO UPDATE
        SET sqrt_price_x96 = $4, tick = $5, mark_price = $6, liquidity = $7
    """, market, row["block_number"], row["block_timestamp"],
        str(sqrt_price), tick, mark_price, str(liquidity))


async def handle_funding(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """FundingApplied(bytes32 indexed marketId, uint256 oldNF, uint256 newNF, int256 fundingRate, uint256 timestamp)"""
    data = row["data"]
    old_nf = decode_uint256(slice_data(data, 0))
    new_nf = decode_uint256(slice_data(data, 1))
    market = row["topic1"]

    # Update block_states (historical)
    await conn.execute("""
        INSERT INTO block_states (market_id, block_number, block_timestamp,
                                   normalization_factor)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (market_id, block_number) DO UPDATE
        SET normalization_factor = $4
    """, market, row["block_number"], row["block_timestamp"], new_nf / 1e18)

    # Update markets table (latest snapshot, raw value)
    await conn.execute("""
        UPDATE markets SET normalization_factor = $1 WHERE market_id = $2
    """, new_nf, market)
    log.info("[proc] FundingApplied market=%s NF=%d", market[:18] if market else "", new_nf)


async def handle_market_state(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """MarketStateUpdated(bytes32 indexed marketId, uint128 normFactor, uint128 totalDebt)"""
    data = row["data"]
    norm = decode_uint256(slice_data(data, 0))
    debt = decode_uint256(slice_data(data, 1))
    market = row["topic1"]

    # Update block_states (historical)
    await conn.execute("""
        INSERT INTO block_states (market_id, block_number, block_timestamp,
                                   normalization_factor, total_debt)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (market_id, block_number) DO UPDATE
        SET normalization_factor = $4, total_debt = $5
    """, market, row["block_number"], row["block_timestamp"],
        norm / 1e18, debt / 1e18)

    # Update markets table (latest snapshot, raw value)
    await conn.execute("""
        UPDATE markets SET normalization_factor = $1, total_debt_raw = $2 WHERE market_id = $3
    """, norm, debt, market)
    log.info("[proc] MarketStateUpdated market=%s nf=%d totalDebt=%d", market[:18] if market else "", norm, debt)


# ── LP Lifecycle ─────────────────────────────────────────────────────────────

async def handle_liquidity_added(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """LiquidityAdded(uint256 indexed tokenId, uint128 liquidity)"""
    token_id = decode_uint256(row["topic1"]) if row["topic1"] else 0
    data = row["data"] or ""
    liquidity = decode_uint256(slice_data(data, 0))
    broker = row["contract"].lower()

    market = await conn.fetchval("SELECT market_id FROM markets LIMIT 1")
    if not market:
        return

    await conn.execute("""
        INSERT INTO lp_positions (token_id, market_id, broker_address, liquidity,
                                   tick_lower, tick_upper, mint_block, is_active, is_burned, is_registered)
        VALUES ($1, $2, $3, $4, 0, 0, $5, true, false, false)
        ON CONFLICT (token_id) DO UPDATE SET liquidity = $4, is_active = true
    """, token_id, market, broker, str(liquidity), row["block_number"])
    log.info("[proc] LiquidityAdded token=%d liq=%d broker=%s", token_id, liquidity, broker[:10])


async def handle_liquidity_removed(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """LiquidityRemoved(uint256 indexed tokenId, uint128 liquidity, bool burned)"""
    token_id = decode_uint256(row["topic1"]) if row["topic1"] else 0
    data = row["data"] or ""
    removed_liq = decode_uint256(slice_data(data, 0))
    burned = bool(decode_uint256(slice_data(data, 1)))

    if burned:
        await conn.execute("""
            UPDATE lp_positions SET liquidity = '0', is_active = false,
                   is_burned = true, is_registered = false
            WHERE token_id = $1
        """, token_id)
        # Clear broker pointer if this was the registered LP
        await conn.execute("""
            UPDATE brokers SET active_lp_token_id = 0
            WHERE active_lp_token_id = $1
        """, token_id)
        log.info("[proc] LiquidityRemoved token=%d BURNED", token_id)
    else:
        await conn.execute("""
            UPDATE lp_positions
            SET liquidity = CAST(CAST(liquidity AS NUMERIC) - $1 AS TEXT)
            WHERE token_id = $2
        """, removed_liq, token_id)
        log.info("[proc] LiquidityRemoved token=%d reduced by %d", token_id, removed_liq)


async def handle_active_position_changed(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """ActivePositionChanged(uint256 oldTokenId, uint256 newTokenId) — in data, not indexed."""
    data = row["data"] or ""
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
    log.info("[proc] ActivePositionChanged old=%d new=%d broker=%s", old_id, new_id, broker[:10])


# ── TWAMM Lifecycle ──────────────────────────────────────────────────────────

async def handle_twamm_submitted(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """TwammOrderSubmitted(bytes32 indexed orderId, bool zeroForOne, uint256 amountIn, uint256 expiration)"""
    order_id = row["topic1"] or ""
    data = row["data"] or ""
    zfo = bool(decode_uint256(slice_data(data, 0)))
    amount_in = decode_uint256(slice_data(data, 1))
    expiration = decode_uint256(slice_data(data, 2))
    broker = row["contract"].lower()

    market = await conn.fetchval("SELECT market_id FROM markets LIMIT 1")
    if not market:
        return

    await conn.execute("""
        INSERT INTO twamm_orders (order_id, market_id, owner, broker_address, zero_for_one,
                                   amount_in, expiration, start_epoch, block_number, tx_hash,
                                   status, is_registered, is_cancelled)
        VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, 'active', false, false)
        ON CONFLICT (order_id) DO NOTHING
    """, order_id, market, broker, zfo, str(amount_in), expiration,
         row["block_timestamp"], row["block_number"], row["tx_hash"])
    log.info("[proc] TwammOrderSubmitted id=%s.. zfo=%s amt=%d", order_id[:10] if order_id else "", zfo, amount_in)


async def handle_twamm_cancelled(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """TwammOrderCancelled(bytes32 indexed orderId, uint256 buyTokensOut, uint256 sellTokensRefund)"""
    order_id = row["topic1"] or ""
    data = row["data"] or ""
    buy_out = decode_uint256(slice_data(data, 0))
    refund = decode_uint256(slice_data(data, 1))

    await conn.execute("""
        UPDATE twamm_orders SET status = 'cancelled', is_cancelled = true, is_registered = false,
                                buy_tokens_out = $1, sell_tokens_refund = $2
        WHERE order_id = $3
    """, str(buy_out), str(refund), order_id)
    log.info("[proc] TwammOrderCancelled id=%s.. buy=%d refund=%d", order_id[:10] if order_id else "", buy_out, refund)


async def handle_twamm_claimed(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """TwammOrderClaimed(bytes32 indexed orderId, uint256 claimAmt0, uint256 claimAmt1)"""
    order_id = row["topic1"] or ""
    data = row["data"] or ""
    c0 = decode_uint256(slice_data(data, 0))
    c1 = decode_uint256(slice_data(data, 1))

    await conn.execute("""
        UPDATE twamm_orders SET status = 'claimed', is_registered = false,
                                buy_tokens_out = $1, sell_tokens_refund = $2
        WHERE order_id = $3
    """, str(c0), str(c1), order_id)
    log.info("[proc] TwammOrderClaimed id=%s.. c0=%d c1=%d", order_id[:10] if order_id else "", c0, c1)


async def handle_active_twamm_changed(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """ActiveTwammOrderChanged(bytes32 oldOrderId, bytes32 newOrderId) — in data, not indexed."""
    data = row["data"] or ""
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
             old_id[:10], new_id[:10], broker[:10])


# ── Liquidation & Bad Debt ───────────────────────────────────────────────────

async def handle_liquidation(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
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
        INSERT INTO liquidations (market_id, block_number, block_timestamp,
                                   user_address, liquidator_address,
                                   debt_covered, collateral_seized, wrlp_burned)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (market_id, block_number, user_address) DO NOTHING
    """, market_id, row["block_number"], row["block_timestamp"],
         broker, liquidator, debt_covered, collateral_seized, wrlp_burned)

    # Mark broker as liquidated
    await conn.execute("UPDATE brokers SET is_liquidated = true WHERE address = $1", broker)
    log.info("[proc] Liquidation broker=%s liquidator=%s debt=%d seized=%d wrlp=%d",
             broker[:10], liquidator[:10], debt_covered, collateral_seized, wrlp_burned)


async def handle_bad_debt(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """BadDebtRegistered(bytes32 indexed marketId, uint128 amount, uint128 totalBadDebt)"""
    market_id = row["topic1"] or ""
    data = row["data"] or ""
    total_bad_debt = decode_uint256(slice_data(data, 1))

    await conn.execute("""
        UPDATE markets SET bad_debt = $1 WHERE market_id = $2
    """, total_bad_debt, market_id)
    log.info("[proc] BadDebtRegistered market=%s totalBadDebt=%d", market_id[:18] if market_id else "", total_bad_debt)


# ── Router ────────────────────────────────────────────────────────────────────

HANDLERS = {
    "MarketCreated":        handle_market_created,
    "BrokerCreated":        handle_broker_created,
    "ERC20_Transfer":       handle_transfer,
    "PositionModified":     handle_position_modified,
    "V4_ModifyLiquidity":   handle_modify_liquidity,
    "V4_Swap":              handle_swap,
    "FundingApplied":       handle_funding,
    "MarketStateUpdated":   handle_market_state,
    "LiquidityAdded":       handle_liquidity_added,
    "LiquidityRemoved":     handle_liquidity_removed,
    "ActivePositionChanged": handle_active_position_changed,
    "TwammOrderSubmitted":  handle_twamm_submitted,
    "TwammOrderCancelled":  handle_twamm_cancelled,
    "TwammOrderClaimed":    handle_twamm_claimed,
    "ActiveTwammOrderChanged": handle_active_twamm_changed,
    "Liquidation":          handle_liquidation,
    "BadDebtRegistered":    handle_bad_debt,
}


# ── Main Processor Loop ──────────────────────────────────────────────────────

async def run_processor(pool: asyncpg.Pool, interval: float = 0.3, stop_event: asyncio.Event | None = None) -> None:
    """Continuously poll raw_events and process pending events."""
    log.info("Processor starting — polling every %.1fs", interval)
    total_processed = 0

    while True:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM raw_events
                WHERE status = 'pending'
                ORDER BY block_number ASC, log_index ASC
                LIMIT 100
            """)

            for row in rows:
                event_name = TOPIC_MAP.get(row["topic0"])
                if not event_name:
                    # Not an event we handle — mark done
                    await conn.execute(
                        "UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])
                    continue

                handler = HANDLERS.get(event_name)
                if handler:
                    try:
                        await handler(conn, row)
                        await conn.execute(
                            "UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])
                        total_processed += 1
                    except Exception as e:
                        log.error("[proc] Error processing event %s id=%d: %s", event_name, row["id"], e)
                        await conn.execute(
                            "UPDATE raw_events SET status = 'error', error_msg = $1 WHERE id = $2",
                            str(e)[:500], row["id"])
                else:
                    # Known event but no handler — mark done (we just log it)
                    await conn.execute(
                        "UPDATE raw_events SET status = 'done' WHERE id = $1", row["id"])

            # Update indexer_state
            if rows:
                max_block = max(r["block_number"] for r in rows)
                await conn.execute("""
                    UPDATE indexer_state SET last_indexed_block = $1,
                           last_indexed_at = NOW(),
                           total_events = total_events + $2
                    WHERE market_id = (SELECT market_id FROM markets LIMIT 1)
                """, max_block, len(rows))

        if stop_event and stop_event.is_set():
            # Drain remaining
            async with pool.acquire() as conn:
                remaining = await conn.fetchval(
                    "SELECT COUNT(*) FROM raw_events WHERE status = 'pending'")
                if remaining == 0:
                    break

        await asyncio.sleep(interval)

    log.info("Processor finished — %d events processed", total_processed)
