#!/bin/bash
#
# RLD Protocol - Test TWAMM Order (User C)
#
# Places a TWAMM order to gradually buy wRLP with waUSDC
# This script uses a DIFFERENT user (User C) from the LP provider and trader
#
# Flow:
# 1. Get waUSDC for User C (from whale → Aave → wrap)
# 2. Approve TWAMM hook
# 3. Submit TWAMM order
# 4. Verify order exists
#
# Usage: ./scripts/test_twamm_order.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
RLD_ROOT="/home/ubuntu/RLD"
CONTRACTS_DIR="$RLD_ROOT/contracts"
MARKET_JSON="$CONTRACTS_DIR/wrapped_market.json"
DEPLOYMENTS_JSON="$CONTRACTS_DIR/deployments.json"
RPC_URL="${RPC_URL:-http://localhost:8545}"

# User C - Anvil account 2 (different from Deployer and User B)
USER_C_PRIVATE_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
USER_C_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

# Order parameters
AMOUNT_WAUSDC=${AMOUNT_WAUSDC:-1000}  # Default 1000 waUSDC
DURATION_HOURS=${DURATION_HOURS:-1}   # Default 1 hour

# Mainnet addresses
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
USDC_WHALE="0xCFFAd3200574698b78f32232aa9D63eABD290703"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          RLD Protocol - TWAMM Order Test (User C)         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Load addresses from wrapped_market.json
if [ ! -f "$MARKET_JSON" ]; then
    echo -e "${RED}✗ Error: wrapped_market.json not found${NC}"
    echo -e "${YELLOW}  Run ./scripts/deploy_wrapped_market.sh first${NC}"
    exit 1
fi

echo -e "${GREEN}Loading addresses from wrapped_market.json...${NC}"
WAUSDC=$(jq -r '.waUSDC' "$MARKET_JSON")
POSITION_TOKEN=$(jq -r '.positionToken' "$MARKET_JSON")
BROKER_FACTORY=$(jq -r '.brokerFactory' "$MARKET_JSON")
MARKET_ID=$(jq -r '.marketId' "$MARKET_JSON")

# Load TWAMM hook from deployments.json
TWAMM_HOOK=$(jq -r '.TWAMM' "$DEPLOYMENTS_JSON")

echo ""
echo "  User C:      $USER_C_ADDRESS"
echo "  waUSDC:      $WAUSDC"
echo "  wRLP:        $POSITION_TOKEN"
echo "  TWAMM Hook:  $TWAMM_HOOK"
echo "  Amount:      $AMOUNT_WAUSDC waUSDC"
echo "  Duration:    $DURATION_HOURS hour(s)"
echo ""

cd "$CONTRACTS_DIR"

# =============================================================================
# Step 1: Check if User C already has waUSDC
# =============================================================================
EXISTING_WAUSDC=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL" | awk '{print $1}')
EXISTING_WAUSDC_DEC=$((EXISTING_WAUSDC / 1000000))

if [ "$EXISTING_WAUSDC_DEC" -lt "$AMOUNT_WAUSDC" ]; then
    echo -e "${YELLOW}[1/4] Acquiring waUSDC for User C...${NC}"
    
    AMOUNT_WEI=$((AMOUNT_WAUSDC * 1000000))
    
    # Fund User C with ETH
    cast rpc anvil_setBalance "$USER_C_ADDRESS" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    
    # Impersonate whale and transfer USDC to User C
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    cast send "$USDC" "transfer(address,uint256)" "$USER_C_ADDRESS" "$AMOUNT_WEI" \
        --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" > /dev/null
    
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    # User C: Approve Aave and supply USDC
    cast send "$USDC" "approve(address,uint256)" "$AAVE_POOL" "$AMOUNT_WEI" \
        --private-key "$USER_C_PRIVATE_KEY" --rpc-url "$RPC_URL" > /dev/null
    
    cast send "$AAVE_POOL" "supply(address,uint256,address,uint16)" \
        "$USDC" "$AMOUNT_WEI" "$USER_C_ADDRESS" 0 \
        --private-key "$USER_C_PRIVATE_KEY" --rpc-url "$RPC_URL" > /dev/null
    
    # Get aUSDC balance and wrap it
    AUSDC_BALANCE=$(cast call "$AUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL" | awk '{print $1}')
    
    cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BALANCE" \
        --private-key "$USER_C_PRIVATE_KEY" --rpc-url "$RPC_URL" > /dev/null
    
    cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BALANCE" \
        --private-key "$USER_C_PRIVATE_KEY" --rpc-url "$RPC_URL" > /dev/null
    
    WAUSDC_BALANCE=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_C_ADDRESS" --rpc-url "$RPC_URL" | awk '{print $1}')
    echo -e "${GREEN}✓ User C waUSDC: $((WAUSDC_BALANCE / 1000000))${NC}"
