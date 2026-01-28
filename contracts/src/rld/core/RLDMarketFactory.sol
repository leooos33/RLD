// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRLDCore, MarketId} from "../../shared/interfaces/IRLDCore.sol";
import {PositionToken} from "../tokens/PositionToken.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol"; 
import {IRLDOracle} from "../../shared/interfaces/IRLDOracle.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PrimeBrokerFactory} from "./PrimeBrokerFactory.sol";
import {BrokerVerifier} from "../modules/verifier/BrokerVerifier.sol";
import {UniswapV4SingletonOracle} from "../modules/oracles/UniswapV4SingletonOracle.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {TWAMM as TwammHook} from "../../twamm/TWAMM.sol";

/**
 * @title RLDMarketFactory
 * @author RLD Protocol
 * @notice Factory contract for deploying new RLD markets with Uniswap V4 integration
 * @dev Orchestrates atomic deployment of:
 *      1. PrimeBrokerFactory - Creates individual broker instances for positions
 *      2. BrokerVerifier - Validates broker authenticity
 *      3. PositionToken (wRLP) - ERC20 representing LP positions
 *      4. Uniswap V4 Pool - AMM pool for wRLP <-> collateral trading
 *      5. Market registration with RLDCore
 *
 * The factory ensures deterministic MarketId generation and prevents duplicate markets.
 * All critical addresses are validated at construction time.
 *
 * @custom:security-considerations
 * - Only owner can create markets (access controlled)
 * - MarketId is deterministically computed and verified post-deployment
 * - All oracle and module addresses must be non-zero
 * - Price bounds are set on TWAMM to prevent extreme price manipulation
 */
