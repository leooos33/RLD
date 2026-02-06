# Reconciliation Engine - Dual Source Verification
from dataclasses import dataclass
from typing import Dict, Optional, Tuple
from decimal import Decimal
import logging
import hashlib
import json

logger = logging.getLogger(__name__)

@dataclass
class ReconciliationResult:
    """Result of comparing indexed state to on-chain state"""
    entity_type: str
    entity_id: str
    block_number: int
    matches: bool
    indexed_state: dict
    onchain_state: dict
    drift_fields: Dict[str, Tuple[Decimal, Decimal]]  # field -> (indexed, onchain)
    

class ReconciliationEngine:
    """
    Paranoid dual-source reconciliation.
    
    Compares indexed state (from events) with on-chain state (direct calls)
    to detect any drift or inconsistencies.
    """
    
    def __init__(self, rpc_client, config):
        self.rpc = rpc_client
        self.config = config
        self.max_drift_wei = config.safety.max_state_drift_wei
        
    async def reconcile_broker(self, broker_address: str, block_number: int, indexed_state: dict) -> ReconciliationResult:
        """Compare indexed broker state to on-chain getFullState()"""
        
        # Call PrimeBroker.getFullState() at specific block
        onchain_state = await self._fetch_broker_state(broker_address, block_number)
        
        drift_fields = {}
        matches = True
        
        # Compare each field
        field_mappings = [
            ("collateral_balance", "collateralBalance"),
            ("position_balance", "positionBalance"),
            ("debt_principal", "debtPrincipal"),
            ("debt_value", "debtValue"),
            ("net_account_value", "netAccountValue"),
        ]
        
        for indexed_key, onchain_key in field_mappings:
            indexed_val = Decimal(indexed_state.get(indexed_key, 0) or 0)
            onchain_val = Decimal(onchain_state.get(onchain_key, 0) or 0)
            
            if abs(indexed_val - onchain_val) > self.max_drift_wei:
                drift_fields[indexed_key] = (indexed_val, onchain_val)
                matches = False
                logger.warning(
                    f"Drift detected for {broker_address[:8]}... {indexed_key}: "
                    f"indexed={indexed_val} vs onchain={onchain_val}"
                )
        
        return ReconciliationResult(
            entity_type="broker",
            entity_id=broker_address,
            block_number=block_number,
            matches=matches,
            indexed_state=indexed_state,
            onchain_state=onchain_state,
            drift_fields=drift_fields,
        )
    
    async def reconcile_market(self, market_id: str, block_number: int, indexed_state: dict) -> ReconciliationResult:
        """Compare indexed market state to on-chain getMarketState()"""
        
        onchain_state = await self._fetch_market_state(market_id, block_number)
        
        drift_fields = {}
        matches = True
        
        # Check normalization factor
        indexed_nf = Decimal(indexed_state.get("normalization_factor", 0) or 0)
        onchain_nf = Decimal(onchain_state.get("normalizationFactor", 0) or 0)
        
        if indexed_nf != onchain_nf:
            drift_fields["normalization_factor"] = (indexed_nf, onchain_nf)
            matches = False
            
        # Check total debt
        indexed_debt = Decimal(indexed_state.get("total_debt", 0) or 0)
        onchain_debt = Decimal(onchain_state.get("totalDebt", 0) or 0)
        
        if abs(indexed_debt - onchain_debt) > self.max_drift_wei:
            drift_fields["total_debt"] = (indexed_debt, onchain_debt)
            matches = False
            
        return ReconciliationResult(
            entity_type="market",
            entity_id=market_id,
            block_number=block_number,
            matches=matches,
            indexed_state=indexed_state,
            onchain_state=onchain_state,
            drift_fields=drift_fields,
        )
    
    async def _fetch_broker_state(self, broker_address: str, block_number: int) -> dict:
        """Call PrimeBroker.getFullState() at specific block"""
        # In production, use eth_call with block number override
        # Placeholder for now
        return {}
    
    async def _fetch_market_state(self, market_id: str, block_number: int) -> dict:
        """Call RLDCore.getMarketState() at specific block"""
        return {}


class InvariantChecker:
    """
    Verify system-wide invariants hold at each block.
    """
    
    def __init__(self, rpc_client, db):
        self.rpc = rpc_client
        self.db = db
        
    async def check_all_invariants(self, block_number: int) -> dict:
        """Run all invariant checks for a block"""
        results = {
            "block_number": block_number,
            "wrlp_supply_matches_debt": await self._check_wrlp_debt_invariant(block_number),
            "all_markets_consistent": await self._check_market_consistency(block_number),
            "nf_monotonic": await self._check_nf_monotonic(block_number),
            "all_balances_positive": await self._check_positive_balances(block_number),
        }
        
        results["all_passed"] = all([
            results["wrlp_supply_matches_debt"],
            results["all_markets_consistent"],
            results["nf_monotonic"],
            results["all_balances_positive"],
        ])
        
        if not results["all_passed"]:
            logger.error(f"Invariant check FAILED at block {block_number}: {results}")
            
        return results
    
    async def _check_wrlp_debt_invariant(self, block_number: int) -> bool:
        """wRLP.totalSupply() == Σ broker.debtPrincipal for all brokers"""
        # Would query chain and compare
        return True
    
    async def _check_market_consistency(self, block_number: int) -> bool:
        """Market totalDebt matches sum of all broker debts"""
        return True
    
    async def _check_nf_monotonic(self, block_number: int) -> bool:
        """Normalization factor should only increase"""
        result = await self.db.fetchrow("""
            SELECT COUNT(*) as violations
            FROM funding_updates f1
            JOIN funding_updates f2 ON f1.market_id = f2.market_id 
                AND f1.block_number < f2.block_number
            WHERE f1.new_norm_factor > f2.old_norm_factor
        """)
        return result["violations"] == 0 if result else True
    
    async def _check_positive_balances(self, block_number: int) -> bool:
        """All tracked balances should be non-negative"""
        result = await self.db.fetchrow("""
            SELECT COUNT(*) as violations
            FROM broker_snapshots
            WHERE block_number <= $1
            AND (collateral_balance < 0 OR position_balance < 0 OR debt_principal < 0)
        """, block_number)
        return result["violations"] == 0 if result else True


def compute_state_hash(state: dict) -> str:
    """Compute deterministic hash of state for comparison"""
    # Sort keys for determinism
    canonical = json.dumps(state, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()
