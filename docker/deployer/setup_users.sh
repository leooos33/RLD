#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RLD Setup Users Script (runs after indexer is healthy)
# ═══════════════════════════════════════════════════════════════
# Creates brokers, funds users, mints positions, provides LP.
# Reads core contract addresses from /config/deployment.json.
#
# This runs as a separate service AFTER the indexer is healthy,
# so the indexer captures all BrokerCreated / Transfer events live.
# ═══════════════════════════════════════════════════════════════

set -e
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1

# ─── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

log_phase() { echo -e "\n${BLUE}═══ PHASE $1: $2 ═══${NC}\n"; }
log_step()  { echo -e "${YELLOW}[$1] $2${NC}"; }
log_ok()    { echo -e "${GREEN}✓ $1${NC}"; }
log_err()   { echo -e "${RED}✗ $1${NC}"; exit 1; }
log_info()  { echo -e "${CYAN}ℹ $1${NC}"; }

# ─── Validate env ─────────────────────────────────────────────
RPC_URL=${RPC_URL:-"http://host.docker.internal:8545"}

for VAR in DEPLOYER_KEY USER_A_KEY USER_B_KEY USER_C_KEY MM_KEY CHAOS_KEY; do
    if [ -z "${!VAR}" ]; then
        log_err "$VAR not set"
    fi
done

# ─── Read core addresses from deployment.json ─────────────────
CONFIG_FILE="/config/deployment.json"
if [ ! -f "$CONFIG_FILE" ]; then
    log_err "deployment.json not found at $CONFIG_FILE"
fi

# Parse JSON with python3 (available in container)
eval "$(python3 -c "
import json, sys
with open('$CONFIG_FILE') as f:
    d = json.load(f)
for k, v in d.items():
    if isinstance(v, (str, int, float, bool)):
        print(f'export {k.upper()}=\"{v}\"')
")"

# ─── Mainnet constants ────────────────────────────────────────
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"

PERMIT2="0x000000000022D473030F116dDEE9F6B43aC78BA3"
V4_POSITION_MANAGER="${V4_POSITION_MANAGER}"
POOL_MANAGER="${POOL_MANAGER}"

# ═══════════════════════════════════════════════════════════════
# PHASE 3: SETUP USERS
# ═══════════════════════════════════════════════════════════════
log_phase "3" "SETUP USERS (indexer is live)"

# ─── Helper functions ──────────────────────────────────────────
fund_user() {
    local ADDR=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))

    # Set ETH balance
    cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_setBalance "$ADDR" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null

    # Transfer USDC from whale
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    cast send "$USDC" "transfer(address,uint256)" "$ADDR" "$AMOUNT_WEI" \
        --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" > /dev/null
    sleep 1
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

    # Supply to Aave
    cast send "$USDC" "approve(address,uint256)" "$AAVE_POOL" "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
    cast send "$AAVE_POOL" "supply(address,uint256,address,uint16)" \
        "$USDC" "$AMOUNT_WEI" "$ADDR" 0 \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1

    # Wrap aUSDC → waUSDC
    local AUSDC_BAL=$(cast call "$AUSDC" "balanceOf(address)(uint256)" "$ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
    cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" \
        --private-key "$KEY" --rpc-url "$RPC_URL" --gas-limit 150000 > /dev/null
    sleep 1
    cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BAL" \
        --private-key "$KEY" --rpc-url "$RPC_URL" --gas-limit 500000 > /dev/null
    sleep 1

    log_ok "Funded $ADDR with \$$AMOUNT_USD"
}

create_broker() {
    local KEY=$1
    local SALT=$(cast keccak "broker-$(date +%s)-$RANDOM")

    local BROKER=$(cast send "$BROKER_FACTORY" "createBroker(bytes32)" "$SALT" \
        --private-key "$KEY" --rpc-url "$RPC_URL" --json 2>/dev/null \
        | jq -r '[.logs[]? | select(.topics[0] == "0xc418c83b1622e1e32aac5d6d2848134a7e89eb8e96c8514afd1757d25ee5ef71")] | .[0].data // empty' 2>/dev/null \
        | head -1 \
        | python3 -c "
import sys
data = sys.stdin.readline().strip()
if data and data.startswith('0x') and len(data) >= 66:
    print('0x' + data[26:66])
else:
    print('')
")
    [ -z "$BROKER" ] && log_err "Failed to create broker"
    echo "$BROKER"
}

deposit_to_broker() {
    local BROKER=$1 KEY=$2 AMOUNT=$3
    local USER_ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null)

    if [ "$AMOUNT" = "all" ]; then
        AMOUNT=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
    else
        AMOUNT=$((AMOUNT * 1000000))
    fi

    cast send "$WAUSDC" "transfer(address,uint256)" "$BROKER" "$AMOUNT" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

mint_wrlp() {
    local BROKER=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))
    cast send "$BROKER" "modifyPosition(bytes32,int256,int256)" \
        "$MARKET_ID" 0 "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

