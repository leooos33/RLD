"""
Simulation / Market API routes.

These endpoints interact with the Anvil fork chain for deploying
and managing RLD rate markets. Only loaded when RATE_ONLY is not set.
"""

import json
import logging
import os
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from web3 import Web3
from eth_account import Account

from api.deps import get_api_key

logger = logging.getLogger(__name__)
router = APIRouter()

# --- Web3 Setup ---
from dotenv import load_dotenv
load_dotenv("../contracts/.env")

RPC_URL = "http://127.0.0.1:8545"
PRIVATE_KEY = os.getenv("PRIVATE_KEY")

w3 = Web3(Web3.HTTPProvider(RPC_URL))
account = None
if PRIVATE_KEY:
    try:
        account = Account.from_key(PRIVATE_KEY)
        logger.info(f"✅ Loaded Deployer: {account.address}")
    except Exception as e:
        logger.error(f"❌ Invalid Private Key: {e}")

# Load ABIs
FACTORY_ABI = []
CORE_ABI = []
ORACLE_ABI = []
ADDRESSES = {}
FACTORY_ADDRESS = None
CORE_ADDRESS = None

try:
    with open("../contracts/out/RLDMarketFactory.sol/RLDMarketFactory.json") as f:
        FACTORY_ABI = json.load(f)["abi"]
    with open("../contracts/out/RLDCore.sol/RLDCore.json") as f:
        CORE_ABI = json.load(f)["abi"]
    with open("../contracts/out/RLDAaveOracle.sol/RLDAaveOracle.json") as f:
        ORACLE_ABI = json.load(f)["abi"]
    with open("../shared/addresses.json") as f:
        ADDRESSES = json.load(f)
        FACTORY_ADDRESS = ADDRESSES.get("RLDMarketFactory")
        CORE_ADDRESS = ADDRESSES.get("RLDCore")
    logger.info(f"✅ Loaded ABIs - Core: {CORE_ADDRESS}, Factory: {FACTORY_ADDRESS}")
except Exception as e:
    logger.warning(f"⚠️ Could not load ABIs or Addresses: {e}")


# --- Indexer Imports ---
from indexers.event_indexer import init_indexer, get_indexer
from db import markets as db
from indexers.state_indexer import init_state_indexer, get_state_indexer, register_market_manually
from db.market_state import (
    init_market_state_db,
    get_all_markets_with_state,
    get_market_by_id,
    upsert_market,
    upsert_risk_params,
    insert_state_snapshot,
)


# --- Deployment Models ---
class MarketParams(BaseModel):
    lending_protocol: str
    target_market: str
    collateral_token: str
    initial_price: str
    min_col_ratio: str
    maintenance_margin: str
    liq_close_factor: str
    debt_cap: str
    funding_period: str


# --- Persistence Utils ---
SIMULATIONS_FILE = "simulations.json"


