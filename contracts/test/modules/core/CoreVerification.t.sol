// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {RLDCore} from "../../../src/rld/core/RLDCore.sol";
import {IRLDOracle} from "../../../src/shared/interfaces/IRLDOracle.sol";
import {IPrimeBroker} from "../../../src/shared/interfaces/IPrimeBroker.sol";
import {IBrokerVerifier} from "../../../src/shared/interfaces/IBrokerVerifier.sol";
import {MarketId} from "../../../src/shared/interfaces/IRLDCore.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

// Harness to expose internal state for testing
contract RLDCoreHarness is RLDCore {
    function setMarketState(MarketId id, uint128 normalizationFactor) external {
        marketStates[id].normalizationFactor = normalizationFactor;
    }
    
    function setPositionLegacy(MarketId id, address user, uint128 principal) external {
        positions[id][user].debtPrincipal = principal;
    }
    
    // Helper to configure a dummy market
    function setupMarket(MarketId id, address oracle, address verifier, uint256 minRatio) external {
        MarketAddresses storage addr = marketAddresses[id];
        addr.rateOracle = oracle;
        // addr.collateralToken = address(1); // Fake
        
        MarketConfig storage cfg = marketConfigs[id];
        cfg.maintenanceMargin = uint64(minRatio); // Ratio
        cfg.brokerVerifier = verifier;
    }
}

contract CoreVerificationTest is Test {
    RLDCoreHarness core;
    
    struct ScenarioResult {
        uint256 accountValue;
        uint256 indexPrice;
        bool isSolvent;
        uint256 minRatio;
        string name;
        uint256 normFactor;
        uint256 principal;
    }
    
    MarketId constant TEST_MARKET = MarketId.wrap(bytes32(uint256(1)));
    address constant BROKER = address(0x99);

    function setUp() public {
        core = new RLDCoreHarness();
    }

    function test_VerificationFromJSON() public {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/test/differential/data/core.json");
        string memory json = vm.readFile(path);
        
        bytes memory rawFuzz = vm.parseJson(json, ".fuzz");
        ScenarioResult[] memory fuzzResults = abi.decode(rawFuzz, (ScenarioResult[]));
        
        console.log("--- Verified Core Solvency Fuzz Vectors (1000) ---");
        for (uint256 i = 0; i < fuzzResults.length; i++) {
            _runScenario(fuzzResults[i]);
        }
    }

    function _runScenario(ScenarioResult memory s) internal {
        // 1. Mock Oracle
        address oracle = address(0x1);
        vm.mockCall(
            oracle,
            abi.encodeWithSelector(IRLDOracle.getIndexPrice.selector),
            abi.encode(s.indexPrice)
        );
        
        // 2. Mock Broker
        // Address 'user' simulates a broker-controlled address
        address user = address(uint160(0xCAFE + s.accountValue)); /* Unique per scenario to reuse mocks? No, mock on precise address */
        user = address(0xCAFE);
        
        vm.mockCall(
            user,
            abi.encodeWithSelector(IPrimeBroker.getNetAccountValue.selector),
            abi.encode(s.accountValue)
        );
        
        // 3. Mock BrokerVerifier (Always Valid)
        address verifier = address(0x2);
        vm.mockCall(
            verifier,
            abi.encodeWithSelector(IBrokerVerifier.isValidBroker.selector, user),
            abi.encode(true)
        );
        
        // 4. Setup State in Core
        // Use harness to force state
        core.setupMarket(TEST_MARKET, oracle, verifier, s.minRatio);
        core.setMarketState(TEST_MARKET, uint128(s.normFactor));
        core.setPositionLegacy(TEST_MARKET, user, uint128(s.principal));
        
        // 5. Check Solvency
        // The check uses _isSolvent internally. 
        // We can access it via 'isSolvent' external view if we update the config margin.
        // But `isSolvent` external uses `config.maintenanceMargin`.
        // We set `config.maintenanceMargin` to `s.minRatio` in setupMarket.
        
        bool actual = core.isSolvent(TEST_MARKET, user);
        
        if (actual != s.isSolvent) {
             console.log("Mismatch for:", s.name);
             console.log("Expected Solvency:", s.isSolvent);
             console.log("Actual Solvency:", actual);
             fail();
        }
    }
}
