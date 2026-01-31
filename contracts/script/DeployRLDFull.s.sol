// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

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

// TWAMM
import {TWAMM} from "../src/twamm/TWAMM.sol";

/// @notice Minimal metadata renderer
contract MinimalMetadataRenderer {
    function tokenURI(uint256) external pure returns (string memory) {
        return "";
    }
}

/// @notice Minimal valuation module placeholder
contract MinimalValuationModule {
    function getValue(bytes calldata) external pure returns (uint256) {
        return 0;
    }
}

/**
 * @title DeployRLDFull
 * @notice Deploys the complete RLD Protocol with TWAMM integration
 * @dev Deployment order:
 *      1. TWAMM Hook (needs special CREATE2 address)
 *      2. Helper contracts (MetadataRenderer, ValuationModules)
 *      3. Singleton Modules (Liquidation, Funding, Oracles)
 *      4. Implementation Templates (PositionToken, PrimeBroker)
 *      5. RLDMarketFactory (with TWAMM address)
 *      6. RLDCore (with TWAMM address)
 *      7. Initialize Factory <-> Core link
 * 
 * Run: forge script script/DeployRLDFull.s.sol:DeployRLDFull --rpc-url http://127.0.0.1:8545 --broadcast --private-key $PRIVATE_KEY -vvv
 */
