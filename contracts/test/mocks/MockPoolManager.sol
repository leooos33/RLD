// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

contract MockPoolManager {
    using PoolIdLibrary for PoolKey;

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24) {
        return 0;
    }
}
