#!/bin/bash
# Go Short wRLP - User C shorts the interest rate
# Deposit collateral → Mint wRLP → Sell on V4 → Redeposit to enhance collateral

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           RLD Protocol - Go Short wRLP                         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$(dirname "$0")/../contracts"
source .env

RPC_URL="http://localhost:8545"

# User C = Anvil account 2
USER_C_PRIVATE_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
USER_C_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

# Leverage loops (default 1 = single cycle)
LEVERAGE_LOOPS=${LEVERAGE_LOOPS:-1}

# Check required env vars
if [ -z "$WAUSDC" ]; then
    echo -e "${RED}Error: WAUSDC not set. Run mint_and_lp_executor.sh first.${NC}"
    exit 1
fi

if [ -z "$MARKET_ID" ]; then
    echo -e "${RED}Error: MARKET_ID not set in .env${NC}"
    exit 1
fi

echo "Config:"
echo "  waUSDC:      $WAUSDC"
echo "  wRLP:        $POSITION_TOKEN"
echo "  TWAMM Hook:  $TWAMM_HOOK"
echo "  Market ID:   $MARKET_ID"
echo "  User C:      $USER_C_ADDRESS"
echo "  Mode:        $([ "$LEVERAGE_LOOPS" -gt 1 ] && echo "LEVERAGE LOOP ($LEVERAGE_LOOPS x)" || echo "SINGLE CYCLE")"
echo ""

# Fund User C with waUSDC
WAUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_C_ADDRESS" | awk '{print $1}')

if [ "$WAUSDC_BAL" -lt "10000000000" ]; then
    echo -e "${YELLOW}Funding User C with waUSDC...${NC}"
    
    USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"
    AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
    AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
    FUND_AMOUNT="50000000000"  # 50k
    
    # Fund whale with ETH
    cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    cast send --rpc-url "$RPC_URL" --unlocked --from "$USDC_WHALE" "$USDC" \
        "transfer(address,uint256)" "$USER_C_ADDRESS" "$FUND_AMOUNT" --gas-limit 100000 > /dev/null
    
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    
    # Fund User C with ETH for gas
    cast rpc anvil_setBalance "$USER_C_ADDRESS" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    
    # Deposit to Aave
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$USDC" \
        "approve(address,uint256)" "$AAVE_POOL" "$FUND_AMOUNT" --gas-limit 100000 > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$AAVE_POOL" \
        "supply(address,uint256,address,uint16)" "$USDC" "$FUND_AMOUNT" "$USER_C_ADDRESS" "0" --gas-limit 500000 > /dev/null
    
    # Wrap aUSDC
    AUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$AUSDC" 'balanceOf(address)(uint256)' "$USER_C_ADDRESS" | awk '{print $1}')
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$AUSDC" \
        "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" --gas-limit 100000 > /dev/null
    
    cast send --rpc-url "$RPC_URL" --private-key "$USER_C_PRIVATE_KEY" "$WAUSDC" \
        "wrap(uint256)" "$AUSDC_BAL" --gas-limit 200000 > /dev/null
    
    WAUSDC_BAL=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_C_ADDRESS" | awk '{print $1}')
    echo -e "${GREEN}✓ Funded with $(python3 -c "print($WAUSDC_BAL // 1000000)") waUSDC${NC}"
fi

echo ""
echo -e "${YELLOW}Priming TWAMM oracle...${NC}"
cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
cast rpc evm_mine --rpc-url "$RPC_URL" > /dev/null
echo -e "${GREEN}✓ Advanced time by 2 hours${NC}"

echo ""
echo -e "${YELLOW}Executing short position...${NC}"
echo ""

# Export env vars
export WAUSDC
export POSITION_TOKEN
export TWAMM_HOOK
export MARKET_ID
export BROKER_FACTORY
export USER_C_PRIVATE_KEY
export LEVERAGE_LOOPS

RESULT=$(forge script script/GoShortWRLP.s.sol --tc GoShortWRLP \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)

if echo "$RESULT" | grep -q "SHORT POSITION ACTIVE"; then
    echo -e "${GREEN}✓ Short position opened!${NC}"
    echo ""
    echo "$RESULT" | grep -A 30 "SHORT POSITION REPORT" | head -35
else
    echo -e "${RED}✗ Short position failed${NC}"
    echo "$RESULT" | tail -50
    exit 1
fi
