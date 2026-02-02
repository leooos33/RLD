// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPrimeBroker} from "../shared/interfaces/IPrimeBroker.sol";

/// @dev Minimal Ownable interface for broker ownership check
interface IOwnable {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title BrokerExecutor - Peripheral contract for atomic broker operations
/// @author RLD Protocol
/// @notice Enables atomic execution of multiple calls with signature-based authorization
///
/// @dev Security Model:
/// 1. Owner signs a message authorizing this executor to become operator
/// 2. Executor sets itself as operator via signature
/// 3. Executor performs all requested calls (can target any contract)
/// 4. Executor revokes its own operator status
///
/// This ensures no lingering approvals and atomic all-or-nothing execution.
contract BrokerExecutor is ReentrancyGuard {
    
    /// @notice A call to execute
    struct Call {
        address target;  // Contract to call
        bytes data;      // Encoded function call
    }
    
    /// @notice Execute multiple calls atomically
    /// @dev Sets executor as operator via signature, executes calls, then revokes
    ///
    /// @param broker The PrimeBroker address (for operator management)
    /// @param ownerSignature EIP-191 signature from broker owner authorizing this execution
    /// @param calls Array of calls to execute (can target any contract)
    function execute(
        address broker,
        bytes calldata ownerSignature,
        Call[] calldata calls
    ) external nonReentrant {
        IPrimeBroker pb = IPrimeBroker(broker);
        
        // Get current nonce for this executor on this broker
        uint256 nonce = pb.operatorNonces(address(this));
        
        // Set self as operator using owner's signature
        pb.setOperatorWithSignature(
            address(this),
            true,
            ownerSignature,
            nonce
        );
        
        // Execute all calls
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory result) = calls[i].target.call(calls[i].data);
            if (!success) {
                // Bubble up revert reason
                if (result.length > 0) {
                    assembly {
                        revert(add(32, result), mload(result))
                    }
                } else {
                    revert("BrokerExecutor: call failed");
                }
            }
        }
        
        // ALWAYS revoke operator status at the end
        pb.setOperator(address(this), false);
    }
    
    /// @notice Generate the message hash that the owner needs to sign
    /// @dev Helper function for clients to generate the correct signature
    ///
    /// @param broker The broker address
    /// @param nonce The current nonce from broker.operatorNonces(executor)
    /// @return The keccak256 hash to be signed (before EIP-191 prefix)
    function getMessageHash(
        address broker,
        uint256 nonce
    ) external view returns (bytes32) {
        return keccak256(abi.encode(
            address(this),  // operator (this executor)
            broker,         // broker address
            nonce,          // nonce
            address(this)   // caller (also this executor)
        ));
    }
    
    /// @notice Generate the EIP-191 prefixed hash that the owner signs
    /// @dev This is the actual hash that should be signed
    ///
    /// @param broker The broker address
    /// @param nonce The current nonce from broker.operatorNonces(executor)
    /// @return The EIP-191 prefixed hash to sign
    function getEthSignedMessageHash(
        address broker,
        uint256 nonce
    ) external view returns (bytes32) {
        bytes32 messageHash = keccak256(abi.encode(
            address(this),
            broker,
            nonce,
            address(this)
        ));
        return keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));
    }
}
