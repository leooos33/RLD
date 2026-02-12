// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {BrokerRouter} from "../src/periphery/BrokerRouter.sol";

contract DeployBrokerRouterScript is Script {
    address constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        vm.startBroadcast();

        BrokerRouter router = new BrokerRouter(POOL_MANAGER, PERMIT2);
        console.log("BrokerRouter deployed at:", address(router));

        vm.stopBroadcast();
    }
}
