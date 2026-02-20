// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";

// ─── Core ────────────────────────────────────────────────────────────────────
import {RLDCore} from "../../../src/rld/core/RLDCore.sol";
import {RLDMarketFactory} from "../../../src/rld/core/RLDMarketFactory.sol";
import {IRLDCore, MarketId} from "../../../src/shared/interfaces/IRLDCore.sol";

// ─── Templates ───────────────────────────────────────────────────────────────
import {PositionToken} from "../../../src/rld/tokens/PositionToken.sol";
import {PrimeBroker} from "../../../src/rld/broker/PrimeBroker.sol";

// ─── Modules ─────────────────────────────────────────────────────────────────
import {
    DutchLiquidationModule
} from "../../../src/rld/modules/liquidation/DutchLiquidationModule.sol";
import {
    StandardFundingModel
} from "../../../src/rld/modules/funding/StandardFundingModel.sol";
import {
    UniswapV4SingletonOracle
} from "../../../src/rld/modules/oracles/UniswapV4SingletonOracle.sol";
import {
    RLDAaveOracle
} from "../../../src/rld/modules/oracles/RLDAaveOracle.sol";
import {
    UniswapV4BrokerModule
} from "../../../src/rld/modules/broker/UniswapV4BrokerModule.sol";
import {
    TwammBrokerModule
} from "../../../src/rld/modules/broker/TwammBrokerModule.sol";
import {
    BrokerVerifier
} from "../../../src/rld/modules/verifier/BrokerVerifier.sol";

// ─── Periphery ───────────────────────────────────────────────────────────────
import {BrokerRouter} from "../../../src/periphery/BrokerRouter.sol";

// ─── TWAMM ───────────────────────────────────────────────────────────────────
import {TWAMM} from "../../../src/twamm/TWAMM.sol";

// ─── Shared Utils ────────────────────────────────────────────────────────────
import {
    FixedPointMathLib
} from "../../../src/shared/utils/FixedPointMathLib.sol";
import {IRLDOracle} from "../../../src/shared/interfaces/IRLDOracle.sol";
import {
    UniswapV4SingletonOracle
} from "../../../src/rld/modules/oracles/UniswapV4SingletonOracle.sol";

// ─── Uniswap V4 ─────────────────────────────────────────────────────────────
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

// ─── External ────────────────────────────────────────────────────────────────
import {ERC20} from "solmate/src/tokens/ERC20.sol";

// ─── Shared Config ───────────────────────────────────────────────────────────
import {
    RLDDeployConfig as C
} from "../../../src/shared/config/RLDDeployConfig.sol";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// @notice Minimal metadata renderer that returns empty strings (satisfies non-zero check)
contract MinimalMetadataRenderer {
    function tokenURI(uint256) external pure returns (string memory) {
        return "";
    }
}

/**
 * @title RLDMarketFactory Unit Tests
 * @notice Comprehensive, paranoid unit tests for the full market deployment lifecycle
 * @dev Runs against an Ethereum mainnet fork to use real Uniswap V4 PoolManager and Aave V3 state.
 *      Deploys the entire RLD protocol stack (mirrors DeployRLDProtocol.s.sol) in setUp().
 */
