// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PrimeBroker} from "../rld/broker/PrimeBroker.sol";
import {IERC20} from "../shared/interfaces/IERC20.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {CurrencySettler} from "v4-core/test/utils/CurrencySettler.sol";

/// @title LeverageShortExecutor - Single-swap leverage short via BrokerExecutor pattern
/// @notice Executes optimal leverage short: mint max debt → single swap → deposit all proceeds
/// @dev Uses type(uint256).max as sentinel for "use all balance"
contract LeverageShortExecutor is ReentrancyGuard {
    using CurrencySettler for Currency;

    IPoolManager public immutable poolManager;
    
    /// @notice Sentinel value meaning "use entire balance"
    uint256 public constant USE_ALL_BALANCE = type(uint256).max;
    
    struct SwapCallback {
        address sender;
        PoolKey key;
        SwapParams params;
    }
    
    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }
    
    /// @notice Execute leveraged short in one atomic transaction
    /// @param broker The PrimeBroker address
    /// @param marketId The market to short
    /// @param collateralToken waUSDC address
    /// @param positionToken wRLP address
    /// @param initialCollateral Amount of initial collateral already in broker
    /// @param targetDebtAmount Total wRLP to mint (pre-calculated for target leverage)
    /// @param poolKey V4 pool key for swap
    /// @param ownerSignature EIP-191 signature from broker owner
    function executeLeverageShort(
        address broker,
        bytes32 marketId,
        address collateralToken,
        address positionToken,
        uint256 initialCollateral,
        uint256 targetDebtAmount,
        PoolKey calldata poolKey,
        bytes calldata ownerSignature
    ) external nonReentrant {
        PrimeBroker pb = PrimeBroker(payable(broker));
        
        // 1. Set self as operator
        uint256 nonce = pb.operatorNonces(address(this));
        pb.setOperatorWithSignature(address(this), true, ownerSignature, nonce);
        
        // 2. Deposit initial collateral and mint all target debt
        pb.modifyPosition(marketId, int256(initialCollateral), int256(targetDebtAmount));
        
        // 3. Withdraw wRLP to this executor
        pb.withdrawPositionToken(address(this), targetDebtAmount);
        
        // 4. Approve pool manager for swap
        IERC20(positionToken).approve(address(poolManager), targetDebtAmount);
        
        // 5. Single swap: wRLP → waUSDC
        bool zeroForOne = positionToken < collateralToken;
        
        SwapParams memory swapParams = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(targetDebtAmount),  // exact input
            sqrtPriceLimitX96: zeroForOne 
                ? 4295128740  // MIN_SQRT_PRICE + 1
                : 1461446703485210103287273052203988822378723970341  // MAX_SQRT_PRICE - 1
        });
        
        BalanceDelta delta = abi.decode(
            poolManager.unlock(abi.encode(SwapCallback({
                sender: address(this),
                key: poolKey,
                params: swapParams
            }))),
            (BalanceDelta)
        );
        
        // Calculate proceeds (the token we received)
        uint256 proceeds = zeroForOne 
            ? uint256(int256(delta.amount1())) 
            : uint256(int256(delta.amount0()));
        
        // 6. Transfer ALL proceeds back to broker (USE_ALL_BALANCE pattern)
        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        IERC20(collateralToken).transfer(broker, collateralBalance);
        
        // 7. Deposit proceeds as additional collateral (no new debt)
        // Using actual balance since we know it now
        pb.modifyPosition(marketId, int256(collateralBalance), int256(0));
        
        // 8. Revoke operator
        pb.setOperator(address(this), false);
    }
    
    /// @notice Callback for V4 swap
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Not PM");
        
        SwapCallback memory data = abi.decode(rawData, (SwapCallback));
        
        BalanceDelta delta = poolManager.swap(data.key, data.params, new bytes(0));
        
        // Settle tokens
        if (data.params.zeroForOne) {
            if (delta.amount0() < 0) {
                data.key.currency0.settle(poolManager, data.sender, uint256(-int256(delta.amount0())), false);
            }
            if (delta.amount1() > 0) {
                data.key.currency1.take(poolManager, data.sender, uint256(int256(delta.amount1())), false);
            }
        } else {
            if (delta.amount1() < 0) {
                data.key.currency1.settle(poolManager, data.sender, uint256(-int256(delta.amount1())), false);
            }
            if (delta.amount0() > 0) {
                data.key.currency0.take(poolManager, data.sender, uint256(int256(delta.amount0())), false);
            }
        }
        
        return abi.encode(delta);
    }
    
    /// @notice Calculate optimal debt for target leverage
    /// @param collateralAmount Initial collateral
    /// @param targetLTV Target loan-to-value (e.g., 40 = 40%)
    /// @param wRLPPriceE6 wRLP price in collateral terms (6 decimals)
    /// @return debtAmount Amount of wRLP to mint
    function calculateOptimalDebt(
        uint256 collateralAmount,
        uint256 targetLTV,
        uint256 wRLPPriceE6
    ) external pure returns (uint256 debtAmount) {
        // For iterative leverage: final_collateral = initial / (1 - LTV)
        // target_debt_value = final_collateral * LTV = initial * LTV / (1 - LTV)
        // debt_amount = target_debt_value / wRLP_price
        
        uint256 targetDebtValue = (collateralAmount * targetLTV) / (100 - targetLTV);
        debtAmount = (targetDebtValue * 1e6) / wRLPPriceE6;
    }
    
    /// @notice Generate message hash for signature
    function getMessageHash(address broker, uint256 nonce) external view returns (bytes32) {
        return keccak256(abi.encode(address(this), broker, nonce, address(this)));
    }
    
    function getEthSignedMessageHash(address broker, uint256 nonce) external view returns (bytes32) {
        bytes32 messageHash = keccak256(abi.encode(address(this), broker, nonce, address(this)));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
    }
}
