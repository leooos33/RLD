#!/bin/bash
#
# RLD Protocol - Mint wRLP and Provide V4 LP via BrokerExecutor
#
# Uses signature-based operator authorization for atomic execution:
# 1. Deploy BrokerExecutor
# 2. Create broker, deposit collateral, mint wRLP
# 3. Sign authorization message
# 4. Execute via BrokerExecutor: withdraw + LP + register (atomic)
#
# Usage: ./scripts/mint_and_lp_executor.sh

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

# Will be set by deployment
WAUSDC=""
WRAPPED_MARKET_ID=""
WRAPPED_BROKER_FACTORY=""
WRAPPED_POSITION_TOKEN=""
TWAMM_HOOK="0x7e0C07EEabb2459D70dba5b8d100Dca44c652aC0"

parse_cast_output() {
    echo "$1" | awk '{print $1}'
}

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   RLD Protocol - Mint & LP via BrokerExecutor (Signature)      ║${NC}"
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

# =============================================================================
# Step 1: Deploy waUSDC market (if not exists)
# =============================================================================
echo -e "\n${CYAN}[1/8] Deploying waUSDC market...${NC}"

DEPLOY_OUTPUT=$(forge script script/DeployWrappedMarket.s.sol --rpc-url "$RPC_URL" --broadcast -v 2>&1)

WAUSDC=$(echo "$DEPLOY_OUTPUT" | grep "WAUSDC_ADDRESS=" | cut -d'=' -f2)
WRAPPED_MARKET_ID=$(echo "$DEPLOY_OUTPUT" | grep "WRAPPED_MARKET_ID=" | cut -d'=' -f2)
WRAPPED_BROKER_FACTORY=$(echo "$DEPLOY_OUTPUT" | grep "WRAPPED_BROKER_FACTORY=" | cut -d'=' -f2)
WRAPPED_POSITION_TOKEN=$(echo "$DEPLOY_OUTPUT" | grep "WRAPPED_POSITION_TOKEN=" | cut -d'=' -f2)

echo -e "${GREEN}✓ waUSDC: $WAUSDC${NC}"
echo -e "${GREEN}✓ MarketId: $WRAPPED_MARKET_ID${NC}"

# =============================================================================
# Step 2: Deploy BrokerExecutor
# =============================================================================
echo -e "\n${CYAN}[2/8] Deploying BrokerExecutor...${NC}"

EXECUTOR_DEPLOY=$(forge script script/DeployBrokerExecutor.s.sol --rpc-url "$RPC_URL" --broadcast 2>&1)

EXECUTOR=$(echo "$EXECUTOR_DEPLOY" | grep "EXECUTOR_ADDRESS=" | cut -d'=' -f2)

if [ -z "$EXECUTOR" ]; then
    echo -e "${RED}✗ Failed to deploy BrokerExecutor${NC}"
    echo "$EXECUTOR_DEPLOY" | tail -20
    exit 1
fi

echo -e "${GREEN}✓ BrokerExecutor: $EXECUTOR${NC}"

# =============================================================================
# Step 3: Acquire aUSDC from whale
# =============================================================================
echo -e "\n${CYAN}[3/8] Acquiring aUSDC from whale...${NC}"

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
# Step 4: Wrap aUSDC → waUSDC
# =============================================================================
echo -e "\n${CYAN}[4/8] Wrapping aUSDC → waUSDC...${NC}"

cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BALANCE" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BALANCE" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

WAUSDC_BALANCE=$(parse_cast_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL")")
echo -e "${GREEN}✓ Deployer waUSDC: $((WAUSDC_BALANCE / 1000000)) (shares)${NC}"

# =============================================================================
# Step 5: Advance time for TWAMM
# =============================================================================
echo -e "\n${CYAN}[5/8] Priming TWAMM oracle...${NC}"
cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
cast rpc evm_mine --rpc-url "$RPC_URL" > /dev/null
echo -e "${GREEN}✓ Advanced time by 2 hours${NC}"

