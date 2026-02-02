#!/bin/bash
#
# RLD Protocol - End-to-End Lifecycle Test
#
# This script creates a complete, production-like market state:
# 1. Restarts Anvil fork
# 2. Deploys protocol
# 3. Creates waUSDC wrapped market
# 4. User A: $100M collateral → $5M wRLP → V4 LP
# 5. User B: Go long $100k
# 6. User C: TWAMM order $100k
#
# After completion, addresses are exported for subsequent testing.
#
# Usage: ./scripts/lifecycle_test.sh
#

set -e

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

# Paths
RLD_ROOT="/home/ubuntu/RLD"
CONTRACTS_DIR="$RLD_ROOT/contracts"
RPC_URL="http://localhost:8545"
FORK_BLOCK=21698573

# Amounts (6 decimals for USDC)
COLLATERAL_AMOUNT=100000000       # $100M
MINT_AMOUNT=5000000               # $5M wRLP
LP_AMOUNT=5000000                 # $5M each for LP
LONG_AMOUNT=100000                # $100k for go long
TWAMM_AMOUNT=100000               # $100k for TWAMM order
TWAMM_DURATION_HOURS=1

# Convert to wei
COLLATERAL_WEI=$((COLLATERAL_AMOUNT * 1000000))
MINT_WEI=$((MINT_AMOUNT * 1000000))
LP_WEI=$((LP_AMOUNT * 1000000))
LONG_WEI=$((LONG_AMOUNT * 1000000))
TWAMM_WEI=$((TWAMM_AMOUNT * 1000000))

# Mainnet addresses
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"
V4_POSITION_MANAGER="0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"
PERMIT2="0x000000000022D473030F116dDEE9F6B43aC78BA3"

# Anvil accounts
USER_A_KEY=""  # Will be loaded from .env (PRIVATE_KEY)
USER_A_ADDRESS=""
USER_B_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
USER_B_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
USER_C_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
USER_C_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

# State variables (populated during execution)
TWAMM_HOOK=""
FACTORY=""
WAUSDC=""
POSITION_TOKEN=""
BROKER_FACTORY=""
MARKET_ID=""
USER_A_BROKER=""

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

