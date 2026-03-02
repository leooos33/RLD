// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IJTM} from "../src/twamm/IJTM.sol";

/**
 * @title PlaceTestOrders
 * @notice Places 4 TWAMM orders from Anvil accounts 6-9 for integrated market testing.
 *         Orders go in both directions to create opposing flow for netting.
 *
 *   Account 6: Sell 1,000 waUSDC → Buy wRLP  (1h)
 *   Account 7: Sell   300 wRLP   → Buy waUSDC (1h)
 *   Account 8: Sell   100 waUSDC → Buy wRLP  (1h)
 *   Account 9: Sell    50 wRLP   → Buy waUSDC (1h)
 *
 * Usage:
 *   WAUSDC=... POSITION_TOKEN=... TWAMM_HOOK=... \
 *     forge script script/PlaceTestOrders.s.sol --rpc-url http://localhost:8545 --broadcast
 */
contract PlaceTestOrders is Script {
    uint24 constant FEE = 500;
    int24 constant TICK_SPACING = 5;
    uint256 constant DURATION = 3600; // 1 hour

    // Anvil default private keys (accounts 0 and 6-9)
    uint256 constant DEPLOYER_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant KEY_6 =
        0xf214f2b2cd398c806f84e317254e0f0b801d0643303b3d56d0b8b3af29d8789f;
    uint256 constant KEY_7 =
        0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82;
    uint256 constant KEY_8 =
        0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1;
    uint256 constant KEY_9 =
        0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd;

    function run() external {
        // Log timestamp for debugging order duration issues
        uint256 currentInterval = (block.timestamp / 600) * 600;
        console.log("block.timestamp:", block.timestamp);
        console.log("currentInterval:", currentInterval);
        console.log("Expected expiration:", currentInterval + DURATION);
        console.log("Actual selling time:", currentInterval + DURATION - block.timestamp, "seconds");

        address waUSDC = vm.envAddress("WAUSDC");
        address positionToken = vm.envAddress("POSITION_TOKEN");
        address hook = vm.envAddress("TWAMM_HOOK");

        // Build pool key
        (address c0, address c1) = waUSDC < positionToken
            ? (waUSDC, positionToken)
            : (positionToken, waUSDC);
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });

        bool waUSDCisC0 = (waUSDC == c0);

        console.log("============================================");
        console.log("  PLACING 4 TEST ORDERS");
        console.log("============================================");
        console.log("waUSDC:", waUSDC, waUSDCisC0 ? "(token0)" : "(token1)");
        console.log(
            "wRLP:  ",
            positionToken,
            waUSDCisC0 ? "(token1)" : "(token0)"
        );
        console.log("Hook:  ", hook);
        console.log("Duration: 1 hour");
        console.log("");

        // ── Accounts (funded externally via cast before running) ──
        address acc6 = vm.addr(KEY_6);
        address acc7 = vm.addr(KEY_7);
        address acc8 = vm.addr(KEY_8);
        address acc9 = vm.addr(KEY_9);

        console.log("Account balances:");
        console.log("  Acc6:", ERC20(waUSDC).balanceOf(acc6) / 1e6, "waUSDC");
        console.log(
            "  Acc7:",
            ERC20(positionToken).balanceOf(acc7) / 1e6,
            "wRLP"
        );
        console.log("  Acc8:", ERC20(waUSDC).balanceOf(acc8) / 1e6, "waUSDC");
        console.log(
            "  Acc9:",
            ERC20(positionToken).balanceOf(acc9) / 1e6,
            "wRLP"
        );

        // ── Place orders (all sell waUSDC → buy wRLP) ──
        // Order 1: Account 6 sells 1,000 waUSDC → buys wRLP
        _placeOrder(
            KEY_6,
            poolKey,
            hook,
            waUSDC,
            1_000e6,
            waUSDCisC0,
            "Order 1 (1000 waUSDC -> wRLP)"
        );

        // Order 2: Account 7 sells 2,000 waUSDC → buys wRLP
        _placeOrder(
            KEY_7,
            poolKey,
            hook,
            waUSDC,
            2_000e6,
            waUSDCisC0,
            "Order 2 (2000 waUSDC -> wRLP)"
        );

        // Order 3: Account 8 sells 1,000 waUSDC → buys wRLP
        _placeOrder(
            KEY_8,
            poolKey,
            hook,
            waUSDC,
            1_000e6,
            waUSDCisC0,
            "Order 3 (1000 waUSDC -> wRLP)"
        );

        // Order 4: Account 9 sells 500 waUSDC → buys wRLP
        _placeOrder(
            KEY_9,
            poolKey,
            hook,
            waUSDC,
            500e6,
            waUSDCisC0,
            "Order 4 (500 waUSDC -> wRLP)"
        );

        console.log("");
        console.log("============================================");
        console.log("  ALL 4 ORDERS PLACED SUCCESSFULLY");
        console.log("  Watch dashboard at /markets/twamm");
        console.log("============================================");
    }

    function _placeOrder(
        uint256 privateKey,
        PoolKey memory poolKey,
        address hook,
        address sellToken,
        uint256 amountIn,
        bool zeroForOne,
        string memory label
    ) internal {
        vm.startBroadcast(privateKey);

        ERC20(sellToken).approve(hook, amountIn);
        (bytes32 orderId, IJTM.OrderKey memory orderKey) = IJTM(hook)
            .submitOrder(
                IJTM.SubmitOrderParams({
                    key: poolKey,
                    zeroForOne: zeroForOne,
                    duration: DURATION,
                    amountIn: amountIn
                })
            );

        IJTM.Order memory order = IJTM(hook).getOrder(poolKey, orderKey);

        console.log("");
        console.log(label);
        console.log("  ID:        ", vm.toString(orderId));
        console.log("  Owner:     ", orderKey.owner);
        console.log("  Expiration:", orderKey.expiration);
        console.log("  zeroForOne:", orderKey.zeroForOne);
        console.log("  SellRate:  ", order.sellRate / 1e18);
        console.log("  Deposit:   ", amountIn / 1e6);

        vm.stopBroadcast();
    }
}
