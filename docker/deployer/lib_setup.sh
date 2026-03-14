#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# lib_setup.sh
# Helper functions for orchestrating brokers and users over RPC.
# Required environment vars: RPC_URL, USDC, AUSDC, WAUSDC, AAVE_POOL,
#                            BROKER_FACTORY_ADDR, POSITION_TOKEN, MARKET_ID
# ═══════════════════════════════════════════════════════════════

fund_user() {
    local ADDR=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))

    # Set ETH balance
    cast rpc anvil_setBalance "$USDC_WHALE" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_setBalance "$ADDR" "0x56BC75E2D63100000" --rpc-url "$RPC_URL" > /dev/null

    # Transfer USDC from whale
    cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null
    cast send "$USDC" "transfer(address,uint256)" "$ADDR" "$AMOUNT_WEI" \
        --from "$USDC_WHALE" --unlocked --rpc-url "$RPC_URL" > /dev/null
    sleep 1
    cast rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$RPC_URL" > /dev/null

    # Supply to Aave
    cast send "$USDC" "approve(address,uint256)" "$AAVE_POOL" "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
    cast send "$AAVE_POOL" "supply(address,uint256,address,uint16)" \
        "$USDC" "$AMOUNT_WEI" "$ADDR" 0 \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1

    # Wrap aUSDC → waUSDC
    local AUSDC_BAL=$(cast call "$AUSDC" "balanceOf(address)(uint256)" "$ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
    cast send "$AUSDC" "approve(address,uint256)" "$WAUSDC" "$AUSDC_BAL" \
        --private-key "$KEY" --rpc-url "$RPC_URL" --gas-limit 150000 > /dev/null
    sleep 1
    cast send "$WAUSDC" "wrap(uint256)" "$AUSDC_BAL" \
        --private-key "$KEY" --rpc-url "$RPC_URL" --gas-limit 500000 > /dev/null
    sleep 1
}

create_broker() {
    local KEY=$1
    local SALT=$(cast keccak "broker-$(date +%s)-$RANDOM")

    local BROKER=$(cast send "$BROKER_FACTORY_ADDR" "createBroker(bytes32)" "$SALT" \
        --private-key "$KEY" --rpc-url "$RPC_URL" --json 2>/dev/null \
        | jq -r '[.logs[]? | select(.topics[0] == "0xc418c83b1622e1e32aac5d6d2848134a7e89eb8e96c8514afd1757d25ee5ef71")] | .[0].data // empty' 2>/dev/null \
        | head -1 \
        | python3 -c "
import sys
data = sys.stdin.readline().strip()
if data and data.startswith('0x') and len(data) >= 66:
    print('0x' + data[26:66])
else:
    print('')
")
    echo "$BROKER"
}

deposit_to_broker() {
    local BROKER=$1 KEY=$2 AMOUNT=$3
    local USER_ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null)

    if [ "$AMOUNT" = "all" ]; then
        AMOUNT=$(cast call "$WAUSDC" "balanceOf(address)(uint256)" "$USER_ADDR" --rpc-url "$RPC_URL" | awk '{print $1}')
    else
        AMOUNT=$((AMOUNT * 1000000))
    fi

    cast send "$WAUSDC" "transfer(address,uint256)" "$BROKER" "$AMOUNT" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

mint_wrlp() {
    local BROKER=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))
    cast send "$BROKER" "modifyPosition(bytes32,int256,int256)" \
        "$MARKET_ID" 0 "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

withdraw_position() {
    local BROKER=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))
    local USER_ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null)
    cast send "$BROKER" "withdrawPositionToken(address,uint256)" "$USER_ADDR" "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

withdraw_collateral() {
    local BROKER=$1 KEY=$2 AMOUNT_USD=$3
    local AMOUNT_WEI=$((AMOUNT_USD * 1000000))
    local USER_ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null)
    cast send "$BROKER" "withdrawCollateral(address,uint256)" "$USER_ADDR" "$AMOUNT_WEI" \
        --private-key "$KEY" --rpc-url "$RPC_URL" > /dev/null
    sleep 1
}

prime_oracle() {
    cast rpc evm_increaseTime 7200 --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_mine 1 --rpc-url "$RPC_URL" > /dev/null
}
