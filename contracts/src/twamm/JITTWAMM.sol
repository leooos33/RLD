// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {IHooks, Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {
    IERC20Minimal
} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {
    ModifyLiquidityParams,
    SwapParams
} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Owned} from "solmate/src/auth/Owned.sol";

import {IJITTWAMM} from "./IJITTWAMM.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";
import {TwapOracle} from "./libraries/TwapOracle.sol";

/// @dev Scaling factor for sell rates to maintain precision
uint256 constant RATE_SCALER = 1e18;

/// @title JIT-TWAMM — Just-In-Time Time-Weighted Average Market Maker
/// @notice Redesign of Paradigm's TWAMM. Keeps O(1) accounting (aggregated sellRates +
///         earningsFactor snapshots) but replaces the broken execution layer (virtual curve
///         simulation → poolManager.swap dump) with a 3-layer matching engine:
///         Layer 1: Internal netting of opposing streams at TWAP (free)
///         Layer 2: JIT matching against external takers via beforeSwap (free)
///         Layer 3: Dynamic time-based auction for arb clearing (gas-only cost)
/// @author Zaha Studio
contract JITTWAMM is BaseHook, Owned, ReentrancyGuard, IJITTWAMM {
    using TransferHelper for IERC20Minimal;
    using PoolIdLibrary for PoolKey;
    using TickMath for int24;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;
    using TwapOracle for mapping(uint256 => TwapOracle.Observation);
    using TwapOracle for TwapOracle.State;

    /* ======================================================================== */
    /*                              CONSTANTS                                   */
    /* ======================================================================== */

    /// @notice Epoch interval for order expiry bucketing (e.g. 3600 = 1 hour)
    uint256 public immutable expirationInterval;

    /// @notice Discount growth rate: basis points per second (e.g. 1 = 0.01% per second)
    /// @dev At 1 bp/s, after 1 hour the discount is 3600 * 0.01% = 36%.
    ///      More conservatively, use smaller values.
    ///      Default: ~0.14 bps/s ≈ 0.5% per hour (configurable via governance)
    uint256 public discountRateBpsPerSecond = 1; // 0.01% per second → 36% per hour (adjustable)

    /// @notice Maximum discount cap in basis points (e.g. 50 = 0.5%)
    uint256 public maxDiscountBps = 50;

    /// @notice TWAP observation window in seconds for pricing
    uint32 public twapWindow = 300; // 5-minute TWAP

    /* ======================================================================== */
    /*                              STATE                                       */
    /* ======================================================================== */

    /// @notice Core JIT-TWAMM state per pool
    mapping(PoolId => JITState) internal poolStates;

    /// @notice Tokens owed to users from order earnings
    mapping(Currency => mapping(address => uint256)) public tokensOwed;

    /// @notice TWAP oracle observations
    mapping(PoolId => mapping(uint256 => TwapOracle.Observation))
        public observations;
    mapping(PoolId => TwapOracle.State) public oracleStates;

    /* ======================================================================== */
    /*                           CONSTRUCTOR                                    */
    /* ======================================================================== */

    constructor(
        IPoolManager _manager,
        address initialOwner,
        uint256 _expirationInterval
    ) BaseHook(_manager) Owned(initialOwner) {
        if (_expirationInterval == 0) revert InvalidExpirationInterval();
        expirationInterval = _expirationInterval;
    }

    /* ======================================================================== */
    /*                        ADMIN CONFIGURATION                               */
    /* ======================================================================== */

    /// @notice Update the discount rate (governance)
    function setDiscountRate(uint256 _bpsPerSecond) external onlyOwner {
        discountRateBpsPerSecond = _bpsPerSecond;
    }

    /// @notice Update the max discount cap (governance)
    function setMaxDiscount(uint256 _maxBps) external onlyOwner {
        maxDiscountBps = _maxBps;
    }

    /// @notice Update the TWAP window (governance)
    function setTwapWindow(uint32 _seconds) external onlyOwner {
        twapWindow = _seconds;
    }

    /* ======================================================================== */
    /*                        V4 HOOK LIFECYCLE                                 */
    /* ======================================================================== */

    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                beforeRemoveLiquidity: true,
                afterAddLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true, // KEY: We return deltas to fill takers internally
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    function _beforeInitialize(
        address,
        PoolKey calldata key,
        uint160
    ) internal override returns (bytes4) {
        if (key.currency0.isAddressZero()) revert PoolWithNativeNotSupported();

        PoolId poolId = key.toId();
        JITState storage state = poolStates[poolId];
        state.lastUpdateTimestamp = _getIntervalTime(block.timestamp);
        state.lastClearTimestamp = block.timestamp;

        // Initialize TWAP oracle
        observations[poolId].initialize(
            oracleStates[poolId],
            uint32(block.timestamp)
        );

        return BaseHook.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) internal override returns (bytes4) {
        _updateOracle(key);
        _accrueAndNet(key);
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeRemoveLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) internal override returns (bytes4) {
        _updateOracle(key);
        _accrueAndNet(key);
        return BaseHook.beforeRemoveLiquidity.selector;
    }

    /// @notice Layer 2: JIT intercept — fill external takers from accrued ghost balances
    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        _updateOracle(key);
        _accrueAndNet(key);

        PoolId poolId = key.toId();
        JITState storage state = poolStates[poolId];

        // Determine what the taker wants and what we have
        // If taker is zeroForOne (selling token0 for token1):
        //   - Taker provides token0, wants token1
        //   - We can fill if we have accrued1 (token1 ghost balance from 1→0 streams)
        // If taker is oneForZero (selling token1 for token0):
        //   - Taker provides token1, wants token0
        //   - We can fill if we have accrued0 (token0 ghost balance from 0→1 streams)

        uint256 availableToFill;
        if (params.zeroForOne) {
            availableToFill = state.accrued1; // We have token1 to give
        } else {
            availableToFill = state.accrued0; // We have token0 to give
        }

        if (availableToFill == 0 || params.amountSpecified == 0) {
            return (
                BaseHook.beforeSwap.selector,
                BeforeSwapDeltaLibrary.ZERO_DELTA,
                0
            );
        }

        // Get TWAP price for fair pricing
        uint160 twapSqrtPriceX96 = _getTwapPrice(key);

        // Calculate how much we can fill at TWAP price
        // For exact input (amountSpecified < 0): taker specifies input amount
        // For exact output (amountSpecified > 0): taker specifies output amount
        uint256 takerAmount;
        if (params.amountSpecified < 0) {
            takerAmount = uint256(-params.amountSpecified);
        } else {
            takerAmount = uint256(params.amountSpecified);
        }

        // Convert takerAmount to the token we're providing using TWAP price
        uint256 fillAmountInOutputToken;
        uint256 fillAmountInInputToken;

        if (params.amountSpecified < 0) {
            // Exact input: taker gives us X input tokens, we give them output tokens
            // Convert input amount to output amount at TWAP
            fillAmountInInputToken = takerAmount;
            fillAmountInOutputToken = _convertAtPrice(
                fillAmountInInputToken,
                twapSqrtPriceX96,
                params.zeroForOne
            );

            // Cap by our available balance
            if (fillAmountInOutputToken > availableToFill) {
                fillAmountInOutputToken = availableToFill;
                // Recalculate input based on capped output
                fillAmountInInputToken = _convertAtPrice(
                    fillAmountInOutputToken,
                    twapSqrtPriceX96,
                    !params.zeroForOne
                );
            }
        } else {
            // Exact output: taker wants X output tokens, will give us input tokens
            fillAmountInOutputToken = takerAmount;
            if (fillAmountInOutputToken > availableToFill) {
                fillAmountInOutputToken = availableToFill;
            }
            fillAmountInInputToken = _convertAtPrice(
                fillAmountInOutputToken,
                twapSqrtPriceX96,
                !params.zeroForOne
            );
        }

        if (fillAmountInOutputToken == 0 || fillAmountInInputToken == 0) {
            return (
                BaseHook.beforeSwap.selector,
                BeforeSwapDeltaLibrary.ZERO_DELTA,
                0
            );
        }

        // Update ghost balances
        if (params.zeroForOne) {
            state.accrued1 -= fillAmountInOutputToken;
            // Record earnings for the 1→0 stream (they sold token1, earned token0)
            _recordEarnings(state.stream1For0, fillAmountInInputToken);
        } else {
            state.accrued0 -= fillAmountInOutputToken;
            // Record earnings for the 0→1 stream (they sold token0, earned token1)
            _recordEarnings(state.stream0For1, fillAmountInInputToken);
        }

        // Build the BeforeSwapDelta
        // specified = amount the hook takes from the taker's specified side (positive = hook takes)
        // unspecified = amount on the other side (negative = hook gives to taker)
        BeforeSwapDelta delta;
        if (params.amountSpecified < 0) {
            // Exact input: hook takes input tokens, gives output tokens
            delta = toBeforeSwapDelta(
                int128(uint128(fillAmountInInputToken)), // take from specified (input)
                -int128(uint128(fillAmountInOutputToken)) // give on unspecified (output)
            );
        } else {
            // Exact output: hook gives output tokens, takes input tokens
            delta = toBeforeSwapDelta(
                int128(uint128(fillAmountInOutputToken)), // take from specified (output side)
                -int128(uint128(fillAmountInInputToken)) // give on unspecified (input side)
            );
        }

        emit JITFill(poolId, fillAmountInOutputToken, params.zeroForOne);

        return (BaseHook.beforeSwap.selector, delta, 0);
    }

    /* ======================================================================== */
    /*                       ORDER SUBMISSION & MANAGEMENT                      */
    /* ======================================================================== */

    /// @inheritdoc IJITTWAMM
    function submitOrder(
        SubmitOrderParams calldata params
    )
        external
        nonReentrant
        returns (bytes32 orderId, OrderKey memory orderKey)
    {
        _accrueAndNet(params.key);

        PoolId poolId = params.key.toId();
        uint256 currentInterval = _getIntervalTime(block.timestamp);

        orderKey = OrderKey({
            owner: msg.sender,
            expiration: (currentInterval + params.duration).toUint160(),
            zeroForOne: params.zeroForOne
        });

        if (orderKey.expiration <= block.timestamp) {
            revert ExpirationLessThanBlockTime(orderKey.expiration);
        }
        if (orderKey.expiration % expirationInterval != 0) {
            revert ExpirationNotOnInterval(orderKey.expiration);
        }

        uint256 sellRate = params.amountIn / params.duration;
        if (sellRate == 0) revert SellRateCannotBeZero();

        uint256 scaledSellRate = sellRate * RATE_SCALER;
        orderId = _orderId(orderKey);

        JITState storage state = poolStates[poolId];
        if (state.lastUpdateTimestamp == 0) revert NotInitialized();
        if (state.orders[orderId].sellRate != 0)
            revert OrderAlreadyExists(orderKey);

        // Update aggregate stream state
        StreamPool storage stream = params.zeroForOne
            ? state.stream0For1
            : state.stream1For0;

        stream.sellRateCurrent += scaledSellRate;
        stream.sellRateEndingAtInterval[orderKey.expiration] += scaledSellRate;

        uint256 earningsFactorLast = stream.earningsFactorCurrent;
        state.orders[orderId] = Order({
            sellRate: scaledSellRate,
            earningsFactorLast: earningsFactorLast
        });

        // Transfer tokens from user
        IERC20Minimal(
            params.zeroForOne
                ? Currency.unwrap(params.key.currency0)
                : Currency.unwrap(params.key.currency1)
        ).safeTransferFrom(
                msg.sender,
                address(this),
                sellRate * params.duration
            );

        emit SubmitOrder(
            poolId,
            orderId,
            msg.sender,
            params.amountIn,
            orderKey.expiration,
            params.zeroForOne,
            sellRate,
            earningsFactorLast
        );
    }

    /// @inheritdoc IJITTWAMM
    function cancelOrder(
        PoolKey calldata key,
        OrderKey calldata orderKey
    )
        external
        nonReentrant
        returns (uint256 buyTokensOut, uint256 sellTokensRefund)
    {
        if (msg.sender != orderKey.owner) revert Unauthorized();

        buyTokensOut = _sync(key, orderKey);

        PoolId poolId = key.toId();
        JITState storage state = poolStates[poolId];
        bytes32 orderId = _orderId(orderKey);
        Order storage order = state.orders[orderId];

        uint256 sellRate = order.sellRate;
        if (sellRate == 0) revert OrderDoesNotExist(orderKey);
        if (state.lastUpdateTimestamp >= orderKey.expiration)
            revert OrderAlreadyExpired(orderKey);

        // Update stream state
        StreamPool storage stream = orderKey.zeroForOne
            ? state.stream0For1
            : state.stream1For0;

        stream.sellRateCurrent -= sellRate;
        stream.sellRateEndingAtInterval[orderKey.expiration] -= sellRate;

        // Calculate refund
        uint256 remainingSeconds = orderKey.expiration -
            state.lastUpdateTimestamp;
        sellTokensRefund = (sellRate * remainingSeconds) / RATE_SCALER;

        delete state.orders[orderId];

        // Transfer refund
        Currency sellToken = orderKey.zeroForOne
            ? key.currency0
            : key.currency1;
        IERC20Minimal(Currency.unwrap(sellToken)).safeTransfer(
            msg.sender,
            sellTokensRefund
        );

        // Claim earned tokens
        Currency buyToken = orderKey.zeroForOne ? key.currency1 : key.currency0;
        uint256 owed = tokensOwed[buyToken][msg.sender];
        if (owed > 0) {
            tokensOwed[buyToken][msg.sender] = 0;
            IERC20Minimal(Currency.unwrap(buyToken)).safeTransfer(
                msg.sender,
                owed
            );
            buyTokensOut += owed;
        }

        emit CancelOrder(poolId, orderId, msg.sender, sellTokensRefund);
    }

    /// @inheritdoc IJITTWAMM
    function sync(
        SyncParams calldata params
    ) public returns (uint256 earningsAmount) {
        return _sync(params.key, params.orderKey);
    }

    /// @notice Internal sync implementation accepting memory params
    function _sync(
        PoolKey memory poolKey,
        OrderKey memory orderKey
    ) internal returns (uint256 earningsAmount) {
        _accrueAndNet(poolKey);

        PoolId poolId = poolKey.toId();
        JITState storage state = poolStates[poolId];
        bytes32 orderId = _orderId(orderKey);
        Order storage order = state.orders[orderId];

        if (order.sellRate == 0)
            revert OrderDoesNotExist(
                OrderKey(
                    orderKey.owner,
                    orderKey.expiration,
                    orderKey.zeroForOne
                )
            );

        StreamPool storage stream = orderKey.zeroForOne
            ? state.stream0For1
            : state.stream1For0;

        // Calculate earnings since last sync
        uint256 earningsFactorDelta = stream.earningsFactorCurrent -
            order.earningsFactorLast;
        if (earningsFactorDelta > 0) {
            earningsAmount = Math.mulDiv(
                order.sellRate,
                earningsFactorDelta,
                FixedPoint96.Q96 * RATE_SCALER
            );

            // Credit buy token to user
            Currency buyToken = orderKey.zeroForOne
                ? poolKey.currency1
                : poolKey.currency0;
            tokensOwed[buyToken][orderKey.owner] += earningsAmount;
        }

        // Update snapshot
        order.earningsFactorLast = stream.earningsFactorCurrent;
    }

    /// @inheritdoc IJITTWAMM
    function claimTokens(Currency currency) external returns (uint256 amount) {
        amount = tokensOwed[currency][msg.sender];
        if (amount > 0) {
            tokensOwed[currency][msg.sender] = 0;
            IERC20Minimal(Currency.unwrap(currency)).safeTransfer(
                msg.sender,
                amount
            );
        }
    }

    /* ======================================================================== */
    /*                     LAYER 3: DYNAMIC AUCTION CLEAR                       */
    /* ======================================================================== */

    /// @inheritdoc IJITTWAMM
    function clear(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 maxAmount
    ) external nonReentrant {
        _accrueAndNet(key);

        PoolId poolId = key.toId();
        JITState storage state = poolStates[poolId];

        // zeroForOne = true means arb wants to buy accrued token0 (pays token1)
        uint256 available = zeroForOne ? state.accrued0 : state.accrued1;
        if (available == 0) revert NothingToClear();

        uint256 clearAmount = available > maxAmount ? maxAmount : available;

        // Calculate dynamic discount
        uint256 elapsedSinceClear = block.timestamp - state.lastClearTimestamp;
        uint256 discountBps = elapsedSinceClear * discountRateBpsPerSecond;
        if (discountBps > maxDiscountBps) discountBps = maxDiscountBps;

        // Get TWAP price
        uint160 twapSqrtPriceX96 = _getTwapPrice(key);

        // Calculate payment: arb pays (clearAmount * price * (1 - discount))
        uint256 fullPayment = _convertAtPrice(
            clearAmount,
            twapSqrtPriceX96,
            zeroForOne
        );
        uint256 discountedPayment = fullPayment -
            ((fullPayment * discountBps) / 10000);

        // Take payment from arb
        Currency paymentToken = zeroForOne ? key.currency1 : key.currency0;
        IERC20Minimal(Currency.unwrap(paymentToken)).safeTransferFrom(
            msg.sender,
            address(this),
            discountedPayment
        );

        // Give arb the cleared tokens
        Currency clearToken = zeroForOne ? key.currency0 : key.currency1;
        IERC20Minimal(Currency.unwrap(clearToken)).safeTransfer(
            msg.sender,
            clearAmount
        );

        // Update ghost balance
        if (zeroForOne) {
            state.accrued0 -= clearAmount;
            // Record earnings for the 0→1 stream (sold token0, earned token1)
            _recordEarnings(state.stream0For1, discountedPayment);
        } else {
            state.accrued1 -= clearAmount;
            // Record earnings for the 1→0 stream (sold token1, earned token0)
            _recordEarnings(state.stream1For0, discountedPayment);
        }

        state.lastClearTimestamp = block.timestamp;

        emit AuctionClear(poolId, msg.sender, clearAmount, discountBps);
    }

    /* ======================================================================== */
    /*                          VIEW FUNCTIONS                                  */
    /* ======================================================================== */

    /// @inheritdoc IJITTWAMM
    function getStreamState(
        PoolKey calldata key
    )
        external
        view
        returns (
            uint256 accrued0,
            uint256 accrued1,
            uint256 currentDiscount,
            uint256 timeSinceLastClear
        )
    {
        PoolId poolId = key.toId();
        JITState storage state = poolStates[poolId];

        // Calculate pending accrual (not yet committed)
        uint256 deltaTime = block.timestamp - state.lastUpdateTimestamp;
        accrued0 =
            state.accrued0 +
            ((state.stream0For1.sellRateCurrent * deltaTime) / RATE_SCALER);
        accrued1 =
            state.accrued1 +
            ((state.stream1For0.sellRateCurrent * deltaTime) / RATE_SCALER);

        timeSinceLastClear = block.timestamp - state.lastClearTimestamp;
        currentDiscount = timeSinceLastClear * discountRateBpsPerSecond;
        if (currentDiscount > maxDiscountBps) currentDiscount = maxDiscountBps;
    }

    /// @inheritdoc IJITTWAMM
    function getOrder(
        PoolKey calldata key,
        OrderKey calldata orderKey
    ) external view returns (Order memory) {
        return poolStates[key.toId()].orders[_orderId(orderKey)];
    }

    /// @inheritdoc IJITTWAMM
    function getStreamPool(
        PoolKey calldata key,
        bool zeroForOne
    )
        external
        view
        returns (uint256 sellRateCurrent, uint256 earningsFactorCurrent)
    {
        JITState storage state = poolStates[key.toId()];
        StreamPool storage stream = zeroForOne
            ? state.stream0For1
            : state.stream1For0;
        return (stream.sellRateCurrent, stream.earningsFactorCurrent);
    }

    /* ======================================================================== */
    /*                         INTERNAL: CORE ENGINE                            */
    /* ======================================================================== */

    /// @notice The heart of the system: accrue ghost balances, cross epochs, and net internally
    function _accrueAndNet(PoolKey memory key) internal {
        PoolId poolId = key.toId();
        JITState storage state = poolStates[poolId];

        if (state.lastUpdateTimestamp == 0) return; // Not initialized

        uint256 currentTime = block.timestamp;
        if (currentTime <= state.lastUpdateTimestamp) return; // No time passed

        uint256 deltaTime = currentTime - state.lastUpdateTimestamp;

        // === Step 1: Accrue ghost balances ===
        uint256 newAccrued0 = (state.stream0For1.sellRateCurrent * deltaTime) /
            RATE_SCALER;
        uint256 newAccrued1 = (state.stream1For0.sellRateCurrent * deltaTime) /
            RATE_SCALER;

        state.accrued0 += newAccrued0;
        state.accrued1 += newAccrued1;

        // === Step 2: Cross epoch boundaries (subtract expired sellRates) ===
        uint256 lastInterval = _getIntervalTime(state.lastUpdateTimestamp);
        uint256 currentInterval = _getIntervalTime(currentTime);

        if (currentInterval > lastInterval) {
            // Walk through each crossed epoch
            for (
                uint256 epoch = lastInterval + expirationInterval;
                epoch <= currentInterval;
                epoch += expirationInterval
            ) {
                _crossEpoch(state.stream0For1, epoch);
                _crossEpoch(state.stream1For0, epoch);
            }
        }

        // === Step 3: Layer 1 — Internal Netting ===
        if (state.accrued0 > 0 && state.accrued1 > 0) {
            _internalNet(key, state);
        }

        state.lastUpdateTimestamp = currentTime;
    }

    /// @notice Cross an epoch boundary: snapshot earningsFactor and subtract expired sellRate
    function _crossEpoch(StreamPool storage stream, uint256 epoch) internal {
        uint256 expiring = stream.sellRateEndingAtInterval[epoch];
        if (expiring > 0) {
            stream.earningsFactorAtInterval[epoch] = stream
                .earningsFactorCurrent;
            stream.sellRateCurrent -= expiring;
        }
    }

    /// @notice Layer 1: Net opposing ghost balances at TWAP price
    function _internalNet(PoolKey memory key, JITState storage state) internal {
        uint160 twapPrice = _getTwapPrice(key);

        // Convert accrued1 to token0 terms at TWAP to find matchable amount
        uint256 accrued1AsToken0 = _convertAtPrice(
            state.accrued1,
            twapPrice,
            false
        );

        uint256 matchedToken0;
        uint256 matchedToken1;

        if (state.accrued0 <= accrued1AsToken0) {
            // All of accrued0 can be matched
            matchedToken0 = state.accrued0;
            matchedToken1 = _convertAtPrice(matchedToken0, twapPrice, true);
        } else {
            // All of accrued1 can be matched
            matchedToken1 = state.accrued1;
            matchedToken0 = accrued1AsToken0;
        }

        if (matchedToken0 == 0 || matchedToken1 == 0) return;

        // Record earnings for both streams
        _recordEarnings(state.stream0For1, matchedToken1); // 0→1 earns token1
        _recordEarnings(state.stream1For0, matchedToken0); // 1→0 earns token0

        state.accrued0 -= matchedToken0;
        state.accrued1 -= matchedToken1;

        emit InternalMatch(key.toId(), matchedToken0, matchedToken1);
    }

    /// @notice Record earnings into a stream's earningsFactor
    function _recordEarnings(
        StreamPool storage stream,
        uint256 earnings
    ) internal {
        if (stream.sellRateCurrent == 0 || earnings == 0) return;

        uint256 earningsFactor = Math.mulDiv(
            earnings,
            FixedPoint96.Q96 * RATE_SCALER,
            stream.sellRateCurrent
        );
        stream.earningsFactorCurrent += earningsFactor;
    }

    /* ======================================================================== */
    /*                        INTERNAL: PRICE HELPERS                           */
    /* ======================================================================== */

    /// @notice Get the TWAP price from our oracle
    function _getTwapPrice(PoolKey memory key) internal view returns (uint160) {
        PoolId poolId = key.toId();
        TwapOracle.State storage oracleState = oracleStates[poolId];

        if (oracleState.cardinality < 2) {
            // Not enough observations, fall back to spot price
            (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(poolId);
            return sqrtPriceX96;
        }

        // Get tick cumulatives for TWAP calculation
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        (, int24 currentTick, , ) = poolManager.getSlot0(poolId);

        int56[] memory tickCumulatives = observations[poolId].observe(
            oracleState,
            uint32(block.timestamp),
            secondsAgos,
            currentTick
        );

        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(tickDelta / int56(uint56(twapWindow)));

        return TickMath.getSqrtPriceAtTick(avgTick);
    }

    /// @notice Convert an amount at a given sqrtPriceX96
    /// @param amount The input amount
    /// @param sqrtPriceX96 The price
    /// @param zeroForOne If true, convert token0 → token1. If false, token1 → token0.
    function _convertAtPrice(
        uint256 amount,
        uint160 sqrtPriceX96,
        bool zeroForOne
    ) internal pure returns (uint256) {
        if (amount == 0) return 0;

        if (zeroForOne) {
            // token0 → token1: output = amount * price^2
            // price = sqrtPriceX96 / 2^96
            // amount1 = amount0 * (sqrtPriceX96)^2 / (2^96)^2
            return
                Math.mulDiv(
                    Math.mulDiv(amount, sqrtPriceX96, FixedPoint96.Q96),
                    sqrtPriceX96,
                    FixedPoint96.Q96
                );
        } else {
            // token1 → token0: output = amount / price^2
            // amount0 = amount1 * (2^96)^2 / (sqrtPriceX96)^2
            return
                Math.mulDiv(
                    Math.mulDiv(amount, FixedPoint96.Q96, sqrtPriceX96),
                    FixedPoint96.Q96,
                    sqrtPriceX96
                );
        }
    }

    /// @notice Update the TWAP oracle
    function _updateOracle(PoolKey memory key) internal {
        PoolId poolId = key.toId();
        (, int24 tick, , ) = poolManager.getSlot0(poolId);
        observations[poolId].write(
            oracleStates[poolId],
            uint32(block.timestamp),
            tick
        );
    }

    /* ======================================================================== */
    /*                        INTERNAL: HELPERS                                 */
    /* ======================================================================== */

    /// @notice Round a timestamp down to the nearest interval boundary
    function _getIntervalTime(
        uint256 timestamp
    ) internal view returns (uint256) {
        return (timestamp / expirationInterval) * expirationInterval;
    }

    /// @notice Generate a unique order ID from an OrderKey
    function _orderId(OrderKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}
