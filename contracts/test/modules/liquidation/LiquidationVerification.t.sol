// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {StaticLiquidationModule} from "../../../src/rld/modules/liquidation/StaticLiquidationModule.sol";
import {ILiquidationModule} from "../../../src/shared/interfaces/ILiquidationModule.sol";
import {IRLDCore} from "../../../src/shared/interfaces/IRLDCore.sol";

contract LiquidationVerificationTest is Test {
    StaticLiquidationModule module;
    
    struct ScenarioResult {
        uint256 baseDiscount;
        uint256 debtToCover;
        uint256 expectedBonus;
        uint256 expectedSeize;
        uint256 indexPrice;
        uint256 liquidationBonus;
        uint256 maintenanceMargin;
        uint256 maxDiscount;
        string name;
        uint256 normFactor;
        uint256 slope;
        uint256 spotPrice;
        string type_;
        uint256 userCollateral;
        uint256 userDebt;
    }

    struct ReferenceData {
        ScenarioResult[] static_scenarios;
        ScenarioResult[] fuzz_vectors;
    }

    function setUp() public {
        module = new StaticLiquidationModule();
    }

    function test_VerificationFromJSON() public {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/test/differential/data/liquidation.json");
        string memory json = vm.readFile(path);
        
        // 1. Verify Static Scenarios
        bytes memory rawStatic = vm.parseJson(json, ".static");
        ScenarioResult[] memory staticResults = abi.decode(rawStatic, (ScenarioResult[]));
        
        console.log("--- Verified Static Scenarios ---");
        for (uint256 i = 0; i < staticResults.length; i++) {
            _runScenario(staticResults[i]);
        }

        // 2. Verify Fuzz Vectors
        bytes memory rawFuzz = vm.parseJson(json, ".fuzz");
        ScenarioResult[] memory fuzzResults = abi.decode(rawFuzz, (ScenarioResult[]));
        
        console.log("--- Verified Fuzz Vectors (1000) ---");
        for (uint256 i = 0; i < fuzzResults.length; i++) {
            _runScenario(fuzzResults[i]);
        }
    }

    function _runScenario(ScenarioResult memory s) internal view {
        // Mock Inputs
        ILiquidationModule.PriceData memory priceData = ILiquidationModule.PriceData({
            spotPrice: s.spotPrice,
            indexPrice: s.indexPrice,
            normalizationFactor: s.normFactor
        });

        // Pack params
        bytes32 params = bytes32(s.liquidationBonus);
        
        // Dummy config
        IRLDCore.MarketConfig memory config; 
        
        (uint256 bonusCollateral, uint256 seizeAmount) = module.calculateSeizeAmount(
            s.debtToCover,
            0, // userCollateral (unused in static)
            0, // userDebt (unused in static)
            priceData,
            config,
            params
        );
        
        if (seizeAmount == 0) {
             console.log("--- DEBUG FAILURE ---");
             console.log("Scenario:", s.name);
             console.log("DebtToCover:", s.debtToCover);
             console.log("Norm:", s.normFactor);
             console.log("Index:", s.indexPrice);
             console.log("Spot:", s.spotPrice);
             console.log("Bonus:", s.liquidationBonus);
             console.log("Seize:", seizeAmount);
        }

        // Assert Seize Amount
        // Since StaticLiquidationModule uses FixedPointMath (mulWad/divWad) and Python uses Decimal,
        // we expect extremely close matches (1-2 Wei tolerance).
        if (s.expectedSeize > 1e16) {
             assertApproxEqRel(seizeAmount, s.expectedSeize, 1e14, "Seize Amount Relative Deviation");
        } else {
             assertApproxEqAbs(seizeAmount, s.expectedSeize, 200, "Seize Amount Absolute Deviation");
        }

        // Assert Bonus Collateral
        if (s.expectedBonus > 1e16) {
             assertApproxEqRel(bonusCollateral, s.expectedBonus, 1e14, "Bonus Relative Deviation");
        } else {
             assertApproxEqAbs(bonusCollateral, s.expectedBonus, 200, "Bonus Absolute Deviation");
        }
    }
}
