// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/**
 * @title Currency Ordering Analysis
 * @notice Analyzes how different token address pairs affect pool initialization
 */
contract CurrencyOrderingTest is Test {
    uint256 constant Q96 = 1 << 96;
    uint256 constant ORACLE_PRICE = 10e18;  // $10
    
    function test_AnalyzeAllTokenPairs() public pure {
        address[9] memory tokens = [
            0x018008bfb33d285247A21d44E50697654f754e63,
            0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a,
            0x24Ab03a9a5Bc2C49E5523e8d915A3536ac38B91D,
            0x32a6268f9Ba3642Dda7892aDd74f1D34469A4259,
            0x4579a27aF00A62C0EB156349f31B345c08386419,
            0x4F5923Fc5FD4a93352581b38B7cD26943012DECF,
            0x5F9190496e0DFC831C3bd307978de4a245E2F5cD,
            0x7c0477d085ECb607CF8429f3eC91Ae5E1e460F4F,
            0xAa0200d169fF3ba9385c12E073c5d1d30434AE7b
        ];
        
        console.log("========================================");
        console.log("   CURRENCY ORDERING ANALYSIS");
        console.log("========================================");
        console.log("");
        
        // Show sorted order
        console.log("Token addresses (already sorted low to high):");
        for (uint i = 0; i < tokens.length; i++) {
            console.log("  [", i, "]", tokens[i]);
        }
        
        console.log("");
        console.log("========================================");
        console.log("   POOL DEPLOYMENT EXAMPLES ($10 Oracle)");
        console.log("========================================");
        
        // Example 1: Lowest vs Highest (position = high, collateral = low)
        console.log("");
        console.log("--- EXAMPLE 1: positionToken=0xAa..., collateral=0x01... ---");
        _analyzePool(tokens[8], tokens[0], ORACLE_PRICE);
        
        // Example 2: Lowest vs Highest (position = low, collateral = high)
        console.log("");
        console.log("--- EXAMPLE 2: positionToken=0x01..., collateral=0xAa... ---");
        _analyzePool(tokens[0], tokens[8], ORACLE_PRICE);
        
        // Example 3: Adjacent addresses
        console.log("");
        console.log("--- EXAMPLE 3: positionToken=0x45..., collateral=0x4F... ---");
        _analyzePool(tokens[4], tokens[5], ORACLE_PRICE);
        
        // Example 4: Different oracle price ($0.5)
        console.log("");
        console.log("--- EXAMPLE 4: Same as Ex1 but $0.5 Oracle ---");
        _analyzePool(tokens[8], tokens[0], 0.5e18);
        
        // Example 5: High oracle price ($100)
        console.log("");
        console.log("--- EXAMPLE 5: Same as Ex1 but $100 Oracle ---");
        _analyzePool(tokens[8], tokens[0], 100e18);
    }
    
    function _analyzePool(
        address positionToken, 
        address collateral, 
        uint256 oraclePrice
    ) internal pure {
        console.log("  positionToken:", positionToken);
        console.log("  collateral:   ", collateral);
        console.log("  oraclePrice:  ", oraclePrice, "(WAD)");
        console.log("");
        
        // Step 1: Currency ordering
        address currency0;
        address currency1;
        bool positionIsToken0;
        
        if (positionToken < collateral) {
            currency0 = positionToken;
            currency1 = collateral;
            positionIsToken0 = true;
        } else {
            currency0 = collateral;
            currency1 = positionToken;
            positionIsToken0 = false;
        }
        
        console.log("  STEP 1 - Currency Ordering:");
        console.log("    currency0:", currency0);
        console.log("    currency1:", currency1);
        console.log("    positionToken is Token", positionIsToken0 ? "0" : "1");
        console.log("");
        
        // Step 2: Price inversion
        uint256 indexPrice = oraclePrice;
        console.log("  STEP 2 - Price Processing:");
        console.log("    Original indexPrice:", indexPrice);
        
        if (!positionIsToken0) {
            indexPrice = 1e36 / indexPrice;
            console.log("    Inverted (positionToken is Token1):", indexPrice);
        } else {
            console.log("    No inversion needed (positionToken is Token0)");
        }
        console.log("");
        
        // Step 3: sqrtPriceX96 calculation
        uint256 sqrtIndex = FixedPointMathLib.sqrt(indexPrice);
        uint160 sqrtPriceX96 = uint160((sqrtIndex * Q96) / 1e9);
        
        console.log("  STEP 3 - sqrtPriceX96 Calculation:");
        console.log("    sqrt(indexPrice):", sqrtIndex);
        console.log("    sqrtPriceX96:    ", sqrtPriceX96);
        console.log("");
        
        // Step 4: Tick
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        console.log("  STEP 4 - Tick:");
        console.log("    tick:", tick);
        console.log("");
        
        // Step 5: Price bounds
        uint160 minSqrt;
        uint160 maxSqrt;
        if (positionIsToken0) {
            minSqrt = uint160(Q96 / 100);
            maxSqrt = uint160(Q96 * 10);
        } else {
            minSqrt = uint160(Q96 / 10);
            maxSqrt = uint160(Q96 * 100);
        }
        
        bool withinBounds = sqrtPriceX96 >= minSqrt && sqrtPriceX96 <= maxSqrt;
        
        console.log("  STEP 5 - Price Bounds:");
        console.log("    minSqrt:     ", minSqrt);
        console.log("    sqrtPriceX96:", sqrtPriceX96);
        console.log("    maxSqrt:     ", maxSqrt);
        console.log("    Within bounds:", withinBounds ? "YES" : "NO");
        console.log("");
        
        // Step 6: Decoded price
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 decodedPrice = (priceX192 * 1e18) >> 192;
        
        console.log("  STEP 6 - Price Interpretation:");
        console.log("    Decoded price (WAD):", decodedPrice);
        if (positionIsToken0) {
            console.log("    Meaning: 1 positionToken =", decodedPrice / 1e15, "/ 1000 collateral");
        } else {
            console.log("    Meaning: 1 collateral =", decodedPrice / 1e15, "/ 1000 positionToken");
        }
    }
}