withdraw_position() {
    local BROKER=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))
    local USER_ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null)
    cast send "$BROKER" "withdrawPositionToken(address,uint256)" "$USER_ADDR" "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

withdraw_collateral() {
    local BROKER=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))
    local USER_ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null)
    cast send "$BROKER" "withdrawCollateral(address,uint256)" "$USER_ADDR" "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

prime_oracle() {
    # Switch to automine, jump time, mine, then restore interval mining.
    # Large evm_increaseTime during interval mining can crash Anvil.
    cast rpc evm_setAutomine true --rpc-url "$RPC_URL" > /dev/null 2>&1 || true
    cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_mine 1 --rpc-url "$RPC_URL" > /dev/null
    cast rpc evm_setAutomine false --rpc-url "$RPC_URL" > /dev/null 2>&1 || true
    cast rpc evm_setIntervalMining 12 --rpc-url "$RPC_URL" > /dev/null 2>&1 || true
}

# ─── User A: LP Provider ($100M collateral, $5M LP) ───────────
log_step "3.1" "Setting up LP Provider (User A)..."
USER_A_ADDR=$(cast wallet address --private-key "$USER_A_KEY" 2>/dev/null)
fund_user "$USER_A_ADDR" "$USER_A_KEY" 100000000

USER_A_BROKER=$(create_broker "$USER_A_KEY")
log_ok "User A broker: $USER_A_BROKER"

deposit_to_broker "$USER_A_BROKER" "$USER_A_KEY" "all"

# Mint wRLP for LP (5M + 10% buffer)
mint_wrlp "$USER_A_BROKER" "$USER_A_KEY" 5500000
withdraw_position "$USER_A_BROKER" "$USER_A_KEY" 5000000
withdraw_collateral "$USER_A_BROKER" "$USER_A_KEY" 5000000

# Add V4 LP
log_step "3.1b" "Adding V4 LP..."
LP_WEI=$((5000000 * 1000000))
MAX_UINT=$(python3 -c 'print(2**160-1)')
MAX_UINT48=$(python3 -c 'print(2**48-1)')

cast send "$WAUSDC" "approve(address,uint256)" "$PERMIT2" "$LP_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$POSITION_TOKEN" "approve(address,uint256)" "$PERMIT2" "$LP_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$PERMIT2" "approve(address,address,uint160,uint48)" \
    "$WAUSDC" "$V4_POSITION_MANAGER" "$MAX_UINT" "$MAX_UINT48" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$PERMIT2" "approve(address,address,uint160,uint48)" \
    "$POSITION_TOKEN" "$V4_POSITION_MANAGER" "$MAX_UINT" "$MAX_UINT48" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null

cd /workspace/contracts
AUSDC_AMOUNT=$LP_WEI WRLP_AMOUNT=$LP_WEI \
    WAUSDC=$WAUSDC POSITION_TOKEN=$POSITION_TOKEN TWAMM_HOOK=$TWAMM_HOOK \
    forge script script/AddLiquidityWrapped.s.sol --tc AddLiquidityWrappedScript \
    --rpc-url "$RPC_URL" --broadcast --code-size-limit 99999 -v > /tmp/lp_output.log 2>&1 || true

if grep -q "LP Position Created" /tmp/lp_output.log; then
    log_ok "LP position created"
else
    echo "  ⚠️  LP creation may have failed"
    tail -5 /tmp/lp_output.log
fi

# ─── User B: Long User ($100k) ────────────────────────────────
log_step "3.2" "Setting up Long User (User B)..."
USER_B_ADDR=$(cast wallet address --private-key "$USER_B_KEY" 2>/dev/null)
fund_user "$USER_B_ADDR" "$USER_B_KEY" 100000

# Swap waUSDC → wRLP (go long)
WAUSDC_BAL_B=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_B_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
cd /workspace/contracts
TOKEN0="$TOKEN0" TOKEN1="$TOKEN1" TWAMM_HOOK="$TWAMM_HOOK" \
    SWAP_AMOUNT="$WAUSDC_BAL_B" ZERO_FOR_ONE="$ZERO_FOR_ONE_LONG" \
    SWAP_USER_KEY="$USER_B_KEY" \
    forge script script/LifecycleSwap.s.sol --tc LifecycleSwap \
    --rpc-url "$RPC_URL" --broadcast -v > /dev/null 2>&1 || true
