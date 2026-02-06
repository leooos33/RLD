# RLD Indexer - Event Handlers
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from decimal import Decimal
import logging
from eth_abi import decode

logger = logging.getLogger(__name__)

# Event signatures (keccak256)
EVENT_SIGNATURES = {
    "MarketCreated": "0x...",
    "PositionModified": "0x...",
    "FundingApplied": "0x...",
    "MarketStateUpdated": "0x...",
    "AccountStateHash": "0x...",
    "AccountBalanceChanged": "0x...",
    "StateAudit": "0x...",
    "OperatorUpdated": "0x...",
    "Liquidated": "0x...",
}

@dataclass
class DecodedEvent:
    """Parsed event with typed fields"""
    name: str
    block_number: int
    tx_hash: str
    log_index: int
    contract_address: str
    args: Dict[str, Any]
    raw_data: bytes


class EventHandler(ABC):
    """Base class for event handlers"""
    
    @abstractmethod
    def event_name(self) -> str:
        """Name of the event this handler processes"""
        pass
    
    @abstractmethod
    async def handle(self, event: DecodedEvent, db) -> None:
        """Process the event and update database"""
        pass


class FundingAppliedHandler(EventHandler):
    """Handle FundingApplied events from RLDCore"""
    
    def event_name(self) -> str:
        return "FundingApplied"
    
    async def handle(self, event: DecodedEvent, db) -> None:
        market_id = event.args["marketId"]
        old_nf = Decimal(event.args["oldNormFactor"])
        new_nf = Decimal(event.args["newNormFactor"]) 
        funding_rate = Decimal(event.args["fundingRate"])
        time_delta = event.args["timeDelta"]
        
        # Insert funding update
        await db.execute("""
            INSERT INTO funding_updates 
            (market_id, block_number, tx_hash, old_norm_factor, new_norm_factor, funding_rate, time_delta)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, market_id, event.block_number, event.tx_hash, old_nf, new_nf, funding_rate, time_delta)
        
        logger.info(f"FundingApplied: market={market_id[:8]}... NF: {old_nf} -> {new_nf}")


class PositionModifiedHandler(EventHandler):
    """Handle PositionModified events from RLDCore"""
    
    def event_name(self) -> str:
        return "PositionModified"
    
    async def handle(self, event: DecodedEvent, db) -> None:
        market_id = event.args["marketId"]
        broker = event.args["broker"]
        delta_collateral = Decimal(event.args["deltaCollateral"])
        delta_debt = Decimal(event.args["deltaDebt"])
        
        # Get new debt principal from chain
        # In production, we'd call Core.getPosition() here
        new_debt = None
        
        await db.execute("""
            INSERT INTO position_changes
            (market_id, broker_address, block_number, tx_hash, delta_collateral, delta_debt, new_debt_principal)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, market_id, broker, event.block_number, event.tx_hash, delta_collateral, delta_debt, new_debt)
        
        # Ensure broker exists in registry
        await db.execute("""
            INSERT INTO brokers (broker_address, owner_address, market_id, discovered_via)
            VALUES ($1, '', $2, 'event')
            ON CONFLICT (broker_address) DO NOTHING
        """, broker, market_id)
        
        logger.info(f"PositionModified: broker={broker[:8]}... Δcollateral={delta_collateral} Δdebt={delta_debt}")


class MarketStateUpdatedHandler(EventHandler):
    """Handle MarketStateUpdated events from RLDCore"""
    
    def event_name(self) -> str:
        return "MarketStateUpdated"
    
    async def handle(self, event: DecodedEvent, db) -> None:
        market_id = event.args["marketId"]
        norm_factor = Decimal(event.args["normalizationFactor"])
        total_debt = Decimal(event.args["totalDebt"])
        
        # Update market snapshot
        await db.execute("""
            INSERT INTO market_snapshots (market_id, block_number, normalization_factor, total_debt)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (market_id, block_number) 
            DO UPDATE SET normalization_factor = $3, total_debt = $4
        """, market_id, event.block_number, norm_factor, total_debt)


class StateAuditHandler(EventHandler):
    """Handle StateAudit events from PrimeBroker"""
    
    def event_name(self) -> str:
        return "StateAudit"
    
    async def handle(self, event: DecodedEvent, db) -> None:
        account = event.args["account"]
        collateral = Decimal(event.args["collateralBalance"])
        position = Decimal(event.args["positionBalance"])
        debt = Decimal(event.args["debtPrincipal"])
        nav = Decimal(event.args["nav"])
        block = event.args["blockNumber"]
        
        # Update broker snapshot with on-chain values
        await db.execute("""
            INSERT INTO broker_snapshots 
            (broker_address, block_number, collateral_balance, position_balance, debt_principal, net_account_value)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (broker_address, block_number) 
            DO UPDATE SET 
                collateral_balance = $3,
                position_balance = $4,
                debt_principal = $5,
                net_account_value = $6
        """, account, block, collateral, position, debt, nav)
        
        logger.debug(f"StateAudit: {account[:8]}... NAV={nav}")


class EventRouter:
    """Routes events to appropriate handlers"""
    
    def __init__(self):
        self.handlers: Dict[str, EventHandler] = {}
        
    def register(self, handler: EventHandler):
        self.handlers[handler.event_name()] = handler
        
    async def route(self, event: DecodedEvent, db):
        handler = self.handlers.get(event.name)
        if handler:
            await handler.handle(event, db)
        else:
            logger.warning(f"No handler for event: {event.name}")


def create_event_router() -> EventRouter:
    """Factory to create fully configured event router"""
    router = EventRouter()
    router.register(FundingAppliedHandler())
    router.register(PositionModifiedHandler())
    router.register(MarketStateUpdatedHandler())
    router.register(StateAuditHandler())
    return router
