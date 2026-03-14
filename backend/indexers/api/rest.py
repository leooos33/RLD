import json
from fastapi import APIRouter
from typing import List, Dict, Any
import logging
from .graphql import get_pool

log = logging.getLogger("rest")
router = APIRouter()

@router.get("/latest")
async def get_latest():
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            # 1. Market states
            market_rows = await conn.fetch("SELECT * FROM markets ORDER BY deploy_block DESC LIMIT 1")
            market_states = []
            pool_states = []
            bps = []
            block_number = 0
            
            if market_rows:
                mr = dict(market_rows[0])
                m_id = mr["market_id"]
                nf_raw = mr["normalization_factor"] or 10**18
                nf = float(nf_raw) / 10**18
                
                # Fetch latest block state
                bs = await conn.fetchrow(
                    "SELECT * FROM block_states WHERE market_id=$1 ORDER BY block_number DESC LIMIT 1", m_id)
                
                idx_price_raw = 0
                mark_price_raw = 0
                mark_price_float = 0.0
                
                if bs:
                    idx_price_raw = bs["index_price"] or 0
                    mark_price_raw = bs["mark_price"] or 0
                    block_number = bs["block_number"]
                    
                    if mark_price_raw:
                        mark_price_float = float(mark_price_raw)
                        
                    ms_dict = {
                        "index_price": str(idx_price_raw),
                        "normalization_factor": str(nf_raw),
                        "total_debt": str(mr["total_debt_raw"] or 0)
                    }
                    market_states.append(ms_dict)
                    
                    ps_dict = {
                        "mark_price": mark_price_float
                    }
                    pool_states.append(ps_dict)
                
                # Broker positions
                broker_rows = await conn.fetch("SELECT * FROM brokers WHERE market_id=$1", m_id)
                for br in broker_rows:
                    collateral_raw = float(br["wausdc_balance"] or 0)
                    debt_principal = float(br["debt_principal"] or 0)
                    
                    # True debt in 18 decimals
                    true_debt_18 = debt_principal * nf
                    # Scale to 6 decimals for frontend
                    debt_6 = int(true_debt_18 / 10**12)
                    
                    # Calculate values using mark price
                    # Collateral is in waUSDC (6 decimals, peg $1) -> value is same
                    coll_value_6 = int(collateral_raw)
                    # Debt value: true_debt (18 dec) / 1e18 * mark_price * 1e6
                    debt_val_float = (true_debt_18 / 10**18) * mark_price_float
                    debt_val_6 = int(debt_val_float * 10**6)
                    
                    hf = 100.0
                    if debt_val_float > 0:
                        hf = (collateral_raw / 10**6) / debt_val_float

                    bps.append({
                        "broker_address": br["address"],
                        "collateral": str(int(collateral_raw)),
                        "debt": str(debt_6),
                        "collateral_value": str(coll_value_6),
                        "debt_value": str(debt_val_6),
                        "health_factor": hf
                    })

        return {
            "block_number": block_number,
            "market_states": market_states,
            "pool_states": pool_states,
            "broker_positions": bps
        }
    except Exception as e:
        log.error(f"Error in /api/latest: {e}")
        return {"error": str(e)}

@router.get("/chart/price")
async def get_chart_price(limit: int = 1000):
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            # We fetch block_states natively instead of candles since the chart expects 1 point per block
            rows = await conn.fetch("""
                SELECT block_number, block_timestamp, mark_price, index_price 
                FROM block_states 
                ORDER BY block_number ASC 
                LIMIT $1
            """, limit)
            
            data = []
            for r in rows:
                data.append({
                    "block_number": r["block_number"],
                    "timestamp": r["block_timestamp"],
                    "mark_price": float(r["mark_price"]) if r["mark_price"] else 0,
                    "index_price": float(r["index_price"])/1e18 if r["index_price"] else 0
                })
        return {"data": data}
    except Exception as e:
        log.error(f"Error in /api/chart/price: {e}")
        return {"error": str(e)}

@router.get("/events")
async def get_events(limit: int = 100):
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            # The dashboard expects events where:
            # event_name, block_timestamp, block_number, event_data
            rows = await conn.fetch("""
                SELECT event_name, block_timestamp, block_number, data 
                FROM raw_events 
                WHERE status='done'
                ORDER BY block_number DESC, log_index DESC
                LIMIT $1
            """, limit)
            
            out = []
            for r in rows:
                try:
                    ev_data = json.loads(r["data"])
                except:
                    ev_data = {}
                out.append({
                    "event_name": r["event_name"],
                    "block_timestamp": r["block_timestamp"],
                    "block_number": r["block_number"],
                    "event_data": ev_data
                })
        return out
    except Exception as e:
        log.error(f"Error in /api/events: {e}")
        return {"error": str(e)}
