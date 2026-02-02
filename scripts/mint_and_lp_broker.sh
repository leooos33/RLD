#!/bin/bash
#
# RLD Protocol - Mint wRLP and Provide V4 LP via PrimeBroker
#
# This script uses executeWithApproval + multicall to add LP directly from the broker.
# LP NFT stays in broker and is tracked for NAV calculation.
#
# Flow:
# 1. Acquire USDC from whale → deposit to Aave → get aUSDC
# 2. Wrap aUSDC → get waUSDC
# 3. Create broker, deposit waUSDC, mint wRLP debt
# 4. Keep tokens in broker (no withdrawal!)
# 5. Use multicall to: approve Permit2 + add V4 LP
# 6. Track LP NFT for NAV via setActiveV4Position()
#
# Usage: ./scripts/mint_and_lp_broker.sh

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
RPC_URL="http://localhost:8545"

# Amounts (6 decimals)
COLLATERAL_AMOUNT=10000000   # 10M waUSDC
DEBT_AMOUNT=500000           # 500k wRLP
LP_AMOUNT=100000             # 100k of each for LP

# Convert to wei
COLLATERAL_WEI=$(echo "$COLLATERAL_AMOUNT * 1000000" | bc)
DEBT_WEI=$(echo "$DEBT_AMOUNT * 1000000" | bc)
LP_WEI=$(echo "$LP_AMOUNT * 1000000" | bc)

# Mainnet addresses
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
AUSDC="0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c"
AAVE_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
USDC_WHALE="0xCFFAd3200574698b78f32232aa9D63eABD290703"
V4_POSITION_MANAGER="0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"
PERMIT2="0x000000000022D473030F116dDEE9F6B43aC78BA3"

# Wrapped market addresses (from deployment)
WAUSDC="0xD1620Dac6d79BE34F8500756B47cf91B1fA5Cc8C"
WRAPPED_MARKET_ID="0x5b171c28fb0eebf8c4f6bebf3f5a0f12611acb1d4a0734c51fbae996b6e9dfdf"
WRAPPED_BROKER_FACTORY="0x9554b52516f306360a239746F70f88c23D187b63"
WRAPPED_POSITION_TOKEN="0x9ed4F4724b521326a9d9d2420252440bD05556c4"
TWAMM_HOOK="0x7e0C07EEabb2459D70dba5b8d100Dca44c652aC0"

parse_cast_output() {
    echo "$1" | awk '{print $1}'
}

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   RLD Protocol - Mint & LP via PrimeBroker (executeWithApproval)║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Collateral:  ${YELLOW}$COLLATERAL_AMOUNT${NC} waUSDC"
echo -e "  Debt:        ${YELLOW}$DEBT_AMOUNT${NC} wRLP"
echo -e "  LP Amount:   ${YELLOW}$LP_AMOUNT${NC} each token"
echo ""

# Load environment
cd "$CONTRACTS_DIR"
source .env

if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}✗ Error: PRIVATE_KEY not set${NC}"
    exit 1
fi

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null)
echo -e "  Deployer: ${CYAN}$DEPLOYER${NC}"
echo -e "  waUSDC:   ${CYAN}$WAUSDC${NC}"
echo -e "  MarketId: ${CYAN}$WRAPPED_MARKET_ID${NC}"

# =============================================================================
# Step 1: Acquire aUSDC from whale
# =============================================================================
echo -e "\n${CYAN}[1/8] Acquiring aUSDC from whale...${NC}"

WHALE_BALANCE_RAW=$(cast call "$USDC" "balanceOf(address)(uint256)" "$USDC_WHALE" --rpc-url "$RPC_URL")
WHALE_BALANCE=$(parse_cast_output "$WHALE_BALANCE_RAW")
echo "  Whale USDC: $((WHALE_BALANCE / 1000000))"

cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

cast send "$USDC" "approve(address,uint256)" "$AAVE_POOL" "$COLLATERAL_WEI" \
    --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" --quiet > /dev/null

cast send "$AAVE_POOL" "supply(address,uint256,address,uint16)" \
    "$USDC" "$COLLATERAL_WEI" "$DEPLOYER" 0 \
    --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" --quiet > /dev/null

cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

AUSDC_BALANCE=$(parse_cast_output "$(cast call "$AUSDC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL")")
echo -e "${GREEN}✓ Deployer aUSDC: $((AUSDC_BALANCE / 1000000))${NC}"

