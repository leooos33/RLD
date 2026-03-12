"""
RLD Market Indexer — entrypoint.

Uses EventDrivenIndexer exclusively (ComprehensiveIndexer removed).
DB is managed by db.event_driven.
"""
import asyncio
import logging
import os
import signal
import sys
import time
import threading

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────
# Config file loading
# ──────────────────────────────────────────────────────────────

CONFIG_MAP: dict = {}


def load_deployment_config(config_file: str):
    """Load deployment.json into CONFIG_MAP and push keys into os.environ."""
    import json
    global CONFIG_MAP
    try:
        with open(config_file) as f:
            data = json.load(f)
        CONFIG_MAP = {k.upper(): str(v) for k, v in data.items() if isinstance(v, (str, int, float))}
        for k, v in CONFIG_MAP.items():
            os.environ.setdefault(k, v)
        logger.info(f"  Loaded {len(CONFIG_MAP)} config values from {config_file}")
    except Exception as e:
        logger.warning(f"  ⚠️  Could not load {config_file}: {e}")


def config_file_watcher(app, config_file: str):
    """Watch deployment.json and reload app.state.market_config on change."""
    import json
    last_mtime = 0
    while True:
        try:
            mtime = os.path.getmtime(config_file)
            if mtime != last_mtime:
                last_mtime = mtime
                with open(config_file) as f:
                    new_config = json.load(f)
                if hasattr(app, "state"):
                    app.state.market_config = new_config
                    logger.info("  🔄 deployment.json reloaded")
        except Exception:
            pass
        time.sleep(5)


# Load deployment.json before importing project modules
config_file = os.environ.get("CONFIG_FILE", "/config/deployment.json")
if os.path.exists(config_file):
    load_deployment_config(config_file)

# ──────────────────────────────────────────────────────────────
# Project imports (after env is populated)
# ──────────────────────────────────────────────────────────────

from indexers.discover import discover_from_env
from indexers.event_driven_indexer import create_indexer_from_config
from db.event_driven import init_db, get_last_indexed_block, clear_sim_data


def main():
    logger.info("╔═══════════════════════════════════════════════════╗")
    logger.info("║     RLD Market Indexer (event-driven)             ║")
    logger.info("╚═══════════════════════════════════════════════════╝")

    # 1. Auto-discover market config (with retries — deployer may still be running)
    logger.info("[1/4] Discovering market configuration...")
    MAX_RETRIES = 30
    config = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            config = discover_from_env()
            break
        except Exception as e:
            logger.error(f"❌ Discovery failed (attempt {attempt}/{MAX_RETRIES}): {e}")
            if attempt == MAX_RETRIES:
                logger.error("❌ All discovery attempts exhausted — exiting")
                sys.exit(1)
            time.sleep(10)

    # Push discovered addresses into environment for GQL resolvers
    os.environ["_DISCOVERED_COLLATERAL"] = config["collateral_token"]
    os.environ["_DISCOVERED_POSITION"] = config["position_token"]
    os.environ["_DISCOVERED_ORACLE"] = config["rate_oracle"]
    os.environ.setdefault("TWAMM_HOOK", config.get("twamm_hook", ""))

    # 2. Initialize DB (PostgreSQL with schema-per-simulation)
    logger.info("[2/4] Initializing database...")
    db_url = os.environ.get("DB_URL")
    sim_id = os.environ.get("SIM_ID", "default")
    init_db(db_url, sim_id)
    logger.info(f"  DB: {db_url} (schema: sim_{sim_id})")

    # 3. Stale DB detection — auto-reset on simulation restart
    logger.info("[3/4] Checking for stale data (simulation restart)...")
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        chain_head = w3.eth.block_number
        last_indexed = get_last_indexed_block()
        lag = last_indexed - chain_head
        if last_indexed > 0 and lag > 1:
            logger.warning(
                f"  ⚠️  STALE DB: indexed={last_indexed:,} > chain={chain_head:,} (lag={lag:,})"
            )
            logger.warning("  🔄 Simulation restarted — clearing indexer tables (bonds preserved)")
            clear_sim_data()
            logger.info("  ✅ Cleared. Will re-index from chain head.")
        else:
            logger.info(f"  Chain head: {chain_head:,} | Last indexed: {last_indexed:,} | OK")
    except Exception as e:
        logger.warning(f"  ⚠️  Could not check chain head (non-fatal): {e}")

    # 4. Create indexer + start API
    logger.info("[4/4] Starting event-driven indexer + API...")
    indexer = create_indexer_from_config(config)

    poll_interval = int(os.environ.get("POLL_INTERVAL", "2"))

    def run_indexer():
        try:
            asyncio.run(indexer.run(poll_interval=poll_interval))
        except Exception as e:
            logger.error(f"Indexer crashed: {e}", exc_info=True)
            raise

    indexer_thread = threading.Thread(
        target=run_indexer,
        daemon=True,
        name="indexer",
    )
    indexer_thread.start()

    def shutdown(signum, frame):
        logger.info("🛑 Shutting down...")
        indexer.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Start FastAPI + attach config to app state
    port = int(os.environ.get("API_PORT", "8080"))

    import uvicorn
    from api.indexer_api import app

    # Augment config with infra addresses from deployment.json / env
    infra_keys = (
        "broker_router", "broker_executor", "bond_factory", "basis_trade_factory",
        "v4_quoter", "broker_factory", "swap_router", "pool_manager",
        "v4_position_manager", "v4_position_descriptor", "v4_state_view",
        "universal_router", "permit2",
    )
    for key in infra_keys:
        env_key = key.upper()
        if env_key in os.environ and key not in config:
            config[key] = os.environ[env_key]

    app.state.market_config = config
    app.state.config_file = config_file

    # Config file watcher thread
    watcher_thread = threading.Thread(
        target=config_file_watcher,
        args=(app, config_file),
        daemon=True,
        name="config-watcher",
    )
    watcher_thread.start()
    logger.info(f"  📁 Config file watcher started (monitoring {config_file})")
    logger.info(f"  API: http://0.0.0.0:{port}")
    logger.info(f"  Docs: http://0.0.0.0:{port}/docs")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    main()