log_phase() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  PHASE $1: $2${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

log_step() {
    echo -e "${YELLOW}[$1] $2${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    exit 1
}

parse_output() {
    echo "$1" | awk '{print $1}'
}

fund_user() {
    local USER_ADDR=$1
    local AMOUNT=$2
    local USER_KEY=$3
    local USER_NAME=$4
    
    log_step "1" "Funding $USER_NAME with $((AMOUNT / 1000000)) USDC"
    
    # Fund whale with ETH
    cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_setBalance "$USER_ADDR" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    cast send "$USDC" "transfer(address,uint256)" "$USER_ADDR" "$AMOUNT" \
        --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" > /dev/null
    
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    log_step "2" "Supplying to Aave"
    cast send "$USDC" "approve(address,uint256)" "$AAVE_POOL" "$AMOUNT" \
        --private-key "$USER_KEY" --rpc-url "$RPC_URL" > /dev/null
    
    cast send "$AAVE_POOL" "supply(address,uint256,address,uint16)" \
        "$USDC" "$AMOUNT" "$USER_ADDR" 0 \
        --private-key "$USER_KEY" --rpc-url "$RPC_URL" > /dev/null
    
    log_step "3" "Wrapping aUSDC → waUSDC"
    local AUSDC_BAL=$(parse_output "$(cast call "$AUSDC" "balanceOf(address)(uint256)" "$USER_ADDR" --rpc-url "$RPC_URL")")
    
    # Approve with explicit gas limit
    cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" \
        --private-key "$USER_KEY" --rpc-url "$RPC_URL" --gas-limit 150000 > /dev/null
    
    # Wrap with explicit higher gas limit (aToken transfers need more gas due to Aave accounting)
    local WRAP_RESULT=$(cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BAL" \
        --private-key "$USER_KEY" --rpc-url "$RPC_URL" --gas-limit 500000 --json 2>&1)
    
    local WRAP_STATUS=$(echo "$WRAP_RESULT" | jq -r '.status // "0x0"' 2>/dev/null)
    if [ "$WRAP_STATUS" != "0x1" ]; then
        echo "Wrap transaction failed or status unknown"
        echo "Debug: $WRAP_RESULT" | head -5
    fi
    
    local WAUSDC_BAL=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_ADDR" --rpc-url "$RPC_URL")")
    log_success "$USER_NAME waUSDC: $((WAUSDC_BAL / 1000000))"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         RLD PROTOCOL - END-TO-END LIFECYCLE TEST                  ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Collateral:   \$${COLLATERAL_AMOUNT}"
echo "  wRLP Mint:    \$${MINT_AMOUNT}"
echo "  LP Amount:    \$${LP_AMOUNT} each"
echo "  Go Long:      \$${LONG_AMOUNT}"
echo "  TWAMM Order:  \$${TWAMM_AMOUNT}"
echo ""

# Load credentials
cd "$CONTRACTS_DIR"
if [ -f .env ]; then
    source .env
    USER_A_KEY="$PRIVATE_KEY"
    USER_A_ADDRESS=$(cast wallet address --private-key "$USER_A_KEY" 2>/dev/null)
else
    log_error ".env file not found"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 0: RESTART ANVIL
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 0 "RESTART ANVIL FORK"

log_step "1" "Killing existing anvil process..."
pkill -f "anvil" 2>/dev/null || true
sleep 2

log_step "2" "Starting fresh anvil fork at block $FORK_BLOCK..."
MAINNET_RPC=$(grep "^MAINNET_RPC_URL=" .env | cut -d'=' -f2)
anvil --fork-url "$MAINNET_RPC" --fork-block-number $FORK_BLOCK --host 0.0.0.0 --port 8545 > /tmp/anvil_lifecycle.log 2>&1 &
ANVIL_PID=$!

log_step "3" "Waiting for RPC to be ready..."
for i in {1..30}; do
    if curl -s -X POST "$RPC_URL" -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' 2>/dev/null | grep -q "result"; then
        break
    fi
    sleep 1
done

BLOCK=$(curl -s -X POST "$RPC_URL" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq -r '.result' | xargs printf "%d")

if [ "$BLOCK" -eq "$FORK_BLOCK" ]; then
    log_success "Anvil running at block $BLOCK (PID: $ANVIL_PID)"
else
    log_error "Failed to start anvil"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: DEPLOY PROTOCOL
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 1 "DEPLOY PROTOCOL"

log_step "1" "Running DeployRLDProtocol.s.sol..."
DEPLOY_OUTPUT=$(forge script script/DeployRLDProtocol.s.sol --tc DeployRLDProtocol \
    --rpc-url "$RPC_URL" --broadcast -v 2>&1)

if ! echo "$DEPLOY_OUTPUT" | grep -q "DEPLOYMENT COMPLETE"; then
    log_error "Protocol deployment failed"
fi

# Extract TWAMM address from deployments.json
TWAMM_HOOK=$(jq -r '.TWAMM' deployments.json)
FACTORY=$(jq -r '.RLDMarketFactory' deployments.json)

log_success "Protocol deployed"
echo "  TWAMM Hook: $TWAMM_HOOK"
echo "  Factory:    $FACTORY"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: DEPLOY WRAPPED MARKET
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 2 "DEPLOY WRAPPED MARKET"

log_step "1" "Running DeployWrappedMarket.s.sol..."
MARKET_OUTPUT=$(forge script script/DeployWrappedMarket.s.sol --tc DeployWrappedMarket \
    --rpc-url "$RPC_URL" --broadcast -v 2>&1)

if ! echo "$MARKET_OUTPUT" | grep -q "WRAPPED MARKET CREATED"; then
    echo "$MARKET_OUTPUT"
    log_error "Market deployment failed"
fi

# Extract waUSDC address from output (it's always logged)
WAUSDC=$(echo "$MARKET_OUTPUT" | grep -i "waUSDC deployed:" | awk '{print $NF}')
if [ -z "$WAUSDC" ]; then
    # Try alternate pattern
    WAUSDC=$(echo "$MARKET_OUTPUT" | grep "collateralToken (waUSDC):" | awk '{print $NF}')
fi

# Extract market ID from output
MARKET_ID=$(echo "$MARKET_OUTPUT" | grep "MarketId:" | awk '{print $NF}')

# Extract broker factory from output
BROKER_FACTORY=$(echo "$MARKET_OUTPUT" | grep "BrokerFactory:" | awk '{print $NF}')

# Extract position token from output
POSITION_TOKEN=$(echo "$MARKET_OUTPUT" | grep "positionToken (wRLP):" | awk '{print $NF}')

if [ -z "$WAUSDC" ] || [ -z "$POSITION_TOKEN" ]; then
    echo "Debug: WAUSDC=$WAUSDC, POSITION_TOKEN=$POSITION_TOKEN"
    echo "Trying to save output for debugging..."
    echo "$MARKET_OUTPUT" > /tmp/market_output_debug.log
    log_error "Failed to extract market addresses"
fi

log_success "Wrapped market deployed"
echo "  waUSDC:         $WAUSDC"
echo "  wRLP:           $POSITION_TOKEN"
echo "  BrokerFactory:  $BROKER_FACTORY"
echo "  MarketId:       $MARKET_ID"

log_step "2" "Priming TWAMM oracle..."
cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
cast rpc anvil_mine 1 --rpc-url "$RPC_URL" > /dev/null
log_success "Oracle primed (advanced 2 hours)"

# ═══════════════════════════════════════════════════════════════════════════════
# CRITICAL: CURRENCY SORTING
# In Uniswap V4, currency0 < currency1 is required.
# We must determine which token is which and set swap direction accordingly.
# ═══════════════════════════════════════════════════════════════════════════════
log_step "3" "Determining currency order..."

# Compare addresses lexicographically (lowercase for consistency)
WAUSDC_LOWER=$(echo "$WAUSDC" | tr '[:upper:]' '[:lower:]')
POSITION_TOKEN_LOWER=$(echo "$POSITION_TOKEN" | tr '[:upper:]' '[:lower:]')

if [[ "$WAUSDC_LOWER" < "$POSITION_TOKEN_LOWER" ]]; then
    TOKEN0="$WAUSDC"
    TOKEN1="$POSITION_TOKEN"
    WAUSDC_IS_TOKEN0=true
    # Going long wRLP = buy wRLP (token1) with waUSDC (token0)
    # zeroForOne = true (sell token0 to get token1)
    ZERO_FOR_ONE_LONG=true
else
    TOKEN0="$POSITION_TOKEN"
    TOKEN1="$WAUSDC"
    WAUSDC_IS_TOKEN0=false
    # Going long wRLP = buy wRLP (token0) with waUSDC (token1)
    # zeroForOne = false (sell token1 to get token0)
    ZERO_FOR_ONE_LONG=false
fi

log_success "Currency order determined"
echo "  TOKEN0 (smaller): $TOKEN0"
echo "  TOKEN1 (larger):  $TOKEN1"
echo "  waUSDC is TOKEN0: $WAUSDC_IS_TOKEN0"
echo "  ZERO_FOR_ONE to go long: $ZERO_FOR_ONE_LONG"

# Update JSON with currency order
cat > wrapped_market.json << EOF
{
  "waUSDC": "$WAUSDC",
  "positionToken": "$POSITION_TOKEN",
  "brokerFactory": "$BROKER_FACTORY",
  "marketId": "$MARKET_ID",
  "token0": "$TOKEN0",
  "token1": "$TOKEN1",
  "zeroForOneLong": $ZERO_FOR_ONE_LONG,
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "network": "mainnet-fork"
}
EOF

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: USER A - PROVIDE LP
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 3 "USER A - PROVIDE \$${COLLATERAL_AMOUNT} COLLATERAL & LP"

# Fund User A with waUSDC
fund_user "$USER_A_ADDRESS" "$COLLATERAL_WEI" "$USER_A_KEY" "User A"

log_step "4" "Creating PrimeBroker..."
SALT=$(cast keccak "lifecycle-$(date +%s)")
BROKER_TX=$(cast send "$BROKER_FACTORY" "createBroker(bytes32)" "$SALT" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" --json)

USER_A_BROKER=$(echo "$BROKER_TX" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for log in data.get('logs', []):
    topics = log.get('topics', [])
    if topics and topics[0].lower() == '0xc418c83b1622e1e32aac5d6d2848134a7e89eb8e96c8514afd1757d25ee5ef71':
        data_field = log.get('data', '')
        if data_field.startswith('0x') and len(data_field) >= 66:
            print('0x' + data_field[26:66])
            break
")
log_success "Broker: $USER_A_BROKER"

log_step "5" "Transferring waUSDC to broker..."
WAUSDC_BAL=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_A_ADDRESS" --rpc-url "$RPC_URL")")
cast send "$WAUSDC" "transfer(address,uint256)" "$USER_A_BROKER" "$WAUSDC_BAL" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
log_success "Broker waUSDC: $((WAUSDC_BAL / 1000000))"

log_step "6" "Minting $MINT_AMOUNT wRLP..."
cast send "$USER_A_BROKER" "modifyPosition(bytes32,int256,int256)" \
    "$MARKET_ID" 0 "$MINT_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null

BROKER_WRLP=$(parse_output "$(cast call "$POSITION_TOKEN" "balanceOf(address)(uint256)" "$USER_A_BROKER" --rpc-url "$RPC_URL")")
log_success "Broker wRLP: $((BROKER_WRLP / 1000000))"

log_step "7" "Withdrawing $LP_AMOUNT each for LP..."
cast send "$USER_A_BROKER" "withdrawPositionToken(address,uint256)" "$USER_A_ADDRESS" "$LP_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null

cast send "$USER_A_BROKER" "withdrawCollateral(address,uint256)" "$USER_A_ADDRESS" "$LP_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null

log_success "Withdrawn for LP"

log_step "8" "Approving V4 contracts..."
cast send "$WAUSDC" "approve(address,uint256)" "$PERMIT2" "$LP_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$POSITION_TOKEN" "approve(address,uint256)" "$PERMIT2" "$LP_WEI" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null

cast send "$PERMIT2" "approve(address,address,uint160,uint48)" \
    "$WAUSDC" "$V4_POSITION_MANAGER" "$(python3 -c 'print(2**160-1)')" "$(python3 -c 'print(2**48-1)')" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
cast send "$PERMIT2" "approve(address,address,uint160,uint48)" \
    "$POSITION_TOKEN" "$V4_POSITION_MANAGER" "$(python3 -c 'print(2**160-1)')" "$(python3 -c 'print(2**48-1)')" \
    --private-key "$USER_A_KEY" --rpc-url "$RPC_URL" > /dev/null
log_success "V4 approvals complete"

log_step "9" "Adding V4 liquidity..."
AUSDC_AMOUNT=$LP_WEI WRLP_AMOUNT=$LP_WEI WAUSDC=$WAUSDC POSITION_TOKEN=$POSITION_TOKEN TWAMM_HOOK=$TWAMM_HOOK \
    forge script script/AddLiquidityWrapped.s.sol --tc AddLiquidityWrappedScript \
    --rpc-url "$RPC_URL" --broadcast -v > /tmp/lp_output.log 2>&1

if grep -q "LP Position Created" /tmp/lp_output.log; then
    TOKEN_ID=$(grep "Token ID:" /tmp/lp_output.log | awk '{print $NF}')
    log_success "V4 LP Position created (Token ID: $TOKEN_ID)"
else
    log_error "LP creation failed - check /tmp/lp_output.log"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: USER B - GO LONG
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 4 "USER B - GO LONG \$${LONG_AMOUNT}"

fund_user "$USER_B_ADDRESS" "$LONG_WEI" "$USER_B_KEY" "User B"

log_step "4" "Swapping waUSDC → wRLP (using LifecycleSwap)..."

# Get balances before
WRLP_BEFORE=$(parse_output "$(cast call "$POSITION_TOKEN" "balanceOf(address)(uint256)" "$USER_B_ADDRESS" --rpc-url "$RPC_URL")")

# Get User B's ACTUAL waUSDC balance (may be slightly less than LONG_WEI due to Aave rounding)
USER_B_WAUSDC=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_B_ADDRESS" --rpc-url "$RPC_URL")")
echo "  User B actual waUSDC balance: $USER_B_WAUSDC"

# Use pre-sorted currencies and explicit direction
TOKEN0="$TOKEN0" TOKEN1="$TOKEN1" TWAMM_HOOK="$TWAMM_HOOK" \
    SWAP_AMOUNT="$USER_B_WAUSDC" ZERO_FOR_ONE="$ZERO_FOR_ONE_LONG" \
    SWAP_USER_KEY="$USER_B_KEY" \
    forge script script/LifecycleSwap.s.sol --tc LifecycleSwap \
    --rpc-url "$RPC_URL" --broadcast -v > /tmp/swap_output.log 2>&1

# Check result
WRLP_AFTER=$(parse_output "$(cast call "$POSITION_TOKEN" "balanceOf(address)(uint256)" "$USER_B_ADDRESS" --rpc-url "$RPC_URL")")
WRLP_RECEIVED=$((WRLP_AFTER - WRLP_BEFORE))

if [ "$WRLP_RECEIVED" -gt 0 ]; then
    log_success "Swap complete: received $((WRLP_RECEIVED / 1000000)) wRLP"
else
    # Show some debug info from the log
    echo "Debug: Last 10 lines of swap log:"
    tail -10 /tmp/swap_output.log
    log_error "Swap failed - check /tmp/swap_output.log"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: USER C - TWAMM ORDER
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 5 "USER C - TWAMM ORDER \$${TWAMM_AMOUNT}"

fund_user "$USER_C_ADDRESS" "$TWAMM_WEI" "$USER_C_KEY" "User C"

log_step "4" "Submitting TWAMM order (using LifecycleTWAMM)..."

# Get waUSDC balance before
WAUSDC_BEFORE=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL")")
# Get User C's ACTUAL waUSDC balance (may be slightly less due to Aave rounding)
USER_C_WAUSDC=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL")")
echo "  User C actual waUSDC balance: $USER_C_WAUSDC"

