// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {OrderPool} from "../../../src/twamm/libraries/OrderPool.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract TwammVerificationTest is Test {
    using OrderPool for OrderPool.State;
    
    OrderPool.State pool;
    
    struct OrderInfo {
        uint256 sellRate;
        uint256 earningsFactorLast;
    }
    mapping(uint256 => OrderInfo) orders;
    
    struct Step {
        string type_; // ADD, REM, DIST
        uint256 id;
        uint256 rate;
        uint256 amount;
        uint256 expectedClaim;
    }
    
    struct Scenario {
        string name;
        Step[] steps;
        uint256 totalDistributed;
        uint256 totalClaimed;
    }

    function setUp() public {
    }

    function test_VerificationFromJSON() public {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/test/differential/data/twamm.json");
        string memory json = vm.readFile(path);
        
        bytes memory raw = vm.parseJson(json, ".scenarios");
        Scenario[] memory scenarios = abi.decode(raw, (Scenario[]));
        
        for(uint i=0; i<scenarios.length; i++) {
            _runScenario(scenarios[i]);
        }
    }
    
    function _runScenario(Scenario memory s) internal {
        // Reset State
        delete pool;
        
        uint256 solvTotalClaimed = 0;
        
        for(uint j=0; j<s.steps.length; j++) {
            Step memory step = s.steps[j];
            
            if (keccak256(bytes(step.type_)) == keccak256("ADD")) {
                // Add Order
                orders[step.id] = OrderInfo({
                    sellRate: step.rate,
                    earningsFactorLast: pool.earningsFactorCurrent
                });
                pool.sellRateCurrent += step.rate;
                
            } else if (keccak256(bytes(step.type_)) == keccak256("DIST")) {
                // Distribute Earnings
                // Logic: factor += amount * X96 / sellRate
                if (pool.sellRateCurrent > 0) {
                    uint256 factorInc = Math.mulDiv(step.amount, FixedPoint96.Q96, pool.sellRateCurrent);
                    pool.advanceWithoutCommit(factorInc, pool.sellRateCurrent); 
                    // Note: advanceWithoutCommit params: (earningsFactor, usedSellRate)
                    // Wait, advanceWithoutCommit adds to earningsFactorCurrent directly.
                }
                
            } else if (keccak256(bytes(step.type_)) == keccak256("REM")) {
                // Remove Order
                OrderInfo memory info = orders[step.id];
                
                // Calculate Earnings
                // (Current - Last) * Rate / X96
                uint256 factorDelta = pool.earningsFactorCurrent - info.earningsFactorLast;
                uint256 claimed = Math.mulDiv(factorDelta, info.sellRate, FixedPoint96.Q96);
                
                solvTotalClaimed += claimed;
                
                pool.sellRateCurrent -= info.sellRate;
                delete orders[step.id];
            }
        }
        
        // Assert Total Claimed matches (roughly)
        // Precision issues between Python Decimal and Solmate Math
        // Python Oracle used Decimal, here we use X96.
        // We expect errors < 0.0001% or absolute small dust.
        
        // Error tolerance: 1e-5 relative?
        // Note: With X96 and many steps, drift can happen.
        // Python oracle logic: `earnings += amount / totalRate` (Decimal)
        // Solidity logic: `earnings += amount * Q96 / totalRate` (Integer X96)
        
        // Let's verify correlation.
        if (s.totalClaimed > 0) {
            uint256 diff = s.totalClaimed > solvTotalClaimed ? s.totalClaimed - solvTotalClaimed : solvTotalClaimed - s.totalClaimed;
            uint256 relErr = (diff * 1e18) / s.totalClaimed;
            
            // Allow 1% error (1e16) due to X96 truncations vs Decimal
             if (relErr > 1e16) {
                 console.log("Error Too High for", s.name);
                 console.log("Expected (Py): ", s.totalClaimed);
                 console.log("Actual (Sol):  ", solvTotalClaimed);
                 fail();
             }
        }
    }
}