# =============================================================================
# Step 6: Create PrimeBroker
# =============================================================================
echo -e "\n${CYAN}[6/8] Creating PrimeBroker...${NC}"

SALT=$(cast keccak "executor-test-$(date +%s)")
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
# Step 7: Fund broker and mint wRLP
# =============================================================================
echo -e "\n${CYAN}[7/8] Funding broker and minting wRLP...${NC}"

# Transfer waUSDC to broker
cast send "$WAUSDC" "transfer(address,uint256)" "$BROKER" "$WAUSDC_BALANCE" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

BROKER_WAUSDC=$(parse_cast_output "$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$BROKER" --rpc-url "$RPC_URL")")
echo -e "  Broker waUSDC: $((BROKER_WAUSDC / 1000000))"

# Mint wRLP
cast send "$BROKER" "modifyPosition(bytes32,int256,int256)" \
    "$WRAPPED_MARKET_ID" 0 "$DEBT_WEI" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --quiet > /dev/null

BROKER_WRLP=$(parse_cast_output "$(cast call "$WRAPPED_POSITION_TOKEN" "balanceOf(address)(uint256)" "$BROKER" --rpc-url "$RPC_URL")")
echo -e "  Broker wRLP: $((BROKER_WRLP / 1000000))"
echo -e "${GREEN}✓ Broker funded with $((BROKER_WAUSDC / 1000000)) waUSDC and $((BROKER_WRLP / 1000000)) wRLP${NC}"

# =============================================================================
# Step 8: Execute via BrokerExecutor (signature + atomic)
# =============================================================================
echo -e "\n${CYAN}[8/8] Executing via BrokerExecutor...${NC}"

export BROKER="$BROKER"
export WAUSDC="$WAUSDC"
export POSITION_TOKEN="$WRAPPED_POSITION_TOKEN"
export TWAMM_HOOK="$TWAMM_HOOK"
export EXECUTOR="$EXECUTOR"
export WRLP_AMOUNT="$LP_WEI"
export AUSDC_AMOUNT="$LP_WEI"

# Persist to .env for other scripts
echo "" >> .env
echo "# Wrapped market variables (added by mint_and_lp_executor.sh)" >> .env
echo "WAUSDC=$WAUSDC" >> .env
echo "POSITION_TOKEN=$WRAPPED_POSITION_TOKEN" >> .env
echo "TWAMM_HOOK=$TWAMM_HOOK" >> .env
echo "MARKET_ID=$WRAPPED_MARKET_ID" >> .env
echo "BROKER_FACTORY=$WRAPPED_BROKER_FACTORY" >> .env

echo "  Broker:       $BROKER"
echo "  Executor:     $EXECUTOR"
echo "  waUSDC:       $WAUSDC"
echo "  wRLP:         $WRAPPED_POSITION_TOKEN"
echo "  LP Amount:    $((LP_WEI / 1000000)) each"
echo ""

RESULT=$(forge script script/TestBrokerExecutorLP.s.sol \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)

if echo "$RESULT" | grep -q "SUCCESS"; then
    echo -e "${GREEN}✓ Full LP via BrokerExecutor passed!${NC}"
    echo ""
    echo "$RESULT" | grep -A 10 "=== VERIFICATION ==="
else
    echo -e "${RED}✗ Full LP test failed${NC}"
    echo "$RESULT" | tail -60
    exit 1
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              BrokerExecutor Test Summary                       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Broker:${NC}           $BROKER"
echo -e "  ${GREEN}Executor:${NC}         $EXECUTOR"
echo ""
echo -e "  ${CYAN}Flow Verified:${NC}"
echo -e "  ✓ Signature-based operator authorization"
echo -e "  ✓ Atomic multi-call execution"
echo -e "  ✓ Auto-revoke operator at end"
echo ""
echo -e "${GREEN}✓ BrokerExecutor implementation complete!${NC}"
echo ""
