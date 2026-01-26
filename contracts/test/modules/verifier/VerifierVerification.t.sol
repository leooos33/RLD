// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {PrimeBrokerFactory} from "../../../src/rld/core/PrimeBrokerFactory.sol";
import {BrokerVerifier} from "../../../src/rld/modules/verifier/BrokerVerifier.sol";
import {PrimeBroker} from "../../../src/rld/broker/PrimeBroker.sol";
import {Clones} from "openzeppelin-v5/contracts/proxy/Clones.sol";
import {IRLDCore, MarketId} from "../../../src/shared/interfaces/IRLDCore.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol"; 

contract MockBroker {
    function initialize(bytes32, address) external {}
}

contract VerifierVerificationTest is Test {
    PrimeBrokerFactory factory;
    BrokerVerifier verifier;
    address implementation;
    
    // JSON Struct 
    struct ScenarioResult {
        address expectedBroker;
        address factory;
        address implementation;
        string name;
        bytes32 salt;
    }

    function setUp() public {
    }

    function test_VerificationFromJSON() public {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/test/differential/data/verifier.json");
        string memory json = vm.readFile(path);
        
        // 1. Verify Static Scenarios
        bytes memory rawStatic = vm.parseJson(json, ".static");
        ScenarioResult[] memory staticResults = abi.decode(rawStatic, (ScenarioResult[]));
        
        console.log("--- Verified Static Address Prediction ---");
        for (uint256 i = 0; i < staticResults.length; i++) {
            _runPredictionCheck(staticResults[i]);
        }

        // 2. Verify Fuzz Vectors
        bytes memory rawFuzz = vm.parseJson(json, ".fuzz");
        ScenarioResult[] memory fuzzResults = abi.decode(rawFuzz, (ScenarioResult[]));
        
        console.log("--- Verified Fuzz Vectors (1000) ---");
        for (uint256 i = 0; i < fuzzResults.length; i++) {
            _runPredictionCheck(fuzzResults[i]);
        }
    }

    function _runPredictionCheck(ScenarioResult memory s) internal pure {
        // Clones.predictDeterministicAddress(implementation, salt, deployer)
        address predicted = Clones.predictDeterministicAddress(
            s.implementation,
            s.salt,
            s.factory
        );
        
        assertEq(predicted, s.expectedBroker, "Address Prediction Mismatch");
    }
    
    // Integration Test: Real Deployment
    function test_Integration_RealDeployment() public {
        // 1. Deploy Implementation
        implementation = address(new MockBroker());
        
        // 2. Deploy Factory
        factory = new PrimeBrokerFactory(
            implementation,
            MarketId.wrap(bytes32(0)),
            "Broker",
            "BKR",
            address(0)
        );
        
        // 3. Deploy Verifier
        verifier = new BrokerVerifier(address(factory));
        
        // 4. Predict Address (using Solidity lib, which we verified against Python above)
        bytes32 salt = keccak256("test_salt");
        address predicted = Clones.predictDeterministicAddress(implementation, salt, address(factory));
        
        // 5. Deploy Real
        address actual = factory.createBroker(salt);
        
        // 6. Assertions
        assertEq(actual, predicted, "Real Deployment failed to match prediction");
        
        assertTrue(factory.isBroker(actual), "Factory should recognize broker");
        assertTrue(verifier.isValidBroker(actual), "Verifier should recognize broker");
        
        // 7. Negative Test
        assertFalse(verifier.isValidBroker(address(0xdead)), "Random address should be invalid");
        
        // Check undeployed address with different salt
        address other = Clones.predictDeterministicAddress(implementation, keccak256("other"), address(factory));
        assertFalse(verifier.isValidBroker(other), "Undeployed predicted address should be invalid");
    }
}
