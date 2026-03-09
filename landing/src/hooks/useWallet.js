import { useState, useEffect, useCallback } from 'react'

// ── Contract addresses (mainnet fork via Anvil) ──────────────────
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_WHALE   = '0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341'
const RPC_URL      = 'https://rld.fi/rpc'

// Amount to fund: 100k USDC (6 decimals)
const FUND_AMOUNT = '100000000000' // 100,000 USDC

// ── Minimal JSON-RPC helpers ─────────────────────────────────────
async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`)
  return json.result
}

// eth_call helper for ERC20 balanceOf(address) → uint256
async function erc20BalanceOf(tokenAddress, walletAddress) {
  // balanceOf(address) selector = 0x70a08231
  const data = '0x70a08231' + walletAddress.slice(2).toLowerCase().padStart(64, '0')
  const result = await rpc('eth_call', [{ to: tokenAddress, data }, 'latest'])
  return BigInt(result)
}

async function sendImpersonatedTx(from, to, data) {
  const result = await rpc('eth_sendTransaction', [
    { from, to, data, gas: '0x7A1200' },
  ])
  return result
}

async function waitForTx(txHash, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const receipt = await rpc('eth_getTransactionReceipt', [txHash])
    if (receipt?.status === '0x1') return receipt
    if (receipt?.status === '0x0') throw new Error('TX reverted')
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('TX timeout')
}

// ERC20 transfer(address,uint256) calldata
function encodeTransfer(to, amount) {
  const selector = '0xa9059cbb'
  const addr = to.slice(2).toLowerCase().padStart(64, '0')
  const amt  = BigInt(amount).toString(16).padStart(64, '0')
  return selector + addr + amt
}

export function shortAddress(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''
}

/* ══════════════════════════════════════
   useWallet
══════════════════════════════════════ */
export function useWallet() {
  const [address,    setAddress]    = useState(null)
  const [chainId,    setChainId]    = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [connError,  setConnError]  = useState(null)

  // balances
  const [ethBalance,  setEthBalance]  = useState(null)  // string, formatted
  const [usdcBalance, setUsdcBalance] = useState(null)  // string, formatted

  // faucet
  const [faucetLoading, setFaucetLoading] = useState(false)
  const [faucetStep,    setFaucetStep]    = useState('')
  const [faucetError,   setFaucetError]   = useState(null)
  const [faucetDone,    setFaucetDone]    = useState(false)

  // ── Balance fetching ──────────────────────────────────────────
  const fetchBalances = useCallback(async (addr) => {
    if (!addr) return
    try {
      // ETH balance
      const hexBal = await rpc('eth_getBalance', [addr, 'latest'])
      const ethWei = BigInt(hexBal)
      const ethFmt = (Number(ethWei) / 1e18).toFixed(4)
      setEthBalance(ethFmt)

      // USDC balance (6 decimals)
      const usdcRaw = await erc20BalanceOf(USDC_ADDRESS, addr)
      const usdcFmt = (Number(usdcRaw) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })
      setUsdcBalance(usdcFmt)
    } catch (e) {
      console.warn('[wallet] balance fetch failed:', e.message)
    }
  }, [])

  // Restore session + listeners
  useEffect(() => {
    if (!window.ethereum) return
    window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
      if (accounts.length) {
        setAddress(accounts[0])
        fetchBalances(accounts[0])
        window.ethereum.request({ method: 'eth_chainId' }).then(setChainId)
      }
    }).catch(() => {})

    const onAccounts = (accounts) => {
      const acc = accounts[0] ?? null
      setAddress(acc)
      fetchBalances(acc)
    }
    const onChain = (id) => setChainId(id)
    window.ethereum.on('accountsChanged', onAccounts)
    window.ethereum.on('chainChanged', onChain)
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccounts)
      window.ethereum.removeListener('chainChanged', onChain)
    }
  }, [fetchBalances])

  // ── Connect ───────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) { setConnError('No wallet detected. Install MetaMask.'); return }
    setConnecting(true)
    setConnError(null)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const id = await window.ethereum.request({ method: 'eth_chainId' })
      setAddress(accounts[0])
      setChainId(id)
      fetchBalances(accounts[0])
    } catch (e) {
      setConnError(e?.message ?? 'Connection rejected')
    } finally {
      setConnecting(false)
    }
  }, [fetchBalances])

  const disconnect = useCallback(() => {
    setAddress(null)
    setChainId(null)
    setEthBalance(null)
    setUsdcBalance(null)
    setFaucetDone(false)
  }, [])

  // ── Faucet ────────────────────────────────────────────────────
  const requestFaucet = useCallback(async () => {
    if (!address) return
    setFaucetLoading(true)
    setFaucetError(null)
    setFaucetDone(false)
    const user = address.toLowerCase()
    try {
      // 1. Set 10 ETH for gas
      setFaucetStep('Setting ETH balance…')
      await rpc('anvil_setBalance', [user, '0x8AC7230489E80000']) // 10 ETH

      // 2. Impersonate whale → give whale gas
      setFaucetStep('Funding USDC…')
      await rpc('anvil_impersonateAccount', [USDC_WHALE])
      await rpc('anvil_setBalance', [USDC_WHALE, '0x8AC7230489E80000'])

      // 3. Transfer USDC from whale to user
      const transferData = encodeTransfer(user, FUND_AMOUNT)
      const txHash = await sendImpersonatedTx(USDC_WHALE, USDC_ADDRESS, transferData)
      await waitForTx(txHash)
      await rpc('anvil_stopImpersonatingAccount', [USDC_WHALE])

      setFaucetStep('Done!')
      setFaucetDone(true)
      await fetchBalances(address)
    } catch (e) {
      console.error('[faucet]', e)
      setFaucetError(e.message ?? 'Faucet failed')
      try { await rpc('anvil_stopImpersonatingAccount', [USDC_WHALE]) } catch {}
    } finally {
      setFaucetLoading(false)
      setFaucetStep('')
    }
  }, [address, fetchBalances])

  return {
    address, chainId,
    connecting, connError,
    ethBalance, usdcBalance,
    connect, disconnect,
    shortAddress,
    faucet: { request: requestFaucet, loading: faucetLoading, step: faucetStep, error: faucetError, done: faucetDone },
    refreshBalances: () => fetchBalances(address),
  }
}
