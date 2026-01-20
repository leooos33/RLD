// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console} from "forge-std/console.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {EasyPosm} from "./utils/EasyPosm.sol";
import {Fixtures} from "./utils/Fixtures.sol";
import {TWAMMExtended} from "./TWAMMExtended.sol";
import {TWAMM, ITWAMM, RATE_SCALER} from "@src/TWAMM.sol";

contract TWAMM_MatchingTest is Test, Fixtures {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;

    TWAMMExtended twammHook;
    PoolId poolId;
    MockERC20 token0;
    MockERC20 token1;

    // Events to spy on
    event SwapExecuted(PoolId indexed poolId, BalanceDelta delta);

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
            100 ether,
            type(uint256).max,
            type(uint256).max,
            address(this),
            block.timestamp,
            ZERO_BYTES
        );
    }

    function testTWAMM_Matching_PerfectMatch() public {
        // 1. Setup Equal Orders
        uint256 amountIn = 1000 ether;
        uint256 duration = 10_000;
        
        deal(address(token0), address(this), amountIn);
        deal(address(token1), address(this), amountIn);
        token0.approve(address(twammHook), amountIn);
        token1.approve(address(twammHook), amountIn);

        // ZeroForOne
        (, ITWAMM.OrderKey memory orderKey0) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn})
        );
        // OneForZero
        (, ITWAMM.OrderKey memory orderKey1) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: false, duration: duration, amountIn: amountIn})
        );

        // 2. Advance to Execution
        vm.warp(block.timestamp + duration); // 20_000

        // 3. Expect NO SwapExecuted event because they net out perfectly
        vm.recordLogs();
        twammHook.executeTWAMMOrders(key);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        
        bool swapEventFound = false;
        bytes32 swapEventSig = keccak256("SwapExecuted(bytes32,int256)");
        
        for (uint i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == swapEventSig) {
                swapEventFound = true;
                break;
            }
        }
        
        // Assert NO swap event found
        assertFalse(swapEventFound, "Should not emit SwapExecuted for perfect match");
        
        // 4. Verify Earnings
        // Update earnings for orders
        twammHook.sync(ITWAMM.SyncParams(key, orderKey0));
        twammHook.sync(ITWAMM.SyncParams(key, orderKey1));
        
        // Claim
        (uint256 c0, uint256 c1) = twammHook.claimTokensByPoolKey(key);
        
        // orderKey0 (0->1) should get token1. 
        // orderKey1 (1->0) should get token0.
        // Since price is 1:1 and perfect match:
        // User put in 1000 token0 + 1000 token1.
        // User should get out 1000 token0 + 1000 token1 (swapped).
        // c0 is from claiming token0 (owed to orderKey1).
        // c1 is from claiming token1 (owed to orderKey0).
        
        console.log("Claimed Token0: %s", c0);
        console.log("Claimed Token1: %s", c1);
        
        // Allow dust error? Netting algebra uses FixedPoint96, might have tiny dust.
        assertApproxEqAbs(c0, amountIn, 1000, "Should get approx 100% token0 back from swap");
        assertApproxEqAbs(c1, amountIn, 1000, "Should get approx 100% token1 back from swap");
    }

    function testTWAMM_Matching_PartialMatch() public {
        // 1. Setup Unequal Orders
        uint256 amountIn0 = 1000 ether; // 0->1
        uint256 amountIn1 = 500 ether;  // 1->0
        uint256 duration = 10_000;

        deal(address(token0), address(this), amountIn0);
        deal(address(token1), address(this), amountIn1);
        token0.approve(address(twammHook), amountIn0);
        token1.approve(address(twammHook), amountIn1);

        // ZeroForOne (Big)
        (, ITWAMM.OrderKey memory orderKey0) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: duration, amountIn: amountIn0})
        );
        // OneForZero (Small)
        (, ITWAMM.OrderKey memory orderKey1) = twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: false, duration: duration, amountIn: amountIn1})
        );

        // 2. Advance to Execution
        vm.warp(block.timestamp + duration); 

        // 3. Expect SwapExecuted event for the DIFFERENCE (approx 500 ether worth)
        vm.recordLogs();
        twammHook.executeTWAMMOrders(key);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        bool swapEventFound = false;
        bytes32 swapEventSig = keccak256("SwapExecuted(bytes32,int256)");
        int256 swapAmount0;
        int256 swapAmount1;

        for (uint i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == swapEventSig) {
                swapEventFound = true;
                // PoolId is indexed (topic 1), so data only contains BalanceDelta
                BalanceDelta delta = abi.decode(entries[i].data, (BalanceDelta));
                swapAmount0 = delta.amount0();
                swapAmount1 = delta.amount1();
                break;
            }
        }

        assertTrue(swapEventFound, "Should emit SwapExecuted for partial match");
        
        console.logInt(swapAmount0);
        console.logInt(swapAmount1);

        // We expect a ZeroForOne swap of approx 500 ether.
        // ZeroForOne: amount0 < 0 (user pays/pool receives? delta is from PoolManager perspective typically?)
        // Uniswap V4 BalanceDelta: 
        // Swap: amount0 is what the PoolManager *received* (positive) or *paid* (negative)?
        // Wait, normally `swap` returns delta. 
        // If I sell token0 (ZeroForOne), the pool receives token0.
        // Let's rely on magnitude for now.
        // Net difference = 500 ether.
        
        assertApproxEqAbs(uint256(swapAmount0 < 0 ? -swapAmount0 : swapAmount0), 500 ether, 1e16, "Swap amount0 should be approx 500 ether");
    }

    function testTWAMM_Matching_DifferentDurations() public {
        // 1. Setup Orders with Different Durations
        uint256 amountIn = 1000 ether;
        uint256 durationShort = 10_000;
        uint256 durationLong = 20_000;

        deal(address(token0), address(this), amountIn);
        deal(address(token1), address(this), amountIn);
        token0.approve(address(twammHook), amountIn);
        token1.approve(address(twammHook), amountIn);

        // ZeroForOne (Short: 10k) -> Valid for first 10k
        twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: true, duration: durationShort, amountIn: amountIn})
        );
        // OneForZero (Long: 20k) -> Valid for 20k
        twammHook.submitOrder(
            ITWAMM.SubmitOrderParams({key: key, zeroForOne: false, duration: durationLong, amountIn: amountIn})
        );

        // Rate Short = 1000 / 10000 = 0.1 per sec
        // Rate Long = 1000 / 20000 = 0.05 per sec
        
        // 2. Warp to 10k (Short matches Long partially)
        vm.warp(block.timestamp + durationShort);
        
        // During first 10k:
        // ZeroForOne sells 1000 total.
        // OneForZero sells 500 total (half of order).
        // Net: 500 ZeroForOne surplus.
        
        vm.recordLogs();
        twammHook.executeTWAMMOrders(key);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        
        bool swapEventFound = false;
        bytes32 swapEventSig = keccak256("SwapExecuted(bytes32,int256)");
        int256 swapAmount0;
        
        for (uint i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == swapEventSig) {
                swapEventFound = true;
                BalanceDelta delta = abi.decode(entries[i].data, (BalanceDelta));
                swapAmount0 = delta.amount0();
                break;
            }
        }
        
        assertTrue(swapEventFound, "Should emit SwapExecuted for first interval mismatch");
        // Expect approx 500 ether surplus swap 
        assertApproxEqAbs(uint256(swapAmount0 < 0 ? -swapAmount0 : swapAmount0), 500 ether, 1e16, "First interval swap mismatch");
        
        // 3. Warp to 20k (Only Long remains)
        vm.warp(block.timestamp + (durationLong - durationShort));
        
        vm.recordLogs();
        twammHook.executeTWAMMOrders(key);
        entries = vm.getRecordedLogs();
        
        swapEventFound = false;
        
        int256 swapAmount1;
        
        for (uint i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == swapEventSig) {
                swapEventFound = true;
                BalanceDelta delta = abi.decode(entries[i].data, (BalanceDelta));
                swapAmount0 = delta.amount0();
                swapAmount1 = delta.amount1();
                break;
            }
        }
        
        assertTrue(swapEventFound, "Should emit SwapExecuted for second interval");
        
        // ZeroForOne is gone. OneForZero sells remaining 500.
        // OneForZero -> sell token1 (pool receives positive amount1).
        // Input is fixed at 500 ether.
        
        assertApproxEqAbs(uint256(swapAmount1 < 0 ? -swapAmount1 : swapAmount1), 500 ether, 1e16, "Second interval input mismatch");
    }
}