# Use pre-sorted currencies and explicit direction
TOKEN0="$TOKEN0" TOKEN1="$TOKEN1" TWAMM_HOOK="$TWAMM_HOOK" \
    ORDER_AMOUNT="$USER_C_WAUSDC" \
    DURATION_SECONDS="$((TWAMM_DURATION_HOURS * 3600))" \
    ZERO_FOR_ONE="$ZERO_FOR_ONE_LONG" \
    TWAMM_USER_KEY="$USER_C_KEY" \
    forge script script/LifecycleTWAMM.s.sol --tc LifecycleTWAMM \
    --rpc-url "$RPC_URL" --broadcast -v > /tmp/twamm_output.log 2>&1

# Check if order was submitted (waUSDC balance decreased = tokens locked)
WAUSDC_AFTER=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL")")

if [ "$WAUSDC_AFTER" -lt "$WAUSDC_BEFORE" ]; then
    LOCKED=$((WAUSDC_BEFORE - WAUSDC_AFTER))
    log_success "TWAMM order created: locked $((LOCKED / 1000000)) waUSDC over $TWAMM_DURATION_HOURS hour(s)"
else
    echo "Debug: Last 10 lines of TWAMM log:"
    tail -10 /tmp/twamm_output.log
    log_error "TWAMM order failed - check /tmp/twamm_output.log"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: VERIFICATION & OUTPUT
