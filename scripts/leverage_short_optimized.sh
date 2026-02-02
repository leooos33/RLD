#!/bin/bash
# Optimized Leverage Short - Single swap atomic execution via LeverageShortExecutor
# Uses signature-based operator auth for atomic: mint → swap → deposit

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   RLD Protocol - Optimized Leverage Short (Single Swap)        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$(dirname "$0")/../contracts"
source .env

RPC_URL="http://localhost:8545"

# User C = Anvil account 2
USER_C_PRIVATE_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
USER_C_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

# Target LTV (default 40%)
TARGET_LTV=${TARGET_LTV:-40}

# Check required env vars
for var in WAUSDC POSITION_TOKEN TWAMM_HOOK MARKET_ID BROKER_FACTORY; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}Error: $var not set. Run mint_and_lp_executor.sh first.${NC}"
        exit 1
    fi
done

echo "Config:"
echo "  waUSDC:      $WAUSDC"
echo "  wRLP:        $POSITION_TOKEN"
echo "  Target LTV:  ${TARGET_LTV}%"
echo "  User C:      $USER_C_ADDRESS"
echo ""

# =============================================================================
# Step 1: Deploy LeverageShortExecutor (if not exists)
# =============================================================================
echo -e "${CYAN}[1/4] Deploying LeverageShortExecutor...${NC}"

DEPLOY_OUTPUT=$(forge script script/DeployLeverageShortExecutor.s.sol \
    --rpc-url "$RPC_URL" --broadcast 2>&1)

LEVERAGE_SHORT_EXECUTOR=$(echo "$DEPLOY_OUTPUT" | grep "LEVERAGE_SHORT_EXECUTOR=" | cut -d'=' -f2)

if [ -z "$LEVERAGE_SHORT_EXECUTOR" ]; then
    echo -e "${RED}✗ Failed to deploy executor${NC}"
    echo "$DEPLOY_OUTPUT" | tail -20
    exit 1
fi

echo -e "${GREEN}✓ Executor: $LEVERAGE_SHORT_EXECUTOR${NC}"

# =============================================================================
# Step 2: Fund User C with waUSDC
# =============================================================================
echo -e "\n${CYAN}[2/4] Funding User C...${NC}"

WAUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_C_ADDRESS" | awk '{print $1}')

if [ "$WAUSDC_BAL" -lt "10000000000" ]; then
    USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"
    AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
    AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
    FUND_AMOUNT="50000000000"  # 50k
    
    cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    cast send --rpc-url "$RPC_URL" --unlocked --from "$USDC_WHALE" "$USDC" \
        "transfer(address,uint256)" "$USER_C_ADDRESS" "$FUND_AMOUNT" --gas-limit 100000 > /dev/null
    
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_setBalance "$USER_C_ADDRESS" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$USDC" \
        "approve(address,uint256)" "$AAVE_POOL" "$FUND_AMOUNT" --gas-limit 100000 > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$AAVE_POOL" \
        "supply(address,uint256,address,uint16)" "$USDC" "$FUND_AMOUNT" "$USER_C_ADDRESS" "0" --gas-limit 500000 > /dev/null
    
    AUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$AUSDC" 'balanceOf(address)(uint256)' "$USER_C_ADDRESS" | awk '{print $1}')
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$AUSDC" \
        "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" --gas-limit 100000 > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$WAUSDC" \
        "wrap(uint256)" "$AUSDC_BAL" --gas-limit 200000 > /dev/null
    
    WAUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_C_ADDRESS" | awk '{print $1}')
fi

echo -e "${GREEN}✓ User C waUSDC: $((WAUSDC_BAL / 1000000))${NC}"

# =============================================================================
# Step 3: Prime TWAMM oracle
# =============================================================================
echo -e "\n${CYAN}[3/4] Priming TWAMM oracle...${NC}"
cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
cast rpc evm_mine --rpc-url "$RPC_URL" > /dev/null
echo -e "${GREEN}✓ Advanced time by 2 hours${NC}"

# =============================================================================
# Step 4: Execute Atomic Leverage Short
# =============================================================================
echo -e "\n${CYAN}[4/4] Executing atomic leverage short...${NC}"
echo ""

export WAUSDC
export POSITION_TOKEN
export TWAMM_HOOK
export MARKET_ID
export BROKER_FACTORY
export LEVERAGE_SHORT_EXECUTOR
export USER_C_PRIVATE_KEY
export TARGET_LTV

RESULT=$(forge script script/TestLeverageShortExecutor.s.sol --tc TestLeverageShortExecutor \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)

if echo "$RESULT" | grep -q "SINGLE SWAP - OPTIMAL GAS"; then
    echo -e "${GREEN}✓ Leverage short executed!${NC}"
    echo ""
    echo "$RESULT" | grep -A 15 "=== LEVERAGE SHORT COMPLETE ===" | head -12
else
    echo -e "${RED}✗ Leverage short failed${NC}"
    echo "$RESULT" | tail -50
    exit 1
fi

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              Single-Swap Leverage Short Complete!              ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
