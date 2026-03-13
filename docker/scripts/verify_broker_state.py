#!/usr/bin/env python3
"""
Verify broker_state DB matches on-chain balanceOf().

Reads all brokers from the DB, then for each broker:
  - Reads on-chain collateral_balance (waUSDC.balanceOf)
  - Reads on-chain position_balance (wRLP.balanceOf)
  - Compares with DB values
  - Reports OK or MISMATCH

Usage:
  RPC_URL=http://localhost:8545 DB_URL=postgresql://rld:rld_dev_password@localhost:5432/rld_indexer python3 verify_broker_state.py
"""

import os
import sys
import json

DB_URL = os.environ.get("DB_URL", "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer")
RPC_URL = os.environ.get("RPC_URL", "http://localhost:8545")
CONFIG_FILE = os.environ.get("CONFIG_FILE", "/home/ubuntu/RLD/docker/deployment.json")

# ─── Load token addresses from deployment.json ──────────────────
try:
    with open(CONFIG_FILE) as f:
        config = json.load(f)
    COLLATERAL = config.get("wausdc", "")
    POSITION = config.get("position_token", "")
except Exception as e:
    print(f"⚠️  Could not load {CONFIG_FILE}: {e}")
    print("   Set CONFIG_FILE env var to deployment.json path")
    sys.exit(1)

if not COLLATERAL or not POSITION:
    print("❌ Missing wausdc or position_token in deployment.json")
    sys.exit(1)

# ─── Connect to DB ──────────────────────────────────────────────
try:
    import psycopg2
except ImportError:
    print("❌ psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

# Get schema prefix from SIM_ID
sim_id = os.environ.get("SIM_ID", "default")
schema = f"sim_{sim_id}"

# ─── Fetch brokers from DB ──────────────────────────────────────
cur.execute(f"""
    SELECT broker_address, collateral_balance, position_balance
    FROM {schema}.broker_state
    ORDER BY broker_address
""")
rows = cur.fetchall()
conn.close()

if not rows:
    print("⚠️  No brokers found in broker_state table")
    sys.exit(0)

# ─── Read on-chain balances ─────────────────────────────────────
try:
    from web3 import Web3
except ImportError:
    print("❌ web3 not installed. Run: pip install web3")
    sys.exit(1)

w3 = Web3(Web3.HTTPProvider(RPC_URL))
if not w3.is_connected():
    print(f"❌ Cannot connect to RPC at {RPC_URL}")
    sys.exit(1)

ERC20_ABI = [{"inputs": [{"name": "account", "type": "address"}],
              "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}],
              "stateMutability": "view", "type": "function"}]

coll_contract = w3.eth.contract(address=Web3.to_checksum_address(COLLATERAL), abi=ERC20_ABI)
pos_contract = w3.eth.contract(address=Web3.to_checksum_address(POSITION), abi=ERC20_ABI)

# ─── Compare ────────────────────────────────────────────────────
all_ok = True
print(f"\n{'='*70}")
print(f"  Broker State Verification (schema: {schema})")
print(f"  Collateral: {COLLATERAL[:10]}...  Position: {POSITION[:10]}...")
print(f"{'='*70}\n")

for broker_addr, db_coll, db_pos in rows:
    addr = Web3.to_checksum_address(broker_addr)
    chain_coll = coll_contract.functions.balanceOf(addr).call()
    chain_pos = pos_contract.functions.balanceOf(addr).call()

    coll_ok = chain_coll == db_coll
    pos_ok = chain_pos == db_pos

    coll_icon = "✓" if coll_ok else "✗"
    pos_icon = "✓" if pos_ok else "✗"

    print(f"  Broker {broker_addr[:10]}...")
    print(f"    coll: on-chain={chain_coll:>20,}  db={db_coll:>20,}  {coll_icon}")
    print(f"    pos:  on-chain={chain_pos:>20,}  db={db_pos:>20,}  {pos_icon}")

    if not coll_ok:
        diff = chain_coll - db_coll
        print(f"    ❌ COLLATERAL MISMATCH: diff={diff:+,}")
        all_ok = False
    if not pos_ok:
        diff = chain_pos - db_pos
        print(f"    ❌ POSITION MISMATCH: diff={diff:+,}")
        all_ok = False
    print()

if all_ok:
    print(f"✅ All {len(rows)} broker(s) match on-chain state")
else:
    print(f"❌ MISMATCH detected — check broker_state table")
    sys.exit(1)
