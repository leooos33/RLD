/**
 * Simulation stack configuration.
 * Reads from the indexer API running alongside the Anvil fork.
 */

export const SIM_API =
  import.meta.env.VITE_SIM_API_URL || "http://localhost:8080";

// Deployed contract addresses (from /config/deployment.json)
export const CONTRACTS = {
  rldCore: "0xaE7b7A1c6C4d859e19301ccAc2C6eD28A4C51288",
  twammHook: "0x2EAf1562e419F68Cc083468cA30fd957006DaAC0",
  mockOracle: "0xeA2e668d430e5AA15babA2f5c5edfd4F9Ef6EB73",
  wausdc: "0x91c8C745fd156d8624677aa924Cdc1Ef8173C69C",
  positionToken: "0x699BF0931001f6cc804942C6C998d9E4dC95cB28",
  brokerFactory: "0x8D901870d9Af8De9349Ab5b80012D97339eb5099",
  swapRouter: "0x934A389CaBFB84cdB3f0260B2a4FD575b8B345A3",
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
};

export const MARKET_ID =
  "0x660a01c4bdc81dcbc5845841998ef85fac39414b465dc91c77330463bc5b1a92";

// Token metadata
export const TOKENS = {
  token0: {
    address: "0x699BF0931001f6cc804942C6C998d9E4dC95cB28",
    symbol: "POS",
    name: "Position Token",
    decimals: 18,
  },
  token1: {
    address: "0x91c8C745fd156d8624677aa924Cdc1Ef8173C69C",
    symbol: "waUSDC",
    name: "Wrapped aUSDC",
    decimals: 6,
  },
};

// Known brokers
export const KNOWN_BROKERS = {
  "0xc297fe7e4d3eaed018f9ad8a8bdcf9c1ee24b1ba": "User A",
  "0xe81b73ce9e1c1bbd7c5f7cd7dda1d41d83a77773": "MM Daemon",
  "0xc9d793863df73e8315371b75e84a48d6bc1cf283": "Chaos Trader",
};

export const ZERO_FOR_ONE_LONG = false;
