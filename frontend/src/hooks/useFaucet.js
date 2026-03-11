import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";

/**
 * One-click Anvil faucet: provisions ETH + USDC + waUSDC to the connected wallet.
 *
 * Flow (all via Anvil admin RPCs — zero MetaMask popups):
 *   1. anvil_setBalance → 100 ETH for gas
 *   2. Impersonate USDC whale → transfer USDC to user
 *   3. Impersonate user → approve + supply to Aave → aUSDC
 *   4. Impersonate user → approve + wrap aUSDC → waUSDC
 *
 * @param {string} account            Connected wallet address
 * @param {string} waUsdcAddress       Live waUSDC contract address (from indexer)
 * @param {object} externalContracts   { usdc, ausdc, aave_pool, susde, usdc_whale } from marketInfo
 */

const RPC_URL = `${window.location.origin}/rpc`;

// Amount to fund: 100k USDC (6 decimals)
const FUND_AMOUNT = "100000000000"; // 100,000 USDC as string to avoid BigInt issues
// Amount of USDC to keep liquid (not wrapped): 10k
const USDC_KEEP = "10000000000"; // 10,000 USDC
// Amount to send to Aave for wrapping: 90k
const AAVE_AMOUNT = "90000000000"; // 90,000 USDC

// Minimal ABIs for the calls we need
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];
const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
];
const WAUSDC_ABI = [
  "function wrap(uint256 aTokenAmount) returns (uint256 shares)",
  "function balanceOf(address owner) view returns (uint256)",
];


/**
 * Call an Anvil admin RPC method (e.g. anvil_setBalance).
 */
async function anvilRpc(rpcUrl, method, params = []) {
  console.log(`[faucet] RPC: ${method}`);
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  const json = await res.json();
  if (json.error)
    throw new Error(`RPC ${method} failed: ${json.error.message}`);
  return json.result;
}

/**
 * Wait for a transaction to be mined.
 */

export function useFaucet(account, waUsdcAddress, externalContracts) {
  const USDC = externalContracts?.usdc || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(""); // Current step description
  const [waUsdcBalance, setWaUsdcBalance] = useState(null);
  const [usdcBalance, setUsdcBalance] = useState(null);

  // ── Fetch balances for any address ───────────────────────
  const fetchBalance = useCallback(
    async (addr) => {
      if (!addr || !waUsdcAddress) return;
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        
        // Fetch waUSDC
        const waUsdcContract = new ethers.Contract(
          waUsdcAddress,
          WAUSDC_ABI,
          provider,
        );
        const waBal = await waUsdcContract.balanceOf(addr);
        setWaUsdcBalance(ethers.formatUnits(waBal, 6));

        // Fetch USDC
        const usdcContract = new ethers.Contract(
          USDC,
          ERC20_ABI,
          provider,
        );
        const uBal = await usdcContract.balanceOf(addr);
        setUsdcBalance(ethers.formatUnits(uBal, 6));

      } catch (e) {
        console.warn("Failed to fetch balances:", e);
      }
    },
    [waUsdcAddress, USDC],
  );

  // Auto-fetch balance when account connects or waUSDC address changes
  useEffect(() => {
    if (account && waUsdcAddress) fetchBalance(account);
  }, [account, waUsdcAddress, fetchBalance]);

  const requestFaucet = useCallback(
    async (userAddress) => {
      if (!userAddress) throw new Error("No wallet connected");
      if (!waUsdcAddress) throw new Error("waUSDC address not loaded yet");

      setLoading(true);
      setError(null);

      try {
        const user = userAddress.toLowerCase();
        console.log(`[faucet] Starting for ${user}, waUSDC=${waUsdcAddress}`);

        // ── Step 1: Set ETH balance (100 ETH for gas) ────────────────
        setStep("Setting ETH balance...");
        await anvilRpc(RPC_URL, "anvil_setBalance", [
          user,
          "0x56BC75E2D63100000", // 100 ETH in hex wei
        ]);
        console.log("[faucet] ✓ ETH balance set");

        // ── Step 2: Directly manipulate USDC & waUSDC storage slots ────────
        setStep("Funding wallets...");
        
        const coder = new ethers.AbiCoder();
        
        // The user asked for a 50:50 split.
        // We will fund 50,000 USDC and 50,000 waUSDC (each token has 6 decimals)
        const amountPerToken = BigInt("50000000000"); // 50,000 * 10^6
        const hexBalance = "0x" + amountPerToken.toString(16).padStart(64, '0');

        // FUND USDC (Mainnet proxy contract uses slot 9 for balances)
        const usdcSlot = ethers.keccak256(coder.encode(["address", "uint256"], [user, 9]));
        await anvilRpc(RPC_URL, "anvil_setStorageAt", [
          USDC,
          usdcSlot,
          hexBalance
        ]);
        
        // FUND waUSDC (WrappedAToken uses solmate standard slot 3 for balances)
        const waUsdcSlot = ethers.keccak256(coder.encode(["address", "uint256"], [user, 3]));
        await anvilRpc(RPC_URL, "anvil_setStorageAt", [
          waUsdcAddress,
          waUsdcSlot,
          hexBalance
        ]);
        
        console.log("[faucet] ✓ USDC and waUSDC balances set directly in storage");

        // ── Read final balances ──────────────────────────────────────
        setStep("Done!");
        await fetchBalance(user);
        console.log("[faucet] ✓ Complete");

        return { success: true };
      } catch (err) {
        console.error("Faucet error:", err);
        setError(err.message || "Faucet failed");
        // Try to clean up impersonation
        try {
          await anvilRpc(RPC_URL, "anvil_stopImpersonatingAccount", [userAddress.toLowerCase()]);
        } catch { /* ignore cleanup errors */ }
        return { success: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [fetchBalance, waUsdcAddress, USDC],
  );

  return {
    requestFaucet,
    loading,
    error,
    step,
    waUsdcBalance,
    usdcBalance,
    refreshBalance: () => fetchBalance(account),
  };
}
