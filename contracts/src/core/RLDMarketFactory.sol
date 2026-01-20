// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRLDCore, MarketId} from "../interfaces/IRLDCore.sol";
import {IRLDMarketFactory} from "../interfaces/IRLDMarketFactory.sol";
import {RLDAaveOracle} from "../modules/oracles/RLDAaveOracle.sol";
import {ChainlinkSpotOracle} from "../modules/oracles/ChainlinkSpotOracle.sol";
import {StandardFundingModel} from "../modules/funding/StandardFundingModel.sol";
import {CDSHook} from "../modules/hooks/CDSHook.sol";
import {StaticLiquidationModule} from "../modules/liquidation/StaticLiquidationModule.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ITWAMM} from "v4-twamm-hook/src/ITWAMM.sol";
import {WrappedRLP} from "../tokens/WrappedRLP.sol";
import {UniswapV4SingletonOracle} from "../modules/oracles/UniswapV4SingletonOracle.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {IRLDOracle} from "../interfaces/IRLDOracle.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @title RLDMarketFactory
/// @notice Permissionless factory for "One-Click" RLD Markets.
/// @dev Automates Oracle, Hook, and Market creation steps.
contract RLDMarketFactory is IRLDMarketFactory {
    
    IRLDCore public immutable CORE;
    IPoolManager public immutable poolManager;
    ITWAMM public immutable twamm;
    
    using PoolIdLibrary for PoolKey;
    
    event MarketDeployed(MarketId indexed id, address indexed pool, address underlying, IRLDCore.MarketType marketType);
    error Unauthorized();
    error MarketAlreadyExists();
    
    // Default Implementations (Immutable for creating clones, or just use references if stateless)
    // For MVP, we pass deployed addresses or deploy new instances if needed.
    // Ideally we have a registry. For now, we hardcode standard modules logic or deploy them.
    
    address public immutable AAVE_RATE_ORACLE; // Stateless
    address public immutable STD_FUNDING_MODEL;
    address public immutable CHAINLINK_SPOT_ORACLE; // Singleton
    address public immutable DEFAULT_ORACLE; // Singleton logic
    address public immutable STATIC_LIQ_MODULE;

    address public immutable CDS_HOOK;
    address public immutable WRAPPED_RLP_IMPL;
    address public immutable SINGLETON_V4_ORACLE; // New Singleton
    
    // Pool -> Funding -> MarketType -> MarketId

    // Key: keccak256(abi.encode(underlyingPool, underlyingToken, marketType))
    mapping(bytes32 => MarketId) public canonicalMarkets;

    function getCanonicalId(address pool, address token, IRLDCore.MarketType mType) public pure returns (bytes32) {
        return keccak256(abi.encode(pool, token, mType));
    }

    constructor(
        address core, 
        address fundingModel, 
        address spotOracle, 
        address rateOracle, 
        address defaultOracle,
        address _poolManager,
        address _twamm
    ) {
        CORE = IRLDCore(core);
        STD_FUNDING_MODEL = fundingModel;
        CHAINLINK_SPOT_ORACLE = spotOracle;
        AAVE_RATE_ORACLE = rateOracle;
        DEFAULT_ORACLE = defaultOracle;
        poolManager = IPoolManager(_poolManager);
        twamm = ITWAMM(_twamm);
        STATIC_LIQ_MODULE = address(new StaticLiquidationModule());
        CDS_HOOK = address(new CDSHook());
        WRAPPED_RLP_IMPL = address(new WrappedRLP());
        SINGLETON_V4_ORACLE = address(new UniswapV4SingletonOracle());
    }

    function deployMarket(
        address underlyingPool,
        address underlyingToken,
        address collateralToken,
        IRLDCore.MarketType marketType,
        uint64 minColRatio,
        uint64 maintenanceMargin,
        address liquidationModule,
        bytes32 liquidationParams
    ) external override returns (MarketId marketId, address oracle, address spotOracle, address defaultOracle, bytes32 poolId) {
        
        oracle = AAVE_RATE_ORACLE;
        spotOracle = CHAINLINK_SPOT_ORACLE; 
        defaultOracle = DEFAULT_ORACLE;
        
        address module = liquidationModule == address(0) ? STATIC_LIQ_MODULE : liquidationModule;
        
        // 1. Deploy wRLP
        address wRLPAddr = Clones.clone(WRAPPED_RLP_IMPL);
        string memory colSymbol = ERC20(collateralToken).symbol();
        WrappedRLP(wRLPAddr).initialize(underlyingToken, colSymbol);

        // 2. Create Market Configs
        IRLDCore.MarketAddresses memory addresses = IRLDCore.MarketAddresses({
            collateralToken: collateralToken,
            underlyingToken: underlyingToken,
            underlyingPool: underlyingPool,
            rateOracle: AAVE_RATE_ORACLE,
            spotOracle: CHAINLINK_SPOT_ORACLE,
            markOracle: address(0), // No V4 Singleton for legacy
            fundingModel: STD_FUNDING_MODEL,
            curator: address(0), 
            hook: CDS_HOOK,
            defaultOracle: DEFAULT_ORACLE,
            liquidationModule: module,
            positionToken: wRLPAddr
        });

        IRLDCore.MarketConfig memory config = IRLDCore.MarketConfig({
            marketType: marketType,
            minColRatio: minColRatio,
            maintenanceMargin: maintenanceMargin,
            liquidationParams: liquidationParams,
            brokerVerifier: address(0)
        });
        
        // 3. Deploy Core
        marketId = _deployCore(addresses, config, wRLPAddr);

        // 4. Initialize Uniswap Pool (Empty)
        poolId = bytes32(0); 
    }

    function deployMarketV4(
        address underlyingPool,
        address underlyingToken,
        address collateralToken, 
        IRLDCore.MarketType marketType,
        uint64 minColRatio,
        uint64 maintenanceMargin,
        address liquidationModule,
        bytes32 liquidationParams,
        address spotOracle,
        address rateOracle,
        uint32 oraclePeriod,
        uint24 poolFee,
        int24 tickSpacing
    ) external override returns (MarketId marketId, address oracle, address _spotOracle, address defaultOracle, bytes32 poolId) {
        if (liquidationModule == address(0)) revert("Invalid Liquidation Module");

        // 1. Deploy wRLP (Clone)
        address wRLPAddr = Clones.clone(WRAPPED_RLP_IMPL);
        string memory colSymbol = ERC20(collateralToken).symbol();
        WrappedRLP(wRLPAddr).initialize(underlyingToken, colSymbol);
        
        // 2. Setup V4 Pool params
        Currency currency0 = Currency.wrap(wRLPAddr);
        Currency currency1 = Currency.wrap(underlyingToken);
        if (currency0 > currency1) (currency0, currency1) = (currency1, currency0);

        uint256 indexPrice = IRLDOracle(rateOracle).getIndexPrice(underlyingPool, underlyingToken);
        if (Currency.wrap(wRLPAddr) == currency1) {
             indexPrice = 1e36 / indexPrice;
        }

        uint160 initSqrtPrice = uint160( (FixedPointMathLib.sqrt(indexPrice) * (1 << 96)) / 1e9 );

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: poolFee, 
            tickSpacing: tickSpacing,
            hooks: IHooks(address(twamm))
        });
        
        poolManager.initialize(key, initSqrtPrice);
        poolId = PoolId.unwrap(key.toId());

        // 3. Register with Singleton Oracle
        UniswapV4SingletonOracle(SINGLETON_V4_ORACLE).registerPool(
            wRLPAddr,
            key,
            address(twamm),
            oraclePeriod
        );

        oracle = rateOracle;
        _spotOracle = spotOracle; 
        defaultOracle = DEFAULT_ORACLE;
        
        // 4. Create Market Configs
        IRLDCore.MarketAddresses memory addresses = IRLDCore.MarketAddresses({
            collateralToken: collateralToken,
            underlyingToken: underlyingToken,
            underlyingPool: underlyingPool,
            rateOracle: rateOracle,
            spotOracle: spotOracle, 
            markOracle: SINGLETON_V4_ORACLE,
            fundingModel: STD_FUNDING_MODEL,
            curator: address(0),
            hook: CDS_HOOK,
            defaultOracle: DEFAULT_ORACLE,
            liquidationModule: liquidationModule,
            positionToken: wRLPAddr
        });

        IRLDCore.MarketConfig memory config = IRLDCore.MarketConfig({
            marketType: marketType,
            minColRatio: minColRatio,
            maintenanceMargin: maintenanceMargin,
            liquidationParams: liquidationParams,
            brokerVerifier: address(0)
        });

        // 5. Deploy Core
        marketId = _deployCore(addresses, config, wRLPAddr);
    }
    
    function _deployCore(
        IRLDCore.MarketAddresses memory addresses,
        IRLDCore.MarketConfig memory config,
        address wRLPAddr
    ) internal returns (MarketId marketId) {
        // Register & Validate Constraints
        bytes32 canonicalKey = getCanonicalId(addresses.underlyingPool, addresses.underlyingToken, config.marketType);
        
        if (MarketId.unwrap(canonicalMarkets[canonicalKey]) != bytes32(0)) {
            revert MarketAlreadyExists();
        }

        marketId = CORE.createMarket(addresses, config);
        canonicalMarkets[canonicalKey] = marketId;
        
        // Link wRLP
        WrappedRLP(wRLPAddr).setMarketId(marketId);
        WrappedRLP(wRLPAddr).transferOwnership(address(CORE));
        
        emit MarketDeployed(marketId, addresses.underlyingPool, addresses.underlyingToken, config.marketType);
    }

    function deployBondVault(MarketId /*marketId*/) external override returns (address vault) {
        // vault = new SyntheticBond(marketId, CORE);
        // return address(vault);
        return address(0);
    }
}
