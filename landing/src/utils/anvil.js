/**
 * Anvil chain-ID sync utilities — adapted for landing page.
 * RPC_URL uses window.location.origin/rpc so the Vite dev proxy
 * forwards to https://rld.fi/rpc
 */
import { ethers } from 'ethers'

export const RPC_URL = `${window.location.origin}/rpc`
const ANVIL_CHAIN_ID = 31337
const ANVIL_CHAIN_HEX = '0x7a69'

export async function anvilRpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`)
  return json.result
}

export async function getAnvilSigner() {
  await anvilRpc('anvil_setChainId', [ANVIL_CHAIN_ID])
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ANVIL_CHAIN_HEX }],
    })
  } catch (e) {
    console.warn('[anvil] Network switch skipped:', e)
  }
  const provider = new ethers.BrowserProvider(window.ethereum, 'any')
  return provider.getSigner()
}

export async function restoreAnvilChainId() {
  try { await anvilRpc('anvil_setChainId', [1]) } catch { /* ignored */ }
}