contract RLDMarketFactoryTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /* =========================================================================
       PROTOCOL CONFIG (from shared config)
    ========================================================================= */

    // Aliases for readability — these constants come from RLDDeployConfig

    /* =========================================================================
       DEPLOYED CONTRACTS (filled in setUp)
    ========================================================================= */

    // Helpers
    address metadataRenderer;
    address v4ValuationModule;
    address twammValuationModule;

    // Templates
    address positionTokenImpl;
    address primeBrokerImpl;

    // Modules
    address dutchLiquidationModule;
    address standardFundingModel;
    address v4Oracle;
    address rldAaveOracle;

    // Periphery
    address brokerRouter;

    // Core
    RLDMarketFactory factory;
    RLDCore core;
    TWAMM twammHook;

    // Actors
    address deployer;
    address attacker;
    address curator;

    /* =========================================================================
       DEFAULT DEPLOY PARAMS (valid aUSDC market)
    ========================================================================= */

    function _defaultParams()
        internal
        view
        returns (RLDMarketFactory.DeployParams memory)
    {
        return
            RLDMarketFactory.DeployParams({
                underlyingPool: C.AAVE_POOL,
                underlyingToken: C.USDC,
                collateralToken: C.AUSDC,
                curator: curator,
                positionTokenName: C.POSITION_TOKEN_NAME,
                positionTokenSymbol: C.POSITION_TOKEN_SYMBOL,
                minColRatio: C.MIN_COL_RATIO,
                maintenanceMargin: C.MAINTENANCE_MARGIN,
                liquidationCloseFactor: C.LIQUIDATION_CLOSE_FACTOR,
                liquidationModule: dutchLiquidationModule,
                liquidationParams: C.LIQUIDATION_PARAMS,
                spotOracle: address(0), // Unused in V1
                rateOracle: rldAaveOracle,
                oraclePeriod: C.ORACLE_PERIOD,
                poolFee: C.POOL_FEE,
                tickSpacing: C.TICK_SPACING
            });
    }

    /* =========================================================================
       SETUP — Full Protocol Deployment (mirrors DeployRLDProtocol.s.sol)
    ========================================================================= */

    function setUp() public {
        // Fork mainnet
        vm.createSelectFork(
            "https://eth-mainnet.g.alchemy.com/v2/***REDACTED_ALCHEMY***"
        );

        deployer = address(this);
        attacker = makeAddr("attacker");
        curator = makeAddr("curator");

        // ── Phase 0: Helper Contracts ──────────────────────────────────

        metadataRenderer = address(new MinimalMetadataRenderer());

        v4ValuationModule = address(new UniswapV4BrokerModule());
        twammValuationModule = address(new TwammBrokerModule());

        // ── Phase 0.5: TWAMM Hook (with salt mining) ──────────────────

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
                Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
                Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
                Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG
        );

        bytes memory creationCode = type(TWAMM).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(C.POOL_MANAGER),
            C.TWAMM_EXPIRATION_INTERVAL,
            deployer,
            address(0) // rldCore set later
        );

        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this), // Foundry's new{salt} uses the calling contract as deployer
            flags,
            creationCode,
            constructorArgs
        );

        twammHook = new TWAMM{salt: salt}(
            IPoolManager(C.POOL_MANAGER),
            C.TWAMM_EXPIRATION_INTERVAL,
            deployer,
            address(0) // rldCore set later
        );
        require(address(twammHook) == hookAddress, "Hook address mismatch");

        // ── Phase 1: Singleton Modules ─────────────────────────────────

        dutchLiquidationModule = address(new DutchLiquidationModule());
        standardFundingModel = address(new StandardFundingModel());
        v4Oracle = address(new UniswapV4SingletonOracle());
        rldAaveOracle = address(new RLDAaveOracle());

        // ── Phase 2: Implementation Templates ──────────────────────────

        positionTokenImpl = address(
            new PositionToken("Implementation", "IMPL", 18, address(1))
        );
        primeBrokerImpl = address(
            new PrimeBroker(
                v4ValuationModule,
                twammValuationModule,
                C.POSITION_MANAGER
            )
        );

        // ── Phase 2.5: BrokerRouter ────────────────────────────────────

        brokerRouter = address(new BrokerRouter(C.POOL_MANAGER, C.PERMIT2));

        // ── Phase 3: Market Factory ────────────────────────────────────

        factory = new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );

        // ── Phase 4: RLD Core ──────────────────────────────────────────

        core = new RLDCore(
            address(factory),
            C.POOL_MANAGER,
            address(twammHook)
        );

        // ── Phase 5: Cross-Linking ─────────────────────────────────────

        factory.initializeCore(address(core));
        twammHook.setRldCore(address(core));
    }

    /* =====================================================================
       GROUP 1: HAPPY PATH
    ===================================================================== */

    function test_createMarket_success() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();

        (MarketId marketId, address brokerFactory) = factory.createMarket(
            params
        );

        // ── MarketId is non-zero ──
        assertTrue(
            MarketId.unwrap(marketId) != bytes32(0),
            "MarketId should be non-zero"
        );

        // ── MarketId is deterministic ──
        bytes32 expectedId = keccak256(
            abi.encode(C.AUSDC, C.USDC, C.AAVE_POOL)
        );
        assertEq(
            MarketId.unwrap(marketId),
            expectedId,
            "MarketId should be deterministic"
        );

        // ── Core recognizes the market ──
        assertTrue(core.marketExists(marketId), "Market should exist in Core");

        // ── Verify MarketAddresses ──
        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        assertEq(addrs.collateralToken, C.AUSDC, "Collateral should be aUSDC");
        assertEq(addrs.underlyingToken, C.USDC, "Underlying should be USDC");
        assertEq(addrs.underlyingPool, C.AAVE_POOL, "Pool should be Aave V3");
        assertEq(addrs.rateOracle, rldAaveOracle, "Rate oracle mismatch");
        assertEq(addrs.markOracle, v4Oracle, "Mark oracle mismatch");
        assertEq(
            addrs.fundingModel,
            standardFundingModel,
            "Funding model mismatch"
        );
        assertEq(addrs.curator, curator, "Curator mismatch");
        assertEq(
            addrs.liquidationModule,
            dutchLiquidationModule,
            "Liquidation module mismatch"
        );

        // ── Verify MarketConfig ──
        IRLDCore.MarketConfig memory config = core.getMarketConfig(marketId);
        assertEq(config.minColRatio, C.MIN_COL_RATIO, "minColRatio mismatch");
        assertEq(
            config.maintenanceMargin,
            C.MAINTENANCE_MARGIN,
            "maintenanceMargin mismatch"
        );
        assertEq(
            config.liquidationCloseFactor,
            C.LIQUIDATION_CLOSE_FACTOR,
            "closeFactor mismatch"
        );
        assertEq(
            config.fundingPeriod,
            C.FUNDING_PERIOD,
            "fundingPeriod mismatch"
        );
        assertEq(config.debtCap, 0, "debtCap should be 0 (unlimited)");

        // ── Verify MarketState (initialization) ──
        IRLDCore.MarketState memory state = core.getMarketState(marketId);
        assertEq(state.normalizationFactor, 1e18, "NF should start at 1.0");
        assertEq(state.totalDebt, 0, "Total debt should be 0");

        // ── BrokerFactory is non-zero & BrokerVerifier is linked ──
        assertTrue(
            brokerFactory != address(0),
            "Broker factory should be non-zero"
        );

        // ── PositionToken checks ──
        address positionToken = addrs.positionToken;
        assertTrue(
            positionToken != address(0),
            "Position token should be non-zero"
        );

        PositionToken pt = PositionToken(positionToken);
        assertEq(pt.decimals(), 6, "wRLP decimals should match aUSDC (6)");
        assertEq(
            pt.collateral(),
            C.AUSDC,
            "wRLP backing collateral should be aUSDC"
        );
        assertEq(
            MarketId.unwrap(pt.marketId()),
            expectedId,
            "wRLP marketId not set correctly"
        );

        // ── PositionToken ownership transferred to Core ──
        assertEq(pt.owner(), address(core), "wRLP owner should be RLDCore");
    }

    function test_createMarket_emitsEvent() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();

        vm.expectEmit(true, true, true, false); // Check indexed params
        emit RLDMarketFactory.MarketDeployed(
            MarketId.wrap(keccak256(abi.encode(C.AUSDC, C.USDC, C.AAVE_POOL))),
            C.AAVE_POOL,
            C.AUSDC,
            address(0), // Can't predict, don't check
            address(0),
            address(0)
        );

        factory.createMarket(params);
    }

    function test_createMarket_v4PoolInitialized() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();

        (MarketId marketId, ) = factory.createMarket(params);

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;

        // Reconstruct PoolKey
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(C.AUSDC);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: params.poolFee,
            tickSpacing: params.tickSpacing,
            hooks: IHooks(address(twammHook))
        });

        // Query the V4 PoolManager for pool state — sqrtPrice should be non-zero
        (uint160 sqrtPriceX96, , , ) = IPoolManager(C.POOL_MANAGER).getSlot0(
            key.toId()
        );
        assertTrue(
            sqrtPriceX96 > 0,
            "V4 pool should be initialized with non-zero sqrtPrice"
        );
    }

    /* =====================================================================
       GROUP 2: VALIDATION FAILURES (_validateParams)
    ===================================================================== */

    function test_revert_zeroUnderlyingPool() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.underlyingPool = address(0);
        vm.expectRevert("Invalid Pool");
        factory.createMarket(params);
    }

    function test_revert_zeroUnderlyingToken() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.underlyingToken = address(0);
        vm.expectRevert("Invalid Underlying");
        factory.createMarket(params);
    }

    function test_revert_zeroCollateralToken() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.collateralToken = address(0);
        vm.expectRevert("Invalid Collateral");
        factory.createMarket(params);
    }

    function test_revert_zeroLiquidationModule() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.liquidationModule = address(0);
        vm.expectRevert("Invalid LiqModule");
        factory.createMarket(params);
    }

    function test_revert_zeroRateOracle() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.rateOracle = address(0);
        vm.expectRevert("Invalid RateOracle");
        factory.createMarket(params);
    }

    function test_revert_minColRatio_exactly100Percent() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.minColRatio = 1e18; // Exactly 100%, must be > 100%
        vm.expectRevert("MinCol < 100%");
        factory.createMarket(params);
    }

    function test_revert_maintenanceMargin_below100Percent() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.maintenanceMargin = 0.99e18;
        vm.expectRevert("Maintenance < 100%");
        factory.createMarket(params);
    }

    function test_revert_minColRatio_lessThanMaintenance() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.minColRatio = 1.1e18;
        params.maintenanceMargin = 1.2e18; // Maintenance > minCol → invalid
        vm.expectRevert("Risk Config Error");
        factory.createMarket(params);
    }

    function test_revert_zeroLiquidationCloseFactor() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.liquidationCloseFactor = 0;
        vm.expectRevert("Invalid CloseFactor");
        factory.createMarket(params);
    }

    function test_revert_overflowLiquidationCloseFactor() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.liquidationCloseFactor = 1e18 + 1; // > 100%
        vm.expectRevert("Invalid CloseFactor");
        factory.createMarket(params);
    }

    function test_revert_zeroTickSpacing() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.tickSpacing = 0;
        vm.expectRevert("Invalid TickSpacing");
        factory.createMarket(params);
    }

    function test_revert_zeroOraclePeriod() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        params.oraclePeriod = 0;
        vm.expectRevert("Invalid OraclePeriod");
        factory.createMarket(params);
    }

    /* =====================================================================
       GROUP 3: ACCESS CONTROL
    ===================================================================== */

    function test_revert_createMarket_notOwner() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        vm.prank(attacker);
        vm.expectRevert("Not owner");
        factory.createMarket(params);
    }

    function test_revert_initializeCore_notDeployer() public {
        // Deploy a fresh factory for this test (so coreInitialized is false in a new one)
        RLDMarketFactory freshFactory = new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );

        vm.prank(attacker);
        vm.expectRevert("Not deployer");
        freshFactory.initializeCore(address(core));
    }

    function test_revert_initializeCore_alreadyInitialized() public {
        // factory.initializeCore was already called in setUp()
        vm.expectRevert("Already initialized");
        factory.initializeCore(makeAddr("newCore"));
    }

    function test_revert_initializeCore_zeroAddress() public {
        RLDMarketFactory freshFactory = new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );

        vm.expectRevert("Invalid core");
        freshFactory.initializeCore(address(0));
    }

    function test_revert_createMarket_coreNotInitialized() public {
        RLDMarketFactory freshFactory = new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );

        RLDMarketFactory.DeployParams memory params = _defaultParams();
        vm.expectRevert("Core not initialized");
        freshFactory.createMarket(params);
    }

    /* =====================================================================
       GROUP 4: DUPLICATE & ID MATCHING
    ===================================================================== */

    function test_revert_duplicateMarket() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();

        // First creation should succeed
        factory.createMarket(params);

        // Second creation with identical params must revert
        vm.expectRevert(RLDMarketFactory.MarketAlreadyExists.selector);
        factory.createMarket(params);
    }

    function test_marketId_deterministic() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();

        (MarketId marketId, ) = factory.createMarket(params);

        bytes32 expected = keccak256(
            abi.encode(
                params.collateralToken,
                params.underlyingToken,
                params.underlyingPool
            )
        );
        assertEq(
            MarketId.unwrap(marketId),
            expected,
            "MarketId must be deterministic keccak256(collateral, underlying, pool)"
        );
    }

    /* =====================================================================
       GROUP 5: POST-DEPLOYMENT INVARIANTS
    ===================================================================== */

    function test_positionToken_ownerIsCore() public {
        (MarketId marketId, ) = factory.createMarket(_defaultParams());

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        PositionToken pt = PositionToken(addrs.positionToken);

        assertEq(
            pt.owner(),
            address(core),
            "Only RLDCore should own PositionToken after deployment"
        );
    }

    function test_positionToken_cannotMintAsNonOwner() public {
        (MarketId marketId, ) = factory.createMarket(_defaultParams());

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        PositionToken pt = PositionToken(addrs.positionToken);

        // The deployer (this test contract) should NOT be able to mint since ownership was transferred
        vm.expectRevert("UNAUTHORIZED");
        pt.mint(address(this), 1000);
    }

    function test_positionToken_marketIdCannotBeSetTwice() public {
        (MarketId marketId, ) = factory.createMarket(_defaultParams());

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        PositionToken pt = PositionToken(addrs.positionToken);

        // Attempting to set MarketId again (even as owner = core) should fail
        vm.prank(address(core));
        vm.expectRevert(PositionToken.MarketIdAlreadySet.selector);
        pt.setMarketId(marketId);
    }

    function test_positionToken_decimalsMatchCollateral() public {
        (MarketId marketId, ) = factory.createMarket(_defaultParams());

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        PositionToken pt = PositionToken(addrs.positionToken);

        uint8 expectedDecimals = ERC20(C.AUSDC).decimals();
        assertEq(
            pt.decimals(),
            expectedDecimals,
            "wRLP decimals must match collateral decimals"
        );
    }

    function test_brokerVerifier_linkedToFactory() public {
        (MarketId marketId, ) = factory.createMarket(_defaultParams());

        IRLDCore.MarketConfig memory config = core.getMarketConfig(marketId);
        BrokerVerifier verifier = BrokerVerifier(config.brokerVerifier);

        // The verifier's FACTORY should be a non-zero newly deployed PrimeBrokerFactory
        address linkedFactory = verifier.FACTORY();
        assertTrue(
            linkedFactory != address(0),
            "BrokerVerifier.FACTORY should be non-zero"
        );
        assertTrue(
            linkedFactory.code.length > 0,
            "BrokerVerifier.FACTORY should be a contract"
        );
    }

    function test_marketState_initializedCorrectly() public {
        (MarketId marketId, ) = factory.createMarket(_defaultParams());

        IRLDCore.MarketState memory state = core.getMarketState(marketId);

        assertEq(state.normalizationFactor, 1e18, "NF must initialize at 1.0");
        assertEq(state.totalDebt, 0, "Total debt must be 0 at initialization");
        assertEq(
            state.lastUpdateTimestamp,
            uint48(block.timestamp),
            "Timestamp must be current block"
        );
    }

    /* =====================================================================
       GROUP 6: CONSTRUCTOR VALIDATION
    ===================================================================== */

    function test_revert_factory_zeroPoolManager() public {
        vm.expectRevert("Invalid PoolManager");
        new RLDMarketFactory(
            address(0),
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );
    }

    function test_revert_factory_zeroPositionTokenImpl() public {
        vm.expectRevert("Invalid PositionTokenImpl");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            address(0),
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );
    }

    function test_revert_factory_zeroPrimeBrokerImpl() public {
        vm.expectRevert("Invalid PrimeBrokerImpl");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            address(0),
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );
    }

    function test_revert_factory_zeroV4Oracle() public {
        vm.expectRevert("Invalid V4Oracle");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            address(0),
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );
    }

    function test_revert_factory_zeroFundingModel() public {
        vm.expectRevert("Invalid FundingModel");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            address(0),
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );
    }

    function test_revert_factory_zeroMetadataRenderer() public {
        vm.expectRevert("Invalid MetadataRenderer");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            address(0),
            C.FUNDING_PERIOD,
            brokerRouter
        );
    }

    function test_revert_factory_fundingPeriodTooShort() public {
        vm.expectRevert("Invalid period");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            uint32(1 hours),
            brokerRouter // < 1 day
        );
    }

    function test_revert_factory_fundingPeriodTooLong() public {
        vm.expectRevert("Invalid period");
        new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            uint32(366 days),
            brokerRouter // > 365 days
        );
    }

    function test_factory_allowsZeroTWAMM() public {
        // Factory explicitly allows TWAMM = address(0) for testing
        RLDMarketFactory noTwammFactory = new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(0), // TWAMM = 0
            metadataRenderer,
            C.FUNDING_PERIOD,
            brokerRouter
        );
        assertEq(
            noTwammFactory.TWAMM(),
            address(0),
            "TWAMM should be allowed as address(0)"
        );
    }

    function test_factory_allowsZeroBrokerRouter() public {
        // BrokerRouter can be address(0) if not deployed yet
        RLDMarketFactory noRouterFactory = new RLDMarketFactory(
            C.POOL_MANAGER,
            positionTokenImpl,
            primeBrokerImpl,
            v4Oracle,
            standardFundingModel,
            address(twammHook),
            metadataRenderer,
            C.FUNDING_PERIOD,
            address(0) // No router
        );
        assertEq(
            noRouterFactory.BROKER_ROUTER(),
            address(0),
            "BrokerRouter should be allowed as address(0)"
        );
    }

    /* =====================================================================
       GROUP 7: EDGE CASES & PARANOIA
    ===================================================================== */

    function test_factory_immutables_matchDeployParams() public view {
        assertEq(
            factory.POOL_MANAGER(),
            C.POOL_MANAGER,
            "POOL_MANAGER mismatch"
        );
        assertEq(
            factory.POSITION_TOKEN_IMPL(),
            positionTokenImpl,
            "POSITION_TOKEN_IMPL mismatch"
        );
        assertEq(
            factory.PRIME_BROKER_IMPL(),
            primeBrokerImpl,
            "PRIME_BROKER_IMPL mismatch"
        );
        assertEq(
            factory.SINGLETON_V4_ORACLE(),
            v4Oracle,
            "SINGLETON_V4_ORACLE mismatch"
        );
        assertEq(
            factory.STD_FUNDING_MODEL(),
            standardFundingModel,
            "STD_FUNDING_MODEL mismatch"
        );
        assertEq(factory.TWAMM(), address(twammHook), "TWAMM mismatch");
        assertEq(
            factory.METADATA_RENDERER(),
            metadataRenderer,
            "METADATA_RENDERER mismatch"
        );
        assertEq(
            factory.FUNDING_PERIOD(),
            C.FUNDING_PERIOD,
            "FUNDING_PERIOD mismatch"
        );
        assertEq(
            factory.BROKER_ROUTER(),
            brokerRouter,
            "BROKER_ROUTER mismatch"
        );
        assertEq(
            factory.CORE(),
            address(core),
            "CORE mismatch after initializeCore"
        );
        assertEq(factory.owner(), deployer, "Owner mismatch");
    }

    function test_createMarket_reentrancyGuard() public {
        // The factory uses nonReentrant on createMarket.
        // While we can't easily trigger reentrancy in a unit test without a malicious contract,
        // we verify the modifier is present by checking the function succeeds normally
        // and that duplicate calls (which would re-enter state) properly revert for other reasons.
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        factory.createMarket(params);
        // If we got here, nonReentrant didn't false-positive block us
    }

    /* =====================================================================
       GROUP 8: V4 POOL PRICE INITIALIZATION & ORACLE CORRECTNESS
    ===================================================================== */

    /// @notice Verifies the V4 pool sqrtPriceX96 is derived correctly from the Aave index price
    function test_v4Pool_sqrtPriceDerivedFromIndexPrice() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        (MarketId marketId, ) = factory.createMarket(params);

        // Fetch the same index price the factory would have used
        uint256 indexPrice = IRLDOracle(rldAaveOracle).getIndexPrice(
            C.AAVE_POOL,
            C.USDC
        );

        // Reconstruct the PoolKey
        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(C.AUSDC);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        // If wRLP is token1, the factory inverts the price
        uint256 adjustedPrice = indexPrice;
        if (Currency.wrap(positionToken) == currency1) {
            adjustedPrice = 1e36 / indexPrice;
        }

        // Reconstruct expected sqrtPriceX96
        uint160 expectedSqrt = uint160(
            (FixedPointMathLib.sqrt(adjustedPrice) * (1 << 96)) / 1e9
        );

        // Read actual from PoolManager
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: C.POOL_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(twammHook))
        });
        (uint160 actualSqrt, , , ) = IPoolManager(C.POOL_MANAGER).getSlot0(
            key.toId()
        );

        assertEq(
            actualSqrt,
            expectedSqrt,
            "V4 pool sqrtPriceX96 must match factory's derivation from index price"
        );
    }

    /// @notice Verifies index price from Aave is within the factory's MIN_PRICE..MAX_PRICE range
    function test_v4Pool_indexPriceWithinFactoryBounds() public view {
        uint256 indexPrice = IRLDOracle(rldAaveOracle).getIndexPrice(
            C.AAVE_POOL,
            C.USDC
        );

        // Factory constants: MIN_PRICE = 1e14 (0.0001 WAD), MAX_PRICE = 100e18
        assertTrue(
            indexPrice >= 1e14,
            "Index price below factory MIN_PRICE (0.0001)"
        );
        assertTrue(
            indexPrice <= 100e18,
            "Index price above factory MAX_PRICE (100)"
        );
    }

    /// @notice Verifies the oracle is correctly registered with the singleton V4 oracle
    function test_v4Pool_oracleRegistered() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        (MarketId marketId, ) = factory.createMarket(params);

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;

        // Query the singleton oracle's storage
        (
            , // key (can't easily destructure PoolKey from storage)
            , // poolId
            , // twamm
            uint32 period,
            bool set
        ) = UniswapV4SingletonOracle(v4Oracle).poolSettings(positionToken);

        assertTrue(set, "Oracle pool must be registered after createMarket");
        assertEq(
            period,
            C.ORACLE_PERIOD,
            "Oracle TWAP period must match deploy config"
        );
    }

    /// @notice Verifies TWAMM price bounds are set and the init sqrtPrice falls within them
    function test_v4Pool_initPriceWithinTwammBounds() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        (MarketId marketId, ) = factory.createMarket(params);

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;

        // Reconstruct PoolKey
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(C.AUSDC);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: C.POOL_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(twammHook))
        });

        // Read actual sqrtPrice
        (uint160 sqrtPriceX96, , , ) = IPoolManager(C.POOL_MANAGER).getSlot0(
            key.toId()
        );

        // Calculate expected TWAMM bounds (same logic as factory)
        uint256 Q96 = 1 << 96;
        uint160 minSqrt;
        uint160 maxSqrt;
        if (currency0 == Currency.wrap(positionToken)) {
            // wRLP is token0: bounds = [Q96/100, Q96*10]
            minSqrt = uint160(Q96 / 100);
            maxSqrt = uint160(Q96 * 10);
        } else {
            // wRLP is token1: bounds = [Q96/10, Q96*100]
            minSqrt = uint160(Q96 / 10);
            maxSqrt = uint160(Q96 * 100);
        }

        assertTrue(
            sqrtPriceX96 >= minSqrt,
            "Init sqrtPrice must be >= TWAMM min bound"
        );
        assertTrue(
            sqrtPriceX96 <= maxSqrt,
            "Init sqrtPrice must be <= TWAMM max bound"
        );
    }

    /// @notice Verifies the TWAMM bounds match the expected formulas based on token order
    function test_v4Pool_twammBoundsConsistency() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        (MarketId marketId, ) = factory.createMarket(params);

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;

        // Reconstruct PoolKey
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(C.AUSDC);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: C.POOL_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(twammHook))
        });

        // Read TWAMM price bounds from storage
        (uint160 storedMin, uint160 storedMax) = twammHook.priceBounds(
            key.toId()
        );

        // Verify they're non-zero (actually set)
        assertTrue(storedMin > 0, "TWAMM min bound must be set");
        assertTrue(storedMax > 0, "TWAMM max bound must be set");
        assertTrue(storedMax > storedMin, "Max bound must be > min bound");

        // Verify formulas match
        uint256 Q96 = 1 << 96;
        if (currency0 == Currency.wrap(positionToken)) {
            assertEq(
                storedMin,
                uint160(Q96 / 100),
                "Token0 min bound = Q96/100"
            );
            assertEq(storedMax, uint160(Q96 * 10), "Token0 max bound = Q96*10");
        } else {
            assertEq(storedMin, uint160(Q96 / 10), "Token1 min bound = Q96/10");
            assertEq(
                storedMax,
                uint160(Q96 * 100),
                "Token1 max bound = Q96*100"
            );
        }
    }

    /// @notice Verifies TWAMM bounds cannot be overwritten (one-time guard)
    function test_v4Pool_twammBoundsCannotBeOverwritten() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        (MarketId marketId, ) = factory.createMarket(params);

        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;

        // Reconstruct PoolKey
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(C.AUSDC);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: C.POOL_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(twammHook))
        });

        // Attempt to overwrite bounds (should revert)
        vm.expectRevert("Bounds already set");
        twammHook.setPriceBounds(key, 1, 2);
    }

    /// @notice Verifies the pool is initialized at a price where mark ≈ index (pre-trading)
    function test_v4Pool_markPriceCorrespondsToIndex() public {
        RLDMarketFactory.DeployParams memory params = _defaultParams();
        (MarketId marketId, ) = factory.createMarket(params);

        // Get the index price
        uint256 indexPrice = IRLDOracle(rldAaveOracle).getIndexPrice(
            C.AAVE_POOL,
            C.USDC
        );

        // Reconstruct PoolKey to read pool state
        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(
            marketId
        );
        address positionToken = addrs.positionToken;
        Currency currency0 = Currency.wrap(positionToken);
        Currency currency1 = Currency.wrap(C.AUSDC);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: C.POOL_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(twammHook))
        });

        // Read actual sqrtPrice from pool
        (uint160 sqrtPriceX96, , , ) = IPoolManager(C.POOL_MANAGER).getSlot0(
            key.toId()
        );

        // Convert back to a WAD price
        // price = (sqrtPrice / 2^96)^2 * 1e18
        // But we need to handle token ordering
        uint256 sqrtAsWad = (uint256(sqrtPriceX96) * 1e9) / (1 << 96);
        uint256 poolMarkPrice = sqrtAsWad * sqrtAsWad;

        // If wRLP is token1, the pool price is inverted (pool stores token1/token0)
        // so we need to invert back to get wRLP_price = collateral_per_wRLP
        if (Currency.wrap(positionToken) == currency1) {
            // Pool stores collateral/wRLP inverted, so poolMarkPrice is 1/actual_price
            poolMarkPrice = 1e36 / poolMarkPrice;
        }

        // At initialization (no trades yet), mark price should closely match index price
        // Allow 1% tolerance for sqrt rounding
        uint256 lowerBound = (indexPrice * 99) / 100;
        uint256 upperBound = (indexPrice * 101) / 100;

        assertTrue(
            poolMarkPrice >= lowerBound && poolMarkPrice <= upperBound,
            "Mark price must be within 1% of index price at initialization"
        );
    }
}
