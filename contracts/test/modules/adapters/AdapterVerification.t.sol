// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {AaveAdapter} from "../../../src/rld/modules/adapters/AaveAdapter.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

// Mock Pool that records calls
contract MockAavePool {
    bytes public lastCallData;
    
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        lastCallData = msg.data;
    }
    
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        lastCallData = msg.data;
        return amount;
    }
    
    function getReserveData(address) external view returns (uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address) {
        return (0,0,0,0,0,0,0,0, address(0), address(0), address(0)); 
    }
}

contract AdapterVerificationTest is Test {
    AaveAdapter adapter;
    MockAavePool pool;
    address constant CORE = 0xC000000000000000000000000000000000000000;
    
    struct ScenarioResult {
        uint256 action; // 1=Supply, 2=Withdraw
        uint256 amount;
        address asset;
        bytes expectedCalldata;
        string name;
        address user;
    }

    function setUp() public {
        pool = new MockAavePool();
        adapter = new AaveAdapter(address(pool));
        
        // Etch ourselves as CORE to match Python expectation
        vm.etch(CORE, address(this).code);
    }

    function test_VerificationFromJSON() public {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/test/differential/data/adapter.json");
        string memory json = vm.readFile(path);
        
        // Verify Fuzz Vectors
        bytes memory rawFuzz = vm.parseJson(json, ".fuzz");
        ScenarioResult[] memory fuzzResults = abi.decode(rawFuzz, (ScenarioResult[]));
        
        console.log("--- Verified Adapter Fuzz Vectors (1000) ---");
        for (uint256 i = 0; i < fuzzResults.length; i++) {
            _runScenario(fuzzResults[i]);
        }
    }

    function _runScenario(ScenarioResult memory s) internal {
        // Deploy Mock Asset
        MockERC20 asset = new MockERC20("Mock", "MCK", 18);
        vm.etch(s.asset, address(asset).code);
        MockERC20(s.asset).mint(CORE, s.amount);
        
        // Prank as CORE
        vm.startPrank(CORE);
        MockERC20(s.asset).approve(address(adapter), s.amount);
        
        if (s.action == 1) { // Supply
            adapter.supply(s.asset, s.amount);
        } else if (s.action == 2) { // Withdraw
            // For withdraw, setup aToken behavior? 
            // Mock Pool.getReserveData returns 0 address for aToken usually.
            // But verify_adapter logic for withdraw doesn't check aToken transfer, 
            // it checks Pool.withdraw call.
            // Adapter.withdraw does: transferFrom(aToken) -> pool.withdraw.
            // We need to support getReserveData returning a mock aToken if we want full execution.
            // BUT: Python expectation is just "Pool.withdraw is called with X".
            
            // To pass execution, getReserveData must return valid token?
            // MockPool returns address(0). Adapter calls IERC20(0).transferFrom... REVERT.
            
            // Fix: Mock Pool Logic in Setup?
            // Or simpler: Mock the call to getReserveData via vm.mockCall.
            MockERC20 aToken = new MockERC20("AToken", "aTKN", 18);
            aToken.mint(CORE, s.amount);
            aToken.approve(address(adapter), s.amount);
            
            vm.mockCall(
                address(pool), 
                abi.encodeWithSelector(pool.getReserveData.selector),
                abi.encode(0,0,0,0,0,0,0,0, address(aToken), address(0), address(0))
            );
            
            adapter.withdraw(s.asset, s.amount);
        }
        vm.stopPrank();
        
        // Assert
        assertEq(pool.lastCallData(), s.expectedCalldata, "Calldata mismatch");
    }
}
