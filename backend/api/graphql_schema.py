"""
GraphQL Schema for RLD Indexer.

Provides a single-query interface for the frontend to fetch market state,
pool state, broker positions, and LP positions in one request.

Uses Strawberry GraphQL with FastAPI integration.
"""
import strawberry
from typing import Optional, List

from db.comprehensive import (
    get_latest_summary,
    get_lp_positions,
    get_all_latest_lp_positions,
    get_block_summary,
)


# ═══════════════════════════════════════════════════════════
# Types
# ═══════════════════════════════════════════════════════════

@strawberry.type
class LPPosition:
    token_id: int
    liquidity: str
    tick_lower: int
    tick_upper: int
    entry_tick: Optional[int] = None
    entry_price: Optional[float] = None
    mint_block: Optional[int] = None
    is_active: bool = False
    broker_address: Optional[str] = None


@strawberry.type
class BrokerState:
    address: str
    collateral: str
    debt: str
    collateral_value: str
    debt_value: str
    health_factor: float
    lp_positions: List[LPPosition]


@strawberry.type
class MarketState:
    block_number: int
    market_id: str
    normalization_factor: str
    total_debt: str
    last_update_timestamp: int
    index_price: str


@strawberry.type
class PoolState:
    pool_id: str
    tick: int
    mark_price: float
    liquidity: str
    sqrt_price_x96: str


@strawberry.type
class Snapshot:
    block_number: int
    market: Optional[MarketState] = None
    pool: Optional[PoolState] = None
    brokers: List[BrokerState] = strawberry.field(default_factory=list)


# ═══════════════════════════════════════════════════════════
# Resolvers
# ═══════════════════════════════════════════════════════════

def _row_to_lp(row: dict) -> LPPosition:
    return LPPosition(
        token_id=row.get('token_id', 0),
        liquidity=str(row.get('liquidity', 0)),
        tick_lower=row.get('tick_lower', 0),
        tick_upper=row.get('tick_upper', 0),
        entry_tick=row.get('entry_tick'),
        entry_price=row.get('entry_price'),
        mint_block=row.get('mint_block'),
        is_active=bool(row.get('is_active', 0)),
        broker_address=row.get('broker_address'),
    )


def _build_snapshot(summary: dict) -> Snapshot:
    block_number = summary.get('block_number', 0)

    # Market
    market = None
    ms_list = summary.get('market_states', [])
    if ms_list:
        ms = ms_list[0]
        market = MarketState(
            block_number=ms.get('block_number', block_number),
            market_id=ms.get('market_id', ''),
            normalization_factor=str(ms.get('normalization_factor', 0)),
            total_debt=str(ms.get('total_debt', 0)),
            last_update_timestamp=ms.get('last_update_timestamp', 0),
            index_price=str(ms.get('index_price', 0)),
        )

    # Pool
    pool = None
    ps_list = summary.get('pool_states', [])
    if ps_list:
        ps = ps_list[0]
        pool = PoolState(
            pool_id=ps.get('pool_id', ''),
            tick=ps.get('tick', 0),
            mark_price=ps.get('mark_price', 0.0),
            liquidity=str(ps.get('liquidity', 0)),
            sqrt_price_x96=str(ps.get('sqrt_price_x96', 0)),
        )

    # Brokers with embedded LP positions
    brokers = []
    bp_list = summary.get('broker_positions', [])
    for bp in bp_list:
        addr = bp.get('broker_address', '')
        lp_rows = get_lp_positions(addr, block_number)
        lps = [_row_to_lp(r) for r in lp_rows]
        brokers.append(BrokerState(
            address=addr,
            collateral=str(bp.get('collateral', 0)),
            debt=str(bp.get('debt', 0)),
            collateral_value=str(bp.get('collateral_value', 0)),
            debt_value=str(bp.get('debt_value', 0)),
            health_factor=bp.get('health_factor', 0.0),
            lp_positions=lps,
        ))

    return Snapshot(
        block_number=block_number,
        market=market,
        pool=pool,
        brokers=brokers,
    )


# ═══════════════════════════════════════════════════════════
# Query Root
# ═══════════════════════════════════════════════════════════

@strawberry.type
class Query:
    @strawberry.field(description="Latest indexed block snapshot with all market/pool/broker data.")
    def latest(self) -> Snapshot:
        summary = get_latest_summary()
        if 'error' in summary:
            return Snapshot(block_number=0)
        return _build_snapshot(summary)

    @strawberry.field(description="Snapshot at a specific block.")
    def block(self, block_number: int) -> Snapshot:
        summary = get_block_summary(block_number)
        return _build_snapshot(summary)

    @strawberry.field(description="All LP positions for a specific broker (latest block).")
    def lp_positions(self, broker_address: str) -> List[LPPosition]:
        rows = get_lp_positions(broker_address)
        return [_row_to_lp(r) for r in rows]

    @strawberry.field(description="All LP positions across all brokers (latest block).")
    def all_lp_positions(self) -> List[LPPosition]:
        rows = get_all_latest_lp_positions()
        return [_row_to_lp(r) for r in rows]


schema = strawberry.Schema(query=Query)
