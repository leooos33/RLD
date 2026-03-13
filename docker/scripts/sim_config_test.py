#!/usr/bin/env python3
"""
Phase 0 Simulation: Prove the simplified config path works BEFORE refactoring.

5 checks against the live stack:
  1. Config completeness (deployment.json has all required keys)
  2. On-chain cross-check (getMarketAddresses matches config)
  3. Indexer /config endpoint matches deployment.json
  4. Broker DB state matches getFullState() on-chain
  5. API enrichment (/api/bonds?enrich=true) matches getFullState()

Usage:
  python3 /tmp/sim_config_test.py
"""

import json
import os
import sys
import urllib.request

# ── Config ──────────────────────────────────────────────────
RPC_URL = os.environ.get("RPC_URL", "http://localhost:8545")
INDEXER_URL = os.environ.get("INDEXER_URL", "http://localhost:8080")
DB_URL = os.environ.get("DB_URL", "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer")
CONFIG_FILE = os.environ.get("CONFIG_FILE", "/home/ubuntu/RLD/docker/deployment.json")
SIM_ID = os.environ.get("SIM_ID", "default")

passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name}")
        if detail:
            print(f"     → {detail}")


def http_get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def http_post_json(url, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


# ═══════════════════════════════════════════════════════════
# CHECK 1: Config Completeness
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("  CHECK 1: Config Completeness")
print("=" * 60)

with open(CONFIG_FILE) as f:
    config = json.load(f)

REQUIRED_KEYS = [
    "rld_core", "twamm_hook", "market_id", "pool_id", "broker_factory",
    "wausdc", "position_token", "mock_oracle", "broker_router",
    "pool_manager", "bond_factory", "rpc_url",
]
missing = [k for k in REQUIRED_KEYS if not config.get(k)]
check("All required keys present", not missing,
      f"Missing: {missing}" if missing else "")

for key in REQUIRED_KEYS:
    val = config.get(key, "")
    if key not in ("rpc_url", "pool_id", "market_id"):
        is_addr = isinstance(val, str) and val.startswith("0x") and len(val) == 42
        check(f"  {key} is valid address", is_addr,
              f"Got: {val!r}" if not is_addr else "")


# ═══════════════════════════════════════════════════════════
# CHECK 2: On-chain Cross-check
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("  CHECK 2: On-chain Cross-check")
print("=" * 60)

try:
    from web3 import Web3

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    check("RPC connected", w3.is_connected(), f"Cannot connect to {RPC_URL}")

    DISCOVERY_ABI = [
        {"inputs": [{"name": "id", "type": "bytes32"}], "name": "getMarketAddresses",
         "outputs": [{"components": [
             {"name": "collateralToken", "type": "address"},
             {"name": "underlyingToken", "type": "address"},
             {"name": "underlyingPool", "type": "address"},
             {"name": "rateOracle", "type": "address"},
             {"name": "spotOracle", "type": "address"},
             {"name": "markOracle", "type": "address"},
             {"name": "fundingModel", "type": "address"},
             {"name": "curator", "type": "address"},
             {"name": "liquidationModule", "type": "address"},
             {"name": "positionToken", "type": "address"},
         ], "name": "", "type": "tuple"}],
         "stateMutability": "view", "type": "function"},
        {"inputs": [{"name": "id", "type": "bytes32"}], "name": "isValidMarket",
         "outputs": [{"name": "", "type": "bool"}],
         "stateMutability": "view", "type": "function"},
        {"inputs": [{"name": "id", "type": "bytes32"}, {"name": "user", "type": "address"}],
         "name": "getPosition",
         "outputs": [{"components": [
             {"name": "debtPrincipal", "type": "uint128"},
         ], "name": "", "type": "tuple"}],
         "stateMutability": "view", "type": "function"},
    ]

    core = w3.eth.contract(
        address=Web3.to_checksum_address(config["rld_core"]),
        abi=DISCOVERY_ABI
    )
    mid = bytes.fromhex(config["market_id"].replace("0x", ""))

    is_valid = core.functions.isValidMarket(mid).call()
    check("Market is valid on-chain", is_valid)

    addrs = core.functions.getMarketAddresses(mid).call()
    # addrs[0] = collateralToken (waUSDC)
    # addrs[3] = rateOracle (MockOracle)
    # addrs[9] = positionToken (wRLP)

    check("collateral (waUSDC) matches",
          addrs[0].lower() == config["wausdc"].lower(),
          f"chain={addrs[0]} config={config['wausdc']}")

    check("positionToken matches",
          addrs[9].lower() == config["position_token"].lower(),
          f"chain={addrs[9]} config={config['position_token']}")

    check("rateOracle matches",
          addrs[3].lower() == config["mock_oracle"].lower(),
          f"chain={addrs[3]} config={config['mock_oracle']}")

except ImportError:
    print("  ⚠️  web3 not installed, skipping on-chain checks")
except Exception as e:
    check("On-chain cross-check", False, str(e))


# ═══════════════════════════════════════════════════════════
# CHECK 3: Indexer /config endpoint matches deployment.json
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("  CHECK 3: Indexer /config endpoint")
print("=" * 60)

try:
    indexer_config = http_get(f"{INDEXER_URL}/config")

    # The indexer exposes config from entrypoint — compare key addresses
    for key in ["rld_core", "twamm_hook", "market_id", "pool_id"]:
        indexer_val = (indexer_config.get(key) or "").lower()
        config_val = (config.get(key) or "").lower()
        check(f"{key} matches indexer",
              indexer_val == config_val,
              f"indexer={indexer_val[:20]}... config={config_val[:20]}...")

except Exception as e:
    check("Indexer /config reachable", False, str(e))


# ═══════════════════════════════════════════════════════════
# CHECK 4: Broker DB state matches getFullState() on-chain
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("  CHECK 4: Broker Account State (DB vs on-chain)")
print("=" * 60)

FULL_STATE_ABI = [{"inputs": [], "name": "getFullState",
    "outputs": [{"components": [
        {"name": "collateralBalance", "type": "uint256"},
        {"name": "positionBalance", "type": "uint256"},
        {"name": "debtPrincipal", "type": "uint128"},
        {"name": "debtValue", "type": "uint256"},
        {"name": "twammSellOwed", "type": "uint256"},
        {"name": "twammBuyOwed", "type": "uint256"},
        {"name": "v4LPValue", "type": "uint256"},
        {"name": "netAccountValue", "type": "uint256"},
        {"name": "healthFactor", "type": "uint256"},
        {"name": "isSolvent", "type": "bool"},
    ], "name": "", "type": "tuple"}],
    "stateMutability": "view", "type": "function"}]

try:
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(DB_URL)
    schema = f"sim_{SIM_ID}"
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(f"SET search_path TO {schema}, public")
    cur.execute("SELECT broker_address, collateral_balance, position_balance, debt_principal FROM broker_state")
    brokers = cur.fetchall()
    conn.close()

    check(f"Found {len(brokers)} broker(s) in DB", len(brokers) > 0)

    for row in brokers:
        addr = row["broker_address"]
        short = addr[:10] + "..."
        try:
            broker_contract = w3.eth.contract(
                address=Web3.to_checksum_address(addr),
                abi=FULL_STATE_ABI
            )
            state = broker_contract.functions.getFullState().call()
            chain_coll = state[0]
            chain_pos = state[1]
            chain_debt = state[2]
            health_raw = state[8]
            is_solvent = state[9]

            db_coll = int(row["collateral_balance"])
            db_pos = int(row["position_balance"])
            db_debt = int(row["debt_principal"])

            check(f"{short} collateral",
                  chain_coll == db_coll,
                  f"chain={chain_coll:,} db={db_coll:,} diff={chain_coll - db_coll:+,}")

            check(f"{short} position",
                  chain_pos == db_pos,
                  f"chain={chain_pos:,} db={db_pos:,} diff={chain_pos - db_pos:+,}")

            check(f"{short} debt_principal",
                  chain_debt == db_debt,
                  f"chain={chain_debt:,} db={db_debt:,} diff={chain_debt - db_debt:+,}")

            # Cross-check: getFullState().debtPrincipal == RLDCore.getPosition().debtPrincipal
            core_position = core.functions.getPosition(mid, Web3.to_checksum_address(addr)).call()
            core_debt = core_position[0]
            check(f"{short} debt cross-check (broker vs core)",
                  chain_debt == core_debt,
                  f"broker={chain_debt:,} core={core_debt:,}")

            # Log derived fields (informational, not asserted)
            health = health_raw / 1e18 if health_raw < 2**255 else float("inf")
            print(f"     ℹ️  health={health:.2f} solvent={is_solvent} "
                  f"nav={state[7] / 1e6:,.2f} debtVal={state[3] / 1e6:,.2f}")

        except Exception as e:
            check(f"{short} on-chain read", False, str(e))

except ImportError:
    print("  ⚠️  psycopg2 not installed, skipping DB checks")
except Exception as e:
    check("DB connection", False, str(e))


# ═══════════════════════════════════════════════════════════
# CHECK 5: API Enrichment vs getFullState()
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("  CHECK 5: API Enrichment vs getFullState()")
print("=" * 60)

FROZEN_ABI = [{"inputs": [], "name": "frozen",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view", "type": "function"}]

try:
    api_resp = http_get(f"{INDEXER_URL}/api/bonds?enrich=true&limit=50")
    bonds = api_resp.get("bonds", [])

    active_bonds = [b for b in bonds if b.get("status") == "active"]
    check(f"API returned {len(bonds)} bond(s) ({len(active_bonds)} active)", True)

    for bond in active_bonds:
        addr = bond["broker_address"]
        short = addr[:10] + "..."

        try:
            # Get on-chain state
            broker_contract = w3.eth.contract(
                address=Web3.to_checksum_address(addr),
                abi=FULL_STATE_ABI + FROZEN_ABI
            )
            state = broker_contract.functions.getFullState().call()
            chain_coll_usd = state[0] / 1e6
            chain_debt_val_usd = state[3] / 1e6
            chain_frozen = broker_contract.functions.frozen().call()

            api_coll = bond.get("free_collateral", 0)
            api_debt = bond.get("debt_usd", 0)
            api_frozen = bond.get("frozen", False)
            api_has_order = bond.get("has_active_order", False)

            # Collateral: exact match (both from balanceOf)
            check(f"{short} API collateral",
                  abs(api_coll - chain_coll_usd) < 0.01,
                  f"api={api_coll:.2f} chain={chain_coll_usd:.2f}")

            # Debt: 1% tolerance (NF may tick between API call and our call)
            if chain_debt_val_usd > 0:
                debt_pct_diff = abs(api_debt - chain_debt_val_usd) / chain_debt_val_usd
                check(f"{short} API debt (1% tolerance)",
                      debt_pct_diff < 0.01,
                      f"api={api_debt:.2f} chain={chain_debt_val_usd:.2f} diff={debt_pct_diff:.4%}")
            else:
                check(f"{short} API debt (zero)", api_debt == 0,
                      f"api={api_debt} expected=0")

            # Frozen: exact
            check(f"{short} API frozen",
                  api_frozen == chain_frozen,
                  f"api={api_frozen} chain={chain_frozen}")

        except Exception as e:
            check(f"{short} API enrichment", False, str(e))

except Exception as e:
    check("API /api/bonds?enrich=true", False, str(e))


# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 60)
total = passed + failed
print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 60 + "\n")

if failed:
    sys.exit(1)
else:
    print("🎉 All checks passed — safe to proceed with refactoring.\n")
    sys.exit(0)