contract DeployRLDFull is Script {
    // ============================================
    // CONSTANTS
    // ============================================
    
    // CREATE2 deployer for HookMiner
    address constant CREATE2_DEPLOYER = address(0x4e59b44847b379578588920cA78FbF26c0B4956C);
    
    // Mainnet Uniswap V4
    address constant UNISWAP_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant UNISWAP_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    
    // Mainnet Aave V3
    address constant AAVE_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant AUSDC = 0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    
    // Config
    uint256 constant TWAMM_EXPIRATION_INTERVAL = 1 hours;
    uint32 constant FUNDING_PERIOD = 30 days;
    
    // ============================================
    // DEPLOYED ADDRESSES
    // ============================================
    
    // TWAMM (deployed first via CREATE2)
    address public twamm;
    
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
    
    // ============================================
    // ISSUE TRACKING
    // ============================================
    string[] public issues;
    
    function _logIssue(string memory issue) internal {
        issues.push(issue);
        console.log("[ISSUE]", issue);
    }
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("");
        console.log("================================================================");
        console.log("  RLD PROTOCOL FULL DEPLOYMENT (WITH TWAMM)");
        console.log("================================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("PoolManager:", UNISWAP_POOL_MANAGER);
        console.log("");
        
        // ============================================
        // PHASE 1: Deploy TWAMM Hook via CREATE2
        // ============================================
        console.log("----------------------------------------------------------------");
        console.log("PHASE 1: TWAMM Hook (CREATE2 Salt Mining)");
        console.log("----------------------------------------------------------------");
        
        _deployTWAMM(deployer, deployerPrivateKey);
        
        // ============================================
        // PHASE 2: Deploy Helper Contracts
        // ============================================
        console.log("");
        console.log("----------------------------------------------------------------");
        console.log("PHASE 2: Helper Contracts");
        console.log("----------------------------------------------------------------");
        
        vm.startBroadcast(deployerPrivateKey);
        
        MinimalMetadataRenderer renderer = new MinimalMetadataRenderer();
        metadataRenderer = address(renderer);
        console.log("MetadataRenderer:", metadataRenderer);
        
        MinimalValuationModule v4Mod = new MinimalValuationModule();
        v4ValuationModule = address(v4Mod);
        console.log("V4ValuationModule:", v4ValuationModule);
        
        MinimalValuationModule twammMod = new MinimalValuationModule();
        twammValuationModule = address(twammMod);
        console.log("TwammValuationModule:", twammValuationModule);
        
        vm.stopBroadcast();
        
        // ============================================
        // PHASE 3: Deploy Singleton Modules
        // ============================================
        console.log("");
        console.log("----------------------------------------------------------------");
        console.log("PHASE 3: Singleton Modules");
        console.log("----------------------------------------------------------------");
        
        vm.startBroadcast(deployerPrivateKey);
        
        DutchLiquidationModule liqModule = new DutchLiquidationModule();
        dutchLiquidationModule = address(liqModule);
        console.log("DutchLiquidationModule:", dutchLiquidationModule);
        
        StandardFundingModel fundingModel = new StandardFundingModel();
        standardFundingModel = address(fundingModel);
        console.log("StandardFundingModel:", standardFundingModel);
        
        UniswapV4SingletonOracle oracle = new UniswapV4SingletonOracle();
        v4Oracle = address(oracle);
        console.log("UniswapV4SingletonOracle:", v4Oracle);
        
        RLDAaveOracle aaveOracle = new RLDAaveOracle();
        rldAaveOracle = address(aaveOracle);
        console.log("RLDAaveOracle:", rldAaveOracle);
        
        vm.stopBroadcast();
        
        // ============================================
        // PHASE 4: Deploy Implementation Templates
        // ============================================
        console.log("");
        console.log("----------------------------------------------------------------");
        console.log("PHASE 4: Implementation Templates");
        console.log("----------------------------------------------------------------");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // PositionToken implementation (dummy - factory deploys fresh per market)
        PositionToken ptImpl = new PositionToken(
            "Implementation",
            "IMPL",
            18,
            address(1) // Placeholder
        );
        positionTokenImpl = address(ptImpl);
        console.log("PositionTokenImpl:", positionTokenImpl);
        
        // NOTE: PositionToken constructor stores collateral as immutable
        // but POSITION_TOKEN_IMPL in factory is never actually cloned
        // Factory uses `new PositionToken(...)` directly - see _deployPositionToken()
        _logIssue("PositionToken: POSITION_TOKEN_IMPL in Factory is stored but unused - Factory deploys fresh");
        
        // PrimeBroker implementation
        // NOTE: CORE is no longer set in constructor - it's set in initialize()
        // This fixes the EIP-1167 clone inheritance issue where clones would
        // inherit the implementation's immutable CORE value
        
        PrimeBroker pbImpl = new PrimeBroker(
            v4ValuationModule,       // _v4Module
            twammValuationModule,    // _twammModule
            UNISWAP_POSITION_MANAGER // _posm
        );
        primeBrokerImpl = address(pbImpl);
        console.log("PrimeBrokerImpl:", primeBrokerImpl);
        console.log("  -> CORE will be set per-clone during initialize()");
        
        vm.stopBroadcast();
        
        // ============================================
        // PHASE 5: Deploy RLDMarketFactory (with TWAMM)
        // ============================================
        console.log("");
        console.log("----------------------------------------------------------------");
        console.log("PHASE 5: RLDMarketFactory");
        console.log("----------------------------------------------------------------");
        
        vm.startBroadcast(deployerPrivateKey);
        
        RLDMarketFactory factory = new RLDMarketFactory(
            UNISWAP_POOL_MANAGER,   // poolManager
            positionTokenImpl,      // positionTokenImpl (unused but validated)
            primeBrokerImpl,        // primeBrokerImpl
            v4Oracle,               // v4Oracle
            standardFundingModel,   // fundingModel
            twamm,                  // twamm - NOW PROPERLY SET!
            metadataRenderer,       // metadataRenderer
            FUNDING_PERIOD          // fundingPeriod
        );
        rldMarketFactory = address(factory);
        console.log("RLDMarketFactory:", rldMarketFactory);
        console.log("  -> TWAMM integrated:", twamm);
        
        vm.stopBroadcast();
        
        // ============================================
        // PHASE 6: Deploy RLDCore (with TWAMM)
        // ============================================
        console.log("");
        console.log("----------------------------------------------------------------");
        console.log("PHASE 6: RLDCore");
        console.log("----------------------------------------------------------------");
        
        vm.startBroadcast(deployerPrivateKey);
        
        RLDCore core = new RLDCore(
            rldMarketFactory,       // factory
            UNISWAP_POOL_MANAGER,   // poolManager
            twamm                   // twamm - NOW PROPERLY SET!
        );
        rldCore = address(core);
        console.log("RLDCore:", rldCore);
        console.log("  -> Factory:", rldMarketFactory);
        console.log("  -> TWAMM:", twamm);
        
        vm.stopBroadcast();
        
        // ============================================
        // PHASE 7: Initialize Factory <-> Core Link
        // ============================================
        console.log("");
        console.log("----------------------------------------------------------------");
        console.log("PHASE 7: Initialize Links");
        console.log("----------------------------------------------------------------");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Link Factory to Core
        factory.initializeCore(rldCore);
        console.log("Factory.initializeCore(Core) - OK");
        
        // Verify the link
        address factoryCore = factory.CORE();
        console.log("  -> Factory.CORE():", factoryCore);
        require(factoryCore == rldCore, "Core link failed!");
        
        // Link TWAMM to Core (fixes the circular dependency)
        TWAMM(twamm).setRldCore(rldCore);
        console.log("TWAMM.setRldCore(Core) - OK");
        console.log("  -> TWAMM.rldCore():", TWAMM(twamm).rldCore());
        
        vm.stopBroadcast();
        
        // ============================================
        // SUMMARY
        // ============================================
        console.log("");
        console.log("================================================================");
        console.log("  DEPLOYMENT COMPLETE!");
        console.log("================================================================");
        console.log("");
        console.log("Core Protocol:");
        console.log("  RLDCore:", rldCore);
        console.log("  RLDMarketFactory:", rldMarketFactory);
        console.log("  TWAMM:", twamm);
        console.log("");
        console.log("Modules:");
        console.log("  DutchLiquidationModule:", dutchLiquidationModule);
        console.log("  StandardFundingModel:", standardFundingModel);
        console.log("  UniswapV4SingletonOracle:", v4Oracle);
        console.log("  RLDAaveOracle:", rldAaveOracle);
        console.log("");
        console.log("Templates:");
        console.log("  PositionTokenImpl:", positionTokenImpl);
        console.log("  PrimeBrokerImpl:", primeBrokerImpl);
        console.log("");
        console.log("Helpers:");
        console.log("  MetadataRenderer:", metadataRenderer);
        console.log("  V4ValuationModule:", v4ValuationModule);
        console.log("  TwammValuationModule:", twammValuationModule);
        console.log("");
        
        if (issues.length > 0) {
            console.log("----------------------------------------------------------------");
            console.log("ISSUES FOUND:", issues.length);
            console.log("----------------------------------------------------------------");
            for (uint i = 0; i < issues.length; i++) {
                console.log(i + 1, ":", issues[i]);
            }
        }
        
        console.log("");
        console.log("External (Mainnet Fork):");
        console.log("  UniswapPoolManager:", UNISWAP_POOL_MANAGER);
        console.log("  UniswapPositionManager:", UNISWAP_POSITION_MANAGER);
        console.log("  AavePool:", AAVE_POOL);
        console.log("  aUSDC:", AUSDC);
        console.log("  USDC:", USDC);
    }
    
    function _deployTWAMM(address deployer, uint256 deployerPrivateKey) internal {
        // TWAMM Hook Permissions (must match getHookPermissions())
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
            Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG
        );
        
        console.log("Hook Permission Flags:", uint256(flags));
        
        // NOTE: TWAMM is deployed with rldCore=address(0) initially
        // This is intentional: Core hasn't been deployed yet
        // We'll call TWAMM.setRldCore() in Phase 7 after Core is deployed
        
        bytes memory creationCode = type(TWAMM).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(UNISWAP_POOL_MANAGER),
            TWAMM_EXPIRATION_INTERVAL,
            deployer,      // initialOwner
            address(0)     // rldCore - will be set via setRldCore() later
        );
        
        console.log("Mining for valid hook address...");
        
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );
        
        console.log("Found hook address:", hookAddress);
        console.log("Salt:", vm.toString(salt));
        
        vm.broadcast(deployerPrivateKey);
        TWAMM twammContract = new TWAMM{salt: salt}(
            IPoolManager(UNISWAP_POOL_MANAGER),
            TWAMM_EXPIRATION_INTERVAL,
            deployer,
            address(0) // rldCore - set via setRldCore() in Phase 7
        );
        
        require(address(twammContract) == hookAddress, "TWAMM address mismatch!");
        twamm = address(twammContract);
        console.log("TWAMM deployed:", twamm);
        console.log("  -> rldCore will be set in Phase 7");
    }
}
