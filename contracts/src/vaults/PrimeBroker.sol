// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPrimeBroker} from "../interfaces/IPrimeBroker.sol";
import {IRLDCore, MarketId} from "../interfaces/IRLDCore.sol";
import {IBrokerModule} from "../interfaces/IBrokerModule.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @title Prime Broker V1 (Thin Version)
/// @notice "Smart Margin Account" protecting RLD Protocol.
/// @dev Optimized for cloning and Core-based data fetching.
contract PrimeBroker is IPrimeBroker {
    using SafeTransferLib for ERC20;

    /* ============================================================================================ */
    /*                                          IMMUTABLES                                          */
    /* ============================================================================================ */

    // System Config (Universal)
    address public immutable CORE;
    address public immutable V4_MODULE;
    address public immutable TWAMM_MODULE;
    address public immutable POSM; // Universal V4 Position Manager

    /* ============================================================================================ */
    /*                                            STORAGE                                           */
    /* ============================================================================================ */

    // Market Identity
    address public owner;
    MarketId public marketId;
    
    // Active Assets (V1 Limit: One of each)
    uint256 public activeTokenId; // V4 Position
    uint256 public activeOrderId; // TWAMM Order
    
    // Init check
    bool private initialized;

    /* ============================================================================================ */
    /*                                          MODIFIERS                                           */
    /* ============================================================================================ */

    modifier onlyCore() {
        require(msg.sender == CORE, "Not Core");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not Owner");
        _;
    }

    /* ============================================================================================ */
    /*                                         CONSTRUCTOR                                          */
    /* ============================================================================================ */

    constructor(address _core, address _v4Module, address _twammModule, address _posm) {
        CORE = _core;
        V4_MODULE = _v4Module;
        TWAMM_MODULE = _twammModule;
        POSM = _posm;
    }

    function initialize(
        address _owner,
        MarketId _marketId
    ) external {
        require(!initialized, "Initialized");
        owner = _owner;
        marketId = _marketId;
        initialized = true;
    }

    /* ============================================================================================ */
    /*                                       VALUATION LOGIC                                        */
    /* ============================================================================================ */

    function getNetAccountValue() external view override returns (uint256 totalValue) {
        IRLDCore.MarketAddresses memory vars = IRLDCore(CORE).getMarketAddresses(marketId);

        // 1. Cash Balance (Collateral)
        totalValue += ERC20(vars.collateralToken).balanceOf(address(this));

        // 2. TWAMM Value
        if (activeOrderId != 0) {
            bytes memory data = abi.encode(
                activeOrderId,
                vars.hook,
                vars.rateOracle,
                vars.collateralToken, // Input (Sell Collateral)
                vars.underlyingToken  // Output (Buy Debt)
            );
            totalValue += IBrokerModule(TWAMM_MODULE).getValue(data);
        }

        // 3. V4 Value
        if (activeTokenId != 0) {
            bytes memory data = abi.encode(
                activeTokenId,
                POSM,
                vars.rateOracle,
                vars.collateralToken,
                vars.underlyingToken
            );
            totalValue += IBrokerModule(V4_MODULE).getValue(data);
        }
    }

    /* ============================================================================================ */
    /*                                      LIQUIDATION LOGIC                                       */
    /* ============================================================================================ */

    function seize(uint256 value, address recipient) external override onlyCore {
        IRLDCore.MarketAddresses memory vars = IRLDCore(CORE).getMarketAddresses(marketId);
        uint256 remaining = value;
        
        address collateral = vars.collateralToken; // Gas saving

        // 1. Priority: Cash
        uint256 cash = ERC20(collateral).balanceOf(address(this));
        if (cash > 0) {
            uint256 take = cash >= remaining ? remaining : cash;
            ERC20(collateral).safeTransfer(recipient, take);
            remaining -= take;
        }
        
        if (remaining == 0) return;

        // 2. Priority: TWAMM
        if (activeOrderId != 0) {
            bytes memory data = abi.encode(
                activeOrderId,
                vars.hook,
                vars.rateOracle,
                collateral,
                vars.underlyingToken
            );
            uint256 seized = IBrokerModule(TWAMM_MODULE).seize(remaining, recipient, data);
            
            // Check overflow safe math
            if (seized >= remaining) return;
            remaining -= seized;
        }

        // 3. Priority: V4 LP
        if (activeTokenId != 0) {
            bytes memory data = abi.encode(
                activeTokenId,
                POSM,
                vars.rateOracle,
                collateral,
                vars.underlyingToken
            );
            IBrokerModule(V4_MODULE).seize(remaining, recipient, data);
        }
    }
    
    // Transfer logic placeholder
    function deposit(uint256 tokenId) external onlyOwner {
        require(activeTokenId == 0, "Slot Full");
        // IERC721(POSM).safeTransferFrom(msg.sender, address(this), tokenId);
        activeTokenId = tokenId;
    }
    
    /* ============================================================================================ */
    /*                                        CORE INTERACTION                                      */
    /* ============================================================================================ */

    // Generic execute for Core interaction
    function modifyPosition(bytes32 rawMarketId, int256 deltaCollateral, int256 deltaDebt) external onlyOwner {
        MarketId id = MarketId.wrap(rawMarketId);
        require(MarketId.unwrap(id) == MarketId.unwrap(marketId), "Wrong Market");
        
        // Encode action for callback
        bytes memory data = abi.encode(id, deltaCollateral, deltaDebt);
        
        // Enter Lock
        IRLDCore(CORE).lock(data);
    }
    
    // Callback from Core
    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == CORE, "Not Core");
        
        (MarketId id, int256 deltaCollateral, int256 deltaDebt) = abi.decode(data, (MarketId, int256, int256));
        require(MarketId.unwrap(id) == MarketId.unwrap(marketId), "Wrong Market");
        
        // Execute Modification
        IRLDCore(CORE).modifyPosition(id, deltaCollateral, deltaDebt);
        
        // Collateral: Core: `ERC20.safeTransferFrom(msg.sender, address(this), amount)`.
        if (deltaCollateral > 0) {
            // Need to fetch collateral token address to approve
            address collateral = IRLDCore(CORE).getMarketAddresses(marketId).collateralToken;
            ERC20(collateral).approve(CORE, uint256(deltaCollateral));
        }
        
        return "";
    }
}
