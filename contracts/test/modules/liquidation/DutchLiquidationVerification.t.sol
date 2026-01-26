// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {DutchLiquidationModule} from "../../../src/rld/modules/liquidation/DutchLiquidationModule.sol";
import {ILiquidationModule} from "../../../src/shared/interfaces/ILiquidationModule.sol";
import {IRLDCore} from "../../../src/shared/interfaces/IRLDCore.sol";

contract DutchLiquidationVerificationTest is Test {
    DutchLiquidationModule module;
    
    // JSON Struct (Alpha sorted)
    struct ScenarioResult {
        uint256 baseDiscount;
        uint256 debtToCover;
        uint256 expectedBonus;
        uint256 expectedSeize;
        uint256 indexPrice;
        uint256 liquidationBonus; // Not used in Dutch directly, but present in JSON
        uint256 maintenanceMargin;
        uint256 maxDiscount;
        string name;
        uint256 normFactor;
        uint256 slope;
        uint256 spotPrice;
        string type_; // "dutch" or null
        uint256 userCollateral;
        uint256 userDebt;
    }

    function setUp() public {
        module = new DutchLiquidationModule();
    }

    function test_VerificationFromJSON() public {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/test/differential/data/liquidation.json");
        string memory json = vm.readFile(path);
        
        // 1. Verify Static Scenarios
        bytes memory rawStatic = vm.parseJson(json, ".static");
        ScenarioResult[] memory staticResults = abi.decode(rawStatic, (ScenarioResult[]));
        
        console.log("--- Verified Dutch Scenarios ---");
        for (uint256 i = 0; i < staticResults.length; i++) {
            // Only process Dutch scenarios
            if (bytes(staticResults[i].type_).length > 0) {
                 _runScenario(staticResults[i]);
            }
        }
    }

    function _runScenario(ScenarioResult memory s) internal view {
        // Mock Inputs
        ILiquidationModule.PriceData memory priceData = ILiquidationModule.PriceData({
            spotPrice: s.spotPrice,
            indexPrice: s.indexPrice,
            normalizationFactor: s.normFactor
        });

        // Pack Dutch Params: [Base(16) | Max(16) | Slope(16)]
        // Verification script provides them as WAD (1e18), but contract expects BPS/Scaled Short.
        // Contract: 
        // base = (params & 0xFFFF) * 1e14; -> So param must be baseWad / 1e14
        // max = ((params >> 16) & 0xFFFF) * 1e14;
        // slope = ((params >> 32) & 0xFFFF) * 1e16; -> 1.0 (100) -> 1e18
        
        uint256 baseShort = s.baseDiscount / 1e14;
        uint256 maxShort = s.maxDiscount / 1e14;
        uint256 slopeShort = s.slope / 1e16;
        
        uint256 packed = baseShort | (maxShort << 16) | (slopeShort << 32);
        
        IRLDCore.MarketConfig memory config;
        config.maintenanceMargin = uint64(s.maintenanceMargin);
        
        (uint256 bonusCollateral, uint256 seizeAmount) = module.calculateSeizeAmount(
            s.debtToCover,
            s.userCollateral,
            s.userDebt,
            priceData,
            config,
            bytes32(packed)
        );

        // Assert Log
        if (seizeAmount == 0 && s.expectedSeize > 0) {
             console.log("--- DEBUG FAILURE ---");
             console.log("Scenario:", s.name);
             console.log("DebtToCover:", s.debtToCover);
             console.log("Seize:", seizeAmount);
             console.log("Expected:", s.expectedSeize);
        }

        // Strict Check
        if (s.expectedSeize > 1e16) {
             assertApproxEqRel(seizeAmount, s.expectedSeize, 1e14, "Seize Rel");
        } else {
             assertApproxEqAbs(seizeAmount, s.expectedSeize, 200, "Seize Abs");
        }
        
        if (s.expectedBonus > 1e16) {
             assertApproxEqRel(bonusCollateral, s.expectedBonus, 1e14, "Bonus Rel");
        } else {
             assertApproxEqAbs(bonusCollateral, s.expectedBonus, 200, "Bonus Abs");
        }
    }
}
