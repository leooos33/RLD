// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {EasyPosm} from "./utils/EasyPosm.sol";
import {Fixtures} from "./utils/Fixtures.sol";
import {TWAMMExtended} from "./TWAMMExtended.sol";
import {TWAMM, ITWAMM, RATE_SCALER} from "@src/TWAMM.sol";

contract TWAMM_CancelTest is Test, Fixtures {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    TWAMMExtended twammHook;
    PoolId poolId;
    MockERC20 token0;
    MockERC20 token1;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        deployAndApprovePosm(manager);

        token0 = MockERC20(Currency.unwrap(currency0));
        token1 = MockERC20(Currency.unwrap(currency1));

        address flags = address(
            uint160(
                Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                    | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
            ) ^ (0x4444 << 144)
        );

        vm.warp(10_000);

        bytes memory constructorArgs = abi.encode(manager, uint256(10_000), address(123));
        deployCodeTo("TWAMMExtended.sol:TWAMMExtended", constructorArgs, flags);
        twammHook = TWAMMExtended(flags);

        key = PoolKey(currency0, currency1, 3000, 60, twammHook);
        poolId = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);

        // Add liquidity
        posm.mint(
            key,
            TickMath.minUsableTick(key.tickSpacing),
            TickMath.maxUsableTick(key.tickSpacing),
            10 ether,
            type(uint256).max,
            type(uint256).max,
            address(this),
            block.timestamp,
            ZERO_BYTES
        );
    }

    function testTWAMM_Cancel_MidOrder() public {
        console.log("=== START: testTWAMM_Cancel_MidOrder ===");
        uint256 amountIn = 1000 ether;
        uint256 duration = 10_000; // 1 interval
        // Submit at 10_000, Expiration 20_000.
        // Rate = 0.1 ether/sec
        
        // Set balance to exactly amountIn for clear accounting logs
        deal(address(token0), address(this), amountIn);
        
        token0.approve(address(twammHook), amountIn);
        
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        console.log("Order Submitted. Owner: %s, Expiration: %s", orderKey.owner, orderKey.expiration);

        // Advance 50% through the order (to 15,000)
        vm.warp(15_000);
        console.log(">>> Warped to Timestamp: 15,000 (Mid-interval)");
        
        // Execute executed part (10k -> 15k isn't a full interval, wait.)
        // Interval is 10k. 
        // 10k start. 20k expiry.
        // at 15k, lastVirtual is 10k. No full interval passed.
        // cancelOrder will trigger sync() which triggers executeTWAMMOrders().
        // executeTWAMMOrders will see current time 15k. It calculates intervals ending <= 15k.
        // There are none. lastVirtual remains 10k?
        // Wait, executeTWAMMOrders logic: 
        // "currentTimestampAtInterval = _getIntervalTime(targetTimestamp);" (floors to 10k)
        // So at 15k, effective time is 10k. 
        // So 0 seconds executed.
        // Expect full refund?
        
        // Let's verify refund amount.
        // Refund = sellRate * (expiration - lastVirtual).
        // If lastVirtual stays 10k. Expiration 20k. Refund = 10k * rate = 100% amount.
        
        uint256 balanceBefore = token0.balanceOf(address(this));
        console.log("User Token0 Balance Before Cancel: %s", balanceBefore);
        
        console.log("ACTION: Cancelling Order...");
        (uint256 buyTokens, uint256 refund) = twammHook.cancelOrder(key, orderKey);
        
        console.log("Result: BuyTokensOut: %s, Refund: %s", buyTokens, refund);
        console.log("User Token0 Balance After Cancel: %s", token0.balanceOf(address(this)));
        
        assertEq(buyTokens, 0, "Should have 0 buy tokens if no interval passed");
        assertEq(refund, amountIn, "Should refund 100% if no interval passed");
        assertEq(token0.balanceOf(address(this)), balanceBefore + refund);
        
        // Verify Order deleted
        ITWAMM.Order memory order = twammHook.getOrder(key, orderKey);
        console.log("Order SellRate in Storage: %s (Should be 0)", order.sellRate);
        assertEq(order.sellRate, 0);
        console.log("=== END: testTWAMM_Cancel_MidOrder ===");
    }

    function testTWAMM_Cancel_AfterOneInterval() public {
        console.log("=== START: testTWAMM_Cancel_AfterOneInterval ===");
        uint256 amountIn = 2000 ether;
        uint256 duration = 20_000; // 2 intervals (10k -> 30k)
        console.log("Config: AmountIn %s, Duration %s", amountIn, duration);
        
        // Set balance to exactly amountIn for clear accounting logs
        deal(address(token0), address(this), amountIn);
        
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        console.log("Order Submitted. Expiration: %s", orderKey.expiration);

        // Advance to 25,000 (1.5 intervals passed)
        vm.warp(25_000);
        console.log(">>> Warped to Timestamp: 25,000 (1.5 Intervals)");
        
        // At 25k, effective interval time is 20k.
        // 1 full interval (10k->20k) should execute.
        // 1 remaining interval (20k->30k) should be refunded.
        
        uint256 balanceBefore = token0.balanceOf(address(this));
        console.log("User Token0 Balance Before Cancel: %s", balanceBefore);

        console.log("ACTION: Cancelling Order...");
        (uint256 buyTokens, uint256 refund) = twammHook.cancelOrder(key, orderKey);
        
        console.log("Result: BuyTokensOut: %s, Refund: %s", buyTokens, refund);
        console.log("User Token0 Balance After Cancel: %s", token0.balanceOf(address(this)));
        
        // Refund should be 50%
        console.log("Expected Refund: %s (50%% of 2000)", amountIn / 2);
        assertEq(refund, amountIn / 2, "Should refund 50%");
        assertGt(buyTokens, 0, "Should have earned some tokens");
        assertEq(token0.balanceOf(address(this)), balanceBefore + refund);
        
        // Verify state cleared
        (uint256 sellRateCurrent, ) = twammHook.getOrderPool(key, true);
        console.log("Global SellRateCurrent: %s (Should be 0)", sellRateCurrent);
        assertEq(sellRateCurrent, 0, "Global sell rate should be 0");
        console.log("=== END: testTWAMM_Cancel_AfterOneInterval ===");
    }

    function testTWAMM_Cancel_Unauthorized() public {
        uint256 amountIn = 100 ether;
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: 10_000, amountIn: amountIn})
        );
        
        vm.prank(address(0xdead));
        vm.expectRevert(ITWAMM.Unauthorized.selector);
        twammHook.cancelOrder(key, orderKey);
    }
    
    function testTWAMM_Cancel_GhostLiquidityBug() public {
        // Ensure that cancelling prevents the sellRate from affecting future intervals
        uint256 amountIn = 1000 ether;
        uint256 duration = 20_000; // 10k -> 30k
        
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        
        // Cancel immediately
        twammHook.cancelOrder(key, orderKey);
        
        // Verify rate logic is clean
        (uint256 sellRateCurrent, ) = twammHook.getOrderPool(key, true);
        assertEq(sellRateCurrent, 0, "Sell rate should be 0");
        
        // Advance to expiration and beyond
        vm.warp(30_000);
        // This execution would crash/underflow if we didn't remove from sellRateEndingAtInterval
        twammHook.executeTWAMMOrders(key);
        
        vm.warp(40_000);
        twammHook.executeTWAMMOrders(key);
    }

    function testTWAMM_Cancel_AlreadyExpired() public {
        uint256 amountIn = 100 ether;
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: 10_000, amountIn: amountIn})
        );
        
        vm.warp(30_000); // Way past expiration
        
        vm.expectRevert(abi.encodeWithSelector(ITWAMM.OrderDoesNotExist.selector, orderKey));
        twammHook.cancelOrder(key, orderKey);
    }
    
    function testTWAMM_GetCancelOrderState() public {
        // Submit order
        uint256 amountIn = 1000 ether;
        uint256 duration = 10_000;
        
        deal(address(token0), address(this), amountIn);
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        
        // Warp to 15,000 (Mid-interval)
        vm.warp(15_000);
        
        // 1. Check View Function
        (uint256 buyTokensOwedView, uint256 sellTokensRefundView) = twammHook.getCancelOrderState(key, orderKey);
        
        console.log("View Predicted Refund: %s", sellTokensRefundView);
        
        // Expect 100% refund because we haven't crossed a full interval
        assertEq(sellTokensRefundView, amountIn);
        
        // 2. Perform Actual Cancel
        (uint256 buyTokensOut, uint256 sellTokensRefund) = twammHook.cancelOrder(key, orderKey);
        
        // 3. Verify Match
        assertEq(sellTokensRefund, sellTokensRefundView, "View refund should match actual refund");
        // We don't assert buyTokens because view function might underestimate pending earnings (as documented)
    }

    function testTWAMM_GetCancelOrderState_Expired() public {
        // Submit order
        uint256 amountIn = 1000 ether;
        uint256 duration = 10_000;
        
        deal(address(token0), address(this), amountIn);
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        
        // Warp PAST expiration
        vm.warp(block.timestamp + duration + 1);
        
        // 1. Check View Function
        (uint256 buyTokensOwedView, uint256 sellTokensRefundView) = twammHook.getCancelOrderState(key, orderKey);
        
        assertEq(sellTokensRefundView, 0, "Refund should be 0 after expiration");
        
        // 2. Perform Actual Check 
        // NOTE: Expect OrderDoesNotExist because sync() cleans up expired orders before cancelOrder can check specific failure
        vm.expectRevert(abi.encodeWithSelector(ITWAMM.OrderDoesNotExist.selector, orderKey));
        twammHook.cancelOrder(key, orderKey);
    }

    function testTWAMM_GetCancelOrderState_Boundary() public {
        // Submit order
        uint256 amountIn = 1000 ether;
        uint256 duration = 20_000; // 2 intervals (10k each) 
        // Note: interval is 10k in setup, so 20k is exactly 2 intervals
        
        deal(address(token0), address(this), amountIn);
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        
        // Warp EXACTLY to first interval (10k elapsed)
        vm.warp(block.timestamp + 10_000);
        
        // 1. Check View Function
        (uint256 buyTokensOwedView, uint256 sellTokensRefundView) = twammHook.getCancelOrderState(key, orderKey);
        
        // Should refund exactly 50%
        assertEq(sellTokensRefundView, amountIn / 2, "Should refund 50% at halftime boundary");
        
        // 2. Perform Actual Cancel
        (uint256 buyTokensOut, uint256 sellTokensRefund) = twammHook.cancelOrder(key, orderKey);
        
        assertEq(sellTokensRefund, sellTokensRefundView, "View should match actual at boundary");
    }

    function testTWAMM_GetCancelOrderState_Fuzz(uint256 warpTime) public {
        // Constrain warp time to be within duration
        warpTime = bound(warpTime, 1, 10_000 - 1); // 1 sec to duration-1
        
        uint256 amountIn = 1000 ether;
        uint256 duration = 10_000; 
        
        deal(address(token0), address(this), amountIn);
        token0.approve(address(twammHook), amountIn);
        (, ITWAMM.OrderKey memory orderKey) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        
        vm.warp(block.timestamp + warpTime);
        
        // 1. Check View Function
        (uint256 buyTokensOwedView, uint256 sellTokensRefundView) = twammHook.getCancelOrderState(key, orderKey);
        
        // 2. Perform Actual Cancel
        // We use a snapshot to revert state after cancel, allowing us to 'simulate' fuzzing nicely if we wanted to check other things, 
        // but here we just want to compare.
        (uint256 buyTokensOut, uint256 sellTokensRefund) = twammHook.cancelOrder(key, orderKey);
        
        // 3. Verify Match
        assertEq(sellTokensRefund, sellTokensRefundView, "Fuzzed view refund should match actual refund");
    }
}
