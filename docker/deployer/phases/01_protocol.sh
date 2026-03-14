#!/bin/bash
# Phase 1: Deploy Protocol (RLDCore, TWAMM, Oracle, BrokerRouter)
# Variables set: TWAMM_HOOK, FACTORY, RLD_CORE, BROKER_ROUTER, MOCK_ORACLE, BROKER_FACTORY_ADDR

log_phase "1" "DEPLOY PROTOCOL"

cd /workspace/contracts

log_step "1.1" "Deploying RLD Protocol..."
DEPLOY_OUTPUT=$(forge script script/DeployRLDProtocol.s.sol --tc DeployRLDProtocol \
    --rpc-url "$RPC_URL" --broadcast --code-size-limit 99999 -v 2>&1) || true

if ! echo "$DEPLOY_OUTPUT" | grep -q "DEPLOYMENT COMPLETE"; then
    echo "$DEPLOY_OUTPUT"
    log_err "Protocol deployment failed"
fi

TWAMM_HOOK=$(jq -r '.TWAMM' deployments.json)
FACTORY=$(jq -r '.RLDMarketFactory' deployments.json)
RLD_CORE=$(jq -r '.RLDCore' deployments.json)
BROKER_ROUTER=$(jq -r '.BrokerRouter' deployments.json)
BROKER_FACTORY_ADDR=""  # Comes from market deploy

log_ok "Protocol deployed"
echo "  RLDCore:       $RLD_CORE"
echo "  TWAMM Hook:    $TWAMM_HOOK"
echo "  Factory:       $FACTORY"
echo "  BrokerRouter:  $BROKER_ROUTER"

# ─── MockRLDAaveOracle (for simulation) ───────────────────────
log_step "1.2" "Deploying MockRLDAaveOracle..."
MOCK_ORACLE_OUTPUT=$(forge create test/mocks/MockRLDAaveOracle.sol:MockRLDAaveOracle \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --broadcast 2>&1) || true
MOCK_ORACLE=$(echo "$MOCK_ORACLE_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
if [ -z "$MOCK_ORACLE" ]; then
    echo "$MOCK_ORACLE_OUTPUT"
    log_err "MockRLDAaveOracle deployment failed"
fi
log_ok "MockRLDAaveOracle: $MOCK_ORACLE (admin-settable rate for simulation)"