log_ok "Long user ready"

# ─── User C: TWAMM User ($100k, funded but NO automatic order) ─
log_step "3.3" "Setting up TWAMM User (User C)..."
USER_C_ADDR=$(cast wallet address --private-key "$USER_C_KEY" 2>/dev/null)
fund_user "$USER_C_ADDR" "$USER_C_KEY" 100000
log_ok "TWAMM user funded (no order placed)"

# ─── MM Bot ($10M) ─────────────────────────────────────────────
log_step "3.4" "Setting up Market Maker..."
MM_ADDR=$(cast wallet address --private-key "$MM_KEY" 2>/dev/null)
fund_user "$MM_ADDR" "$MM_KEY" 10000000

MM_BROKER=$(create_broker "$MM_KEY")
log_ok "MM broker: $MM_BROKER"
deposit_to_broker "$MM_BROKER" "$MM_KEY" 6500000

prime_oracle
mint_wrlp "$MM_BROKER" "$MM_KEY" 1000000
withdraw_position "$MM_BROKER" "$MM_KEY" 1000000
log_ok "MM bot ready"

# ─── Chaos Trader ($10M) ──────────────────────────────────────
log_step "3.5" "Setting up Chaos Trader..."
CHAOS_ADDR=$(cast wallet address --private-key "$CHAOS_KEY" 2>/dev/null)
fund_user "$CHAOS_ADDR" "$CHAOS_KEY" 10000000

CHAOS_BROKER=$(create_broker "$CHAOS_KEY")
log_ok "Chaos broker: $CHAOS_BROKER"
deposit_to_broker "$CHAOS_BROKER" "$CHAOS_KEY" 5000000

prime_oracle

# Compute wRLP mint amount from price
WRLP_PRICE_WAD=$(cast call "$MOCK_ORACLE" "getIndexPrice(address,address)(uint256)" \
    "0x0000000000000000000000000000000000000000" "0x0000000000000000000000000000000000000000" \
    --rpc-url "$RPC_URL" | awk '{print $1}')
WRLP_MINT=$(python3 -c "
price_wad = $WRLP_PRICE_WAD
target_usd = 1000000
tokens = int(target_usd * 1e18 / price_wad)
print(tokens)
")
mint_wrlp "$CHAOS_BROKER" "$CHAOS_KEY" "$WRLP_MINT"
withdraw_position "$CHAOS_BROKER" "$CHAOS_KEY" "$WRLP_MINT"
log_ok "Chaos trader ready"

# ─── Approve SwapRouter for MM and Chaos ──────────────────────
if [ -n "$SWAP_ROUTER" ]; then
    log_step "3.6" "Approving SwapRouter for trading bots..."
    python3 -c "
from web3 import Web3
from eth_account import Account
import os

w3 = Web3(Web3.HTTPProvider(os.environ['RPC_URL']))
ERC20_ABI = [
    {'inputs': [{'name': 'spender', 'type': 'address'}, {'name': 'amount', 'type': 'uint256'}],
     'name': 'approve', 'outputs': [{'name': '', 'type': 'bool'}],
     'stateMutability': 'nonpayable', 'type': 'function'},
]
MAX_UINT = 2**256 - 1
pm = '$POOL_MANAGER'
router = '$SWAP_ROUTER'
wausdc = '$WAUSDC'
pos_token = '$POSITION_TOKEN'

for name, key_env in [('MM', 'MM_KEY'), ('Chaos', 'CHAOS_KEY')]:
    key = os.environ.get(key_env)
    if not key: continue
    acct = Account.from_key(key)
    for token_addr, tname in [(wausdc, 'waUSDC'), (pos_token, 'wRLP')]:
        token = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI)
        for spender, sname in [(router, 'Router'), (pm, 'PoolManager')]:
            nonce = w3.eth.get_transaction_count(acct.address)
            tx = token.functions.approve(Web3.to_checksum_address(spender), MAX_UINT).build_transaction({
                'from': acct.address, 'nonce': nonce, 'gas': 60000,
                'maxFeePerGas': w3.to_wei('2', 'gwei'), 'maxPriorityFeePerGas': w3.to_wei('1', 'gwei'),
            })
            signed = w3.eth.account.sign_transaction(tx, key)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
            print(f'  ✅ {name} approved {tname} for {sname}')
"
fi

echo ""
echo -e "${MAGENTA}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${MAGENTA}║     USER SETUP COMPLETE                           ║${NC}"
echo -e "${MAGENTA}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
