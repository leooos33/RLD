#!/usr/bin/env bash
# lp_setup.sh — End-to-end LP provisioning for User A with per-step verification
# Usage: docker exec docker-deployer-1 bash /workspace/docker/deployer/lp_setup.sh
# Or:    source .env && bash docker/deployer/lp_setup.sh
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
CFG=/config/deployment.json
RPC_URL="${RPC_URL:-http://host.docker.internal:8545}"
API_URL="${API_URL:-http://localhost:8080}"

MARKET_ID=$(python3 -c "import json; print(json.load(open('$CFG'))['market_id'])")
WAUSDC=$(python3 -c "import json; print(json.load(open('$CFG'))['wausdc'])")
WRLP=$(python3 -c "import json; print(json.load(open('$CFG'))['position_token'])")
TWAMM_HOOK=$(python3 -c "import json; print(json.load(open('$CFG'))['twamm_hook'])")
BROKER_FACTORY=$(python3 -c "import json; print(json.load(open('$CFG'))['broker_factory'])")
PERMIT2=$(python3 -c "import json; print(json.load(open('$CFG'))['permit2'])")
V4_POSM=$(python3 -c "import json; print(json.load(open('$CFG'))['v4_position_manager'])")
POOL_MANAGER=$(python3 -c "import json; print(json.load(open('$CFG'))['pool_manager'])")
POOL_ID=$(python3 -c "import json; print(json.load(open('$CFG'))['pool_id'])")

# Aave / USDC (mainnet addresses, forked)
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
AAVE_POOL=0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
AUSDC=0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c
USDC_WHALE=0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341

# ── Keys ──────────────────────────────────────────────────────────────────────
# USER_A = Hardhat account 5 (0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc)
USER_A_KEY="${USER_A_KEY:?USER_A_KEY not set}"
USER_A_ADDR=$(cast wallet address --private-key "$USER_A_KEY" 2>/dev/null)

# ── Logging ───────────────────────────────────────────────────────────────────
log_step() { echo ""; echo "[$1] $2"; }
log_ok()   { echo "  ✓ $1"; }
log_err()  { echo "  ✗ ERROR: $1" >&2; exit 1; }

wait_for_indexer() {
    local desc=$1 query=$2 check=$3
    local attempts=0
    while [ $attempts -lt 12 ]; do
        result=$(curl -s "$API_URL/graphql" \
            -H "Content-Type: application/json" \
            -d "{\"query\": \"$query\"}" 2>/dev/null)
        if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if $check else 1)" 2>/dev/null; then
            log_ok "$desc — indexed ✓"
            return 0
        fi
        sleep 5
        attempts=$((attempts + 1))
    done
    echo "  ⚠️  $desc — indexer timeout (check manually)"
}

echo "═══════════════════════════════════════════"
echo "  LP SETUP — User A: $USER_A_ADDR"
echo "  Market: $MARKET_ID"
echo "═══════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Fund User A with 100M USDC → aUSDC → waUSDC
# ─────────────────────────────────────────────────────────────────────────────
log_step "1" "Funding User A with \$100M waUSDC..."

FUND_WEI=$((100000000 * 1000000))  # 100M × 1e6

cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
cast rpc anvil_setBalance "$USER_A_ADDR"  "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
cast send "$USDC" "transfer(address,uint256)" "$USER_A_ADDR" "$FUND_WEI" \
    --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" > /dev/null
sleep 1
cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

# Approve + supply Aave
cast send "$USDC" "approve(address,uint256)" "$AAVE_POOL" "$FUND_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
sleep 1
cast send "$AAVE_POOL" "supply(address,uint256,address,uint16)" \
    "$USDC" "$FUND_WEI" "$USER_A_ADDR" 0 \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
sleep 1

