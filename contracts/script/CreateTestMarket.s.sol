// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RLDCore} from "../src/rld/core/RLDCore.sol";
import {RLDMarketFactory} from "../src/rld/core/RLDMarketFactory.sol";
import {IRLDCore} from "../src/shared/interfaces/IRLDCore.sol";
import {MarketId} from "../src/shared/interfaces/IRLDCore.sol";

/**
 * @title CreateTestMarket
 * @notice Creates a test aUSDC market and queries its data
 */
contract CreateTestMarket is Script {
    // Deployed protocol addresses
    address constant CORE = 0x6B5CF024365D5d5d0786673780CA7E3F07f85B63;
    address constant FACTORY = 0xAaC7D4A36DAb95955ef3c641c23F1fA46416CF71;
    
    // Mainnet addresses
    address constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant AUSDC = 0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c;
    
    // Deployed modules
    address constant LIQUIDATION_MODULE = 0x01D4648B896F53183d652C02619c226727477C82;
    address constant V4_ORACLE = 0xf4fa0d1C10c47cDe9F65D56c3eC977CbEb13449A;
    address constant AAVE_ORACLE = 0xA343B1FC2897b8C49A72A9A0B2675cB9c7664e8c;
    
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        
        console.log("");
        console.log("=== CREATING TEST MARKET ===");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerKey);
        
        RLDMarketFactory factory = RLDMarketFactory(FACTORY);
        RLDCore core = RLDCore(CORE);
        
        // Create market params
        RLDMarketFactory.DeployParams memory params = RLDMarketFactory.DeployParams({
            underlyingPool: AAVE_V3_POOL,
            underlyingToken: AUSDC,
            collateralToken: USDC,
            curator: deployer,
            positionTokenName: "Wrapped RLD LP aUSDC",
            positionTokenSymbol: "wRLP-aUSDC",
            minColRatio: 1.25e18,         // 125% min collateral ratio
            maintenanceMargin: 1.1e18,     // 110% maintenance margin
            liquidationCloseFactor: 0.5e18, // 50% max liquidation per call
            liquidationModule: LIQUIDATION_MODULE,
            liquidationParams: bytes32(0),
            spotOracle: V4_ORACLE,
            rateOracle: AAVE_ORACLE,
            oraclePeriod: 1 hours,
            poolFee: 3000,     // 0.3% fee
            tickSpacing: 60
        });
        
        // Create the market
        (MarketId marketId, address brokerFactory) = factory.createMarket(params);
        
        console.log("");
        console.log("=== MARKET CREATED ===");
        console.log("MarketId:", vm.toString(MarketId.unwrap(marketId)));
        console.log("BrokerFactory:", brokerFactory);
        
        vm.stopBroadcast();
        
        // Query market data
        console.log("");
        console.log("=== MARKET STATE ===");
        
        IRLDCore.MarketState memory state = core.getMarketState(marketId);
        console.log("normalizationFactor:", state.normalizationFactor);
        console.log("totalDebt:", state.totalDebt);
        console.log("lastUpdateTimestamp:", state.lastUpdateTimestamp);
        
        console.log("");
        console.log("=== MARKET CONFIG (Risk Parameters) ===");
        
        IRLDCore.MarketConfig memory config = core.getMarketConfig(marketId);
        console.log("minColRatio:", config.minColRatio);
        console.log("maintenanceMargin:", config.maintenanceMargin);
        console.log("liquidationCloseFactor:", config.liquidationCloseFactor);
        console.log("fundingPeriod:", config.fundingPeriod);
        console.log("debtCap:", config.debtCap);
        console.log("brokerVerifier:", config.brokerVerifier);
        
        console.log("");
        console.log("=== MARKET ADDRESSES ===");
        
        IRLDCore.MarketAddresses memory addrs = core.getMarketAddresses(marketId);
        console.log("collateralToken:", addrs.collateralToken);
        console.log("underlyingToken:", addrs.underlyingToken);
        console.log("underlyingPool:", addrs.underlyingPool);
        console.log("positionToken:", addrs.positionToken);
        console.log("curator:", addrs.curator);
        console.log("spotOracle:", addrs.spotOracle);
        console.log("rateOracle:", addrs.rateOracle);
        console.log("markOracle:", addrs.markOracle);
        console.log("fundingModel:", addrs.fundingModel);
        console.log("liquidationModule:", addrs.liquidationModule);
    }
}