def load_simulations():
    if not os.path.exists(SIMULATIONS_FILE):
        return []
    try:
        with open(SIMULATIONS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return []


def save_simulation(data):
    current = load_simulations()
    current.insert(0, data)
    with open(SIMULATIONS_FILE, "w") as f:
        json.dump(current, f, indent=4)


# --- Routes ---

@router.get("/simulations")
def get_simulations():
    try:
        markets = db.get_all_markets()
        simulations = []
        for market in markets:
            simulations.append({
                "id": market['tx_hash'],
                "target_market": market['position_token_symbol'],
                "rate_oracle": market['rate_oracle'],
                "status": "Running",
                "timestamp": market['deployment_timestamp']
            })
        return simulations
    except Exception as e:
        logger.error(f"Error fetching simulations: {e}")
        return []


@router.get("/simulations/enriched")
def get_enriched_simulations():
    try:
        markets = get_all_markets_with_state()
        enriched = []
        for market in markets:
            nf_raw = int(market.get('normalization_factor') or 0)
            nf_display = nf_raw / 1e18 if nf_raw else 0
            accrued_interest_pct = (nf_display - 1) * 100 if nf_display > 0 else 0
            total_debt_raw = int(market.get('total_debt') or 0)
            total_debt_display = total_debt_raw / 1e18 if total_debt_raw else 0
            min_col_raw = int(market.get('min_col_ratio') or 0)
            maint_margin_raw = int(market.get('maintenance_margin') or 0)
            liq_close_raw = int(market.get('liquidation_close_factor') or 0)
            min_col_pct = min_col_raw / 1e16 if min_col_raw else 0
            maint_margin_pct = maint_margin_raw / 1e16 if maint_margin_raw else 0
            liq_close_pct = liq_close_raw / 1e16 if liq_close_raw else 0
            funding_period = market.get('funding_period') or 0
            funding_period_days = funding_period / 86400 if funding_period else 0
            state_last_update = market.get('state_last_update')
            last_update_display = ""
            if state_last_update:
                last_update_display = datetime.utcfromtimestamp(state_last_update).strftime('%Y-%m-%d %H:%M:%S')

            enriched.append({
                "id": market.get('tx_hash') or market.get('market_id'),
                "market_id": market.get('market_id'),
                "target_market": market.get('position_token_symbol') or "Unknown",
                "broker_factory": market.get('broker_factory'),
                "position_token": market.get('position_token'),
                "collateral_token": market.get('collateral_token'),
                "underlying_token": market.get('underlying_token'),
                "curator": market.get('curator'),
                "status": "Running",
                "timestamp": market.get('deployment_timestamp'),
                "state": {
                    "normalization_factor": str(nf_raw),
                    "normalization_factor_display": f"{nf_display:.6f}",
                    "accrued_interest_pct": f"{accrued_interest_pct:.4f}%",
                    "total_debt": str(total_debt_raw),
                    "total_debt_display": f"{total_debt_display:.2f}",
                    "last_update": last_update_display,
                    "last_update_timestamp": state_last_update,
                    "block_number": market.get('state_block')
                },
                "risk_params": {
                    "min_col_ratio": min_col_pct,
                    "min_col_ratio_display": f"{min_col_pct:.0f}%",
                    "maintenance_margin": maint_margin_pct,
                    "maintenance_margin_display": f"{maint_margin_pct:.0f}%",
                    "liquidation_close_factor": liq_close_pct,
                    "liquidation_close_factor_display": f"{liq_close_pct:.0f}%",
                    "funding_period_seconds": funding_period,
                    "funding_period_days": funding_period_days,
                    "debt_cap": market.get('debt_cap'),
                    "broker_verifier": market.get('broker_verifier')
                },
                "oracles": {
                    "spot_oracle": market.get('spot_oracle'),
                    "rate_oracle": market.get('rate_oracle')
                }
            })
        return enriched
    except Exception as e:
        logger.error(f"Error fetching enriched simulations: {e}", exc_info=True)
        return []


@router.get("/market/{market_id}/state")
def get_market_state(market_id: str):
    try:
        market = get_market_by_id(market_id)
        if not market:
            raise HTTPException(status_code=404, detail="Market not found")
        nf_raw = int(market.get('normalization_factor') or 0)
        nf_display = nf_raw / 1e18 if nf_raw else 0
        accrued_interest = (nf_display - 1) * 100 if nf_display > 0 else 0
        return {
            "market_id": market_id,
            "state": {
                "normalization_factor": str(nf_raw),
                "normalization_factor_display": f"{nf_display:.6f}",
                "accrued_interest_pct": f"{accrued_interest:.4f}%",
                "total_debt": str(market.get('total_debt') or 0),
                "last_update_timestamp": market.get('state_last_update'),
                "block_number": market.get('state_block')
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching market state: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/deploy-market", dependencies=[Depends(get_api_key)])
async def deploy_market(params: MarketParams):
    if not w3.is_connected():
        raise HTTPException(status_code=500, detail="RPC Connection Failed")
    if not account:
        raise HTTPException(status_code=500, detail="Server Wallet Not Configured")
    if not FACTORY_ADDRESS:
        raise HTTPException(status_code=500, detail="Factory Address Not Found")

    try:
        logger.info(f"🚀 Deploying Market: {params.target_market}")
        min_col_wad = int(float(params.min_col_ratio) * 10**16)
        maint_margin_wad = int(float(params.maintenance_margin) * 10**16)
        liq_close_wad = int(float(params.liq_close_factor) * 10**16)
        debt_cap_raw = int(params.debt_cap) * 10**18
        funding_period = int(params.funding_period)

        TOKEN_MAP = {
            "aUSDC": {
                "collateral": w3.to_checksum_address("0xFF00000000000000000000000000000000000001"),
                "underlying": w3.to_checksum_address("0xFF00000000000000000000000000000000000002"),
                "pool": w3.to_checksum_address("0xFF00000000000000000000000000000000000003")
            },
            "aUSDT": {
                "collateral": w3.to_checksum_address("0xFF00000000000000000000000000000000000004"),
                "underlying": w3.to_checksum_address("0xFF00000000000000000000000000000000000005"),
                "pool": w3.to_checksum_address("0xFF00000000000000000000000000000000000003")
            },
            "aDAI": {
                "collateral": w3.to_checksum_address("0xFF00000000000000000000000000000000000006"),
                "underlying": w3.to_checksum_address("0xFF00000000000000000000000000000000000007"),
                "pool": w3.to_checksum_address("0xFF00000000000000000000000000000000000003")
            }
        }

        market_config = TOKEN_MAP.get(params.target_market)
        if not market_config:
            raise HTTPException(status_code=400, detail="Unsupported Target Market")

        with open("../contracts/out/RLDAaveOracle.sol/RLDAaveOracle.json") as f:
            oracle_artifact = json.load(f)
            oracle_bytecode = oracle_artifact["bytecode"]["object"]

        OracleFactory = w3.eth.contract(abi=ORACLE_ABI, bytecode=oracle_bytecode)
        construct_tx = OracleFactory.constructor().build_transaction({
            'from': account.address,
            'nonce': w3.eth.get_transaction_count(account.address),
            'gas': 2000000,
            'maxFeePerGas': w3.to_wei('2', 'gwei'),
            'maxPriorityFeePerGas': w3.to_wei('1', 'gwei'),
        })
        signed_tx = w3.eth.account.sign_transaction(construct_tx, PRIVATE_KEY)
        tx_hash_oracle = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        receipt_oracle = w3.eth.wait_for_transaction_receipt(tx_hash_oracle)
        rate_oracle_address = receipt_oracle.contractAddress
        logger.info(f"✅ Deployed RLDAaveOracle: {rate_oracle_address}")

        factory_contract = w3.eth.contract(address=FACTORY_ADDRESS, abi=FACTORY_ABI)
        spot_oracle_address = w3.to_checksum_address("0x" + "0" * 40)
        curator_address = account.address
        liq_module = w3.to_checksum_address(ADDRESSES.get("RLDCore"))

        deploy_params = (
            market_config["pool"], market_config["underlying"], market_config["collateral"],
            curator_address, f"Wrapped RLP: {params.target_market}", f"wRLP{params.target_market}",
            min_col_wad, maint_margin_wad, liq_close_wad, liq_module, b'\x00' * 32,
            spot_oracle_address, rate_oracle_address, 3600, 3000, 60
        )

        create_tx = factory_contract.functions.createMarket(deploy_params).build_transaction({
            'from': account.address,
            'nonce': w3.eth.get_transaction_count(account.address),
            'gas': 5000000,
            'maxFeePerGas': w3.to_wei('2', 'gwei'),
            'maxPriorityFeePerGas': w3.to_wei('1', 'gwei'),
        })
        signed_create_tx = w3.eth.account.sign_transaction(create_tx, PRIVATE_KEY)
        tx_hash_create = w3.eth.send_raw_transaction(signed_create_tx.raw_transaction)
        receipt_create = w3.eth.wait_for_transaction_receipt(tx_hash_create)

        sim_data = {
            "id": receipt_create.transactionHash.hex(),
            "target_market": params.target_market,
            "rate_oracle": rate_oracle_address,
            "status": "Running",
            "timestamp": int(time.time())
        }
        save_simulation(sim_data)

        return {
            "status": "success",
            "tx_hash": receipt_create.transactionHash.hex(),
            "rate_oracle": rate_oracle_address,
            "market_id": "0x..."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Deployment Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/simulation/{tx_hash}")
def get_simulation_detail(tx_hash: str):
    if not w3.is_connected():
        raise HTTPException(status_code=500, detail="RPC Connection Failed")
    try:
        tx = w3.eth.get_transaction(tx_hash)
        factory_contract = w3.eth.contract(abi=FACTORY_ABI)
        func_obj, decoded_params = factory_contract.decode_function_input(tx.input)

        data = decoded_params.get('params')
        if not data:
            raise HTTPException(status_code=404, detail="Could not decode params")

        def normalize(v):
            if isinstance(v, bytes):
                return v.hex()
            return v

        response = {}
        for k, v in data.items():
            response[k] = normalize(v)

        response["tx_hash"] = tx_hash
        response["block_number"] = tx.blockNumber

        if 'minColRatio' in response:
            response['display_minColRatio'] = float(response['minColRatio']) / 10**16
        if 'maintenanceMargin' in response:
            response['display_maintenanceMargin'] = float(response['maintenanceMargin']) / 10**16
        if 'liquidationCloseFactor' in response:
            response['display_liquidationCloseFactor'] = float(response['liquidationCloseFactor']) / 10**16

        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching sim detail: {e}")
        raise HTTPException(status_code=404, detail=f"Simulation data not found on chain: {e}")


@router.get("/simulation/{market_id}/enriched")
def get_simulation_detail_enriched(market_id: str):
    try:
        if not market_id.startswith('0x'):
            market_id = '0x' + market_id

        market = get_market_by_id(market_id)
        if not market:
            raise HTTPException(status_code=404, detail="Market not found in state database")

        nf_raw = int(market.get('normalization_factor') or 0)
        nf_display = nf_raw / 1e18 if nf_raw else 1.0
        accrued_interest_pct = (nf_display - 1) * 100 if nf_display > 0 else 0
        total_debt_raw = int(market.get('total_debt') or 0)
        total_debt_display = total_debt_raw / 1e18 if total_debt_raw else 0
        min_col_raw = int(market.get('min_col_ratio') or 0)
        maint_margin_raw = int(market.get('maintenance_margin') or 0)
        liq_close_raw = int(market.get('liquidation_close_factor') or 0)
        min_col_pct = min_col_raw / 1e16 if min_col_raw else 0
        maint_margin_pct = maint_margin_raw / 1e16 if maint_margin_raw else 0
        liq_close_pct = liq_close_raw / 1e16 if liq_close_raw else 0
        funding_period = market.get('funding_period') or 0
        funding_period_days = funding_period / 86400 if funding_period else 0

        state_last_update = market.get('state_last_update')
        last_update_display = ""
        if state_last_update:
            last_update_display = datetime.utcfromtimestamp(state_last_update).strftime('%Y-%m-%d %H:%M:%S UTC')

        # Fetch live prices from oracles
        prices = {"index_price": None, "index_price_display": "—", "mark_price": None, "mark_price_display": "—", "price_error": None}

        try:
            rate_oracle_abi = [{"inputs":[{"name":"underlyingPool","type":"address"},{"name":"underlyingToken","type":"address"}],"name":"getIndexPrice","outputs":[{"name":"indexPrice","type":"uint256"}],"stateMutability":"view","type":"function"}]
            spot_oracle_abi = [{"inputs":[{"name":"collateralToken","type":"address"},{"name":"underlyingToken","type":"address"}],"name":"getSpotPrice","outputs":[{"name":"price","type":"uint256"}],"stateMutability":"view","type":"function"}]

            rate_oracle_addr = market.get('rate_oracle')
            underlying_pool = market.get('underlying_pool')
            underlying_token = market.get('underlying_token')

            if rate_oracle_addr and underlying_pool and underlying_token:
                rate_oracle = w3.eth.contract(address=rate_oracle_addr, abi=rate_oracle_abi)
                try:
                    index_price_raw = rate_oracle.functions.getIndexPrice(underlying_pool, underlying_token).call()
                    prices["index_price"] = str(index_price_raw)
                    index_price_dollars = index_price_raw / 1e18
                    prices["index_price_display"] = f"${index_price_dollars:.4f}"
                except Exception as e:
                    logger.warning(f"Failed to fetch index price: {e}")

            spot_oracle_addr = market.get('spot_oracle')
            collateral_token = market.get('collateral_token')
            if spot_oracle_addr and collateral_token and underlying_token:
                spot_oracle = w3.eth.contract(address=spot_oracle_addr, abi=spot_oracle_abi)
                try:
                    mark_price_raw = spot_oracle.functions.getSpotPrice(collateral_token, underlying_token).call()
                    prices["mark_price"] = str(mark_price_raw)
                    mark_price_display = mark_price_raw / 1e18
                    prices["mark_price_display"] = f"{mark_price_display:.6f}"
                except Exception as e:
                    logger.warning(f"Failed to fetch mark price: {e}")
        except Exception as e:
            prices["price_error"] = str(e)

        return {
            "market_id": market_id,
            "tx_hash": market.get('tx_hash'),
            "block_number": market.get('state_block'),
            "positionTokenSymbol": market.get('position_token_symbol') or "Unknown",
            "positionTokenName": market.get('position_token_symbol') or "Unknown Market",
            "positionToken": market.get('position_token'),
            "collateralToken": market.get('collateral_token'),
            "underlyingToken": market.get('underlying_token'),
            "underlyingPool": market.get('underlying_pool'),
            "curator": market.get('curator'),
            "spotOracle": market.get('spot_oracle'),
            "rateOracle": market.get('rate_oracle'),
            "liquidationModule": market.get('liquidation_module'),
            "state": {
                "normalization_factor": str(nf_raw),
                "normalization_factor_display": f"{nf_display:.6f}",
                "accrued_interest_pct": f"{accrued_interest_pct:.4f}%",
                "total_debt": str(total_debt_raw),
                "total_debt_display": f"{total_debt_display:.2f}",
                "last_update": last_update_display,
                "last_update_timestamp": state_last_update,
                "block_number": market.get('state_block')
            },
            "prices": prices,
            "risk_params": {
                "minColRatio": min_col_raw,
                "display_minColRatio": min_col_pct,
                "maintenanceMargin": maint_margin_raw,
                "display_maintenanceMargin": maint_margin_pct,
                "liquidationCloseFactor": liq_close_raw,
                "display_liquidationCloseFactor": liq_close_pct,
                "fundingPeriod": funding_period,
                "fundingPeriodDays": funding_period_days,
                "debtCap": market.get('debt_cap'),
                "brokerVerifier": market.get('broker_verifier')
            },
            "deployment_block": market.get('deployment_block'),
            "deployment_timestamp": market.get('deployment_timestamp')
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching enriched sim detail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error fetching market details: {e}")


@router.post("/market/register", dependencies=[Depends(get_api_key)])
async def register_market(market_id: str):
    if not w3.is_connected():
        raise HTTPException(status_code=500, detail="RPC not connected")
    if not CORE_ADDRESS or not CORE_ABI:
        raise HTTPException(status_code=500, detail="Core contract not configured")
    try:
        core_contract = w3.eth.contract(
            address=Web3.to_checksum_address(CORE_ADDRESS), abi=CORE_ABI
        )
        success = register_market_manually(market_id, w3, core_contract)
        if success:
            return {"status": "success", "market_id": market_id}
        else:
            raise HTTPException(status_code=400, detail="Failed to register market")
    except Exception as e:
        logger.error(f"Error registering market: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Indexer lifecycle (called from main.py startup/shutdown) ---

async def start_indexers():
    """Start event + state indexers. Returns task handles."""
    tasks = []

    if FACTORY_ADDRESS and FACTORY_ABI:
        try:
            import asyncio
            indexer = init_indexer(RPC_URL, FACTORY_ADDRESS, FACTORY_ABI)
            tasks.append(asyncio.create_task(indexer.start()))
            logger.info("✅ Event Indexer started")
        except Exception as e:
            logger.error(f"❌ Failed to start event indexer: {e}")

    if CORE_ADDRESS and CORE_ABI and FACTORY_ADDRESS and FACTORY_ABI:
        try:
            import asyncio
            state_indexer = init_state_indexer(RPC_URL, CORE_ADDRESS, FACTORY_ADDRESS, CORE_ABI, FACTORY_ABI)
            tasks.append(asyncio.create_task(state_indexer.start()))
            logger.info("✅ Market State Indexer started")
        except Exception as e:
            logger.error(f"❌ Failed to start state indexer: {e}")

    return tasks


def stop_indexers():
    """Stop all indexers."""
    indexer = get_indexer()
    if indexer:
        indexer.stop()
    state_indexer = get_state_indexer()
    if state_indexer:
        state_indexer.stop()
    logger.info("🛑 All indexers stopped")
