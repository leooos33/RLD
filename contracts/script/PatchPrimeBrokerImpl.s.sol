// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PrimeBroker} from "../src/rld/broker/PrimeBroker.sol";

contract PatchPrimeBrokerImpl is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        address v4Module = 0x70e754531418461eF2366b72cd396337d2AD6D5d;
        address twammModule = 0xeF66010868Ff77119171628B7eFa0F6179779375;
        address posm = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
        address oldImpl = 0xf975A646FCa589Be9fc4E0C28ea426A75645fB1f;

        vm.startBroadcast(pk);

        PrimeBroker newImpl = new PrimeBroker(v4Module, twammModule, posm);
        console.log("New PrimeBroker impl:", address(newImpl));

        vm.stopBroadcast();

        // Patch old impl with new bytecode
        bytes memory newCode = address(newImpl).code;
        vm.etch(oldImpl, newCode);
        console.log("Patched old impl at:", oldImpl);

        // Verify
        PrimeBroker patched = PrimeBroker(payable(oldImpl));
        console.log("V4_MODULE:", patched.V4_MODULE());
        console.log("TWAMM_MODULE:", patched.TWAMM_MODULE());
        console.log("POSM:", patched.POSM());
    }
}