# Wrap aUSDC → waUSDC
AUSDC_BAL=$(cast call "$AUSDC" "balanceOf(address)(uint256)" "$USER_A_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" --gas-limit 150000 > /dev/null
sleep 1
cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BAL" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" --gas-limit 500000 > /dev/null
sleep 1

WAUSDC_BAL=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_A_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
log_ok "User A waUSDC balance: $WAUSDC_BAL"
[ "$WAUSDC_BAL" -gt 0 ] || log_err "waUSDC balance is 0 — funding failed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Create Broker
# ─────────────────────────────────────────────────────────────────────────────
log_step "2" "Creating broker for User A..."

SALT=$(cast keccak "lp-broker-$(date +%s)-$RANDOM")
BROKER=$(cast send "$BROKER_FACTORY" "createBroker(bytes32)" "$SALT" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" --json 2>/dev/null \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
logs = data.get('logs', [])
topic = '0xc418c83b1622e1e32aac5d6d2848134a7e89eb8e96c8514afd1757d25ee5ef71'
for l in logs:
    if l.get('topics', [None])[0] == topic:
        d = l['data']
        print('0x' + d[26:66])
        break
")
[ -n "$BROKER" ] || log_err "Failed to parse broker address from BrokerCreated event"
log_ok "Broker: $BROKER"

# Verify indexer captured BrokerCreated
wait_for_indexer \
    "BrokerCreated indexed" \
    "{ brokers(marketId: \"$MARKET_ID\") { address owner } }" \
    "any(b['address'] == '$BROKER'.lower() for b in d['data']['brokers'])"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Deposit all waUSDC as collateral
# ─────────────────────────────────────────────────────────────────────────────
log_step "3" "Depositing all waUSDC to broker..."

DEPOSIT_AMT=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_A_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
cast send "$WAUSDC" "transfer(address,uint256)" "$BROKER" "$DEPOSIT_AMT" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
sleep 1

BROKER_BAL=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$BROKER" --rpc-url "$RPC_URL" | awk '{print $1}')
log_ok "Broker waUSDC balance: $BROKER_BAL"
[ "$BROKER_BAL" -gt 0 ] || log_err "Broker collateral is 0"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: Mint 5M wRLP
# ─────────────────────────────────────────────────────────────────────────────
log_step "4" "Minting 5M wRLP..."

WRLP_MINT=5000000000000  # 5M × 1e6
cast send "$BROKER" "modifyPosition(bytes32,int256,int256)" \
    "$MARKET_ID" 0 "$WRLP_MINT" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
sleep 1

WRLP_IN_BROKER=$(cast call "$WRLP" "balanceOf(address)(uint256)" "$BROKER" --rpc-url "$RPC_URL" | awk '{print $1}')
log_ok "Broker wRLP balance: $WRLP_IN_BROKER"
[ "$WRLP_IN_BROKER" -ge "$WRLP_MINT" ] || log_err "wRLP mint failed — broker has insufficient wRLP"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: Compute live waUSDC amount needed (pure math from chain state)
# ─────────────────────────────────────────────────────────────────────────────
log_step "5" "Computing LP amounts from live pool state..."

MATH_OUTPUT=$(python3 << PYEOF
import json, subprocess, math, sys

cfg = json.load(open('$CFG'))
RPC = '$RPC_URL'
PM = cfg['pool_manager']
POOL_ID = cfg['pool_id']
Q96 = 2**96

# Read live sqrtPriceX96 from PoolManager storage
pool_padded = POOL_ID.lstrip('0x').zfill(64)
abi_enc = subprocess.run(
    ['cast', 'abi-encode', 'x(bytes32,uint256)', '0x' + pool_padded, '6'],
    capture_output=True, text=True
).stdout.strip()
storage_key = subprocess.run(['cast', 'keccak', abi_enc], capture_output=True, text=True).stdout.strip()
slot_val = subprocess.run(
    ['cast', 'storage', PM, storage_key, '--rpc-url', RPC],
    capture_output=True, text=True
).stdout.strip()

raw = int(slot_val, 16)
sqrtP = raw & ((1 << 160) - 1)
tick_raw = (raw >> 160) & ((1 << 24) - 1)
tick = tick_raw if tick_raw < 2**23 else tick_raw - 2**24

if sqrtP == 0:
    print('ERROR: pool not initialized', file=sys.stderr)
    sys.exit(1)

# Tick bounds
TICK_LOWER = 6930
TICK_UPPER = 29960
WRLP_AMOUNT = 5_000_000 * 1_000_000  # 5e12 raw units

def sqrtAtTick(t):
    return int(math.sqrt(1.0001 ** t) * Q96)

sqrtL = sqrtAtTick(TICK_LOWER)
sqrtU = sqrtAtTick(TICK_UPPER)

assert sqrtL < sqrtP < sqrtU, f"Pool price tick {tick} outside range [{TICK_LOWER},{TICK_UPPER}]"

# getLiquidityForAmounts anchored on wRLP (token0, amount1=MAX → L=L0)
# L = amount0 * mulDiv(sqrtU, sqrtP, Q96) / (sqrtU - sqrtP)
L = (WRLP_AMOUNT * ((sqrtU * sqrtP) // Q96)) // (sqrtU - sqrtP)

# getAmountsForLiquidity → amount0 should equal WRLP_AMOUNT (±1 rounding)
amount0_check = (((L * (sqrtU - sqrtP)) // sqrtP) * Q96) // sqrtU
amount1_needed = (L * (sqrtP - sqrtL)) // Q96

assert abs(amount0_check - WRLP_AMOUNT) <= 2, f"Ordering error: amount0={amount0_check} != input={WRLP_AMOUNT}"

print(f"{sqrtP},{tick},{L},{amount1_needed},{amount0_check}")
PYEOF
)

if [[ "$MATH_OUTPUT" == ERROR* ]]; then
    log_err "$MATH_OUTPUT"
fi

SQRT_PRICE=$(echo "$MATH_OUTPUT" | cut -d, -f1)
CURRENT_TICK=$(echo "$MATH_OUTPUT" | cut -d, -f2)
LIQUIDITY=$(echo "$MATH_OUTPUT" | cut -d, -f3)
WAUSDC_NEEDED=$(echo "$MATH_OUTPUT" | cut -d, -f4)
AMOUNT0_CHECK=$(echo "$MATH_OUTPUT" | cut -d, -f5)

log_ok "sqrtPriceX96  = $SQRT_PRICE"
log_ok "current tick  = $CURRENT_TICK  (range: [$((6930)), $((29960))])  ✓"
log_ok "liquidity (L) = $LIQUIDITY"
log_ok "wRLP  needed  = $AMOUNT0_CHECK  (= \$$(python3 -c "print(f'{int(\"$AMOUNT0_CHECK\")/1e6:,.2f}')") )"
log_ok "waUSDC needed = $WAUSDC_NEEDED  (= \$$(python3 -c "print(f'{int(\"$WAUSDC_NEEDED\")/1e6:,.2f}')") )"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: Withdraw wRLP + waUSDC to User A wallet
# ─────────────────────────────────────────────────────────────────────────────
log_step "6" "Withdrawing wRLP + waUSDC to User A wallet..."

cast send "$BROKER" "withdrawPositionToken(address,uint256)" \
    "$USER_A_ADDR" "$WRLP_MINT" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
sleep 1

cast send "$BROKER" "withdrawCollateral(address,uint256)" \
    "$USER_A_ADDR" "$WAUSDC_NEEDED" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
sleep 1

USER_WRLP=$(cast call "$WRLP"   "balanceOf(address)(uint256)" "$USER_A_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
USER_WAUSDC=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_A_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
log_ok "User A wRLP:   $USER_WRLP"
log_ok "User A waUSDC: $USER_WAUSDC"
[ "$USER_WRLP"   -ge "$WRLP_MINT" ]     || log_err "wRLP not in user wallet"
[ "$USER_WAUSDC" -ge "$WAUSDC_NEEDED" ] || log_err "waUSDC not in user wallet"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7: Set Permit2 approvals
# ─────────────────────────────────────────────────────────────────────────────
log_step "7" "Setting Permit2 approvals..."

MAX256=$(python3 -c 'print(2**256-1)')
MAX160=$(python3 -c 'print(2**160-1)')
MAX48=$(python3  -c 'print(2**48-1)')

cast send "$WAUSDC" "approve(address,uint256)" "$PERMIT2" "$MAX256" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$WRLP" "approve(address,uint256)" "$PERMIT2" "$MAX256" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$PERMIT2" "approve(address,address,uint160,uint48)" \
    "$WAUSDC" "$V4_POSM" "$MAX160" "$MAX48" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$PERMIT2" "approve(address,address,uint160,uint48)" \
    "$WRLP" "$V4_POSM" "$MAX160" "$MAX48" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
log_ok "Permit2 allowances set"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8: Provide LP via forge script
# ─────────────────────────────────────────────────────────────────────────────
log_step "8" "Adding V4 liquidity (WRLP_AMOUNT=5M, waUSDC capped at needed)..."

LP_WEI=$WRLP_MINT  # 5M wRLP — waUSDC surplus returned by V4
cd /workspace/contracts

TOKEN_ID_BEFORE=$(cast call "$V4_POSM" "nextTokenId()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}')

AUSDC_AMOUNT=$LP_WEI WRLP_AMOUNT=$LP_WEI \
    WAUSDC="$WAUSDC" POSITION_TOKEN="$WRLP" TWAMM_HOOK="$TWAMM_HOOK" \
    TICK_SPACING=5 POOL_FEE=500 \
    PRIVATE_KEY="$USER_A_KEY" \
    forge script script/AddLiquidityWrapped.s.sol --tc AddLiquidityWrappedScript \
    --rpc-url "$RPC_URL" --broadcast --code-size-limit 99999 -vvv \
    > /tmp/lp_output.log 2>&1

if grep -q "LP Position Created" /tmp/lp_output.log; then
    TOKEN_ID=$(cast call "$V4_POSM" "nextTokenId()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}')
    TOKEN_ID=$((TOKEN_ID - 1))
    log_ok "LP Position Created — tokenId=$TOKEN_ID"

    # Confirm NFT owner
    OWNER=$(cast call "$V4_POSM" "ownerOf(uint256)(address)" "$TOKEN_ID" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}')
    log_ok "NFT owner: $OWNER  (expected: $USER_A_ADDR)"
    [ "${OWNER,,}" = "${USER_A_ADDR,,}" ] || echo "  ⚠️  NFT owner mismatch"

    # Verify Transfer event emitted by V4 PositionManager
    TRANSFER_TOPIC=$(cast sig-event "Transfer(address,address,uint256)" 2>/dev/null || echo "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
    TRANSFER_LOG=$(grep -i "Transfer\|ddf252ad" /tmp/lp_output.log | head -3)
    log_ok "Transfer event: $TRANSFER_LOG"
else
    echo "  ✗ LP creation failed. Log tail:"
    tail -20 /tmp/lp_output.log
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# VERIFICATION: Check indexer for LP position
# ─────────────────────────────────────────────────────────────────────────────
log_step "V" "Verifying pool snapshot in indexer..."

# Pool snapshot — mark price should now be available
sleep 15  # give indexer time to process
SNAPSHOT=$(curl -s "$API_URL/graphql" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"{ poolSnapshot(marketId: \\\"$MARKET_ID\\\") { markPrice tick liquidity sqrtPriceX96 } }\"}" \
    2>/dev/null)
echo "  Pool snapshot: $SNAPSHOT" | python3 -c "
import sys, json
raw = sys.stdin.read()
start = raw.find('{\"mark')
if start >= 0:
    print(raw[start:].split('}')[0] + '}')
else:
    print(raw[:200])
" 2>/dev/null || echo "  $SNAPSHOT" | head -c 200

echo ""
echo "═══════════════════════════════════════════"
echo "  LP SETUP COMPLETE"
echo "  Broker:  $BROKER"
echo "  LP NFT:  tokenId=$TOKEN_ID  owner=$USER_A_ADDR"
echo "  wRLP LP: $AMOUNT0_CHECK raw = \$$(python3 -c "print(f'{int(\"$AMOUNT0_CHECK\")/1e6:,.2f}')")"
echo "  waUSDC:  $WAUSDC_NEEDED raw = \$$(python3 -c "print(f'{int(\"$WAUSDC_NEEDED\")/1e6:,.2f}')")"
echo "═══════════════════════════════════════════"
