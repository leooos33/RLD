// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IBrokerModule} from "../../interfaces/IBrokerModule.sol";
import {ISpotOracle} from "../../interfaces/ISpotOracle.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {ITWAMM} from "v4-twamm-hook/src/ITWAMM.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/// @title TWAMM Broker Module
/// @notice Valuates active TWAMM orders and implements Cancel-and-Seize logic.
contract TwammBrokerModule is IBrokerModule {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for ERC20;

    struct VerifyParams {
        address hook; // TWAMM Address
        PoolKey key;
        ITWAMM.OrderKey orderKey;
        address oracle;
        address collateralToken;
        address underlyingToken;
    }

    /// @notice Returns the value of a TWAMM Order.
    function getValue(bytes calldata data) external view returns (uint256) {
        VerifyParams memory params = abi.decode(data, (VerifyParams));
        
        // 1. Get Order State
        ITWAMM.Order memory order = ITWAMM(params.hook).getOrder(params.key, params.orderKey);
        
        if (order.sellRate == 0) return 0;
        
        uint256 expiration = params.orderKey.expiration;
        if (block.timestamp >= expiration) return 0;
        
        uint256 remainingSeconds = expiration - block.timestamp;
        uint256 remainingSellAmount = (order.sellRate * remainingSeconds) / 1e18; // RATE_SCALER is 1e18
        
        uint256 totalValue = 0;
        
        address sellToken = params.orderKey.zeroForOne 
            ? Currency.unwrap(params.key.currency0) 
            : Currency.unwrap(params.key.currency1);
            
        if (remainingSellAmount > 0) {
            uint256 price = ISpotOracle(params.oracle).getSpotPrice(sellToken, params.underlyingToken);
            totalValue += remainingSellAmount.mulWadDown(price);
        }
        
        return totalValue;
    }

    /// @notice Seizes assets by Cancel & Claim.
    function seize(uint256 amount, address recipient, bytes calldata data) external returns (uint256 seizedValue) {
        VerifyParams memory params = abi.decode(data, (VerifyParams));

        ITWAMM(params.hook).cancelOrder(params.key, params.orderKey);
        
        uint256 realizedValue = 0;
        
        address[2] memory tokens = [params.collateralToken, params.underlyingToken];
        
        for (uint256 i = 0; i < 2; i++) {
            address token = tokens[i];
            uint256 balance = ERC20(token).balanceOf(address(this));
            
            if (balance > 0) {
                // Calculate Value
                uint256 price = ISpotOracle(params.oracle).getSpotPrice(token, params.underlyingToken);
                uint256 val = balance.mulWadDown(price);
                
                uint256 needed = amount - seizedValue;
                if (needed == 0) break;
                
                uint256 transferAmount;
                uint256 valueToSend;
                
                if (val <= needed) {
                    transferAmount = balance;
                    valueToSend = val;
                } else {
                    // val > needed. We need partial.
                    // transferAmount = balance * (needed / val)
                    transferAmount = balance.mulDivUp(needed, val);
                    valueToSend = needed;
                }
                
                ERC20(token).safeTransfer(recipient, transferAmount);
                seizedValue += valueToSend;
            }
        }
        
        return seizedValue;
    }
}