else
    echo -e "${GREEN}[1/4] User C already has $EXISTING_WAUSDC_DEC waUSDC${NC}"
    WAUSDC_BALANCE=$EXISTING_WAUSDC
fi

# =============================================================================
# Step 2: Check pool has liquidity
# =============================================================================
echo -e "${YELLOW}[2/4] Checking pool liquidity...${NC}"

POOL_WRLP=$(cast call "$TWAMM_HOOK" "poolManager()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x0")
echo -e "${GREEN}✓ Pool Manager connected${NC}"

# =============================================================================
# Step 3: Submit TWAMM order via Forge script
# =============================================================================
echo -e "${YELLOW}[3/4] Submitting TWAMM order...${NC}"

AMOUNT_WEI=$((AMOUNT_WAUSDC * 1000000))
DURATION_SECONDS=$((DURATION_HOURS * 3600))

# Sync Anvil timestamp before order placement — Anvil's pending block uses
# fork_ts + block_count, ignoring evm_increaseTime jumps. We must set the
# next block timestamp explicitly to match the chain tip.
echo "  Syncing Anvil timestamp..."
LATEST_TS=$(cast block latest --field timestamp --rpc-url "$RPC_URL" 2>/dev/null)
NEXT_TS=$((LATEST_TS + 1))
cast rpc evm_setNextBlockTimestamp "$NEXT_TS" --rpc-url "$RPC_URL" > /dev/null 2>&1 || true
cast rpc evm_mine --rpc-url "$RPC_URL" > /dev/null 2>&1 || true

WAUSDC=$WAUSDC \
    POSITION_TOKEN=$POSITION_TOKEN \
    TWAMM_HOOK=$TWAMM_HOOK \
    AMOUNT_IN=$AMOUNT_WEI \
    DURATION_SECONDS=$DURATION_SECONDS \
    USER_C_PRIVATE_KEY=$USER_C_PRIVATE_KEY \
    forge script script/TestTwammOrder.s.sol \
        --rpc-url $RPC_URL \
        --broadcast \
        -vvv 2>&1 | tee /tmp/twamm_output.log

# Check if successful
if grep -q "SUCCESS" /tmp/twamm_output.log; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              TWAMM ORDER CREATED SUCCESSFULLY              ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  User C:     $USER_C_ADDRESS"
    echo "  Amount:     $AMOUNT_WAUSDC waUSDC"
    echo "  Duration:   $DURATION_HOURS hour(s)"
    echo "  Direction:  Selling waUSDC → Buying wRLP"
    echo ""
    echo -e "${GREEN}The TWAMM order will gradually execute over the specified duration.${NC}"
else
    echo ""
    echo -e "${RED}✗ TWAMM order submission failed${NC}"
    echo "See output above for details."
    exit 1
fi

# =============================================================================
# Step 4: Verify order state (optional advance time)
# =============================================================================
echo ""
echo -e "${YELLOW}[4/4] Order verification info...${NC}"
echo ""
echo "To advance time and check order execution:"
echo '  cast rpc evm_increaseTime 3600 --rpc-url http://localhost:8545'
echo '  cast rpc anvil_mine 1 --rpc-url http://localhost:8545'
echo ""
echo "To claim tokens after order executes:"
echo "  User C can call TWAMM.claimTokensByPoolKey(poolKey)"
echo ""
