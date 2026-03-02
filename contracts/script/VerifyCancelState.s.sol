// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {OrderKey} from "../src/twamm/IJTM.sol";

interface IJTM {
    function getCancelOrderState(
        PoolKey calldata key,
        OrderKey calldata orderKey
    ) external view returns (uint256, uint256);
    function cancelOrder(
        PoolKey calldata key,
        OrderKey calldata orderKey
    ) external returns (uint256, uint256);
}

contract VerifyCancelState is Script {
    function run() public {
        // Read deployment
        string memory deployJson = vm.readFile("../docker/deployment.json");
        bytes memory rawHook = vm.parseJson(deployJson, ".twamm_hook");
        address hookAddr = abi.decode(rawHook, (address));

        bytes memory rawToken0 = vm.parseJson(deployJson, ".token0");
        address token0 = abi.decode(rawToken0, (address));

        bytes memory rawToken1 = vm.parseJson(deployJson, ".token1");
        address token1 = abi.decode(rawToken1, (address));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 500,
            tickSpacing: 5,
            hooks: IHooks(hookAddr)
        });

        // Event signature hash for SubmitOrder
        bytes32 submitSig = keccak256(
            "SubmitOrder(bytes32,bytes32,address,uint256,uint160,bool,uint256,uint256,uint256)"
        );

        // Fetch the last SubmitOrder event
        // We'll use vm.getRecordedLogs or just parse RPC directly.
        // Actually, easiest is to use `vm.getLogs` if available, but it might not be supported without creating them.
        // Let's rely on JSON RPC for raw logs via `cast rc`? No, ffi is disabled by default in foundry config.
    }
}
