#!/bin/bash
# 100-Swap Stress Test
# Executes alternating buy/sell, exact in/out swaps to stress test V4 pool

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "╔════════════════════════════════════════════════════════════════╗"
echo -e "║           RLD Protocol - 100-Swap Stress Test                  ║"
echo -e "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Navigate to contracts
cd "$(dirname "$0")/../contracts"

# Load environment
source .env

RPC_URL="http://localhost:8545"

# Use Anvil account 1 as trader
USER_B_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
USER_B_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

# Check required env vars
if [ -z "$WAUSDC" ]; then
    echo -e "${RED}Error: WAUSDC not set. Run mint_and_lp_executor.sh first.${NC}"
    exit 1
fi

echo "Config:"
echo "  waUSDC:      $WAUSDC"
echo "  wRLP:        $POSITION_TOKEN"
echo "  TWAMM Hook:  $TWAMM_HOOK"
echo "  Trader:      $USER_B_ADDRESS"
echo ""

# Check if trader has tokens - if not, fund them
WAUSDC_BALANCE=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')
WRLP_BALANCE=$(cast call --rpc-url "$RPC_URL" "$POSITION_TOKEN" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')

echo "Trader balances:"
echo "  waUSDC: $(python3 -c "print($WAUSDC_BALANCE // 1000000)")"
echo "  wRLP:   $(python3 -c "print($WRLP_BALANCE // 1000000)")"
echo ""

# Fund trader if needed (need both tokens for buy/sell)
MIN_BALANCE=10000000000  # 10,000 tokens

if [ "$WAUSDC_BALANCE" -lt "$MIN_BALANCE" ]; then
    echo -e "${YELLOW}Funding trader with waUSDC...${NC}"
    
    # Get USDC, deposit to Aave, wrap
    USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"
    AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
    AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
    FUND_AMOUNT="20000000000"  # 20k
    
    cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    cast send --rpc-url "$RPC_URL" --unlocked --from "$USDC_WHALE" "$USDC" \
        "transfer(address,uint256)" "$USER_B_ADDRESS" "$FUND_AMOUNT" --gas-limit 100000 > /dev/null
    
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    # Deposit to Aave
    cast send --rpc-url "$RPC_URL" --private-key "$USER_B_PRIVATE_KEY" "$USDC" \
        "approve(address,uint256)" "$AAVE_POOL" "$FUND_AMOUNT" --gas-limit 100000 > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_B_PRIVATE_KEY" "$AAVE_POOL" \
        "supply(address,uint256,address,uint16)" "$USDC" "$FUND_AMOUNT" "$USER_B_ADDRESS" "0" --gas-limit 500000 > /dev/null
    
    # Wrap aUSDC
    AUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$AUSDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_B_PRIVATE_KEY" "$AUSDC" \
        "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" --gas-limit 100000 > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_B_PRIVATE_KEY" "$WAUSDC" \
        "wrap(uint256)" "$AUSDC_BAL" --gas-limit 200000 > /dev/null
    
    echo -e "${GREEN}✓ Funded with waUSDC${NC}"
fi

if [ "$WRLP_BALANCE" -lt "$MIN_BALANCE" ]; then
    echo -e "${YELLOW}Funding trader with wRLP (via initial buy)...${NC}"
    # Trader needs wRLP to sell - do an initial buy swap
    export WAUSDC
    export POSITION_TOKEN
    export TWAMM_HOOK
    export SWAP_AMOUNT="5000000000"  # 5k waUSDC
    export USER_B_PRIVATE_KEY
    
    forge script script/GoLongWRLP.s.sol --tc GoLongWRLP \
        --rpc-url "$RPC_URL" --broadcast --skip-simulation > /dev/null 2>&1 || true
    
    echo -e "${GREEN}✓ Funded with wRLP${NC}"
fi

# Update balances
WAUSDC_BALANCE=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')
WRLP_BALANCE=$(cast call --rpc-url "$RPC_URL" "$POSITION_TOKEN" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')

echo ""
echo "Updated balances:"
echo "  waUSDC: $(python3 -c "print($WAUSDC_BALANCE // 1000000)")"
echo "  wRLP:   $(python3 -c "print($WRLP_BALANCE // 1000000)")"
echo ""

echo -e "${YELLOW}Running 100-swap stress test...${NC}"
echo ""

# Export env vars for forge script
export WAUSDC
export POSITION_TOKEN
export TWAMM_HOOK
export USER_B_PRIVATE_KEY

# Run stress test
RESULT=$(forge script script/SwapStressTest.s.sol --tc SwapStressTest \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)

if echo "$RESULT" | grep -q "FINAL STATE"; then
    echo -e "${GREEN}✓ Stress test completed!${NC}"
    echo ""
    echo "$RESULT" | grep -A 20 "=== INITIAL STATE ===" | head -30
    echo ""
    echo "$RESULT" | grep -A 10 "=== FINAL STATE ===" 
    echo ""
    echo "$RESULT" | grep -A 10 "=== SUMMARY ===" 
else
    echo -e "${RED}✗ Stress test failed${NC}"
    echo "$RESULT" | tail -40
    exit 1
fi
