/**
 * Anvil chain-ID sync utilities.
 *
 * The Anvil fork runs with chainId 1 (mainnet) but MetaMask signs
 * transactions with chainId 31337 (Anvil network).  ethers.js rejects the
 * mismatch.  Every function that sends a signed transaction must:
 *
 *   1. Set Anvil's chainId to 31337  (so it accepts 31337-signed txs)
 *   2. Switch MetaMask to the Anvil network (0x7a69)
 *   3. Create a BrowserProvider with network = "any"
 *
 * After the transaction, restore Anvil's chainId to 1.
 *
 * `getAnvilSigner()` and `restoreAnvilChainId()` encapsulate this pattern
 * so every callsite doesn't have to reimplement it.
 */

import { ethers } from "ethers";

export const RPC_URL = `${window.location.origin}/rpc`;
const ANVIL_CHAIN_ID = 31337;
const ANVIL_CHAIN_HEX = "0x7a69";

/**
 * Low-level JSON-RPC call to the Anvil node.
 */
export async function anvilRpc(method, params = []) {
  const res = await fetch(RPC_URL, {
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
 * Prepare Anvil + MetaMask for a signed transaction and return an
 * ethers.js Signer.
 *
 * Call `restoreAnvilChainId()` in your `finally` block after the
 * transaction completes.
 *
 * @returns {Promise<ethers.Signer>}
 */
export async function getAnvilSigner() {
  // 1. Sync Anvil's reported chainId to 31337
  await anvilRpc("anvil_setChainId", [ANVIL_CHAIN_ID]);

  // 2. Make sure MetaMask is on Anvil network
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ANVIL_CHAIN_HEX }],
    });
  } catch (switchErr) {
    console.warn("[anvil] Network switch skipped:", switchErr);
  }

  // 3. "any" network bypasses ethers chain-id enforcement
  const provider = new ethers.BrowserProvider(window.ethereum, "any");
  return provider.getSigner();
}

/**
 * Restore Anvil's chainId back to mainnet (1) so read-only RPC calls
 * continue to work against the mainnet fork.  Safe to call even if
 * getAnvilSigner was never called.
 */
export async function restoreAnvilChainId() {
  try {
    await anvilRpc("anvil_setChainId", [1]);
  } catch {
    /* ignored — best-effort */
  }
}
