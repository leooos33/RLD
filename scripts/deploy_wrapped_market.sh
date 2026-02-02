#!/bin/bash
#
# RLD Protocol - Deploy Wrapped Market and Save Addresses
#
# This script:
# 1. Deploys the waUSDC wrapper and creates a new wrapped market
# 2. Captures all addresses from the deployment
# 3. Saves them to wrapped_market.json for use by other scripts
# 4. Primes the TWAMM oracle
#
# Usage: ./scripts/deploy_wrapped_market.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Paths
RLD_ROOT="/home/ubuntu/RLD"
CONTRACTS_DIR="$RLD_ROOT/contracts"
MARKET_JSON="$CONTRACTS_DIR/wrapped_market.json"
RPC_URL="${RPC_URL:-http://localhost:8545}"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      RLD Protocol - Deploy Wrapped Market (waUSDC)         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Load environment
cd "$CONTRACTS_DIR"
source .env

if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}✗ Error: PRIVATE_KEY not set in .env${NC}"
    exit 1
fi

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null)
echo -e "Deployer: ${CYAN}$DEPLOYER${NC}"
echo -e "RPC URL:  ${CYAN}$RPC_URL${NC}"
echo ""

# =============================================================================
# STEP 1: Run DeployWrappedMarket.s.sol and capture output
# =============================================================================
echo -e "${YELLOW}[1/3] Deploying wrapped market...${NC}"

# Run the deployment and capture output
DEPLOY_OUTPUT=$(forge script script/DeployWrappedMarket.s.sol \
    --rpc-url $RPC_URL \
    --broadcast \
    -v 2>&1)

# Check if deployment succeeded
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Deployment failed${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo -e "${GREEN}✓ Deployment completed${NC}"

# =============================================================================
# STEP 2: Parse addresses from output
# =============================================================================
echo -e "${YELLOW}[2/3] Parsing deployment addresses...${NC}"

# Extract addresses using grep and awk
WAUSDC=$(echo "$DEPLOY_OUTPUT" | grep "WAUSDC_ADDRESS=" | sed 's/.*WAUSDC_ADDRESS=//' | tr -d '[:space:]')
MARKET_ID=$(echo "$DEPLOY_OUTPUT" | grep "WRAPPED_MARKET_ID=" | sed 's/.*WRAPPED_MARKET_ID=//' | tr -d '[:space:]')
BROKER_FACTORY=$(echo "$DEPLOY_OUTPUT" | grep "WRAPPED_BROKER_FACTORY=" | sed 's/.*WRAPPED_BROKER_FACTORY=//' | tr -d '[:space:]')
POSITION_TOKEN=$(echo "$DEPLOY_OUTPUT" | grep "WRAPPED_POSITION_TOKEN=" | sed 's/.*WRAPPED_POSITION_TOKEN=//' | tr -d '[:space:]')

# Validate we got all addresses
if [ -z "$WAUSDC" ] || [ -z "$MARKET_ID" ] || [ -z "$BROKER_FACTORY" ] || [ -z "$POSITION_TOKEN" ]; then
    echo -e "${RED}✗ Failed to parse all addresses from deployment output${NC}"
    echo "WAUSDC: $WAUSDC"
    echo "MARKET_ID: $MARKET_ID"  
    echo "BROKER_FACTORY: $BROKER_FACTORY"
    echo "POSITION_TOKEN: $POSITION_TOKEN"
    exit 1
fi

echo -e "  waUSDC:        ${GREEN}$WAUSDC${NC}"
echo -e "  positionToken: ${GREEN}$POSITION_TOKEN${NC}"
echo -e "  brokerFactory: ${GREEN}$BROKER_FACTORY${NC}"
echo -e "  marketId:      ${GREEN}$MARKET_ID${NC}"

# =============================================================================
# STEP 3: Write to wrapped_market.json
# =============================================================================
echo -e "${YELLOW}[3/3] Writing to wrapped_market.json...${NC}"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$MARKET_JSON" << EOF
{
  "waUSDC": "$WAUSDC",
  "positionToken": "$POSITION_TOKEN",
  "brokerFactory": "$BROKER_FACTORY",
  "marketId": "$MARKET_ID",
  "deployedAt": "$TIMESTAMP",
  "network": "mainnet-fork"
}
EOF

echo -e "${GREEN}✓ Saved to $MARKET_JSON${NC}"

# =============================================================================
# STEP 4: Prime TWAMM oracle (advance time)
# =============================================================================
echo ""
echo -e "${YELLOW}Priming TWAMM oracle...${NC}"
cast rpc anvil_mine 1 --rpc-url $RPC_URL > /dev/null
cast rpc evm_increaseTime 7200 --rpc-url $RPC_URL > /dev/null
cast rpc anvil_mine 1 --rpc-url $RPC_URL > /dev/null
echo -e "${GREEN}✓ Advanced time by 2 hours${NC}"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            WRAPPED MARKET DEPLOYED SUCCESSFULLY            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Addresses saved to: ${CYAN}$MARKET_JSON${NC}"
echo ""
echo "Other scripts can now read from this file using:"
echo '  WAUSDC=$(jq -r ".waUSDC" contracts/wrapped_market.json)'
echo ""