# ═══════════════════════════════════════════════════════════════════════════════
log_phase 6 "VERIFICATION & OUTPUT"

echo -e "${CYAN}Final Balances:${NC}"
echo ""

# User A Broker
BROKER_WAUSDC=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_A_BROKER" --rpc-url "$RPC_URL")")
BROKER_WRLP=$(parse_output "$(cast call "$POSITION_TOKEN" "balanceOf(address)(uint256)" "$USER_A_BROKER" --rpc-url "$RPC_URL")")
echo "  User A Broker:"
echo "    waUSDC: $((BROKER_WAUSDC / 1000000))"
echo "    wRLP:   $((BROKER_WRLP / 1000000))"
echo ""

# User B
USER_B_WAUSDC=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_B_ADDRESS" --rpc-url "$RPC_URL")")
USER_B_WRLP=$(parse_output "$(cast call "$POSITION_TOKEN" "balanceOf(address)(uint256)" "$USER_B_ADDRESS" --rpc-url "$RPC_URL")")
echo "  User B (Long):"
echo "    waUSDC: $((USER_B_WAUSDC / 1000000))"
echo "    wRLP:   $((USER_B_WRLP / 1000000))"
echo ""

# User C
USER_C_WAUSDC=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL")")
echo "  User C (TWAMM):"
echo "    waUSDC: $((USER_C_WAUSDC / 1000000)) (rest in TWAMM order)"
echo ""

# Pool Manager
PM="0x000000000004444c5dc75cB358380D2e3dE08A90"
PM_WAUSDC=$(parse_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$PM" --rpc-url "$RPC_URL")")
PM_WRLP=$(parse_output "$(cast call "$POSITION_TOKEN" "balanceOf(address)(uint256)" "$PM" --rpc-url "$RPC_URL")")
echo "  V4 Pool Manager:"
echo "    waUSDC: $((PM_WAUSDC / 1000000))"
echo "    wRLP:   $((PM_WRLP / 1000000))"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# EXPORT ADDRESSES
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    LIFECYCLE TEST COMPLETE!                       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Copy these exports to run additional tests:${NC}"
echo ""
echo "export WAUSDC=$WAUSDC"
echo "export POSITION_TOKEN=$POSITION_TOKEN"
echo "export TWAMM_HOOK=$TWAMM_HOOK"
echo "export MARKET_ID=$MARKET_ID"
echo "export BROKER_FACTORY=$BROKER_FACTORY"
echo "export USER_A_BROKER=$USER_A_BROKER"
echo ""
echo "# Then run:"
echo "#   ./scripts/go_long.sh"
echo "#   ./scripts/go_short.sh"
echo "#   ./scripts/chaos_test.sh"
echo ""
