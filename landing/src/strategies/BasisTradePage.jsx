import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { useWallet } from '../hooks/useWallet'
import { useBondExecution } from '../hooks/useBondExecution'
import { useTradeLogic } from '../hooks/useTradeLogic'
import { useBondPositions } from '../hooks/useBondPositions'
import { formatPct } from '../utils/helpers'

/* ── Grain ─────────────────────────────────────────────────────── */
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

/* ── Helpers ────────────────────────────────────────────────────── */
function fmt$(v) {
  const abs = Math.abs(v)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${abs.toFixed(0)}`
}

const DURATION_PRESETS = [
  { label: '7D',   days: 7   },
  { label: '30D',  days: 30  },
  { label: '90D',  days: 90  },
  { label: '180D', days: 180 },
  { label: '1Y',   days: 365 },
]

/* ── Shared tiny components (matching BondMarketPage/OrderPanel style) */

function Spinner() {
  return (
    <svg className="animate-spin text-[#444]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

function MetricCell({ label, value, color }) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5 border-r border-[#1a1a1a] last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">{label}</span>
      <span className="font-mono text-[20px] leading-none" style={{ color: color || '#e4e4e4' }}>
        {value ?? <Spinner />}
      </span>
    </div>
  )
}

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

function FieldRow({ label, value, dim = false, accent }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">{label}</span>
      <span className="font-mono text-[13px]"
        style={{ color: accent || (dim ? '#444' : '#ccc') }}>{value}</span>
    </div>
  )
}

/* ── Slider style (matches OrderPanel) ─────────────────────────── */
const SLIDER_STYLE = `
  .bt-slider { -webkit-appearance: none; appearance: none; width: 100%; background: transparent; cursor: pointer; }
  .bt-slider::-webkit-slider-runnable-track { height: 2px; background: #2a2a2a; }
  .bt-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; background: #fff; border-radius: 0; margin-top: -4.5px; }
  .bt-slider::-moz-range-track { height: 1px; background: #2a2a2a; border: none; }
  .bt-slider::-moz-range-thumb { width: 10px; height: 10px; background: #fff; border: none; border-radius: 0; }
`

/* ── TokenDropdown (identical to OrderPanel) ───────────────────── */
function TokenDropdown({ asset, onChange }) {
  const [open, setOpen] = useState(false)
  const tokens = [
    { value: 'sUSDe', label: 'sUSDe' },
    { value: 'USDC',  label: 'USDC'  },
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

/* ══════════════════════════════════════════════════════════════════
   BASISORDERPANEL — mirrors OrderPanel exactly, basis-trade fields
═══════════════════════════════════════════════════════════════════ */
function BasisOrderPanel({
  basisApy, hedgeSize,
  userBonds, usdcBalance,
  executing, execStep, execError,
  onEnter, onExit,
}) {
  const [tab,          setTab]          = useState('OPEN')
  const [capital,      setCapital]      = useState(1000)
  const [leverage,     setLeverage]     = useState(3)
  const [asset,        setAsset]        = useState('sUSDe')
  const [selectedBond, setSelectedBond] = useState(null)
  const { notional, maturityDays, handleDaysChange, handleEndDateChange, epochs } = useTradeLogic()

  const balanceNum = typeof usdcBalance === 'string'
    ? parseFloat(usdcBalance.replace(/,/g, '')) || 0
    : (usdcBalance || 0)

  const canCreate = capital >= 1 && maturityDays >= 1 && !executing

  return (
    <div className="border border-[#141414] bg-[#0b0b0b] h-full flex flex-col">
      <style>{SLIDER_STYLE}</style>

      {/* Tabs — identical to OrderPanel */}
      <div className="flex items-center gap-6 px-5 pt-4 border-b border-[#141414] font-bold shrink-0">
        <TabBtn active={tab === 'OPEN'}  onClick={() => setTab('OPEN')}>Open Position</TabBtn>
        <TabBtn active={tab === 'CLOSE'} onClick={() => setTab('CLOSE')}>Close Position</TabBtn>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1 overflow-y-auto">

        {tab === 'OPEN' && (
          <>
            {/* Capital */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">Capital</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-[#444]">
                    Balance: {asset === 'USDC' ? (usdcBalance || '0') : '0'}
                  </span>
                  <TokenDropdown asset={asset} onChange={setAsset} />
                </div>
              </div>
              <div className="border border-[#141414] flex items-center bg-[#080808]">
                <span className="font-mono text-[12px] text-[#444] px-3">$</span>
                <input
                  type="number"
                  value={capital}
                  min={1}
                  onChange={e => setCapital(Math.max(1, Number(e.target.value)))}
                  className="flex-1 bg-transparent font-mono text-[14px] text-white py-3
                             outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => setCapital(Math.floor(Math.max(1, balanceNum)))}
                  className="font-mono text-[11px] tracking-[0.15em] uppercase text-[#555]
                             hover:text-white border-l border-[#141414] px-3 py-3
                             transition-colors duration-200 shrink-0"
                >
                  MAX
                </button>
              </div>
              {usdcBalance && (
                <span className="font-mono text-[12px] text-[#333]">Balance: {usdcBalance}</span>
              )}
            </div>

            {/* Leverage */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">Leverage</span>
                <span className="font-mono text-[12px] text-[#888]">{leverage}×</span>
              </div>
              <div className="border border-[#141414] flex items-center bg-[#080808]">
                <input
                  type="number"
                  value={leverage}
                  min={1}
                  max={5}
                  step={0.5}
                  onChange={e => setLeverage(Math.min(5, Math.max(1, Number(e.target.value))))}
                  className="flex-1 bg-transparent font-mono text-[14px] text-white py-3 px-3
                             outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="font-mono text-[12px] text-[#444] pr-3">×</span>
              </div>
            </div>

            {/* Duration */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">Duration</span>
                <span className="font-mono text-[12px] text-[#888]">{Math.round(maturityDays)} days</span>
              </div>
              {/* Date picker */}
              <input
                type="datetime-local"
                value={epochs.endDateTimeLocal}
                onChange={e => handleEndDateChange(e.target.value)}
                className="bg-transparent font-mono text-[12px] text-[#666] px-0 py-1 outline-none w-full [color-scheme:dark]"
              />
              {/* Slider */}
              <div className="flex flex-col gap-1.5">
                <input
                  type="range" className="bt-slider"
                  min={1} max={365} step={1}
                  value={Math.round(maturityDays)}
                  onChange={e => handleDaysChange(Number(e.target.value))}
                />
                <div className="flex justify-between font-mono text-[10px] text-[#666] tracking-[0.1em]">
                  <span>1D</span><span>1Y</span>
                </div>
              </div>
              {/* Duration presets */}
              <div className="grid grid-cols-5 gap-[1px] bg-[#141414]">
                {DURATION_PRESETS.map(p => (
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

            {/* Summary rows */}
            <div className="border-t border-[#141414] pt-1">
              {[
                { label: 'Entry APY',      value: `${basisApy.toFixed(2)}%`,         color: '#f472b6' },
                { label: 'Leverage',       value: `${leverage}×`,                    color: '#ccc'    },
                { label: 'Hedge Required', value: `${hedgeSize.toFixed(2)} wRLP`,    color: '#444'    },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between px-0 py-1.5">
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">{label}</span>
                  <span className="font-mono text-[13px]" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'CLOSE' && (
          <div className="flex flex-col gap-3">
            {!selectedBond ? (
              userBonds.length === 0 ? (
                <div className="border border-[#141414] bg-[#080808] px-4 py-3">
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">
                    No active positions
                  </span>
                </div>
              ) : (
                <>
                  <p className="font-mono text-[11px] text-[#555] leading-[1.8]">
                    Select a position to close it. Returns your principal plus accrued carry yield.
                  </p>
                  {userBonds.map(bond => {
                    const accrued = bond.principal * (basisApy / 100) * (bond.elapsed / 365)
                    return (
                      <button key={bond.id} onClick={() => setSelectedBond(bond.id)}
                        className="w-full text-left border border-[#141414] bg-[#080808]
                                   hover:border-[#f472b640] transition-colors p-3 flex justify-between items-start">
                        <div>
                          <div className="font-mono text-[12px] text-white">
                            #{String(bond.id).padStart(4,'0')} · {basisApy.toFixed(1)}% APY
                          </div>
                          <div className="font-mono text-[11px] text-[#444]">
                            {Number(bond.principal).toLocaleString()} sUSDe · {bond.maturityDays - bond.elapsed}D left
                          </div>
                        </div>
                        <span className="font-mono text-[12px] text-[#4ade80]">+{fmt$(accrued)}</span>
                      </button>
                    )
                  })}
                </>
              )
            ) : (() => {
              const bond = userBonds.find(b => b.id === selectedBond)
              if (!bond) return null
              const accrued = bond.principal * (basisApy / 100) * (bond.elapsed / 365)
              const remaining = bond.maturityDays - bond.elapsed
              return (
                <div className="flex flex-col gap-3">
                  <div className="border border-[#f472b630] bg-[#f472b608] p-3">
                    <div className="font-mono text-[12px] text-white">#{String(bond.id).padStart(4,'0')} · {basisApy.toFixed(1)}% APY</div>
                    <div className="font-mono text-[11px] text-[#444]">{Number(bond.principal).toLocaleString()} sUSDe</div>
                  </div>
                  <FieldRow label="Estimated PnL"   value={`+${fmt$(accrued)}`}            accent="#4ade80"/>
                  <FieldRow label="Time to Maturity" value={`${remaining > 0 ? remaining : 0} Days`}/>
                  {remaining > 0 && (
                    <div className="border border-[#2a1f00] bg-[#1a1200] px-4 py-3">
                      <span className="font-mono text-[10px] text-[#aa8800]">
                        Early exit may incur swap costs · slippage
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setSelectedBond(null)}
                    className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#444] hover:text-[#888] transition-colors text-left"
                  >
                    ← Back
                  </button>
                </div>
              )
            })()}
          </div>
        )}

        {/* Error */}
        {execError && (
          <div className="border border-[#2a1a1a] bg-[#150a0a] px-4 py-3">
            <span className="font-mono text-[11px] text-[#884444] break-all">{execError}</span>
          </div>
        )}

        {/* CTA */}
        {tab === 'OPEN' && (
          <div className="mt-auto pt-2">
            <button
              disabled={!canCreate}
              onClick={() => onEnter(capital, maturityDays * 24, leverage)}
              className="w-full py-3 font-mono text-[11px] tracking-[0.22em] uppercase
                         border transition-all duration-200"
              style={{ borderColor: '#555', color: '#fff' }}
              onMouseEnter={e => { if (canCreate) { e.currentTarget.style.borderColor='#fff'; e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#000' }}}
              onMouseLeave={e => { if (canCreate) { e.currentTarget.style.borderColor='#555'; e.currentTarget.style.background=''; e.currentTarget.style.color='#fff' }}}
            >
              {executing ? (execStep || 'Executing…') : 'Create Position'}
            </button>
          </div>
        )}
        {tab === 'CLOSE' && selectedBond && (
          <div className="mt-auto pt-2">
            <button
              disabled={executing}
              onClick={() => onExit(selectedBond, () => setSelectedBond(null))}
              className="w-full py-3 font-mono text-[11px] tracking-[0.22em] uppercase
                         border transition-all duration-200"
              style={{ borderColor: '#f472b640', color: '#f472b6' }}
            >
              {executing ? (execStep || 'Executing…') : 'Close Position'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   HEDGE CALCULATOR — replaces PerformanceChart (right col top)
═══════════════════════════════════════════════════════════════════ */
function HedgeCalculator({ susdeRate, usdcCost }) {
  const [capital,       setCapital]       = useState('100000')
  const [expectedYield, setExpectedYield] = useState('10')
  const [leverage,      setLeverage]      = useState('3')
  const [timeHorizon,   setTimeHorizon]   = useState('365')

  const lev  = Number(leverage) || 3
  const cap  = Number(capital) || 100_000
  const t    = (Number(timeHorizon) || 365) / 365
  const exp  = expectedYield !== '' ? Number(expectedYield) : susdeRate
  const col  = cap * lev
  const debt = cap * (lev - 1)

  const uBorrow = usdcCost + (exp - susdeRate)
  const uGross  = col * (exp / 100) * t
  const uInt    = debt * (uBorrow / 100) * t
  const uNet    = uGross - uInt
  const uRoi    = (uNet / cap) * 100

  const hGross  = col * (exp / 100) * t
  const hInt    = debt * (usdcCost / 100) * t
  const hNet    = hGross - hInt
  const hRoi    = (hNet / cap) * 100

  const rows = [
    { label: 'Gross Yield',       u: fmt$(uGross), uSub: `@ ${exp.toFixed(2)}%`,              h: fmt$(hGross), hSub: `@ ${exp.toFixed(2)}%` },
    { label: 'Interest Expense',  u: `(${fmt$(uInt)})`, uSub: `@ ${uBorrow.toFixed(2)}% flt`,  h: `(${fmt$(hInt)})`, hSub: `@ ${usdcCost.toFixed(2)}% fix`, hColor: '#4ade80' },
    { label: 'Spread',            u: `${(exp - uBorrow).toFixed(2)}%`,                          h: `${(exp - usdcCost).toFixed(2)}%`, hColor: '#4ade80' },
    { label: 'Net Profit',        u: fmt$(uNet),                                                 h: fmt$(hNet), hColor: hNet >= 0 ? '#4ade80' : '#f87171' },
  ]

  return (
    <div className="border border-[#141414] bg-[#0b0b0b] flex flex-col">
      {/* Row 1 — title + live hedged yield */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#141414] shrink-0">
        <span className="font-mono text-[11px] font-bold tracking-[0.22em] uppercase text-[#555]">
          Scenario Calculator
        </span>
      </div>

      {/* Row 2 — 4 equal input columns */}
      <div className="px-5 py-3 border-b border-[#141414] shrink-0">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Capital',        value: capital,       set: setCapital,       suffix: '$',    step: 10000, min: 1000 },
            { label: 'Expected Yield', value: expectedYield, set: setExpectedYield, suffix: '%',    step: 0.1,   placeholder: susdeRate.toFixed(2) },
            { label: 'Leverage',       value: leverage,      set: setLeverage,      suffix: 'x',    step: 0.5,   min: 1, max: 5 },
            { label: 'Time Horizon',   value: timeHorizon,   set: setTimeHorizon,   suffix: 'days', step: 1,     min: 1, max: 1825 },
          ].map(f => (
            <div key={f.label} className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-[#555] uppercase tracking-[0.15em]">{f.label}</span>
              <div className="flex items-center border border-[#141414] bg-[#080808]">
                <input
                  type="number"
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  placeholder={f.placeholder}
                  className="flex-1 min-w-0 bg-transparent font-mono text-[12px] text-white px-2 py-1.5
                             outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="font-mono text-[10px] text-[#444] pr-2 shrink-0">{f.suffix}</span>
              </div>
            </div>
          ))}
        </div>
      </div>



      {/* Comparison table — fills remaining space */}
      <div className="flex-1 overflow-auto">
        <table className="w-full font-mono">
          <thead>
            <tr className="border-b border-[#141414]">
              <th className="px-5 py-3 text-[10px] tracking-[0.2em] uppercase text-[#444] text-left font-normal w-[35%]">Metric</th>
              <th className="px-5 py-3 text-[10px] tracking-[0.2em] uppercase text-[#444] text-right font-normal w-[32%]">
                Unhedged ({lev}×)
              </th>
              <th className="px-5 py-3 text-[10px] tracking-[0.2em] uppercase text-right font-bold w-[32%]"
                style={{ color: '#f472b6' }}>
                Hedged ({lev}× with RLP)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b" style={{ borderColor: '#111' }}>
                <td className="px-5 py-2.5 text-[12px] text-[#444]">{r.label}</td>
                <td className="px-5 py-2.5 text-right">
                  <span className="text-[13px]" style={{ color: '#777' }}>{r.u}</span>
                  {r.uSub && <span className="block text-[10px] text-[#444]">{r.uSub}</span>}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <span className="text-[13px]" style={{ color: r.hColor || '#ccc' }}>{r.h}</span>
                  {r.hSub && <span className="block text-[10px] text-[#444]">{r.hSub}</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t" style={{ borderColor: '#222' }}>
              <td className="px-5 py-3 text-[10px] tracking-[0.2em] uppercase text-[#666] font-bold">
                ROI / {Number(timeHorizon) || 365}D
              </td>
              <td className="px-5 py-3 text-right">
                <span className="text-[13px]" style={{ color: '#777' }}>
                  {uRoi.toFixed(2)}%
                </span>
              </td>
              <td className="px-5 py-3 text-right">
                <span className="text-[13px] font-bold" style={{ color: '#f472b6' }}>
                  {hRoi.toFixed(2)}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   YOUR POSITIONS — styled identically to YourBondsTable
═══════════════════════════════════════════════════════════════════ */
function YourPositions({ bonds, basisApy, spread, onExit }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#888]">
        Your Positions
      </h3>

      {bonds.length === 0 ? (
        <div className="border border-[#141414] bg-[#0b0b0b] px-5 py-12 text-center">
          <span className="font-mono text-[10px] tracking-widest uppercase text-[#2a2a2a]">
            No active bonds
          </span>
        </div>
      ) : (
        <div className="border border-[#141414] bg-[#0b0b0b]">
          {/* header row */}
          <div className="grid grid-cols-[2.5rem_1fr_1fr_2.5rem_1fr_1fr_2.5rem]
                          px-5 py-2 border-b border-[#141414]
                          font-mono text-[9px] tracking-[0.2em] uppercase text-[#444]">
            <span>#</span>
            <span>Capital</span>
            <span>Locked</span>
            <span>Lev</span>
            <span>Duration</span>
            <span>PnL</span>
            <span/>
          </div>

          {bonds.map(bond => {
            const lev    = bond.leverage || 3
            const locked = spread * lev
            const pnl    = bond.principal * lev * (spread / 100) * (bond.elapsed / 365)
            const rem    = Math.max(bond.maturityDays - bond.elapsed, 0)
            const prog   = Math.min((bond.elapsed / bond.maturityDays) * 100, 100)

            return (
              <div key={bond.id}
                className="grid grid-cols-[2.5rem_1fr_1fr_2.5rem_1fr_1fr_2.5rem]
                           items-center px-5 py-3 border-b border-[#0f0f0f] last:border-b-0
                           hover:bg-[#0f0f0f] transition-colors duration-150">
                <span className="font-mono text-[10px] text-[#333]">
                  {String(bond.id).padStart(4,'0')}
                </span>
                <span className="font-mono text-[12px] text-[#ccc]">
                  {Number(bond.principal).toLocaleString()}
                  <span className="text-[9px] text-[#444] ml-1">sUSDe</span>
                </span>
                <span className="font-mono text-[12px]" style={{ color: '#f472b6' }}>
                  {locked >= 0 ? '+' : ''}{locked.toFixed(2)}%
                </span>
                <span className="font-mono text-[12px] text-[#ccc]">{lev}×</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-[#ccc]">{rem}D</span>
                  <div className="w-10 h-[2px] bg-[#1a1a1a] relative">
                    <div className="absolute inset-0 h-full bg-[#f472b640]"
                      style={{ width: `${prog}%` }}/>
                  </div>
                </div>
                <span className="font-mono text-[12px]"
                  style={{ color: pnl >= 0 ? '#4ade80' : '#f87171' }}>
                  {pnl >= 0 ? '+' : ''}{fmt$(pnl)}
                </span>
                <button onClick={() => onExit(bond.id)}
                  className="font-mono text-[9px] tracking-[0.1em] uppercase text-[#444]
                             hover:text-[#888] transition-colors duration-150 text-right">
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   PAGE ROOT
═══════════════════════════════════════════════════════════════════ */
export default function BasisTradePage() {
  const { address: account, connect: connectWallet, usdcBalance } = useWallet()
  const { market, marketInfo } = useSim()

  // Live sUSDe yield
  const [susdeRate, setSusdeRate] = useState(0)
  useEffect(() => {
    fetch('/api/susde-yield')
      .then(r => r.json())
      .then(d => { if (d?.apy) setSusdeRate(Number(d.apy)) })
      .catch(() => {})
  }, [])

  const usdcCost = market?.indexPrice ?? 0
  const spread   = susdeRate - usdcCost
  const basisApy = usdcCost + 4.2

  // Mirror left panel height → right column (same as BondMarketPage)
  const panelRef    = useRef(null)
  const [panelHeight, setPanelHeight] = useState(575)
  useEffect(() => {
    if (!panelRef.current) return
    const obs = new ResizeObserver(entries => setPanelHeight(entries[0].contentRect.height))
    obs.observe(panelRef.current)
    return () => obs.disconnect()
  }, [])

  const hedgeSize = useMemo(() => {
    const n = 100_000
    return Math.max(n * (basisApy / 100) * (365 / 8760), n * 0.01, 1)
  }, [basisApy])

  // Bond execution
  const { bonds: userBonds, optimisticClose, optimisticCreate, refresh } = useBondPositions(account, basisApy)

  const infra = marketInfo ? {
    bond_factory:   marketInfo.infrastructure?.bondFactory,
    broker_factory: marketInfo.brokerFactory,
    broker_router:  marketInfo.infrastructure?.brokerRouter,
    twamm_hook:     marketInfo.infrastructure?.twammHook,
    pool_fee:       marketInfo.infrastructure?.poolFee,
    tick_spacing:   marketInfo.infrastructure?.tickSpacing,
  } : undefined

  const { createBond, closeBond, executing, step: execStep, error: execError } = useBondExecution(
    account, infra,
    marketInfo?.collateral?.address,
    marketInfo?.positionToken?.address,
  )

  const handleEnter = (capital, durationHours) => {
    if (!account) { connectWallet(); return }
    createBond(capital, durationHours, basisApy, receipt => {
      if (receipt?.brokerAddress) optimisticCreate(receipt.brokerAddress, capital, durationHours)
      else refresh()
    })
  }

  const handleExit = (bondId, cb) => {
    const bond = userBonds.find(b => b.id === bondId)
    if (!bond?.brokerAddress) return
    closeBond(bond.brokerAddress, () => {
      optimisticClose(bond.brokerAddress)
      cb?.()
    })
  }

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }}/>
      <Nav activePage="strategies"/>

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* Breadcrumb — mirrors BondMarketPage exactly */}
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
          <Link to="/strategies" className="text-[#444] hover:text-[#888] transition-colors duration-200">
            Strategies
          </Link>
          <span className="text-[#2a2a2a]">/</span>
          <span className="text-[#888]">Basis Trade</span>
        </div>

        {/* Market header — mirrors BondMarketPage title block */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
              BASIS_TRADE
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#f472b6' }}>
                Leveraged Carry
              </span>
              <span className="font-mono text-[10px] text-[#333]">·</span>
              <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">sUSDe / USDC</span>
            </div>
          </div>

          {/* Metric strip — same structure, basis-trade metrics */}
          <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
            <div className="grid grid-cols-2 lg:grid-cols-3 divide-y lg:divide-y-0 divide-[#1a1a1a]">
              <MetricCell
                label="Yield sUSDe"
                value={`${susdeRate.toFixed(2)}%`}
                color="#f472b6"
              />
              <MetricCell
                label="Cost USDC"
                value={`${usdcCost.toFixed(2)}%`}
              />
              <MetricCell
                label="Spread"
                value={`${spread >= 0 ? '+' : ''}${spread.toFixed(2)}%`}
                color={spread >= 0 ? '#4ade80' : '#f87171'}
              />
            </div>
          </div>
        </div>

        {/* Main grid: terminal (left) | calculator + positions (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">

          {/* Left: order panel — fixed height */}
          <div ref={panelRef} style={{ minHeight: '575px' }}>
            <BasisOrderPanel
              basisApy={basisApy}
              hedgeSize={hedgeSize}
              userBonds={userBonds}
              usdcBalance={usdcBalance}
              executing={executing}
              execStep={execStep}
              execError={execError}
              onEnter={handleEnter}
              onExit={handleExit}
            />
          </div>

          {/* Right: calculator (height mirrors panel) + positions */}
          <div className="flex flex-col gap-6">
            <HedgeCalculator
              susdeRate={susdeRate}
              usdcCost={usdcCost}
            />
            <YourPositions
              bonds={userBonds}
              basisApy={basisApy}
              spread={spread}
              onExit={id => handleExit(id)}
            />
          </div>

        </div>
      </main>
    </div>
  )
}