# =============================================================================
# Step 2: Wrap aUSDC → waUSDC
# =============================================================================
echo -e "\n${CYAN}[2/8] Wrapping aUSDC → waUSDC...${NC}"

cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BALANCE" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BALANCE" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

WAUSDC_BALANCE=$(parse_cast_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL")")
echo -e "${GREEN}✓ Deployer waUSDC: $((WAUSDC_BALANCE / 1000000)) (shares)${NC}"

# =============================================================================
# Step 3: Advance time for TWAMM
# =============================================================================
echo -e "\n${CYAN}[3/8] Priming TWAMM oracle...${NC}"
cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
cast rpc evm_mine --rpc-url "$RPC_URL" > /dev/null
echo -e "${GREEN}✓ Advanced time by 2 hours${NC}"

# =============================================================================
# Step 4: Create PrimeBroker
# =============================================================================
echo -e "\n${CYAN}[4/8] Creating PrimeBroker...${NC}"

SALT=$(cast keccak "wrapped-broker-lp-$(date +%s)")
BROKER_TX=$(cast send "$WRAPPED_BROKER_FACTORY" "createBroker(bytes32)" "$SALT" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --json)

BROKER=$(echo "$BROKER_TX" | python3 -c "
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

echo -e "${GREEN}✓ Broker: $BROKER${NC}"

# =============================================================================
# Step 5: Transfer waUSDC collateral to broker
# =============================================================================
echo -e "\n${CYAN}[5/8] Transferring waUSDC to broker...${NC}"

cast send "$WAUSDC" "transfer(address,uint256)" "$BROKER" "$WAUSDC_BALANCE" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

BROKER_WAUSDC=$(parse_cast_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$BROKER" --rpc-url "$RPC_URL")")
echo -e "${GREEN}✓ Broker waUSDC: $((BROKER_WAUSDC / 1000000))${NC}"

# =============================================================================
# Step 6: Mint wRLP debt
# =============================================================================
echo -e "\n${CYAN}[6/8] Minting $DEBT_AMOUNT wRLP debt...${NC}"

cast send "$BROKER" "modifyPosition(bytes32,int256,int256)" \
    "$WRAPPED_MARKET_ID" 0 "$DEBT_WEI" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

BROKER_WRLP=$(parse_cast_output "$(cast call "$WRAPPED_POSITION_TOKEN" "balanceOf(address)(uint256)" "$BROKER" --rpc-url "$RPC_URL")")
echo -e "${GREEN}✓ Broker wRLP: $((BROKER_WRLP / 1000000))${NC}"

# =============================================================================
# Step 7: Add LP via Forge script (handles all approvals via executeWithApproval)
# =============================================================================
echo -e "\n${CYAN}[7/7] Adding concentrated liquidity via Forge script...${NC}"

export BROKER="$BROKER"
export WAUSDC="$WAUSDC"
export POSITION_TOKEN="$WRAPPED_POSITION_TOKEN"
export TWAMM_HOOK="$TWAMM_HOOK"
export WRLP_AMOUNT="$LP_WEI"
export AUSDC_AMOUNT="$LP_WEI"

echo "  Broker:       $BROKER"
echo "  waUSDC:       $WAUSDC"
echo "  wRLP:         $WRAPPED_POSITION_TOKEN"
echo "  LP Amount:    $((LP_WEI / 1000000)) each"
echo ""

LP_RESULT=$(forge script script/AddLiquidityFromBroker.s.sol \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)

if echo "$LP_RESULT" | grep -q "LP CREATED IN BROKER"; then
    TOKEN_ID=$(echo "$LP_RESULT" | grep "Token ID:" | tail -1 | awk '{print $NF}')
    echo -e "${GREEN}✓ V4 LP Created in Broker!${NC}"
    echo -e "  Token ID: ${YELLOW}$TOKEN_ID${NC}"
else
    echo -e "${RED}✗ LP provision failed${NC}"
    echo "$LP_RESULT" | tail -50
    exit 1
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              Broker-Based V4 LP Summary                        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Broker:${NC}         $BROKER"
echo -e "  ${GREEN}LP Token ID:${NC}    $TOKEN_ID"
echo ""
echo -e "  ${CYAN}Key Features:${NC}"
echo -e "  ✓ LP NFT owned by broker (not deployer)"
echo -e "  ✓ Position tracked for NAV calculation"
echo -e "  ✓ Tokens never left the broker"
echo ""
echo -e "${GREEN}✓ Broker-based V4 LP complete!${NC}"
echo ""
