#!/bin/bash
# Phase 3: Deploy Periphery (SwapRouter, BondFactory, BrokerExecutor, BasisTradeFactory)
# Variables set: SWAP_ROUTER, BOND_FACTORY, BROKER_EXECUTOR, BASIS_TRADE_FACTORY

log_phase "3" "DEPLOY PERIPHERY"

# ─── SwapRouter ───────────────────────────────────────────────
cd /workspace/contracts
ROUTER_OUTPUT=$(forge script script/DeploySwapRouter.s.sol --tc DeploySwapRouter \
    --rpc-url "$RPC_URL" --broadcast --code-size-limit 99999 -v 2>&1) || true

SWAP_ROUTER=$(echo "$ROUTER_OUTPUT" | grep "SWAP_ROUTER:" | awk -F: '{print $NF}' | tr -d ' ')
if [ -z "$SWAP_ROUTER" ]; then
    log_info "SwapRouter deploy skipped (non-critical)"
    SWAP_ROUTER=""
else
    log_ok "SwapRouter: $SWAP_ROUTER"
fi

# ─── Approve tokens for MM and Chaos ──────────────────────────
if [ -n "$SWAP_ROUTER" ]; then
    python3 -c "
from web3 import Web3
from eth_account import Account
import os

w3 = Web3(Web3.HTTPProvider(os.environ['RPC_URL']))
ERC20_ABI = [
    {'inputs': [{'name': 'spender', 'type': 'address'}, {'name': 'amount', 'type': 'uint256'}],
     'name': 'approve', 'outputs': [{'name': '', 'type': 'bool'}],
     'stateMutability': 'nonpayable', 'type': 'function'},
]
MAX_UINT = 2**256 - 1
pm = '$POOL_MANAGER'
router = '$SWAP_ROUTER'
wausdc = '$WAUSDC'
pos_token = '$POSITION_TOKEN'

for name, key_env in [('MM', 'MM_KEY'), ('Chaos', 'CHAOS_KEY')]:
    key = os.environ.get(key_env)
    if not key: continue
    acct = Account.from_key(key)
    for token_addr, tname in [(wausdc, 'waUSDC'), (pos_token, 'wRLP')]:
        token = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI)
        for spender, sname in [(router, 'Router'), (pm, 'PoolManager')]:
            nonce = w3.eth.get_transaction_count(acct.address)
            tx = token.functions.approve(Web3.to_checksum_address(spender), MAX_UINT).build_transaction({
                'from': acct.address, 'nonce': nonce, 'gas': 60000,
                'maxFeePerGas': w3.to_wei('2', 'gwei'), 'maxPriorityFeePerGas': w3.to_wei('1', 'gwei'),
            })
            signed = w3.eth.account.sign_transaction(tx, key)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
            print(f'  ✅ {name} approved {tname} for {sname}')
"
fi

# ─── BondFactory ──────────────────────────────────────────────
cd /workspace/contracts
log_step "3.2" "Deploying BondFactory..."
BOND_FACTORY=$(forge create src/periphery/BondFactory.sol:BondFactory \
    --private-key $DEPLOYER_KEY \
    --rpc-url $RPC_URL \
    --broadcast \
    --constructor-args \
        $BROKER_FACTORY_ADDR \
        $BROKER_ROUTER \
        $TWAMM_HOOK \
        $WAUSDC \
        $POOL_MANAGER \
        $V4_QUOTER \
    2>&1 | grep "Deployed to:" | awk '{print $3}')

if [ -n "$BOND_FACTORY" ]; then
    log_ok "BondFactory: $BOND_FACTORY"
else
    log_info "BondFactory deploy failed (non-critical)"
    BOND_FACTORY=""
fi

# ─── BrokerExecutor ───────────────────────────────────────────
log_step "3.3" "Deploying BrokerExecutor..."
BROKER_EXECUTOR=$(forge create src/periphery/BrokerExecutor.sol:BrokerExecutor \
    --private-key $DEPLOYER_KEY \
    --rpc-url $RPC_URL \
    --broadcast \
    2>&1 | grep "Deployed to:" | awk '{print $3}')

if [ -n "$BROKER_EXECUTOR" ]; then
    log_ok "BrokerExecutor: $BROKER_EXECUTOR"
else
    log_info "BrokerExecutor deploy failed (non-critical)"
    BROKER_EXECUTOR=""
fi

# ─── BasisTradeFactory ────────────────────────────────────────
log_step "3.4" "Deploying BasisTradeFactory..."
BASIS_TRADE_FACTORY=$(forge create src/periphery/BasisTradeFactory.sol:BasisTradeFactory \
    --private-key $DEPLOYER_KEY \
    --rpc-url $RPC_URL \
    --broadcast \
    --constructor-args \
        $BROKER_FACTORY_ADDR \
        $TWAMM_HOOK \
        $WAUSDC \
        $POOL_MANAGER \
        $MORPHO \
        $SUSDE \
        $USDE \
        $USDC \
        $PYUSD \
        $CURVE_USDE_USDC_POOL \
        $CURVE_PYUSD_USDC_POOL \
        0 \
        1 \
        0 \
        1 \
        $MORPHO_ORACLE \
        $MORPHO_IRM \
        $MORPHO_LLTV \
    2>&1 | grep "Deployed to:" | awk '{print $3}')

if [ -n "$BASIS_TRADE_FACTORY" ]; then
    log_ok "BasisTradeFactory: $BASIS_TRADE_FACTORY"
else
    log_info "BasisTradeFactory deploy failed (non-critical)"
    BASIS_TRADE_FACTORY=""
fi