contract RLDMarketFactory {
    using Clones for address;
    using PoolIdLibrary for PoolKey;

    /* ============================================================================================ */
    /*                                            OWNER                                             */
    /* ============================================================================================ */

    /// @notice The owner of the factory with exclusive market creation rights
    address public owner;
    
    /// @dev Restricts function access to the contract owner
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    /// @notice Thrown when a non-owner attempts a restricted action
    error NotOwner();
    
    /// @notice Thrown when an invalid address is provided
    error InvalidAddress();

    /* ============================================================================================ */
    /*                                          IMMUTABLES                                          */
    /* ============================================================================================ */

    /// @notice The funding period (e.g., 30 days)
    uint32 public immutable FUNDING_PERIOD;

    /// @notice The RLDCore contract that manages all markets
    address public immutable CORE;
    
    /// @notice Uniswap V4 PoolManager for pool operations
    address public immutable POOL_MANAGER;
    
    /// @notice Implementation contract for PositionToken clones
    address public immutable POSITION_TOKEN_IMPL;
    
    /// @notice Implementation contract for PrimeBroker clones
    address public immutable PRIME_BROKER_IMPL;
    
    /// @notice Singleton oracle for Uniswap V4 TWAP price queries
    address public immutable SINGLETON_V4_ORACLE;
    
    /// @notice TWAMM hook for time-weighted AMM functionality (can be address(0) for testing)
    address public immutable TWAMM;
    
    /// @notice Standard funding model for interest rate calculations
    address public immutable STD_FUNDING_MODEL;

    /// @notice Metadata renderer for NFT display
    address public immutable METADATA_RENDERER;

    /* ============================================================================================ */
    /*                                            STORAGE                                           */
    /* ============================================================================================ */

    /**
     * @notice Maps canonical key to MarketId to prevent duplicate markets
     * @dev Key = keccak256(abi.encode(collateralToken, underlyingToken, underlyingPool))
     *      This matches exactly with the MarketId computation in _precomputeId()
     */
    mapping(bytes32 => MarketId) public canonicalMarkets;
    
    /// @notice Thrown when attempting to create a market that already exists
    error MarketAlreadyExists();
    
    /// @notice Thrown when the computed MarketId doesn't match the expected value
    error IDMismatch();

    /* ============================================================================================ */
    /*                                            STRUCTS                                           */
    /* ============================================================================================ */

    /**
     * @notice Configuration parameters for creating a new RLD Market
     * @dev All addresses are validated in _validateParams() before use
     *
     * @param underlyingPool The lending pool (e.g., Aave V3) that holds the underlying asset
     * @param underlyingToken The base asset (e.g., USDC) - what asset is being structured
     * @param collateralToken The yield-bearing collateral (e.g., aUSDC) - backs the wRLP token
     * @param curator The risk manager address for this market
     * @param positionTokenName Human-readable name for the wRLP token (e.g., "Wrapped RLP: aUSDC")
     * @param positionTokenSymbol Token symbol for the wRLP token (e.g., "wRLP-aUSDC")
     * @param minColRatio Minimum initial collateralization ratio in WAD (e.g., 1.2e18 = 120%)
     * @param maintenanceMargin Maintenance collateralization ratio in WAD (e.g., 1.1e18 = 110%)
     * @param liquidationCloseFactor Max portion liquidatable in single tx in WAD (e.g., 0.5e18 = 50%)
     * @param liquidationModule Contract handling liquidation logic
     * @param liquidationParams Encoded parameters for the liquidation module
     * @param spotOracle External oracle for spot price (e.g., Chainlink)
     * @param rateOracle External oracle for interest rates (e.g., Aave rates)
     * @param oraclePeriod TWAP observation window in seconds (e.g., 3600 = 1 hour)
     * @param poolFee Uniswap V4 pool fee tier in hundredths of bips (e.g., 3000 = 0.3%)
     * @param tickSpacing Uniswap V4 tick spacing (e.g., 60)
     */
    struct DeployParams {
        // --- Assets ---
        address underlyingPool;
        address underlyingToken;
        address collateralToken;
        address curator;
        
        // --- Token Metadata ---
        string positionTokenName;
        string positionTokenSymbol;
        
        // --- Risk Parameters ---
        uint64 minColRatio;
        uint64 maintenanceMargin;
        uint64 liquidationCloseFactor;
        address liquidationModule;
        bytes32 liquidationParams;
        
        // --- Oracle Configuration ---
        address spotOracle;
        address rateOracle;
        uint32 oraclePeriod;
        
        // --- V4 Pool Configuration ---
        uint24 poolFee;
        int24 tickSpacing;
    }

    /**
     * @notice Emitted when a new market is successfully deployed
     * @param id The unique MarketId for the new market
     * @param underlyingPool The lending pool address
     * @param collateral The collateral token address
     */
    event MarketDeployed(MarketId indexed id, address indexed underlyingPool, address indexed collateral);

    /* ============================================================================================ */
    /*                                         CONSTRUCTOR                                          */
    /* ============================================================================================ */

    /**
     * @notice Initializes the factory with all required protocol addresses
     * @dev All addresses except TWAMM are validated to be non-zero
     *      TWAMM can be address(0) for testing without V4 hooks
     *
     * @param core RLDCore contract address
     * @param poolManager Uniswap V4 PoolManager address
     * @param positionTokenImpl PositionToken implementation for cloning
     * @param primeBrokerImpl PrimeBroker implementation for cloning
     * @param v4Oracle UniswapV4SingletonOracle address
     * @param fundingModel Standard funding model address
     * @param twamm TWAMM hook address (can be address(0) for testing)
     * @param metadataRenderer NFT metadata renderer address
     * @param _fundingPeriod Funding period in seconds (e.g., 30 days = 2592000)
     */
    constructor(
        address core, 
        address poolManager, 
        address positionTokenImpl,
        address primeBrokerImpl,
        address v4Oracle,
        address fundingModel,
        address twamm,
        address metadataRenderer,
        uint32 _fundingPeriod
    ) {
        // Validate all critical immutables (TWAMM can be 0 for testing)
        require(core != address(0), "Invalid Core");
        require(poolManager != address(0), "Invalid PoolManager");
        require(positionTokenImpl != address(0), "Invalid PositionTokenImpl");
        require(primeBrokerImpl != address(0), "Invalid PrimeBrokerImpl");
        require(v4Oracle != address(0), "Invalid V4Oracle");
        require(fundingModel != address(0), "Invalid FundingModel");
        require(metadataRenderer != address(0), "Invalid MetadataRenderer");
        
        owner = msg.sender;
        
        CORE = core;
        POOL_MANAGER = poolManager;
        POSITION_TOKEN_IMPL = positionTokenImpl;
        PRIME_BROKER_IMPL = primeBrokerImpl;
        SINGLETON_V4_ORACLE = v4Oracle;
        STD_FUNDING_MODEL = fundingModel;
        TWAMM = twamm;
        METADATA_RENDERER = metadataRenderer;
        FUNDING_PERIOD = _fundingPeriod;
    }

    /* ============================================================================================ */
    /*                                     EXTERNAL FUNCTIONS                                       */
    /* ============================================================================================ */

    /**
     * @notice Deploys a new RLD market with full Uniswap V4 integration
     * @dev Executes a 7-phase atomic deployment:
     *      1. Validation - Fail fast on invalid params
     *      2. Identification - Precompute deterministic MarketId
     *      3. Infrastructure - Deploy PrimeBrokerFactory + BrokerVerifier
     *      4. Assets - Clone and initialize PositionToken (wRLP)
     *      5. Mechanics - Initialize V4 pool with correct pricing
     *      6. Registration - Register market with RLDCore
     *      7. Verification - Assert MarketId matches expectation
     *
     * @param params Complete market configuration (see DeployParams struct)
     * @return marketId The unique identifier for the created market
     * @return brokerFactory Address of the deployed PrimeBrokerFactory
     *
     * @custom:security Only callable by owner
     * @custom:reverts MarketAlreadyExists if market with same params exists
     * @custom:reverts IDMismatch if computed ID differs from RLDCore's
     */
    function createMarket(DeployParams calldata params) 
        external 
        onlyOwner 
        returns (MarketId marketId, address brokerFactory) 
    {
        // 1. Validation Phase (Fail Fast)
        _validateParams(params);

        // 2. Identification Phase - Compute expected MarketId
        MarketId futureId = _precomputeId(params);

        // 3. Infrastructure Phase - Deploy broker infrastructure
        address verifier;
        (brokerFactory, verifier) = _deployInfrastructure(futureId, params);

        // 4. Asset Phase - Deploy position token
        address positionToken = _deployPositionToken(params);

        // 5. Market Mechanics Phase - Initialize Uniswap V4 pool
        _initializePool(positionToken, params);

        // 6. Registration Phase - Register with RLDCore
        marketId = _registerMarket(params, positionToken, verifier);

        // 7. Post-Condition Check (Critical Security Invariant)
        // Ensures deterministic ID generation is consistent with RLDCore
        if (MarketId.unwrap(marketId) != MarketId.unwrap(futureId)) {
            revert IDMismatch();
        }
    }

    /* ============================================================================================ */
    /*                                     INTERNAL FUNCTIONS                                       */
    /* ============================================================================================ */

    /**
     * @notice Validates all deployment parameters
     * @dev Checks for:
     *      - Non-zero critical addresses
     *      - Sane risk parameters (minColRatio > 100%, minColRatio > maintenanceMargin)
     *      - Valid V4 configuration (positive tickSpacing and oraclePeriod)
     *
     * @param params The deployment parameters to validate
     */
    function _validateParams(DeployParams calldata params) internal pure {
        // Critical Address Checks
        require(params.underlyingPool != address(0), "Invalid Pool");
        require(params.underlyingToken != address(0), "Invalid Underlying");
        require(params.collateralToken != address(0), "Invalid Collateral");
        require(params.liquidationModule != address(0), "Invalid LiqModule");
        require(params.spotOracle != address(0), "Invalid SpotOracle");
        require(params.rateOracle != address(0), "Invalid RateOracle");
        
        // Risk Parameter Logic Checks
        require(params.minColRatio > 1e18, "MinCol < 100%");
        require(params.maintenanceMargin > 0, "Invalid MaintenanceMargin");
        require(params.minColRatio > params.maintenanceMargin, "Risk Config Error");
        require(
            params.liquidationCloseFactor > 0 && params.liquidationCloseFactor <= 1e18, 
            "Invalid CloseFactor"
        );
        
        // V4 Configuration Checks
        require(params.tickSpacing > 0, "Invalid TickSpacing");
        require(params.oraclePeriod > 0, "Invalid OraclePeriod");
    }

    /**
     * @notice Precomputes the deterministic MarketId
     * @dev MarketId = keccak256(collateralToken, underlyingToken, underlyingPool)
     *      This must match RLDCore.createMarket() computation exactly
     *
     * @param params Deployment parameters containing the three key addresses
     * @return The precomputed MarketId
     */
    function _precomputeId(DeployParams calldata params) internal pure returns (MarketId) {
        return MarketId.wrap(keccak256(abi.encode(
            params.collateralToken,
            params.underlyingToken,
            params.underlyingPool
        )));
    }

    /**
     * @notice Deploys broker infrastructure for the market
     * @dev Creates:
     *      1. PrimeBrokerFactory - Clones PrimeBroker instances for each position
     *      2. BrokerVerifier - Validates that brokers belong to this factory
     *
     * @param id The MarketId for naming the NFT collection
     * @param params Deployment parameters (uses underlyingToken for symbol)
     * @return factory The deployed PrimeBrokerFactory address
     * @return verifier The deployed BrokerVerifier address
     */
    function _deployInfrastructure(
        MarketId id, 
        DeployParams calldata params
    ) internal returns (address factory, address verifier) {
        // Build NFT metadata from underlying token
        string memory symbol = ERC20(params.underlyingToken).symbol();
        string memory name = string(abi.encodePacked("RLD: ", symbol));
        string memory nftSymbol = string(abi.encodePacked("RLD-", symbol));

        // Deploy factory for this market
        PrimeBrokerFactory pbFactory = new PrimeBrokerFactory(
            PRIME_BROKER_IMPL, 
            id,
            name,
            nftSymbol,
            METADATA_RENDERER
        );
        factory = address(pbFactory);
        
        // Deploy verifier linked to this factory
        verifier = address(new BrokerVerifier(factory));
    }

    /**
     * @notice Deploys and initializes the PositionToken (wRLP)
     * @dev Uses minimal proxy (clone) pattern for gas efficiency
     *      The token is backed by collateralToken (e.g., aUSDC), not underlying
     *
     * @param params Deployment parameters
     * @return tokenAddr The deployed PositionToken address
     */
    function _deployPositionToken(DeployParams calldata params) internal returns (address tokenAddr) {
        tokenAddr = Clones.clone(POSITION_TOKEN_IMPL);
        PositionToken(tokenAddr).initialize(
            params.collateralToken,  // Backing asset (yield-bearing)
            params.positionTokenName, 
            params.positionTokenSymbol
        );
    }

    /**
     * @notice Initializes the Uniswap V4 pool for wRLP <-> collateral trading
     * @dev Key operations:
     *      1. Orders currencies (V4 requires token0 < token1)
     *      2. Fetches oracle price and inverts if necessary
     *      3. Computes sqrtPriceX96 in Q64.96 format
     *      4. Initializes V4 pool at computed price
     *      5. Sets TWAMM price bounds [0.0001, 100] relative to wRLP
     *      6. Registers pool with singleton oracle for TWAP queries
     *
     * @dev Price calculation:
     *      - Oracle returns: price = collateral per wRLP (e.g., 10 aUSDC per wRLP)
     *      - V4 stores: sqrtPrice = sqrt(token1/token0) * 2^96
     *      - If wRLP is token1, we invert the price
     *
     * @param positionToken The deployed wRLP token address
     * @param params Deployment parameters
     * @return The PoolId as bytes32
     */
    function _initializePool(
        address positionToken, 
        DeployParams calldata params
    ) internal returns (bytes32) {
        // Step 1: Order currencies (V4 requires currency0 < currency1)
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(params.collateralToken);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        // Step 2: Fetch index price from oracle
        // Returns price in WAD: how many collateral tokens per 1 wRLP
        uint256 indexPrice = IRLDOracle(params.rateOracle).getIndexPrice(
            params.underlyingPool, 
            params.collateralToken
        );
        
        // Step 3: Invert if wRLP is token1
        // V4 stores price as token1/token0, so if wRLP is token1, we need 1/price
        if (Currency.wrap(positionToken) == currency1) {
            indexPrice = 1e36 / indexPrice;
        }

        // Step 4: Calculate sqrtPriceX96
        // Formula: sqrtPriceX96 = sqrt(price) * 2^96
        // Since price is in WAD (1e18), we divide by 1e9 (sqrt(1e18))
        uint160 initSqrtPrice = uint160(
            (FixedPointMathLib.sqrt(indexPrice) * (1 << 96)) / 1e9
        );

        // Step 5: Build PoolKey
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: params.poolFee, 
            tickSpacing: params.tickSpacing,
            hooks: IHooks(TWAMM)
        });
        
        // Step 6: Initialize pool at computed price
        IPoolManager(POOL_MANAGER).initialize(key, initSqrtPrice);
        
        // Step 7: Set price bounds for TWAMM
        // Bounds define valid trading range to prevent extreme manipulation
        uint160 minSqrt; 
        uint160 maxSqrt;
        uint256 Q96 = 1 << 96;

        if (currency0 == Currency.wrap(positionToken)) {
            // wRLP is Token0: price = collateral/wRLP
            // Allow wRLP price range: [0.0001, 100] collateral per wRLP
            minSqrt = uint160(Q96 / 100);   // sqrt(0.0001) = 0.01
            maxSqrt = uint160(Q96 * 10);    // sqrt(100) = 10
        } else {
            // wRLP is Token1: price = wRLP/collateral (inverted)
            // Equivalent range: [0.01, 10000] in inverted terms
            minSqrt = uint160(Q96 / 10);    // sqrt(0.01) = 0.1
            maxSqrt = uint160(Q96 * 100);   // sqrt(10000) = 100
        }
        
        // Only set bounds if TWAMM is configured (can be address(0) in tests)
        if (TWAMM != address(0)) {
            TwammHook(TWAMM).setPriceBounds(key, minSqrt, maxSqrt);
        }
        
        // Step 8: Register with singleton oracle for TWAP queries
        UniswapV4SingletonOracle(SINGLETON_V4_ORACLE).registerPool(
            positionToken,
            key,
            TWAMM,
            params.oraclePeriod
        );
        
        return PoolId.unwrap(key.toId());
    }

    /**
     * @notice Registers the market with RLDCore and completes setup
     * @dev Final steps:
     *      1. Checks market doesn't already exist (via canonicalKey)
     *      2. Builds MarketAddresses and MarketConfig structs
     *      3. Registers with RLDCore.createMarket()
     *      4. Links PositionToken to MarketId
     *      5. Transfers PositionToken ownership to RLDCore
     *
     * @param params Deployment parameters
     * @param positionToken The deployed wRLP address
     * @param verifier The deployed BrokerVerifier address
     * @return marketId The registered MarketId from RLDCore
     */
    function _registerMarket(
        DeployParams calldata params, 
        address positionToken, 
        address verifier
    ) internal returns (MarketId marketId) {
        // Compute canonical key (must match _precomputeId exactly)
        bytes32 canonicalKey = keccak256(abi.encode(
            params.collateralToken,
            params.underlyingToken,
            params.underlyingPool
        ));
        
        // Prevent duplicate markets
        if (MarketId.unwrap(canonicalMarkets[canonicalKey]) != bytes32(0)) {
            revert MarketAlreadyExists();
        }

        // Build addresses struct for RLDCore
        IRLDCore.MarketAddresses memory addresses = IRLDCore.MarketAddresses({
            collateralToken: params.collateralToken,
            underlyingToken: params.underlyingToken,
            underlyingPool: params.underlyingPool,
            rateOracle: params.rateOracle,
            spotOracle: params.spotOracle, 
            markOracle: SINGLETON_V4_ORACLE,
            fundingModel: STD_FUNDING_MODEL,
            curator: params.curator, 
            liquidationModule: params.liquidationModule,
            positionToken: positionToken
        });

        // Build config struct for RLDCore
        IRLDCore.MarketConfig memory config = IRLDCore.MarketConfig({
            minColRatio: params.minColRatio,
            maintenanceMargin: params.maintenanceMargin,
            liquidationCloseFactor: params.liquidationCloseFactor,
            fundingPeriod: FUNDING_PERIOD,
            liquidationParams: params.liquidationParams,
            brokerVerifier: verifier
        });

        // Register with RLDCore
        marketId = IRLDCore(CORE).createMarket(addresses, config);
        canonicalMarkets[canonicalKey] = marketId;
        
        // Link PositionToken to this market
        PositionToken(positionToken).setMarketId(marketId);
        
        // Transfer ownership to RLDCore (for minting/burning control)
        PositionToken(positionToken).transferOwnership(CORE);
        
        emit MarketDeployed(marketId, params.underlyingPool, params.collateralToken);
    }
}
