#!/usr/bin/env python3
"""
RLD Market Indexer - Container Entrypoint.

Single Python process:
  1. Auto-discover market config from RLD_CORE + MARKET_ID
  2. Start indexer in background thread
  3. Start FastAPI API in main thread
  4. Graceful shutdown on SIGTERM

Required env vars:
  RPC_URL      - Chain RPC endpoint
  RLD_CORE     - RLDCore contract address
  MARKET_ID    - Market ID (bytes32 hex)
  TWAMM_HOOK   - TWAMM hook address

Optional env vars:
  POOL_MANAGER - V4 PoolManager (default: mainnet)
  DB_URL       - PostgreSQL connection string (default: postgresql://rld:rld@postgres:5432/rld_indexer)
  SIM_ID       - Simulation ID for schema isolation (default: default)
  API_PORT     - API port (default: 8080)
  POLL_INTERVAL - Block poll interval in seconds (default: 2)
  BROKERS      - Comma-separated broker addresses to track
"""
import os
import sys
import signal
import logging
import threading
import time

# Configure logging before imports
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("entrypoint")

# Set DB_URL default for container
if "DB_URL" not in os.environ:
    os.environ["DB_URL"] = "postgresql://rld:rld_dev_password@postgres:5432/rld_indexer"
if "SIM_ID" not in os.environ:
    os.environ["SIM_ID"] = "default"

# Load config from deployment.json (written by deployer in compose stack)
config_file = os.environ.get("CONFIG_FILE", "/config/deployment.json")

# ── Config mapping: deployment.json keys → env vars ────────────────
CONFIG_MAP = {
    "rld_core": "RLD_CORE",
    "twamm_hook": "TWAMM_HOOK",
    "market_id": "MARKET_ID",
    "pool_manager": "POOL_MANAGER",
    "wausdc": "WAUSDC",
    "position_token": "POSITION_TOKEN",
    "mock_oracle": "MOCK_ORACLE",
    "swap_router": "SWAP_ROUTER",
    "broker_factory": "BROKER_FACTORY",
    "broker_router": "BROKER_ROUTER",
    "broker_executor": "BROKER_EXECUTOR",
    "bond_factory": "BOND_FACTORY",
    "basis_trade_factory": "BASIS_TRADE_FACTORY",
    "v4_quoter": "V4_QUOTER",
    "v4_position_manager": "V4_POSITION_MANAGER",
    "v4_position_descriptor": "V4_POSITION_DESCRIPTOR",
    "v4_state_view": "V4_STATE_VIEW",
    "universal_router": "UNIVERSAL_ROUTER",
    "permit2": "PERMIT2",
    "mm_broker": "MM_BROKER",
    "chaos_broker": "CHAOS_BROKER",
}


def load_deployment_config(path: str, update_env: bool = True) -> dict:
    """Load deployment.json and optionally update env vars.
    Returns the parsed config dict."""
    import json
    with open(path) as f:
        deploy_config = json.load(f)
    if update_env:
        for json_key, env_key in CONFIG_MAP.items():
            if json_key in deploy_config:
                os.environ[env_key] = str(deploy_config[json_key])
        # Set BROKERS from known broker addresses
        broker_keys = ["user_a_broker", "mm_broker", "chaos_broker"]
        brokers = [str(deploy_config[k]) for k in broker_keys if k in deploy_config and deploy_config[k]]
        if brokers and "BROKERS" not in os.environ:
            os.environ["BROKERS"] = ",".join(brokers)
    return deploy_config


def reload_config_into_app(app, path: str):
    """Re-read deployment.json and hot-update app.state.market_config.
    Called by the file-watcher thread and admin endpoint."""
    deploy_config = load_deployment_config(path, update_env=True)
    market_config = getattr(app.state, "market_config", None) or {}
    # Overlay infrastructure keys from fresh deployment
    infra_keys = (
        "broker_router", "broker_executor", "bond_factory", "basis_trade_factory",
        "v4_quoter", "broker_factory", "swap_router",
        "v4_position_manager", "v4_position_descriptor", "v4_state_view",
        "universal_router", "permit2",
    )
    for key in infra_keys:
        env_key = key.upper()
        if env_key in os.environ:
            market_config[key] = os.environ[env_key]
    app.state.market_config = market_config
    logger.info(f"  🔄 Config reloaded from {path} — bond_factory={market_config.get('bond_factory', '?')}")
    return market_config


def config_file_watcher(app, path: str, check_interval: int = 10):
    """Background thread that watches deployment.json for changes
    and hot-reloads into app.state.market_config."""
    last_mtime = 0
    try:
        last_mtime = os.path.getmtime(path)
    except OSError:
        pass

    while True:
        try:
            time.sleep(check_interval)
            current_mtime = os.path.getmtime(path)
            if current_mtime != last_mtime:
                logger.info(f"📁 deployment.json changed (mtime {last_mtime} → {current_mtime}), reloading...")
                reload_config_into_app(app, path)
                last_mtime = current_mtime
        except Exception as e:
            logger.warning(f"Config watcher error: {e}")


# Wait for config file to appear (deployer may still be running)
MAX_WAIT = 300  # 5 minutes
waited = 0
while not os.path.exists(config_file) and waited < MAX_WAIT:
    if waited == 0:
        logger.info(f"⏳ Waiting for {config_file} (deployer still running?)...")
    time.sleep(5)
    waited += 5

