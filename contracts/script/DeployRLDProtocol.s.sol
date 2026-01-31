// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

// Core
import {RLDCore} from "../src/rld/core/RLDCore.sol";
import {RLDMarketFactory} from "../src/rld/core/RLDMarketFactory.sol";

// Templates
import {PositionToken} from "../src/rld/tokens/PositionToken.sol";
import {PrimeBroker} from "../src/rld/broker/PrimeBroker.sol";

// Modules
import {DutchLiquidationModule} from "../src/rld/modules/liquidation/DutchLiquidationModule.sol";
import {StandardFundingModel} from "../src/rld/modules/funding/StandardFundingModel.sol";
import {UniswapV4SingletonOracle} from "../src/rld/modules/oracles/UniswapV4SingletonOracle.sol";
import {RLDAaveOracle} from "../src/rld/modules/oracles/RLDAaveOracle.sol";

/// @notice Minimal metadata renderer that returns empty strings (satisfies non-zero check)
contract MinimalMetadataRenderer {
    function tokenURI(uint256) external pure returns (string memory) {
        return "";
    }
}

/// @notice Minimal valuation module placeholder (for PrimeBroker constructor)
contract MinimalValuationModule {
    function getValue(bytes calldata) external pure returns (uint256) {
        return 0;
    }
}

