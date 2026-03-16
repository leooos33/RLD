"""
handlers/broker.py — Handles BrokerFactory + PrimeBroker events.

BrokerFactory events (watched at factory address):
  - BrokerCreated(address indexed broker, address indexed owner, uint256 marketId)

PrimeBroker events (watched at each broker address):
  - PositionModified(bytes32 indexed marketId, address indexed user, int256 deltaCollateral, int256 deltaDebt)
  - ActivePositionChanged(uint256 oldTokenId, uint256 newTokenId)
  - ActiveTwammOrderChanged(bytes32 oldOrderId, bytes32 newOrderId)
  - BrokerFrozen(address indexed owner)
  - BrokerUnfrozen(address indexed owner)
  - OperatorUpdated(address indexed operator, bool active)

All broker state is maintained as a single upserted row in `brokers`.
All values stored as raw uint256 strings — no decimal conversion.
"""
import asyncpg
import logging

log = logging.getLogger(__name__)


async def handle_broker_created(
    conn: asyncpg.Connection,
    market_id: str,
    broker_address: str,
    owner: str,
    block_number: int,
    tx_hash: str,
) -> None:
    await conn.execute("""
        INSERT INTO brokers (address, market_id, owner, created_block, created_tx)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (address) DO NOTHING
    """, broker_address.lower(), market_id, owner.lower(), block_number, tx_hash)
    log.info("[broker] BrokerCreated market=%s broker=%s owner=%s block=%d",
             market_id, broker_address, owner, block_number)


async def handle_position_modified(
    conn: asyncpg.Connection,
    market_id: str,
    broker_address: str,
    delta_collateral: int,
    delta_debt: int,
    block_number: int,
) -> None:
    """
    PositionModified carries (deltaCollateral int256, deltaDebt int256).
    deltaCollateral is always 0 (known contract behavior — collateral managed by broker).
    Only deltaDebt matters: raw int256, stored as running sum in debt_principal.
    """
    if delta_debt == 0:
        return  # Nothing to update

    # debt_principal stored as raw uint256 string. We do arithmetic in Python.
    row = await conn.fetchrow(
        "SELECT debt_principal FROM brokers WHERE address = $1",
        broker_address.lower()
    )
    if not row:
        return

    current = int(row["debt_principal"] or "0")
    new_principal = current + delta_debt
    if new_principal < 0:
        new_principal = 0  # safety clamp

    await conn.execute(
        "UPDATE brokers SET debt_principal = $1 WHERE address = $2",
        str(new_principal), broker_address.lower()
    )
    log.debug("[broker] PositionModified broker=%s deltaDebt=%d newDebt=%s block=%d",
              broker_address, delta_debt, new_principal, block_number)


async def handle_active_position_changed(
    conn: asyncpg.Connection,
    broker_address: str,
    old_token_id: int,
    new_token_id: int,
) -> None:
    """ActivePositionChanged(uint256 oldTokenId, uint256 newTokenId)"""
    await conn.execute(
        "UPDATE brokers SET active_lp_token_id = $1 WHERE address = $2",
        str(new_token_id), broker_address.lower()
    )
    # Update lp_positions: new tokenId is active, old is not
    if old_token_id != 0:
        await conn.execute(
            "UPDATE lp_positions SET is_active = FALSE WHERE token_id = $1",
            str(old_token_id)
        )
    if new_token_id != 0:
        await conn.execute(
            "UPDATE lp_positions SET is_active = TRUE WHERE token_id = $1",
            str(new_token_id)
        )
    log.debug("[broker] ActivePositionChanged broker=%s old=%d new=%d",
              broker_address, old_token_id, new_token_id)


async def handle_active_twamm_order_changed(
    conn: asyncpg.Connection,
    broker_address: str,
    old_order_id: str,
    new_order_id: str,
) -> None:
    """ActiveTwammOrderChanged(bytes32 oldOrderId, bytes32 newOrderId)"""
    await conn.execute(
        "UPDATE brokers SET active_twamm_order_id = $1 WHERE address = $2",
        new_order_id, broker_address.lower()
    )
    # Update twamm_orders: new orderId is registered, old is not
    if old_order_id and old_order_id != "0x" + "00" * 32:
        await conn.execute(
            "UPDATE twamm_orders SET is_registered = FALSE WHERE order_id = $1",
            old_order_id
        )
    if new_order_id and new_order_id != "0x" + "00" * 32:
        await conn.execute(
            "UPDATE twamm_orders SET is_registered = TRUE WHERE order_id = $1",
            new_order_id
        )
    log.debug("[broker] ActiveTwammOrderChanged broker=%s old=%s new=%s",
              broker_address, old_order_id[:18], new_order_id[:18])


async def handle_broker_frozen(
    conn: asyncpg.Connection,
    broker_address: str,
) -> None:
    """BrokerFrozen(address indexed owner) — emitted at broker address."""
    await conn.execute(
        "UPDATE brokers SET is_frozen = TRUE WHERE address = $1",
        broker_address.lower()
    )
    log.info("[broker] BrokerFrozen broker=%s", broker_address)


async def handle_broker_unfrozen(
    conn: asyncpg.Connection,
    broker_address: str,
) -> None:
    """BrokerUnfrozen(address indexed owner) — emitted at broker address."""
    await conn.execute(
        "UPDATE brokers SET is_frozen = FALSE WHERE address = $1",
        broker_address.lower()
    )
    log.info("[broker] BrokerUnfrozen broker=%s", broker_address)


async def handle_operator_updated(
    conn: asyncpg.Connection,
    broker_address: str,
    operator: str,
    active: bool,
) -> None:
    """OperatorUpdated(address indexed operator, bool active)"""
    if active:
        await conn.execute("""
            INSERT INTO broker_operators (broker_address, operator)
            VALUES ($1, $2)
            ON CONFLICT (broker_address, operator) DO NOTHING
        """, broker_address.lower(), operator.lower())
    else:
        await conn.execute(
            "DELETE FROM broker_operators WHERE broker_address = $1 AND operator = $2",
            broker_address.lower(), operator.lower()
        )
    log.debug("[broker] OperatorUpdated broker=%s operator=%s active=%s",
              broker_address, operator, active)
