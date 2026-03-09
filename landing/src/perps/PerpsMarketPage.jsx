import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { useWallet } from '../hooks/useWallet'
import { formatUSD } from '../utils/helpers'

/* ── Grain ─────────────────────────────────────────────────────── */
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

/* ── Helpers ────────────────────────────────────────────────────── */
function Spinner() {
  return (
    <svg className="animate-spin text-[#444]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

function fmtRate(v) {
  if (v == null || isNaN(v)) return '—'
  return `${(v * 100).toFixed(4)}%`
}

/* ── Metric cell ────────────────────────────────────────────────── */
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

/* ── Change badge ───────────────────────────────────────────────── */
function ChangeBadge({ value }) {
  if (value == null) return <span className="font-mono text-[20px] text-[#444]">—</span>
  const pos = value >= 0
  return (
    <span className="font-mono text-[20px]" style={{ color: pos ? '#4ade80' : '#f87171' }}>
      {pos ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}

/* ── Price Line Chart ───────────────────────────────────────────── */
function PriceChart({ data, timeframe, onTimeframe }) {
  const ref = useRef(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el); return () => ro.disconnect()
  }, [])

  if (!data?.length) return (
    <div ref={ref} className="w-full h-full flex items-center justify-center">
      <span className="font-mono text-[10px] text-[#333] tracking-[0.2em] uppercase">No price data</span>
    </div>
  )

  const M = { top: 18, right: 12, bottom: 28, left: 72 }
  const pw = dims.w - M.left - M.right
  const ph = dims.h - M.top - M.bottom
  const allVals = data.flatMap(d => [d.markPrice, d.indexPrice].filter(Boolean))
  const minV = Math.min(...allVals) * 0.998
  const maxV = Math.max(...allVals) * 1.002
  const xOf = i => M.left + (i / (data.length - 1)) * pw
  const yOf = v => M.top + ph - ((v - minV) / (maxV - minV)) * ph
  const linePath = (key) => data
    .map((d, i) => d[key] != null
      ? `${i === 0 || data[i-1]?.[key] == null ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d[key]).toFixed(1)}`
      : null)
    .filter(Boolean).join(' ')

  const fmtPct = v => `${(v * 100).toFixed(4)}%`
  const hovData = hovered !== null ? data[hovered] : null

  return (
    <div ref={ref} className="w-full h-full relative font-mono" onMouseLeave={() => setHovered(null)}>
      {dims.w > 0 && ph > 0 && (
        <svg width={dims.w} height={dims.h}>
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={M.left} y1={M.top + ph * (1-f)} x2={M.left + pw} y2={M.top + ph * (1-f)}
              stroke="#1c1c1c" strokeDasharray="3 3"/>
          ))}
          <path d={linePath('markPrice')} fill="none" stroke="#ec4899" strokeWidth={1.5} strokeOpacity={0.85}/>
          <path d={linePath('indexPrice')} fill="none" stroke="#22d3ee" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.75}/>
          <line x1={M.left} y1={M.top + ph} x2={M.left + pw} y2={M.top + ph} stroke="#2a2a2a"/>
          {[0.25, 0.5, 0.75, 1].map(f => (
            <text key={f} x={M.left - 6} y={M.top + ph * (1-f) + 4} textAnchor="end" fill="#555" fontSize={10} fontFamily="monospace">
              {fmtPct(minV + (maxV - minV) * f)}
            </text>
          ))}
          {[0, Math.floor(data.length / 2), data.length - 1].map(i => (
            <text key={i} x={xOf(i)} y={M.top + ph + 18} textAnchor="middle" fill="#555" fontSize={10} fontFamily="monospace">
              {new Date(data[i].timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ))}
          {hovered !== null && (
            <line x1={xOf(hovered)} y1={M.top} x2={xOf(hovered)} y2={M.top + ph} stroke="#333" strokeWidth={1}/>
          )}
          {data.map((_, i) => (
            <rect key={i} x={M.left + (i / data.length) * pw} y={M.top} width={pw / data.length} height={ph}
              fill="transparent" onMouseEnter={() => setHovered(i)}/>
          ))}
        </svg>
      )}
      {hovData && (
        <div className="absolute pointer-events-none top-2 right-2 bg-[#0a0a0a] border border-[#2a2a2a] px-3 py-2 text-right">
          {hovData.markPrice && <div className="font-mono text-[11px]" style={{ color: '#ec4899' }}>Mark {fmtPct(hovData.markPrice)}</div>}
          {hovData.indexPrice && <div className="font-mono text-[11px]" style={{ color: '#22d3ee' }}>Index {fmtPct(hovData.indexPrice)}</div>}
        </div>
      )}
    </div>
  )
}