if os.path.exists(config_file):
    logger.info(f"Loading config from {config_file}")
    load_deployment_config(config_file)
    logger.info(f"  Loaded {len(CONFIG_MAP)} config values from deployment.json")

# Now import our modules
from indexers.discover import discover_from_env
from indexers.comprehensive import ComprehensiveIndexer
from db.comprehensive import init_db


def create_indexer_from_config(config: dict) -> ComprehensiveIndexer:
    """Create indexer from discovered config."""
    # Parse optional broker list
    brokers_str = os.environ.get("BROKERS", "")
    brokers = [b.strip() for b in brokers_str.split(",") if b.strip()]

    return ComprehensiveIndexer(
        rpc_url=config["rpc_url"],
        rld_core=config["rld_core"],
        pool_manager=config["pool_manager"],
        market_id=config["market_id"],
        oracle_addr=config["rate_oracle"],
        tracked_brokers=brokers
    )


def run_indexer(indexer: ComprehensiveIndexer, poll_interval: int):
    """Run indexer in background thread."""
    import asyncio
    try:
        asyncio.run(indexer.run(poll_interval=poll_interval))
    except Exception as e:
        logger.error(f"Indexer crashed: {e}")
        raise


def main():
    logger.info("╔═══════════════════════════════════════════════════╗")
    logger.info("║     RLD Market Indexer                            ║")
    logger.info("╚═══════════════════════════════════════════════════╝")

    # 1. Auto-discover market config (with retries — deployer may still be running)
    logger.info("[1/3] Discovering market configuration...")
    MAX_DISCOVERY_RETRIES = 30
    config = None
    for attempt in range(1, MAX_DISCOVERY_RETRIES + 1):
        try:
            config = discover_from_env()
            break
        except Exception as e:
            logger.error(f"❌ Discovery failed (attempt {attempt}/{MAX_DISCOVERY_RETRIES}): {e}")
            if attempt == MAX_DISCOVERY_RETRIES:
                logger.error("❌ All discovery attempts exhausted — exiting")
                sys.exit(1)
            time.sleep(10)

    # Store config globally for API to access
    os.environ["_DISCOVERED_COLLATERAL"] = config["collateral_token"]
    os.environ["_DISCOVERED_POSITION"] = config["position_token"]
    os.environ["_DISCOVERED_ORACLE"] = config["rate_oracle"]
    os.environ.setdefault("TWAMM_HOOK", config["twamm_hook"])

    # 2. Initialize DB (PostgreSQL with schema-per-simulation)
    logger.info("[2/4] Initializing database...")
    db_url = os.environ.get("DB_URL")
    sim_id = os.environ.get("SIM_ID", "default")
    init_db(db_url, sim_id)
    logger.info(f"  DB: {db_url} (schema: sim_{sim_id})")

    # 3. Stale DB detection - auto-reset on simulation restart
    logger.info("[3/4] Checking for stale data (simulation restart)...")
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        chain_head = w3.eth.block_number

        from db.comprehensive import get_last_indexed_block, clear_sim_data
        last_indexed = get_last_indexed_block()

        lag = last_indexed - chain_head
        if last_indexed > 0 and lag > 1:
            logger.warning(f"  \u26a0\ufe0f  STALE DB DETECTED: indexed block {last_indexed:,} > chain head {chain_head:,} (lag: {lag:,})")
            logger.warning(f"  \U0001f504 Simulation was restarted - clearing indexer tables (preserving bonds)")
            clear_sim_data()
            logger.info(f"  \u2705 Indexer tables cleared. Bonds preserved. Will re-index from chain head.")
        else:
            logger.info(f"  Chain head: {chain_head:,} | Last indexed: {last_indexed:,} | OK")
    except Exception as e:
        logger.warning(f"  \u26a0\ufe0f  Could not check chain head (non-fatal): {e}")

    # 4. Create and start indexer
    logger.info("[4/4] Starting indexer + API...")
    indexer = create_indexer_from_config(config)

    poll_interval = int(os.environ.get("POLL_INTERVAL", "2"))
    indexer_thread = threading.Thread(
        target=run_indexer,
        args=(indexer, poll_interval),
        daemon=True,
        name="indexer"
    )
    indexer_thread.start()

    # Graceful shutdown
    def shutdown(signum, frame):
        logger.info("🛑 Shutting down...")
        indexer.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Start FastAPI in main thread
    port = int(os.environ.get("API_PORT", "8080"))
    logger.info(f"  API: http://0.0.0.0:{port}")
    logger.info(f"  Docs: http://0.0.0.0:{port}/docs")

    import uvicorn
    from api.indexer_api import app

    # Attach config to app for /health and /config endpoints
    # Augment with infrastructure addresses loaded from deployment.json
    infra_keys = (
        "broker_router", "broker_executor", "bond_factory", "basis_trade_factory", "v4_quoter", "broker_factory", "swap_router",
        "v4_position_manager", "v4_position_descriptor", "v4_state_view",
        "universal_router", "permit2",
    )
    for key in infra_keys:
        env_key = key.upper()
        if env_key in os.environ and key not in config:
            config[key] = os.environ[env_key]
    app.state.market_config = config
    # Store config_file path on app for admin reload endpoint
    app.state.config_file = config_file

    # Start deployment.json file watcher (auto-reloads on change)
    watcher_thread = threading.Thread(
        target=config_file_watcher,
        args=(app, config_file),
        daemon=True,
        name="config-watcher"
    )
    watcher_thread.start()
    logger.info(f"  📁 Config file watcher started (monitoring {config_file})")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    main()
