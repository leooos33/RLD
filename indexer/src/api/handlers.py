# REST API Layer for RLD Indexer
from dataclasses import dataclass
from typing import Optional, List
from decimal import Decimal
import json

# FastAPI would be used in production
# This is a minimal structure showing the endpoints

@dataclass
class BrokerResponse:
    broker_address: str
    owner_address: str
    market_id: str
    collateral_balance: str
    position_balance: str
    debt_principal: str
    debt_value: str
    net_account_value: str
    health_factor: str
    is_solvent: bool
    block_number: int


@dataclass  
class MarketResponse:
    market_id: str
    collateral_token: str
    underlying_token: str
    normalization_factor: str
    funding_rate: Optional[str]
    mark_price: Optional[str]
    index_price: Optional[str]
    total_debt: str
    debt_cap: Optional[str]
    block_number: int


class APIHandlers:
    """API endpoint handlers"""
    
    def __init__(self, db):
        self.db = db
        
    # ==========================================================================
    # BROKER ENDPOINTS
    # ==========================================================================
    
    async def get_broker(self, address: str) -> Optional[BrokerResponse]:
        """GET /api/v1/brokers/{address}"""
        row = await self.db.fetchrow("""
            SELECT b.*, bs.*
            FROM brokers b
            LEFT JOIN broker_latest_state bs ON bs.broker_address = b.broker_address
            WHERE b.broker_address = $1
        """, address)
        
        if not row:
            return None
            
        return BrokerResponse(
            broker_address=row["broker_address"],
            owner_address=row["owner_address"],
            market_id=row["market_id"],
            collateral_balance=str(row["collateral_balance"] or 0),
            position_balance=str(row["position_balance"] or 0),
            debt_principal=str(row["debt_principal"] or 0),
            debt_value=str(row["debt_value"] or 0),
            net_account_value=str(row["net_account_value"] or 0),
            health_factor=str(row["health_factor"] or 0),
            is_solvent=row["is_solvent"] or True,
            block_number=row["block_number"] or 0,
        )
    
    async def get_broker_history(
        self, address: str, from_block: int, to_block: int
    ) -> List[dict]:
        """GET /api/v1/brokers/{address}/history?from={}&to={}"""
        rows = await self.db.fetch("""
            SELECT * FROM broker_snapshots
            WHERE broker_address = $1 AND block_number BETWEEN $2 AND $3
            ORDER BY block_number ASC
        """, address, from_block, to_block)
        return [dict(row) for row in rows]
    
    async def get_brokers_by_owner(self, owner: str) -> List[BrokerResponse]:
        """GET /api/v1/accounts/{owner}/brokers"""
        rows = await self.db.fetch("""
            SELECT b.*, bs.*
            FROM brokers b
            LEFT JOIN broker_latest_state bs ON bs.broker_address = b.broker_address
            WHERE b.owner_address = $1
        """, owner)
        return [self._row_to_broker(row) for row in rows]
    
    async def get_at_risk_brokers(self, threshold: float = 1.2) -> List[dict]:
        """GET /api/v1/brokers/at-risk?threshold={}"""
        rows = await self.db.fetch("""
            SELECT * FROM broker_latest_state
            WHERE health_factor < $1 * 1e18 AND health_factor > 0
            ORDER BY health_factor ASC
        """, threshold)
        return [dict(row) for row in rows]
    
    # ==========================================================================
    # MARKET ENDPOINTS
    # ==========================================================================
    
    async def get_market(self, market_id: str) -> Optional[MarketResponse]:
        """GET /api/v1/markets/{market_id}"""
        row = await self.db.fetchrow("""
            SELECT m.*, ms.*
            FROM markets m
            LEFT JOIN market_latest_state ms ON ms.market_id = m.market_id
            WHERE m.market_id = $1
        """, market_id)
        
        if not row:
            return None
            
        return MarketResponse(
            market_id=row["market_id"],
            collateral_token=row["collateral_token"],
            underlying_token=row["underlying_token"],
            normalization_factor=str(row["normalization_factor"] or 0),
            funding_rate=str(row["funding_rate"]) if row["funding_rate"] else None,
            mark_price=str(row["mark_price"]) if row["mark_price"] else None,
            index_price=str(row["index_price"]) if row["index_price"] else None,
            total_debt=str(row["total_debt"] or 0),
            debt_cap=str(row["debt_cap"]) if row["debt_cap"] else None,
            block_number=row["block_number"] or 0,
        )
    
    async def get_all_markets(self) -> List[MarketResponse]:
        """GET /api/v1/markets"""
        rows = await self.db.fetch("""
            SELECT m.*, ms.*
            FROM markets m
            LEFT JOIN market_latest_state ms ON ms.market_id = m.market_id
        """)
        return [self._row_to_market(row) for row in rows]
    
    async def get_funding_history(
        self, market_id: str, from_block: int, to_block: int
    ) -> List[dict]:
        """GET /api/v1/markets/{market_id}/funding?from={}&to={}"""
        rows = await self.db.fetch("""
            SELECT * FROM funding_updates
            WHERE market_id = $1 AND block_number BETWEEN $2 AND $3
            ORDER BY block_number ASC
        """, market_id, from_block, to_block)
        return [dict(row) for row in rows]
    
    async def get_price_history(
        self, market_id: str, from_block: int, to_block: int
    ) -> List[dict]:
        """GET /api/v1/markets/{market_id}/prices?from={}&to={}"""
        rows = await self.db.fetch("""
            SELECT * FROM prices
            WHERE market_id = $1 AND block_number BETWEEN $2 AND $3
            ORDER BY block_number ASC
        """, market_id, from_block, to_block)
        return [dict(row) for row in rows]
    
    # ==========================================================================
    # SYSTEM ENDPOINTS
    # ==========================================================================
    
    async def get_system_status(self) -> dict:
        """GET /api/v1/status"""
        latest = await self.db.fetchrow("""
            SELECT MAX(block_number) as latest_block,
                   COUNT(*) as total_blocks
            FROM blocks WHERE reorged = FALSE
        """)
        
        brokers = await self.db.fetchval("SELECT COUNT(*) FROM brokers")
        markets = await self.db.fetchval("SELECT COUNT(*) FROM markets")
        events = await self.db.fetchval("SELECT COUNT(*) FROM raw_events")
        
        # Last invariant check
        invariant = await self.db.fetchrow("""
            SELECT * FROM invariant_checks ORDER BY block_number DESC LIMIT 1
        """)
        
        return {
            "latest_indexed_block": latest["latest_block"],
            "total_blocks": latest["total_blocks"],
            "total_brokers": brokers,
            "total_markets": markets,
            "total_events": events,
            "last_invariant_check": dict(invariant) if invariant else None,
            "healthy": invariant["all_passed"] if invariant else True,
        }
    
    async def get_drift_report(self, from_block: int = 0) -> List[dict]:
        """GET /api/v1/admin/drift?from={}"""
        rows = await self.db.fetch("""
            SELECT * FROM reconciliation_status
            WHERE matches = FALSE AND block_number >= $1
            ORDER BY block_number DESC
            LIMIT 100
        """, from_block)
        return [dict(row) for row in rows]
    
    async def get_liquidation_queue(self) -> List[dict]:
        """GET /api/v1/admin/liquidation-queue"""
        rows = await self.db.fetch("""
            SELECT * FROM liquidation_candidates
            WHERE status = 'pending'
            ORDER BY priority_score DESC
        """)
        return [dict(row) for row in rows]
    
    def _row_to_broker(self, row) -> BrokerResponse:
        return BrokerResponse(
            broker_address=row["broker_address"],
            owner_address=row["owner_address"],
            market_id=row["market_id"],
            collateral_balance=str(row.get("collateral_balance", 0) or 0),
            position_balance=str(row.get("position_balance", 0) or 0),
            debt_principal=str(row.get("debt_principal", 0) or 0),
            debt_value=str(row.get("debt_value", 0) or 0),
            net_account_value=str(row.get("net_account_value", 0) or 0),
            health_factor=str(row.get("health_factor", 0) or 0),
            is_solvent=row.get("is_solvent", True) or True,
            block_number=row.get("block_number", 0) or 0,
        )
    
    def _row_to_market(self, row) -> MarketResponse:
        return MarketResponse(
            market_id=row["market_id"],
            collateral_token=row["collateral_token"],
            underlying_token=row["underlying_token"],
            normalization_factor=str(row.get("normalization_factor", 0) or 0),
            funding_rate=str(row["funding_rate"]) if row.get("funding_rate") else None,
            mark_price=str(row["mark_price"]) if row.get("mark_price") else None,
            index_price=str(row["index_price"]) if row.get("index_price") else None,
            total_debt=str(row.get("total_debt", 0) or 0),
            debt_cap=str(row["debt_cap"]) if row.get("debt_cap") else None,
            block_number=row.get("block_number", 0) or 0,
        )


# API Routes (FastAPI example)
"""
from fastapi import FastAPI, HTTPException

app = FastAPI(title="RLD Indexer API", version="1.0.0")
api = APIHandlers(db)

@app.get("/api/v1/brokers/{address}")
async def get_broker(address: str):
    result = await api.get_broker(address)
    if not result:
        raise HTTPException(404, "Broker not found")
    return result

@app.get("/api/v1/markets/{market_id}")  
async def get_market(market_id: str):
    result = await api.get_market(market_id)
    if not result:
        raise HTTPException(404, "Market not found")
    return result

@app.get("/api/v1/status")
async def get_status():
    return await api.get_system_status()
"""
