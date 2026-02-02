#!/bin/bash
# Go Long wRLP - Buy wRLP from V4 Pool
# Uses a different user (User B) to swap waUSDC → wRLP

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "╔════════════════════════════════════════════════════════════════╗"
echo -e "║               RLD Protocol - Go Long wRLP                      ║"
echo -e "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Navigate to contracts
cd "$(dirname "$0")/../contracts"

# Load environment
source .env

RPC_URL="http://localhost:8545"

# Anvil pre-funded accounts
# Account 0: Deployer (already used for LP)
# Account 1: User B (for swap)
USER_B_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
USER_B_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

# Paths
MARKET_JSON="./wrapped_market.json"
DEPLOYMENTS_JSON="./deployments.json"

# Load addresses from wrapped_market.json
if [ -f "$MARKET_JSON" ]; then
    echo -e "${GREEN}Loading addresses from wrapped_market.json...${NC}"
    WAUSDC=$(jq -r '.waUSDC' "$MARKET_JSON")
    POSITION_TOKEN=$(jq -r '.positionToken' "$MARKET_JSON")
else
    echo -e "${RED}Error: wrapped_market.json not found${NC}"
    echo -e "${YELLOW}  Run ./scripts/deploy_wrapped_market.sh first${NC}"
    exit 1
fi

# Load TWAMM hook from deployments.json
TWAMM_HOOK=$(jq -r '.TWAMM' "$DEPLOYMENTS_JSON")

echo "  waUSDC:         $WAUSDC"
echo "  wRLP:           $POSITION_TOKEN"
echo "  TWAMM Hook:     $TWAMM_HOOK"
echo "  User B:         $USER_B_ADDRESS"
echo ""

# Config - Note: pool has limited liquidity, keep swap size reasonable
SWAP_AMOUNT=${SWAP_AMOUNT:-1000000000}  # 1,000 waUSDC (6 decimals)
AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
AUSDC_WHALE="0x4aef720f7bbe98f916221bbc089a2a9b619e5d99"

echo -e "${YELLOW}[1/4] Minting aUSDC to User B via Anvil...${NC}"

# Mint aUSDC directly to User B using Anvil's deal cheat
# We need to set the balance using storage slot manipulation
# For ERC20s, use the balanceOf slot at mapping(address => uint256)
# Simpler: just use cast rpc anvil_setStorageAt to set balance

# Get storage slot for user B's balance in aUSDC
# For standard ERC20, balanceOf is typically slot 0 or use the known slot
# aUSDC uses upgradeable proxy pattern, balance slot = keccak256(abi.encode(address, slot))

# Alternative: Supply USDC to Aave to get aUSDC
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
USDC_WHALE="0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"  # Circle USDC holder
AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"

# Fund USDC whale with ETH and impersonate
cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

# Transfer USDC to User B
cast send --rpc-url "$RPC_URL" \
    --unlocked \
    --from "$USDC_WHALE" \
    "$USDC" \
    "transfer(address,uint256)" \
    "$USER_B_ADDRESS" \
    "$SWAP_AMOUNT" \
    --gas-limit 100000 > /dev/null

cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

echo "  User B USDC: $(cast call --rpc-url "$RPC_URL" "$USDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}' | xargs -I {} python3 -c "print({} // 1000000)")"

# User B: Approve and deposit to Aave to get aUSDC
cast send --rpc-url "$RPC_URL" \
    --private-key "$USER_B_PRIVATE_KEY" \
    "$USDC" \
    "approve(address,uint256)" \
    "$AAVE_POOL" \
    "$SWAP_AMOUNT" \
    --gas-limit 100000 > /dev/null

cast send --rpc-url "$RPC_URL" \
    --private-key "$USER_B_PRIVATE_KEY" \
    "$AAVE_POOL" \
    "supply(address,uint256,address,uint16)" \
    "$USDC" \
    "$SWAP_AMOUNT" \
    "$USER_B_ADDRESS" \
    "0" \
    --gas-limit 500000 > /dev/null

AUSDC_BALANCE=$(cast call --rpc-url "$RPC_URL" "$AUSDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')
echo -e "${GREEN}✓ User B aUSDC: $(python3 -c "print($AUSDC_BALANCE // 1000000)")${NC}"

echo -e "${YELLOW}[2/4] Wrapping aUSDC → waUSDC for User B...${NC}"

# Approve waUSDC to spend aUSDC
cast send --rpc-url "$RPC_URL" \
    --private-key "$USER_B_PRIVATE_KEY" \
    "$AUSDC" \
    "approve(address,uint256)" \
    "$WAUSDC" \
    "$AUSDC_BALANCE" \
    --gas-limit 100000 > /dev/null

# Wrap aUSDC -> waUSDC (uses wrap(), not deposit())
cast send --rpc-url "$RPC_URL" \
    --private-key "$USER_B_PRIVATE_KEY" \
    "$WAUSDC" \
    "wrap(uint256)" \
    "$AUSDC_BALANCE" \
    --gas-limit 200000 > /dev/null

WAUSDC_BALANCE=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')
echo -e "${GREEN}✓ User B waUSDC: $(python3 -c "print($WAUSDC_BALANCE // 1000000)")${NC}"

echo -e "${YELLOW}[3/4] Checking wRLP balance before swap...${NC}"
WRLP_BEFORE=$(cast call --rpc-url "$RPC_URL" "$POSITION_TOKEN" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS" | awk '{print $1}')
echo "  User B wRLP before: $(python3 -c "print($WRLP_BEFORE // 1000000)")"

echo -e "${YELLOW}[4/4] Executing swap via V4 pool...${NC}"

export WAUSDC
export POSITION_TOKEN
export TWAMM_HOOK
export SWAP_AMOUNT  # Use configured amount, not full balance
export USER_B_PRIVATE_KEY

RESULT=$(forge script script/GoLongWRLP.s.sol --tc GoLongWRLP \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)

if echo "$RESULT" | grep -q "SUCCESS"; then
    echo -e "${GREEN}✓ Swap successful!${NC}"
    echo ""
    echo "$RESULT" | grep -A 10 "=== SUMMARY ==="
else
    echo -e "${RED}✗ Swap failed${NC}"
    echo "$RESULT" | tail -40
    exit 1
fi

# Final verification
WRLP_AFTER=$(cast call --rpc-url "$RPC_URL" "$POSITION_TOKEN" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS")
WAUSDC_AFTER=$(cast call --rpc-url "$RPC_URL" "$WAUSDC" 'balanceOf(address)(uint256)' "$USER_B_ADDRESS")

echo ""
echo -e "╔════════════════════════════════════════════════════════════════╗"
echo -e "║                    Go Long Summary                             ║"
echo -e "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "  User B:          $USER_B_ADDRESS"
echo "  waUSDC spent:    $(python3 -c "print(($WAUSDC_BALANCE - $WAUSDC_AFTER) // 1000000)")"
echo "  wRLP received:   $(python3 -c "print(($WRLP_AFTER - $WRLP_BEFORE) // 1000000)")"
echo ""
echo -e "${GREEN}✓ User B is now LONG wRLP!${NC}"
