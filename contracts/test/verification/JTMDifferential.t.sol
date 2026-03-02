// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {
    JITRLDIntegrationBase
} from "../integration/shared/JITRLDIntegrationBase.t.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {
    PoolModifyLiquidityTestNoChecks
} from "v4-core/src/test/PoolModifyLiquidityTestNoChecks.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IJTM} from "../../../src/twamm/IJTM.sol";
import {JTM} from "../../../src/twamm/JTM.sol";
import "forge-std/console.sol";

/**
 * @title JTMDifferential
 * @notice Differential fuzzing verifier for JTM v2 (Option A: deferred settle).
 *
 * INVARIANTS VERIFIED:
 *   INV-1: Ghost = 0 after all orders expire (deferred settle executed)
 *   INV-2: Stream sellRate = 0 after expiry
 *   INV-3: Option E: expiration = nextEpoch + duration
 *   INV-4: Cancel-settle zeroes ghost when last order cancels
 *   INV-6: No spurious settle (cancel non-last order keeps stream active)
 *   INV-7: Immediate cancel = full refund, zero buy
 */
contract JTMDifferential is JITRLDIntegrationBase {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    PoolModifyLiquidityTestNoChecks public lpRouter;
    PoolSwapTest public swapRouter;

    uint256 constant INTERVAL = 3600;
    uint256 internal T0;

    function setUp() public override {
        vm.warp(7200);
        super.setUp();
        T0 = block.timestamp;
    }

    function _tweakSetup() internal override {
        lpRouter = new PoolModifyLiquidityTestNoChecks(
            IPoolManager(address(poolManager))
        );
        swapRouter = new PoolSwapTest(IPoolManager(address(poolManager)));
        pt.approve(address(lpRouter), type(uint256).max);
        ct.approve(address(lpRouter), type(uint256).max);
        pt.approve(address(swapRouter), type(uint256).max);
        ct.approve(address(swapRouter), type(uint256).max);
        pt.approve(address(twammHook), type(uint256).max);
        ct.approve(address(twammHook), type(uint256).max);
        lpRouter.modifyLiquidity(
            twammPoolKey,
            ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: 100e12,
                salt: bytes32(0)
            }),
            ""
        );
    }

    function _submit(
        bool zeroForOne,
        uint256 duration,
        uint256 amountIn
    ) internal returns (bytes32 orderId, IJTM.OrderKey memory orderKey) {
        return
            twammHook.submitOrder(
                IJTM.SubmitOrderParams({
                    key: twammPoolKey,
                    zeroForOne: zeroForOne,
                    duration: duration,
                    amountIn: amountIn
                })
            );
    }

    function _expectedExp(uint256 duration) internal view returns (uint256) {
        uint256 nextEpoch = (block.timestamp / INTERVAL) * INTERVAL + INTERVAL;
        return nextEpoch + duration;
    }

    // ================================================================
    //  INV-1: Ghost = 0 after expiry (deferred auto-settle)
    // ================================================================

    function test_DFF_EC1_SingleOrderAutoSettle() public {
        (, IJTM.OrderKey memory key) = _submit(true, INTERVAL, 3600e6);

        vm.warp(key.expiration + 60);
        twammHook.executeJTMOrders(twammPoolKey);

        (uint256 a0, uint256 a1, , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(a0, 0, "INV-1: ghost0 zero");
        assertEq(a1, 0, "INV-1: ghost1 zero");

        (uint256 sr0, ) = twammHook.getStreamPool(twammPoolKey, true);
        assertEq(sr0, 0, "INV-2: sellRate zero");
    }

    // ================================================================
    //  INV-4: Cancel-settle zeros ghost
    // ================================================================

    function test_DFF_EC2_CancelSettle() public {
        (, IJTM.OrderKey memory key) = _submit(true, INTERVAL, 3600e6);
        uint256 startEpoch = (T0 / INTERVAL) * INTERVAL + INTERVAL;

        vm.warp(startEpoch + INTERVAL / 2);

        (uint256 buyOut, uint256 refund) = twammHook.cancelOrder(
            twammPoolKey,
            key
        );

        (uint256 a0, , , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(a0, 0, "INV-4: ghost0 zero after cancel-settle");
        console.log("[EC2] buy:", buyOut, "refund:", refund);
    }

    // ================================================================
    //  INV-6: No spurious settle
    // ================================================================

    function test_DFF_EC3_CancelNoSettle() public {
        (, IJTM.OrderKey memory key0) = _submit(true, INTERVAL, 3600e6);
        (, IJTM.OrderKey memory key1) = _submit(true, 2 * INTERVAL, 7200e6);

        uint256 startEpoch = (T0 / INTERVAL) * INTERVAL + INTERVAL;
        vm.warp(startEpoch + INTERVAL / 2);

        twammHook.cancelOrder(twammPoolKey, key0);

        (uint256 sr0, ) = twammHook.getStreamPool(twammPoolKey, true);
        assertTrue(sr0 > 0, "INV-6: stream still active");
    }

    // ================================================================
    //  INV-3: Option E expiration
    // ================================================================

    function test_DFF_EC4_OptionEExpiration() public {
        uint256 expectedExp = _expectedExp(INTERVAL);
        (, IJTM.OrderKey memory key) = _submit(true, INTERVAL, 3600e6);
        assertEq(key.expiration, expectedExp, "INV-3: expiration");

        vm.warp(T0 + 100);
        uint256 expectedExp2 = _expectedExp(2 * INTERVAL);
        (, IJTM.OrderKey memory key2) = _submit(true, 2 * INTERVAL, 7200e6);
        assertEq(key2.expiration, expectedExp2, "INV-3: exp2");
    }

    // ================================================================
    //  INV-1: Opposing netting - ghost zero
    // ================================================================

    function test_DFF_EC5_OpposingNetting() public {
        (, IJTM.OrderKey memory k0) = _submit(true, INTERVAL, 3600e6);
        (, IJTM.OrderKey memory k1) = _submit(false, INTERVAL, 3600e6);

        vm.warp(k0.expiration + 60);
        twammHook.executeJTMOrders(twammPoolKey);

        (uint256 a0, uint256 a1, , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(a0, 0, "INV-1: ghost0 zero");
        assertEq(a1, 0, "INV-1: ghost1 zero");
    }

    // ================================================================
    //  INV-1+2: Interleaved expirations
    // ================================================================

    function test_DFF_EC6_InterleavedExpirations() public {
        (, IJTM.OrderKey memory k1) = _submit(true, INTERVAL, 3600e6);
        (, IJTM.OrderKey memory k2) = _submit(true, 2 * INTERVAL, 7200e6);

        vm.warp(k1.expiration + 60);
        twammHook.executeJTMOrders(twammPoolKey);

        (uint256 sr0, ) = twammHook.getStreamPool(twammPoolKey, true);
        assertTrue(sr0 > 0, "stream still active (order 2)");

        vm.warp(k2.expiration + 60);
        twammHook.executeJTMOrders(twammPoolKey);

        (uint256 a0, , , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(a0, 0, "INV-1: ghost zero after both expired");

        (sr0, ) = twammHook.getStreamPool(twammPoolKey, true);
        assertEq(sr0, 0, "INV-2: stream dead");
    }

    // ================================================================
    //  INV-7: Immediate cancel = full refund
    // ================================================================

    function test_DFF_EC7_ImmediateCancel() public {
        (, IJTM.OrderKey memory key) = _submit(true, INTERVAL, 3600e6);

        (uint256 buyOut, uint256 refund) = twammHook.cancelOrder(
            twammPoolKey,
            key
        );

        uint256 sellRate = 3600e6 / INTERVAL;
        assertEq(refund, sellRate * INTERVAL, "INV-7: full refund");
        assertEq(buyOut, 0, "INV-7: zero buy");
    }

    // ================================================================
    //  FUZZ TESTS
    // ================================================================

    function test_DFF_Fuzz_SingleOrder(
        uint8 durEpochs,
        uint32 amountMul
    ) public {
        uint256 dur = (uint256(bound(durEpochs, 1, 4))) * INTERVAL;
        uint256 amt = uint256(bound(amountMul, 1, 100)) * dur * 1e6;

        (, IJTM.OrderKey memory key) = _submit(true, dur, amt);
        vm.warp(key.expiration + 120);
        twammHook.executeJTMOrders(twammPoolKey);

        (uint256 a0, uint256 a1, , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(a0, 0, "FUZZ: ghost0 zero");
        assertEq(a1, 0, "FUZZ: ghost1 zero");
    }

    function test_DFF_Fuzz_Opposing(
        uint32 amt0,
        uint32 amt1,
        uint8 durE
    ) public {
        uint256 dur = (uint256(bound(durE, 1, 3))) * INTERVAL;
        uint256 a0 = uint256(bound(amt0, 1, 50)) * dur * 1e6;
        uint256 a1 = uint256(bound(amt1, 1, 50)) * dur * 1e6;

        (, IJTM.OrderKey memory k0) = _submit(true, dur, a0);
        _submit(false, dur, a1);

        vm.warp(k0.expiration + 120);
        twammHook.executeJTMOrders(twammPoolKey);

        (uint256 g0, uint256 g1, , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(g0, 0, "FUZZ-OPP: ghost0 zero");
        assertEq(g1, 0, "FUZZ-OPP: ghost1 zero");
    }

    function test_DFF_Fuzz_CancelSettle(
        uint32 amountIn,
        uint8 cancelFrac
    ) public {
        uint256 amt = uint256(bound(amountIn, 1, 100)) * INTERVAL * 1e6;
        (, IJTM.OrderKey memory key) = _submit(true, INTERVAL, amt);

        uint256 startEpoch = (T0 / INTERVAL) * INTERVAL + INTERVAL;
        uint256 frac = uint256(bound(cancelFrac, 1, 99));
        uint256 cancelTime = startEpoch + (INTERVAL * frac) / 100;
        vm.warp(cancelTime);

        twammHook.cancelOrder(twammPoolKey, key);

        (uint256 a0, , , ) = twammHook.getStreamState(twammPoolKey);
        assertEq(a0, 0, "FUZZ-CANCEL: ghost0 zero");
    }

    function test_DFF_Fuzz_CancelNotLast(uint8 n, uint32 amountIn) public {
        uint256 numOrders = uint256(bound(n, 2, 4));
        uint256 amt = uint256(bound(amountIn, 1, 50)) * INTERVAL * 1e6;

        IJTM.OrderKey[] memory keys = new IJTM.OrderKey[](numOrders);
        for (uint256 i = 0; i < numOrders; i++) {
            (, keys[i]) = _submit(true, (i + 1) * INTERVAL, (i + 1) * amt);
        }

        uint256 startEpoch = (T0 / INTERVAL) * INTERVAL + INTERVAL;
        vm.warp(startEpoch + INTERVAL / 2);

        twammHook.cancelOrder(twammPoolKey, keys[0]);

        (uint256 sr0, ) = twammHook.getStreamPool(twammPoolKey, true);
        assertTrue(sr0 > 0, "FUZZ-NOTLAST: stream still active");
    }

    function test_DFF_Fuzz_OptionEExpiration(
        uint16 submitOffset,
        uint8 durEpochs
    ) public {
        uint256 offset = uint256(bound(submitOffset, 0, INTERVAL - 1));
        uint256 dur = (uint256(bound(durEpochs, 1, 4))) * INTERVAL;

        vm.warp(T0 + offset);
        uint256 expectedExp = _expectedExp(dur);
        (, IJTM.OrderKey memory key) = _submit(true, dur, dur * 1e6);

        assertEq(key.expiration, expectedExp, "FUZZ-OPTE: expiration");
    }
}
