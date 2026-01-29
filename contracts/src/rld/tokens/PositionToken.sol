// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {Owned} from "solmate/src/auth/Owned.sol";
import {MarketId} from "../../shared/interfaces/IRLDCore.sol";

/**
 * @title PositionToken
 * @notice ERC20 token representing wrapped RLP positions (wRLP)
 * @dev Decimals are set via constructor to match collateral token
 *      e.g., wRLPaUSDC has 6 decimals, wRLPaDAI has 18 decimals
 */
contract PositionToken is ERC20, Owned {
    MarketId public marketId;
    address public immutable collateral;

    error MarketIdAlreadySet();

    /**
     * @param _name Token name (e.g., "Wrapped RLP: aUSDC")
     * @param _symbol Token symbol (e.g., "wRLPaUSDC")
     * @param _decimals Token decimals (matches collateral, e.g., 6 for aUSDC)
     * @param _collateral The collateral token address (e.g., aUSDC)
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _collateral
    ) ERC20(_name, _symbol, _decimals) Owned(msg.sender) {
        collateral = _collateral;
    }

    function setMarketId(MarketId _id) external onlyOwner {
        if (MarketId.unwrap(marketId) != bytes32(0)) revert MarketIdAlreadySet();
        marketId = _id;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