/* ── Perps Order Panel ──────────────────────────────────────────── */
function PerpsOrderPanel({ markPrice, indexPrice, posSymbol, colSymbol, usdcBalance, address, onConnect }) {
  const [side, setSide]         = useState('LONG')   // LONG | SHORT
  const [mode, setMode]         = useState('OPEN')   // OPEN | CLOSE
  const [collateral, setCollateral] = useState('1000')
  const [leverage, setLeverage] = useState('3')

  const col     = parseFloat(collateral) || 0
  const lev     = parseFloat(leverage)   || 1
  const notional = col * lev
  const mark    = markPrice || 0
  const amtOut  = mark > 0 ? notional / mark : 0
  const avgRate = indexPrice || 0
  // Liquidation rate: for LONG, trigger if mark drops 80%; for SHORT if mark rises 120%
  const liqRate = side === 'LONG'
    ? avgRate * (1 - 0.8 / lev)
    : avgRate * (1 + 0.8 / lev)

  const isLong = side === 'LONG'

  return (
    <div className="border border-[#141414] bg-[#0b0b0b] flex flex-col h-full">
      {/* Side tabs */}
      <div className="flex border-b border-[#141414]">
        {['LONG', 'SHORT'].map(s => (
          <button key={s} onClick={() => setSide(s)}
            className="flex-1 py-3.5 font-mono text-[11px] tracking-[0.2em] uppercase relative transition-colors duration-200"
            style={{ color: side === s ? '#fff' : '#444' }}>
            {s}
            {side === s && (
              <span className="absolute bottom-0 left-0 right-0 h-[1px]"
                style={{ backgroundColor: s === 'LONG' ? '#4ade80' : '#f87171' }}/>
            )}
          </button>
        ))}
      </div>

      {/* Open / Close tabs */}
      <div className="flex border-b border-[#141414]">
        {['OPEN', 'CLOSE'].map(m => (
          <button key={m} onClick={() => setMode(m)}
            className="flex-1 py-2.5 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors duration-200"
            style={{ color: mode === m ? '#ccc' : '#333' }}>
            {m}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5 p-5 flex-1 overflow-y-auto">
        {mode === 'OPEN' ? (
          <>
            {/* Collateral */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">Collateral</span>
                <span className="font-mono text-[11px] text-[#444]">
                  Balance: {usdcBalance || '0'}
                </span>
              </div>
              <div className="border border-[#141414] flex items-center bg-[#080808]">
                <input
                  type="number" value={collateral} min={0}
                  onChange={e => setCollateral(e.target.value)}
                  className="flex-1 bg-transparent font-mono text-[14px] text-white py-3 px-3
                             outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => setCollateral(usdcBalance?.replace(/,/g, '') || '0')}
                  className="font-mono text-[10px] tracking-[0.18em] text-[#555] hover:text-white
                             transition-colors pr-3 shrink-0">
                  MAX
                </button>
              </div>
            </div>

            {/* Leverage */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">Leverage</span>
                <span className="font-mono text-[12px] text-[#888]">{leverage}×</span>
              </div>
              <div className="border border-[#141414] flex items-center bg-[#080808]">
                <input
                  type="number" value={leverage} min={1} max={20} step={0.5}
                  onChange={e => setLeverage(Math.min(20, Math.max(1, Number(e.target.value))).toString())}
                  className="flex-1 bg-transparent font-mono text-[14px] text-white py-3 px-3
                             outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="font-mono text-[12px] text-[#444] pr-3">×</span>
              </div>
            </div>

            {/* Broker */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">Broker</span>
              <span className="font-mono text-[12px] text-[#888]">{colSymbol}</span>
            </div>

            {/* Amount out */}
            <div className="border border-[#141414] bg-[#080808] flex items-center justify-between px-3 py-3">
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#444]">Amount Out</span>
              <div className="text-right">
                <span className="font-mono text-[14px] text-white">{amtOut.toFixed(3)}</span>
                <span className="font-mono text-[11px] text-[#444] ml-1.5">{posSymbol}</span>
              </div>
            </div>

            {/* Summary rows */}
            <div className="border-t border-[#141414] pt-2 flex flex-col gap-2">
              {[
                { label: 'Avg Rate',  value: fmtRate(avgRate),  color: '#22d3ee' },
                { label: 'Liq. Rate', value: fmtRate(liqRate),  color: '#f87171' },
                { label: 'Notional',  value: formatUSD(notional), color: '#ccc' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">{label}</span>
                  <span className="font-mono text-[13px]" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-[#333]">No Open Position</span>
            <span className="font-mono text-[10px] text-[#2a2a2a] text-center">Open a position first</span>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="p-5 pt-0">
        {address ? (
          <button
            className="w-full py-3.5 font-mono text-[11px] tracking-[0.22em] uppercase transition-all duration-200"
            style={{
              background: isLong ? '#15803d20' : '#7f1d1d20',
              border: `1px solid ${isLong ? '#4ade8040' : '#f8717140'}`,
              color: isLong ? '#4ade80' : '#f87171',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = isLong ? '#15803d40' : '#7f1d1d40' }}
            onMouseLeave={e => { e.currentTarget.style.background = isLong ? '#15803d20' : '#7f1d1d20' }}
          >
            {mode === 'OPEN' ? `Open ${side === 'LONG' ? 'Long' : 'Short'}` : `Close Position`}
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="w-full py-3.5 font-mono text-[11px] tracking-[0.22em] uppercase
                       border border-[#222] bg-[#0f0f0f] text-[#444]
                       hover:border-[#444] hover:text-[#ccc] transition-colors duration-200">
            Connect Wallet
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Your Position ──────────────────────────────────────────────── */
function YourPosition({ protocolStats, marketInfo, address }) {
  const colSym = marketInfo?.collateral?.symbol     || 'waUSDC'
  const posSym = marketInfo?.position_token?.symbol || 'wRLP'
  const totalCol  = protocolStats?.totalCollateral  || 0
  const totalDebt = protocolStats?.totalDebtUsd     || 0
  const nav       = totalCol - totalDebt
  const colRatio  = totalDebt > 0 ? ((totalCol / totalDebt) * 100).toFixed(1) + '%' : '∞'

  return (
    <div className="border border-[#141414] bg-[#0b0b0b]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#141414] flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">Your Position</span>
        {address && (
          <span className="font-mono text-[10px] text-[#333] tracking-widest">
            {address.slice(0,6)}…{address.slice(-4)}
          </span>
        )}
      </div>

      {/* 4-metric row */}
      <div className="grid grid-cols-4 divide-x divide-[#141414]">
        {[
          { label: 'NAV',        value: address ? formatUSD(nav)     : '—' },
          { label: 'Collateral', value: address ? formatUSD(totalCol) : '—' },
          { label: 'Debt Value', value: address ? formatUSD(totalDebt) : '—', color: totalDebt > 0 ? '#f87171' : undefined },
          { label: 'Col. Ratio', value: address ? colRatio : '—',             color: '#4ade80' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col gap-1.5 px-5 py-4">
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-[#555]">{label}</span>
            <span className="font-mono text-[14px]" style={{ color: color || '#ccc' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Token table */}
      <div className="grid grid-cols-2 divide-x divide-[#141414] border-t border-[#141414]">
        {/* Collateral */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-[#555]">Collateral</span>
            <span className="font-mono text-[9px] text-[#333]">· tracked</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[#888]">{colSym}</span>
            <span className="font-mono text-[12px] text-[#555]">{address ? formatUSD(totalCol) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[#888]">{posSym}</span>
            <span className="font-mono text-[12px] text-[#555]">—</span>
          </div>
        </div>

        {/* Debt */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-[#555]">Debt</span>
          {[
            { label: 'Principal',  value: address ? formatUSD(totalDebt) : '—' },
            { label: 'True Debt',  value: address ? formatUSD(totalDebt) : '—' },
            { label: 'Debt Value', value: address ? formatUSD(totalDebt) : '—', color: totalDebt > 0 ? '#f87171' : undefined },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#555]">{label}</span>
              <span className="font-mono text-[12px]" style={{ color: color || '#555' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Actions + Operations ───────────────────────────────────────── */
function ActionsPanel() {
  const actions = [
    { label: 'Mint',  sub: 'Mint wRLP from collateral',   href: '#' },
    { label: 'TWAP',  sub: 'Time-weighted swap',           href: '#' },
    { label: 'LP',    sub: 'Provide liquidity',            href: '/#/pools' },
  ]
  return (
    <div className="border border-[#141414] bg-[#0b0b0b]">
      <div className="px-5 py-3 border-b border-[#141414]">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">Actions</span>
      </div>
      {actions.map((a, i) => (
        <a key={a.label} href={a.href}
          className="flex items-center justify-between px-5 py-4 border-b border-[#141414] last:border-b-0
                     hover:bg-[#0f0f0f] transition-colors group">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[12px] text-[#ccc] group-hover:text-white transition-colors">{a.label}</span>
            <span className="font-mono text-[10px] text-[#444]">{a.sub}</span>
          </div>
          <svg width="5" height="9" viewBox="0 0 5 9" fill="none" className="text-[#333] group-hover:text-[#666] transition-colors">
            <path d="M1 1l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      ))}
    </div>
  )
}

function OperationsPanel() {
  return (
    <div className="border border-[#141414] bg-[#0b0b0b] flex flex-col">
      <div className="px-5 py-3 border-b border-[#141414]">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">Operations</span>
      </div>
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#2a2a2a]">No Operations Yet</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   PERPS MARKET PAGE
═══════════════════════════════════════════════════════════════════ */
export default function PerpsMarketPage() {
  const { marketId } = useParams()
  const { market, pool, poolTVL, volumeData, protocolStats, marketInfo, oracleChange24h, chartData, loading } = useSim()
  const { address, usdcBalance, connect } = useWallet()

  const posSymbol = marketInfo?.position_token?.symbol || 'wRLP'
  const colSymbol = marketInfo?.collateral?.symbol     || 'waUSDC'
  const oi        = (protocolStats?.totalCollateral || 0) + (protocolStats?.totalDebtUsd || 0)

  /* ── Timeframe filter for chart ── */
  const [timeframe, setTimeframe] = useState('1W')
  const tfHours = { '1D': 24, '1W': 168, '1M': 720 }

  const filteredChartData = useMemo(() => {
    if (!chartData?.length) return chartData ?? []
    const maxTs = Math.max(...chartData.map(d => d.timestamp))
    const cutoff = maxTs - tfHours[timeframe] * 3600
    const filtered = chartData.filter(d => d.timestamp >= cutoff)
    return filtered.length ? filtered : chartData
  }, [chartData, timeframe])

  /* ── Panel height sync ── */
  const panelRef = useRef(null)
  const [panelH, setPanelH] = useState(560)
  useEffect(() => {
    const el = panelRef.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setPanelH(e.contentRect.height))
    ro.observe(el); return () => ro.disconnect()
  }, [])

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }}/>
      <Nav activePage="perps"/>

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
          <Link to="/perps" className="text-[#444] hover:text-[#888] transition-colors duration-200">Perps</Link>
          <span className="text-[#2a2a2a]">/</span>
          <span className="text-[#888]">{posSymbol} · USD</span>
        </div>

        {/* Title block */}
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
            {posSymbol}_PERP
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
              Interest Rate Perpetual
            </span>
            <span className="font-mono text-[10px] text-[#333]">·</span>
            <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">Aave V3 · Uniswap V4</span>
            {marketId && (
              <>
                <span className="font-mono text-[10px] text-[#333]">·</span>
                <span className="font-mono text-[10px] text-[#2a2a2a] tracking-widest">
                  {marketId.slice(0,6)}…{marketId.slice(-4)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Metric strip */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          <div className="grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 divide-[#1a1a1a]">
            <MetricCell label="Oracle Rate"  value={loading ? <Spinner /> : fmtRate(market?.indexPrice)} color="#22d3ee"/>
            <MetricCell label="Mark Rate"    value={loading ? <Spinner /> : fmtRate(pool?.markPrice)} color="#ec4899"/>
            <MetricCell label="24H Δ"        value={loading ? <Spinner /> : <ChangeBadge value={oracleChange24h} />} />
            <MetricCell label="Open Interest" value={loading ? <Spinner /> : formatUSD(oi)} />
            <MetricCell label="TVL"          value={loading ? <Spinner /> : formatUSD(poolTVL)} />
          </div>
        </div>

        {/* Main 2-col grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">

          {/* Left: Order panel */}
          <div ref={panelRef} style={{ minHeight: '540px' }}>
            <PerpsOrderPanel
              markPrice={pool?.markPrice}
              indexPrice={market?.indexPrice}
              posSymbol={posSymbol}
              colSymbol={colSymbol}
              usdcBalance={usdcBalance}
              address={address}
              onConnect={connect}
            />
          </div>

          {/* Right: Chart + position + actions */}
          <div className="flex flex-col gap-6">

            {/* Price chart */}
            <div className="border border-[#1a1a1a] bg-[#0b0b0b] flex flex-col" style={{ height: `${panelH}px` }}>
              {/* Chart header */}
              <div className="px-4 py-2.5 border-b border-[#1a1a1a] flex items-center justify-between flex-wrap gap-3 shrink-0">
                {/* Legend */}
                <div className="flex items-center gap-4 font-mono text-[9px] tracking-[0.18em]">
                  <span className="flex items-center gap-1.5 text-[#ec4899]">
                    <span className="w-3 h-px bg-[#ec4899] inline-block"/> Mark
                  </span>
                  <span className="flex items-center gap-1.5 text-[#22d3ee]">
                    <span className="w-3 h-px border-t border-dashed border-[#22d3ee] inline-block"/> Index
                  </span>
                </div>
                {/* Timeframe buttons */}
                <div className="flex items-center border border-[#1a1a1a]">
                  {['1D', '1W', '1M'].map(tf => (
                    <button key={tf} onClick={() => setTimeframe(tf)}
                      className="px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] uppercase border-r border-[#1a1a1a]
                                 last:border-r-0 transition-colors duration-150"
                      style={{ color: timeframe === tf ? '#fff' : '#444',
                               background: timeframe === tf ? '#141414' : 'transparent' }}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              {/* Chart body */}
              <div className="flex-1 min-h-0 p-3">
                <PriceChart data={filteredChartData} />
              </div>
            </div>

            {/* Your Position */}
            <YourPosition
              protocolStats={protocolStats}
              marketInfo={marketInfo}
              address={address}
            />

            {/* Actions + Operations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ActionsPanel />
              <OperationsPanel />
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
