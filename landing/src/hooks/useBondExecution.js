import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { RPC_URL, getAnvilSigner, restoreAnvilChainId } from '../utils/anvil'

// ── ABI fragments ────────────────────────────────────────────────
const BOND_FACTORY_ABI = [
  'function mintBond(uint256 notional, uint256 hedgeAmount, uint256 duration, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool useUnderlying) returns (address broker)',
  'function closeBond(address broker, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool useUnderlying)',
  'event BondMinted(address indexed user, address indexed broker, uint256 notional, uint256 hedge, uint256 duration)',
  'event BondClosed(address indexed user, address indexed broker, uint256 collateralReturned, uint256 positionReturned)',
]
const WRAPPED_ATOKEN_ABI = ['function aToken() view returns (address)']
const ATOKEN_ABI = ['function UNDERLYING_ASSET_ADDRESS() view returns (address)']
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]

export function useBondExecution(account, infrastructure, collateralAddr, positionAddr) {
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState(null)
  const [step, setStep] = useState('')
  const [txHash, setTxHash] = useState(null)

  const createBond = useCallback(
    async (notionalUSD, durationHours, ratePercent, onSuccess, { useUnderlying = true } = {}) => {
      if (!account || !collateralAddr || !positionAddr) { setError('Missing parameters'); return }
      const bondFactoryAddr = infrastructure?.bond_factory
      if (!bondFactoryAddr || !infrastructure?.twamm_hook) {
        setError('Bond factory not available — waiting for config'); return
      }
      setExecuting(true); setError(null); setStep('Preparing...')
      try {
        const readProvider = new ethers.JsonRpcProvider(RPC_URL)
        const sorted = positionAddr.toLowerCase() < collateralAddr.toLowerCase()
        const poolKey = {
          currency0: sorted ? positionAddr : collateralAddr,
          currency1: sorted ? collateralAddr : positionAddr,
          fee: infrastructure.pool_fee || 500,
          tickSpacing: infrastructure.tick_spacing || 5,
          hooks: infrastructure.twamm_hook,
        }
        const hedgeUSD = Math.max(
          notionalUSD * (ratePercent / 100) * (durationHours / 8760),
          notionalUSD * 0.01, 1.0
        )
        const notionalWei = ethers.parseUnits(notionalUSD.toString(), 6)
        const hedgeWei = ethers.parseUnits(hedgeUSD.toFixed(6), 6)
        const totalWei = notionalWei + hedgeWei

        let approveTokenAddr = collateralAddr
        let approveLabel = 'waUSDC'
        if (useUnderlying) {
          try {
            const wrapper = new ethers.Contract(collateralAddr, WRAPPED_ATOKEN_ABI, readProvider)
            const aTokenAddr = await wrapper.aToken()
            const aToken = new ethers.Contract(aTokenAddr, ATOKEN_ABI, readProvider)
            approveTokenAddr = await aToken.UNDERLYING_ASSET_ADDRESS()
            approveLabel = 'USDC'
          } catch { /* fallback to waUSDC */ }
        }

        setStep('Checking balance...')
        const tokenReader = new ethers.Contract(approveTokenAddr, ERC20_ABI, readProvider)
        const balance = await tokenReader.balanceOf(account)
        if (balance < totalWei) {
          const have = Number(ethers.formatUnits(balance, 6)).toFixed(2)
          const need = Number(ethers.formatUnits(totalWei, 6)).toFixed(2)
          setError(`Insufficient ${approveLabel} — need $${need}, have $${have}`)
          setExecuting(false); return
        }

        setStep('Checking approval...')
        const allowance = await tokenReader.allowance(account, bondFactoryAddr)
        let signer
        if (allowance < totalWei) {
          setStep('Syncing chain ID...')
          signer = await getAnvilSigner()
          setStep(`Approve ${approveLabel}...`)
          const tok = new ethers.Contract(approveTokenAddr, ERC20_ABI, signer)
          await (await tok.approve(bondFactoryAddr, ethers.MaxUint256)).wait()
        }
        if (!signer) { setStep('Syncing chain ID...'); signer = await getAnvilSigner() }

        setStep('Minting bond...')
        const bondFactory = new ethers.Contract(bondFactoryAddr, BOND_FACTORY_ABI, signer)
        const durationSec = Math.floor(durationHours * 3600)
        const tx = await bondFactory.mintBond(
          notionalWei, hedgeWei, durationSec,
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
          useUnderlying, { gasLimit: 10_000_000 }
        )
        setTxHash(tx.hash)
        setStep('Waiting for confirmation...')
        const receipt = await tx.wait()

        if (receipt.status === 1) {
          let brokerAddress = null
          const iface = new ethers.Interface(BOND_FACTORY_ABI)
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog({ topics: log.topics, data: log.data })
              if (parsed?.name === 'BondMinted') { brokerAddress = parsed.args.broker; break }
            } catch { /* not our event */ }
          }
          if (brokerAddress) {
            try {
              localStorage.setItem(`rld_bond_${brokerAddress.toLowerCase()}`, JSON.stringify({ notionalUSD, ratePercent, durationHours, createdAt: Date.now(), txHash: receipt.hash, brokerAddress }))
              const listKey = `rld_bonds_${account.toLowerCase()}`
              const existing = JSON.parse(localStorage.getItem(listKey) || '[]')
              if (!existing.includes(brokerAddress.toLowerCase())) {
                existing.push(brokerAddress.toLowerCase())
                localStorage.setItem(listKey, JSON.stringify(existing))
              }
            } catch { /* ignore */ }
          }
          setStep('Bond created ✓')
          if (onSuccess) onSuccess({ ...receipt, brokerAddress })
        } else {
          setError('Transaction reverted'); setStep('')
        }
      } catch (e) {
        console.error('[Bond] createBond failed:', e)
        let msg = 'Bond creation failed'
        if (e.reason) msg = e.reason
        else if (e.message?.includes('user rejected')) msg = 'User rejected'
        setError(msg); setStep('')
      } finally {
        setExecuting(false)
        try { await restoreAnvilChainId() } catch { /* ignore */ }
      }
    },
    [account, infrastructure, collateralAddr, positionAddr]
  )

  const closeBond = useCallback(
    async (brokerAddress, onSuccess, { useUnderlying = true } = {}) => {
      if (!account || !brokerAddress) { setError('Missing parameters'); return }
      const bondFactoryAddr = infrastructure?.bond_factory
      const brokerFactoryAddr = infrastructure?.broker_factory
      if (!bondFactoryAddr || !brokerFactoryAddr || !infrastructure?.twamm_hook) {
        setError('Infrastructure not available'); return
      }
      setExecuting(true); setError(null); setStep('Preparing...')
      try {
        const signer = await getAnvilSigner()
        const sorted = positionAddr.toLowerCase() < collateralAddr.toLowerCase()
        const poolKeyArr = [
          sorted ? positionAddr : collateralAddr,
          sorted ? collateralAddr : positionAddr,
          infrastructure.pool_fee || 500,
          infrastructure.tick_spacing || 5,
          infrastructure.twamm_hook,
        ]
        setStep('Closing bond...')
        const bondFactory = new ethers.Contract(bondFactoryAddr, BOND_FACTORY_ABI, signer)
        const tx = await bondFactory.closeBond(brokerAddress, poolKeyArr, useUnderlying, { gasLimit: 25_000_000 })
        setTxHash(tx.hash)
        setStep('Waiting for confirmation...')
        const receipt = await tx.wait()
        if (receipt.status === 1) {
          try {
            const listKey = `rld_bonds_${account.toLowerCase()}`
            const existing = JSON.parse(localStorage.getItem(listKey) || '[]')
            localStorage.setItem(listKey, JSON.stringify(existing.filter(a => a.toLowerCase() !== brokerAddress.toLowerCase())))
            localStorage.removeItem(`rld_bond_${brokerAddress.toLowerCase()}`)
          } catch { /* ignore */ }
          setStep('Bond closed ✓')
          if (onSuccess) onSuccess({ brokerAddress })
        } else { setError('Transaction reverted'); setStep('') }
      } catch (e) {
        let msg = 'Close bond failed'
        if (e.reason) msg = e.reason
        else if (e.message?.includes('user rejected')) msg = 'User rejected'
        setError(msg); setStep('')
      } finally {
        setExecuting(false)
        try { await restoreAnvilChainId() } catch { /* ignore */ }
      }
    },
    [account, infrastructure, collateralAddr, positionAddr]
  )

  return { createBond, closeBond, executing, error, step, txHash }
}