/**
 * @title DeployRLDProtocol
 * @notice Deploys the full RLD Protocol to an Anvil Mainnet Fork
 * @dev Run with: forge script script/DeployRLDProtocol.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract DeployRLDProtocol is Script {
    // ============================================
    // MAINNET ADDRESSES (Pre-existing)
    // ============================================
    
    // Uniswap V4
    address constant UNISWAP_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant UNISWAP_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    
    // Aave V3
    address constant AAVE_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant AUSDC = 0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    
    // ============================================
    // DEPLOYED ADDRESSES (filled during deployment)
    // ============================================
    
    // Helpers
    address public metadataRenderer;
    address public v4ValuationModule;
    address public twammValuationModule;
    
    // Templates
    address public positionTokenImpl;
    address public primeBrokerImpl;
    
    // Modules
    address public dutchLiquidationModule;
    address public standardFundingModel;
    address public v4Oracle;
    address public rldAaveOracle;
    
    // Core
    address public rldMarketFactory;
    address public rldCore;
    
    // Config
    uint32 constant FUNDING_PERIOD = 30 days;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("========================================");
        console.log("RLD PROTOCOL DEPLOYMENT");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // ============================================
        // PHASE 0: Deploy Helper Contracts
        // ============================================
        console.log("PHASE 0: Helper Contracts");
        console.log("----------------------------------");
        
        MinimalMetadataRenderer renderer = new MinimalMetadataRenderer();
        metadataRenderer = address(renderer);
        console.log("MetadataRenderer:", metadataRenderer);
        
        MinimalValuationModule v4Module = new MinimalValuationModule();
        v4ValuationModule = address(v4Module);
        console.log("V4 Valuation Module:", v4ValuationModule);
        
        MinimalValuationModule twammModule = new MinimalValuationModule();
        twammValuationModule = address(twammModule);
        console.log("TWAMM Valuation Module:", twammValuationModule);
        
        console.log("");
        
        // ============================================
        // PHASE 1: Deploy Singleton Modules
        // ============================================
        console.log("PHASE 1: Singleton Modules");
        console.log("----------------------------------");
        
        // DutchLiquidationModule
        DutchLiquidationModule liqModule = new DutchLiquidationModule();
        dutchLiquidationModule = address(liqModule);
        console.log("DutchLiquidationModule:", dutchLiquidationModule);
        
        // StandardFundingModel
        StandardFundingModel fundingModel = new StandardFundingModel();
        standardFundingModel = address(fundingModel);
        console.log("StandardFundingModel:", standardFundingModel);
        
        // UniswapV4SingletonOracle
        UniswapV4SingletonOracle oracle = new UniswapV4SingletonOracle();
        v4Oracle = address(oracle);
        console.log("UniswapV4SingletonOracle:", v4Oracle);
        
        // RLDAaveOracle (for rate/index prices)
        RLDAaveOracle aaveOracle = new RLDAaveOracle();
        rldAaveOracle = address(aaveOracle);
        console.log("RLDAaveOracle:", rldAaveOracle);
        
        console.log("");
        
        // ============================================
        // PHASE 2: Deploy Implementation Templates
        // ============================================
        console.log("PHASE 2: Implementation Templates");
        console.log("----------------------------------");
        
        // PositionToken Implementation (dummy - will be deployed fresh per market)
        // The factory checks for non-zero but doesn't actually clone it
        PositionToken positionTokenImplContract = new PositionToken(
            "Implementation",
            "IMPL",
            18,
            address(1) // Placeholder collateral
        );
        positionTokenImpl = address(positionTokenImplContract);
        console.log("PositionToken Impl:", positionTokenImpl);
        
        // PrimeBroker needs CORE, but CORE needs Factory which needs PrimeBroker impl
        // PrimeBroker implementation - CORE is now set in initialize()
        PrimeBroker primeBrokerImplContract = new PrimeBroker(
            v4ValuationModule,       // _v4Module
            twammValuationModule,    // _twammModule
            UNISWAP_POSITION_MANAGER // _posm
        );
        primeBrokerImpl = address(primeBrokerImplContract);
        console.log("PrimeBroker Impl:", primeBrokerImpl);
        
        console.log("");
        
        // ============================================
        // PHASE 3: Deploy Factory
        // ============================================
        console.log("PHASE 3: Market Factory");
        console.log("----------------------------------");
        
        // Note: TWAMM is optional (set to 0 for testing)
        RLDMarketFactory factory = new RLDMarketFactory(
            UNISWAP_POOL_MANAGER,   // poolManager
            positionTokenImpl,      // positionTokenImpl
            primeBrokerImpl,        // primeBrokerImpl
            v4Oracle,               // v4Oracle
            standardFundingModel,   // fundingModel
            address(0),             // twamm (optional for testing)
            metadataRenderer,       // metadataRenderer
            FUNDING_PERIOD          // fundingPeriod
        );
        rldMarketFactory = address(factory);
        console.log("RLDMarketFactory:", rldMarketFactory);
        
        console.log("");
        
        // ============================================
        // PHASE 4: Deploy Core
        // ============================================
        console.log("PHASE 4: RLD Core");
        console.log("----------------------------------");
        
        RLDCore core = new RLDCore(
            rldMarketFactory,       // factory
            UNISWAP_POOL_MANAGER,   // poolManager
            address(0)              // twamm (optional for testing)
        );
        rldCore = address(core);
        console.log("RLDCore:", rldCore);
        
        console.log("");
        
        // ============================================
        // PHASE 5: Initialize Factory <-> Core Link
        // ============================================
        console.log("PHASE 5: Initialize Links");
        console.log("----------------------------------");
        
        factory.initializeCore(rldCore);
        console.log("Factory linked to Core: OK");
        
        vm.stopBroadcast();
        
        // ============================================
        // SUMMARY
        // ============================================
        console.log("");
        console.log("========================================");
        console.log("DEPLOYMENT COMPLETE!");
        console.log("========================================");
        console.log("");
        console.log("Core Protocol:");
        console.log("  RLDCore:", rldCore);
        console.log("  RLDMarketFactory:", rldMarketFactory);
        console.log("");
        console.log("Modules:");
        console.log("  DutchLiquidationModule:", dutchLiquidationModule);
        console.log("  StandardFundingModel:", standardFundingModel);
        console.log("  UniswapV4SingletonOracle:", v4Oracle);
        console.log("  RLDAaveOracle:", rldAaveOracle);
        console.log("");
        console.log("External (Mainnet):");
        console.log("  Uniswap PoolManager:", UNISWAP_POOL_MANAGER);
        console.log("  Aave Pool:", AAVE_POOL);
        console.log("  aUSDC:", AUSDC);
        console.log("  USDC:", USDC);
    }
}
