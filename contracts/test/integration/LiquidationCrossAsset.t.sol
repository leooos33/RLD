// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RLDIntegrationBase} from "./shared/RLDIntegrationBase.t.sol";
import {IRLDCore, MarketId} from "../../src/shared/interfaces/IRLDCore.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import "forge-std/console.sol";

/**
 * @title LiquidationCrossAssetTest
 * @notice Integration tests for cross-asset liquidation scenarios.
 *
 *  Inherits the full RLD + V4 + TWAMM setup from RLDIntegrationBase.
 *  Pool initialization and oracle price correctness is pre-validated
 *  by TwammInitialization.t.sol — tests here assume the base setup is correct.
 *
 *  Planned test phases (to be implemented):
 *
 *  Phase 1 – LP Position Setup & Registration
 *    [ ] Add V4 LP position via PrimeBroker
 *    [ ] Verify PrimeBroker values LP position via V4ValuationModule
 *    [ ] Verify collateral ratio calculation with LP collateral
 *    [ ] Add TWAMM order via PrimeBroker
 *    [ ] Verify PrimeBroker values TWAMM order via TwammValuationModule
 *
 *  Phase 2 – Liquidation Trigger Conditions
 *    [ ] test_Liquidation_CashCollateral_HealthFactor_Below_1
 *    [ ] test_Liquidation_wRLP_Collateral_HealthFactor_Below_1
 *    [ ] test_Liquidation_V4LP_Collateral_HealthFactor_Below_1
 *    [ ] test_Liquidation_TWAMM_Order_Collateral_HealthFactor_Below_1
 *
 *  Phase 3 – Liquidation Execution & State Assertions
 *    [ ] Verify seize() unwinds LP and processes both token outputs
 *    [ ] Verify seize() cancels TWAMM order and withdraws tokens
 *    [ ] Verify partial close with liquidationCloseFactor = 50%
 *    [ ] Verify cascading liquidation across multiple collateral types
 *    [ ] Verify negative equity handling (bad debt)
 *
 *  Phase 4 – Token Order & Oracle Divergence Edge Cases
 *    [ ] Both tokens returned from unwind are correctly accounted for
 *    [ ] Only token0 returned (token1 balance = 0) — handled gracefully
 *    [ ] Only token1 returned — handled gracefully
 *    [ ] TWAMM internal price diverges from external oracle > tolerance → reverts
 */
contract LiquidationCrossAssetTest is RLDIntegrationBase {
    using PoolIdLibrary for PoolKey;

    // ================================================================
    //  SMOKE TEST — Verifies that the inherited setUp works correctly
    //  before any liquidation-specific setup is layered on top.
    // ================================================================

    /// @notice Sanity check: the inherited base setUp must produce a live market.
    function test_BaseSetup_MarketIsLive() public view {
        assertTrue(
            MarketId.unwrap(marketId) != bytes32(0),
            "Market must be created"
        );

        IRLDCore.MarketAddresses memory ma = core.getMarketAddresses(marketId);
        assertTrue(ma.positionToken != address(0), "wRLP must be deployed");
        assertTrue(ma.collateralToken != address(0), "Collateral must be set");

        // TWAMM hook must be live at correct flag-bit address
        uint160 hookAddr = uint160(address(twammHook));
        assertTrue(
            hookAddr & uint160(0x2AC0) == uint160(0x2AC0),
            "TWAMM hook flags must be set"
        );

        console.log("[Smoke] Market ID :", uint256(MarketId.unwrap(marketId)));
        console.log("[Smoke] wRLP      :", ma.positionToken);
        console.log("[Smoke] TWAMM hook:", address(twammHook));
    }

    // ================================================================
    //  Phase 1 tests will go here
    // ================================================================
}
