import { useState } from 'react'
import { useWallet } from '../hooks/useWallet'
import { useTradeLogic } from '../hooks/useTradeLogic'
import { useBondExecution } from '../hooks/useBondExecution'
import { formatUSD, formatPct } from '../utils/helpers'

const DURATION_PRESETS = [
  { label: '7D',   days: 7 },
  { label: '30D',  days: 30 },
  { label: '90D',  days: 90 },
  { label: '180D', days: 180 },
  { label: '1Y',   days: 365 },
]

const ASSETS = [
  { symbol: 'waUSDC', name: 'Wrapped Aave USDC' },
]

/* ── Tab button ─────────────────────────────────────────────── */
function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`font-mono text-[11px] tracking-[0.2em] uppercase pb-3 transition-colors duration-200
                  ${active
                    ? 'text-white border-b border-white'
                    : 'text-[#444] hover:text-[#888] border-b border-transparent'}`}
    >
      {children}
    </button>
  )
}

/* ── Summary row ────────────────────────────────────────────── */
function FieldRow({ label, value, dim = false }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">{label}</span>
      <span className={`font-mono text-[13px] ${dim ? 'text-[#444]' : 'text-[#ccc]'}`}>{value}</span>
    </div>
  )
}

/* ── Full asset panel dropdown (Collateral selector) ────────── */
function AssetDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const selected = ASSETS.find(a => a.symbol === value) || ASSETS[0]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-[#141414] bg-[#080808] px-3 py-2
                   font-mono text-[12px] text-[#888] hover:text-[#ccc] transition-colors duration-200 w-full"
      >
        <span className="flex-1 text-left">{selected.symbol}</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none"
          className="transition-transform duration-200 shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-20 border border-[#141414] border-t-0 bg-[#0b0b0b]">
          {ASSETS.map(a => (
            <button
              key={a.symbol}
              onClick={() => { onChange(a.symbol); setOpen(false) }}
              className={`w-full flex flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-200 hover:bg-[#111]
                          ${a.symbol === value ? 'bg-[#111]' : ''}`}
            >
              <span className="font-mono text-[12px] text-[#ccc]">{a.symbol}</span>
              <span className="font-mono text-[10px] text-[#444]">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Compact inline token toggle (waUSDC ↔ USDC) ───────────── */
function TokenDropdown({ asset, onChange }) {
  const [open, setOpen] = useState(false)
  const tokens = [
    { value: 'waUSDC', label: 'waUSDC' },
    { value: 'USDC',   label: 'USDC'   },
  ]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 font-mono text-[11px] text-[#555]
                   hover:text-[#888] transition-colors duration-200"
      >
        <span>{asset}</span>
        <svg width="6" height="4" viewBox="0 0 8 5" fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          className="transition-transform duration-200">
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-20 border border-[#141414] bg-[#0b0b0b] min-w-[80px]">
          {tokens.map(t => (
            <button
              key={t.value}
              onClick={() => { onChange(t.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 font-mono text-[11px] transition-colors duration-200 hover:bg-[#111]
                          ${t.value === asset ? 'text-white' : 'text-[#555]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Range slider ───────────────────────────────────────────── */
function MaturitySlider({ days, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <style>{`
        .rld-slider { -webkit-appearance: none; appearance: none; width: 100%; background: transparent; cursor: pointer; }
        .rld-slider::-webkit-slider-runnable-track { height: 2px; background: #2a2a2a; }
        .rld-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; background: #fff; border-radius: 0; margin-top: -4.5px; }
        .rld-slider::-moz-range-track { height: 1px; background: #2a2a2a; border: none; }
        .rld-slider::-moz-range-thumb { width: 10px; height: 10px; background: #fff; border: none; border-radius: 0; }
      `}</style>
      <input
        type="range"
        min={1}
        max={365}
        step={1}
        value={Math.round(days)}
        onChange={e => onChange(Number(e.target.value))}
        className="rld-slider"
      />
      <div className="flex justify-between font-mono text-[10px] text-[#666] tracking-[0.1em]">
        <span>1D</span><span>1Y</span>
      </div>
    </div>
  )
}

/* ══ ORDER PANEL ════════════════════════════════════════════════ */
export function OrderPanel({ market, marketInfo, apy, tradeLogic }) {
  const [tab, setTab]         = useState('OPEN')
  const [asset, setAsset]     = useState('waUSDC')
  const { address, usdcBalance } = useWallet()

  const ownTradeLogic = useTradeLogic()
  const {
    notional, setNotional,
    maturityDays, handleDaysChange, handleEndDateChange, epochs,
  } = tradeLogic || ownTradeLogic

  const infra = marketInfo?.infrastructure
  const { createBond, executing, error, step } = useBondExecution(
    address, infra,
    marketInfo?.collateral?.address,
    marketInfo?.position_token?.address,
  )

  const entryRate     = apy || 0
  const hedgeUSD      = Math.max(notional * (entryRate / 100) * (maturityDays / 365), notional * 0.01, 1)
  const totalRequired = notional + hedgeUSD

  // Parse USDC balance (string like "1,234.56" or number)
  const balanceNum = typeof usdcBalance === 'string'
    ? parseFloat(usdcBalance.replace(/,/g, '')) || 0
    : (usdcBalance || 0)

  const handleMax = () => setNotional(Math.floor(Math.max(1, balanceNum - hedgeUSD)))

  const handleCreate = () => {
    if (!address) return
    createBond(notional, maturityDays * 24, entryRate, () => {})
  }

  const connected  = !!address
  const canCreate  = connected && notional >= 1 && maturityDays >= 1 && !executing

  return (
    <div className="border border-[#141414] bg-[#0b0b0b] h-full flex flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-6 px-5 pt-4 border-b border-[#141414] font-bold shrink-0">
        <TabBtn active={tab === 'OPEN'}  onClick={() => setTab('OPEN')}>Open Bond</TabBtn>
        <TabBtn active={tab === 'CLOSE'} onClick={() => setTab('CLOSE')}>Close Bond</TabBtn>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1 overflow-y-auto">

        {tab === 'OPEN' && (
          <>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">
                  Notional
                </span>
                {/* Token toggle dropdown */}
                <TokenDropdown asset={asset} onChange={setAsset} />
              </div>
              {/* Input + MAX inline */}
              <div className="border border-[#141414] flex items-center bg-[#080808]">
                <span className="font-mono text-[12px] text-[#444] px-3">$</span>
                <input
                  type="number"
                  value={notional}
                  min={1}
                  onChange={(e) => setNotional(Math.max(1, Number(e.target.value)))}
                  className="flex-1 bg-transparent font-mono text-[14px] text-white py-3
                             outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                {connected && (
                  <button
                    onClick={handleMax}
                    className="font-mono text-[11px] tracking-[0.15em] uppercase text-[#555]
                               hover:text-white border-l border-[#141414] px-3 py-3
                               transition-colors duration-200 shrink-0"
                  >
                    MAX
                  </button>
                )}
              </div>
              {/* Balance hint */}
              {connected && (
                <span className="font-mono text-[12px] text-[#333]">
                  Balance: {usdcBalance ?? '—'}
                </span>
              )}
            </div>

            {/* Maturity */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">
                  Maturity
                </span>
                <span className="font-mono text-[12px] text-[#888]">
                  {Math.round(maturityDays)} days
                </span>
              </div>

              {/* Date picker */}
              <input
                type="datetime-local"
                value={epochs.endDateTimeLocal}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="bg-transparent font-mono text-[12px] text-[#666]
                           px-0 py-1 outline-none w-full [color-scheme:dark]"
              />

              {/* Slider */}
              <MaturitySlider days={maturityDays} onChange={handleDaysChange} />

              {/* Presets */}
              <div className="grid grid-cols-5 gap-[1px] bg-[#141414]">
                {DURATION_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => handleDaysChange(p.days)}
                    className={`font-mono font-semibold text-[10px] tracking-[0.15em] py-2 transition-colors duration-200
                                ${Math.round(maturityDays) === p.days
                                  ? 'bg-white text-black'
                                  : 'bg-[#080808] text-[#555] hover:text-[#ccc]'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="">
              <FieldRow label="Entry Rate" value={formatPct(entryRate)} />
              <FieldRow label="Duration"   value={`${Math.round(maturityDays)} days`} />
            </div>
          </>
        )}

        {tab === 'CLOSE' && (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-[11px] text-[#555] leading-[1.8]">
              Select an active bond from the table to close it. Closing returns
              your principal plus accrued yield.
            </p>
            <div className="border border-[#141414] bg-[#080808] px-4 py-3">
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">
                Use the × button in Your Bonds table below
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="border border-[#2a1a1a] bg-[#150a0a] px-4 py-3">
            <span className="font-mono text-[11px] text-[#884444]">{error}</span>
          </div>
        )}

        {/* Action button */}
        {tab === 'OPEN' && (
          <div className="mt-auto pt-2">
            <button
              disabled={!canCreate}
              onClick={handleCreate}
              className="w-full py-3 font-mono text-[11px] tracking-[0.22em] uppercase
                         border transition-all duration-200"
              style={
                !connected
                  ? { borderColor: '#222', color: '#444', cursor: 'not-allowed' }
                  : executing
                  ? { borderColor: '#333', color: '#555', cursor: 'not-allowed' }
                  : { borderColor: '#555', color: '#fff' }
              }
              onMouseEnter={(e) => { if (canCreate) { e.currentTarget.style.borderColor = '#fff'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000' } }}
              onMouseLeave={(e) => { if (canCreate) { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.background = ''; e.currentTarget.style.color = '#fff' } }}
            >
              {!connected
                ? 'Connect Wallet'
                : executing
                ? step || 'Executing…'
                : 'Create Bond'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
