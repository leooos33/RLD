import { useState, useMemo } from 'react'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { formatUSD, formatPct, formatPrice } from '../utils/helpers'

// ── Token icon URLs ──────────────────────────────────────────────
const TOKEN_ICONS = {
  waUSDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  waDAI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
  default:'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
}

// ── Grain texture ────────────────────────────────────────────────
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

// ── Sort icon ────────────────────────────────────────────────────
function SortIcon({ col, sortKey, sortDir }) {
  const active = sortKey === col
  if (!active) return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="opacity-20 shrink-0">
      <path d="M4.5 1v7M1 5.5l3.5 3 3.5-3M1 3.5l3.5-3 3.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  return sortDir === 'desc'
    ? <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0" style={{ color: '#22d3ee' }}>
        <path d="M4.5 1v7M1 5.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    : <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0" style={{ color: '#22d3ee' }}>
        <path d="M4.5 8V1M1 3.5l3.5-3 3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
}

// ── Metric cell ──────────────────────────────────────────────────
function MetricCell({ label, value, accent = false }) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5 border-r border-[#1a1a1a] last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">{label}</span>
      <span className="font-mono text-[20px] leading-none" style={{ color: accent ? '#22d3ee' : '#e4e4e4' }}>
        {value ?? '···'}
      </span>
    </div>
  )
}

// ── Sortable column header ───────────────────────────────────────
function ColHeader({ label, col, sortKey, sortDir, onSort, className = '' }) {
  const active = sortKey === col
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] uppercase
                  transition-colors duration-200 ${className}`}
      style={{ color: active ? '#22d3ee' : '#555' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#aaa' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#555' }}
    >
      {label}
      <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
    </button>
  )
}

// ═══════════════════════════════════════════
//  BONDS PAGE
// ═══════════════════════════════════════════
export default function BondsPage() {
  const [sortKey, setSortKey] = useState('openInterest')
  const [sortDir, setSortDir] = useState('desc')

  const { market, poolTVL, protocolStats, marketInfo, chartData, loading, connected } = useSim()

  // ── Build market rows ─────────────────────────────────────────
  const bondMarkets = useMemo(() => {
    if (!market || !marketInfo) return []

    const colSymbol = marketInfo.collateral?.symbol || 'waUSDC'
    const colName   = marketInfo.collateral?.name   || 'Wrapped Aave USDC'
    const icon      = TOKEN_ICONS[colSymbol] || TOKEN_ICONS.default
    const oi        = (protocolStats?.totalCollateral || 0) + (protocolStats?.totalDebtUsd || 0)
    const indexPrice= market.indexPrice || 0

    let rangeMin = indexPrice, rangeMax = indexPrice
    if (chartData?.length > 0) {
      const prices = chartData.map(d => d.indexPrice).filter(p => p > 0)
      if (prices.length) { rangeMin = Math.min(...prices); rangeMax = Math.max(...prices) }
    }

    return [{
      id: colSymbol,
      asset: colSymbol,
      name: colName,
      icon,
      protocol: 'AAVE',
      indexPrice,
      openInterest: oi,
      liquidity: poolTVL || 0,
      rangeMin,
      rangeMax,
    }]
  }, [market, poolTVL, protocolStats, marketInfo, chartData])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortedMarkets = useMemo(() => {
    return [...bondMarkets].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [bondMarkets, sortKey, sortDir])

  // ── Aggregate header stats ────────────────────────────────────
  const totalOI  = bondMarkets.reduce((s, m) => s + m.openInterest, 0)
  const totalLiq = bondMarkets.reduce((s, m) => s + m.liquidity, 0)
  const apy      = market?.indexPrice != null ? market.indexPrice : null

  // Loading spinner helper
  const Spinner = () => (
    <svg className="animate-spin text-[#333]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      {/* Grain */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }} />

      {/* Nav */}
      <Nav activePage="bonds" />

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Header + Steps | Bond card ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 lg:gap-12 items-start">

          {/* Left: title + description + steps */}
          <div className="flex flex-col gap-6">
            {/* Title + description */}
            <div className="flex flex-col gap-2">
              <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
                Bond Repository
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
                  Fixed Yield
                </span>
                <span className="font-mono text-[10px] text-[#333]">·</span>
                <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">Custom Maturity · Aave V3</span>
              </div>
            </div>

            {/* How it works */}
            <div className="flex flex-col gap-4">
              <span className="font-mono text-[12px] tracking-[0.28em] uppercase text-[#888]">
                How it Works
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4">
                {[
                  { n: '01', label: 'Choose Asset' },
                  { n: '02', label: 'Select Maturity' },
                  { n: '03', label: 'Deposit Funds' },
                  { n: '04', label: 'Collect Fixed Yield' },
                ].map(step => (
                  <div
                    key={step.n}
                    className="border border-[#141414] bg-[#0b0b0b] px-4 py-4
                               border-r-0 last:border-r
                               border-b sm:border-b
                               flex flex-col gap-2"
                  >
                    <span className="font-mono text-[10px] tracking-[0.18em] text-[#333]">
                      {step.n}
                    </span>
                    <span className="font-mono text-[12px] tracking-[0.06em] text-[#888]">
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: bond card */}
          <div className="border border-[#141414] bg-[#0b0b0b] w-full shrink-0">
            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#141414]">
              <div className="flex items-center gap-2">
                <div className="w-[7px] h-[7px] bg-white shrink-0" />
                <span className="font-mono font-bold text-[11px] tracking-[0.25em] uppercase text-white">
                  Bond
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#333] tracking-[0.15em]">#0042</span>
            </div>

            {/* APY + Principal */}
            <div className="grid grid-cols-2 divide-x divide-[#141414] border-b border-[#141414]">
              <div className="flex flex-col gap-2 px-5 py-4">
                <span className="font-mono text-[12px] tracking-[0.22em] uppercase text-[#555]">
                  Fixed APY
                </span>
                <span className="font-mono text-[22px] leading-none text-white">
                  {apy !== null ? formatPct(apy) : '8.40%'}
                </span>
              </div>
              <div className="flex flex-col gap-2 px-5 py-4">
                <span className="font-mono text-[12px] tracking-[0.22em] uppercase text-[#555]">
                  Principal
                </span>
                <span className="font-mono text-[22px] leading-none text-white">
                  25,000 <span className="text-[14px] text-[#666]">USDC</span>
                </span>
              </div>
            </div>

            {/* Status + Days */}
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="w-[7px] h-[7px] bg-white shrink-0" />
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white">
                  Active
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#555] tracking-[0.1em]">453 Days</span>
            </div>
          </div>
        </div>

        {/* ── Markets table ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">

          {/* Table header bar */}
          <div className="px-6 py-4 border-b border-[#141414] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-[12px] tracking-[0.28em] uppercase text-white">
                Markets
              </span>
              <span className="font-mono text-[12px] text-[#333]">{bondMarkets.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 shrink-0"
                style={{ background: connected ? '#fff' : '#2a2a2a' }}
              />
              <span className="font-mono text-[11px] tracking-[0.18em] uppercase"
                style={{ color: connected ? '#444' : '#2a2a2a' }}>
                {connected ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>

          {/* Column headers — desktop */}
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-x-6 px-6 py-3 border-b border-[#1a1a1a] bg-[#090909]">
            <ColHeader label="Asset"         col="asset"        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <ColHeader label="Protocol"      col="protocol"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="justify-center" />
            <ColHeader label="APY %"         col="indexPrice"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="justify-center" />
            <ColHeader label="Open Interest" col="openInterest" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="justify-center" />
            <ColHeader label="Liquidity"     col="liquidity"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="justify-center" />
            <ColHeader label="1Y Range"      col="rangeMax"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="justify-center" />
            <div /> {/* action col */}
          </div>

          {/* Loading state */}
          {loading && bondMarkets.length === 0 && (
            <div className="flex items-center justify-center py-24">
              <div className="flex flex-col items-center gap-4">
                <svg className="animate-spin text-[#2a2a2a]" width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="32" strokeDashoffset="12"/>
                </svg>
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">Connecting to indexer</span>
              </div>
            </div>
          )}

          {/* Disconnected state */}
          {!loading && !connected && bondMarkets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#333]">
                Indexer disconnected
              </span>
              <span className="font-mono text-[11px] text-[#222]">rld.fi/graphql unreachable</span>
            </div>
          )}

          {/* Market rows */}
          {sortedMarkets.map(m => (
            <a
              key={m.id}
              href={`/#/bonds/${m.id}`}
              className="flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]
                         gap-y-4 md:gap-x-6 px-6 py-5
                         hover:bg-[#111] transition-colors duration-200
                         border-b border-[#1a1a1a] last:border-b-0
                         group md:items-center cursor-pointer"
            >
              {/* Asset */}
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-mono text-[14px] tracking-[0.06em] text-[#ccc] group-hover:text-white transition-colors duration-200">
                    {m.asset}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-[10px] tracking-widest" style={{ color: '#22d3ee' }}>Bond</span>
                    <span className="font-mono text-[10px] text-[#333]">·</span>
                    <span className="font-mono text-[10px] text-[#444] uppercase tracking-[0.15em]">{m.name}</span>
                  </div>
                </div>
              </div>

              {/* Mobile: 2-col grid for stats */}
              <div className="grid grid-cols-2 gap-4 md:contents md:mt-0">

                {/* Protocol */}
                <div className="md:text-center flex flex-col md:block">
                  <span className="md:hidden font-mono text-[10px] text-[#444] uppercase tracking-[0.2em] mb-1">Protocol</span>
                  <span className="font-mono text-[13px] text-[#666] md:text-center">{m.protocol}</span>
                </div>

                {/* APY */}
                <div className="md:text-center flex flex-col md:block">
                  <span className="md:hidden font-mono text-[10px] text-[#444] uppercase tracking-[0.2em] mb-1">APY</span>
                  <span className="font-mono text-[13px] text-[#ccc] md:text-center">
                    {formatPct(m.indexPrice)}
                  </span>
                </div>

                {/* Open Interest */}
                <div className="md:text-center flex flex-col md:block">
                  <span className="md:hidden font-mono text-[10px] text-[#444] uppercase tracking-[0.2em] mb-1">Open Interest</span>
                  <span className="font-mono text-[13px] text-[#ccc] md:text-center">
                    {formatUSD(m.openInterest)}
                  </span>
                </div>

                {/* Liquidity */}
                <div className="md:text-center flex flex-col md:block">
                  <span className="md:hidden font-mono text-[10px] text-[#444] uppercase tracking-[0.2em] mb-1">Liquidity</span>
                  <span className="font-mono text-[13px] text-[#ccc] md:text-center">
                    {formatUSD(m.liquidity)}
                  </span>
                </div>

                {/* 1Y Range */}
                <div className="col-span-2 md:col-span-1 md:text-center flex flex-col md:block">
                  <span className="md:hidden font-mono text-[10px] text-[#444] uppercase tracking-[0.2em] mb-1">1Y Range</span>
                  <span className="font-mono text-[13px] md:text-center">
                    <span className="text-[#555]">{formatPrice(m.rangeMin)}</span>
                    <span className="text-[#2a2a2a] mx-1">–</span>
                    <span className="text-[#ccc]">{formatPrice(m.rangeMax)}</span>
                  </span>
                </div>
              </div>

              {/* Trade arrow */}
              <div className="hidden md:flex justify-end">
                <svg
                  width="11" height="11" viewBox="0 0 11 11" fill="none"
                  className="text-[#2a2a2a] group-hover:text-[#888] transition-colors duration-200"
                >
                  <path d="M1 10L10 1M10 1H4M10 1V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </a>
          ))}

          {/* Table footer */}
          <div className="px-6 py-3 border-t border-[#1a1a1a] bg-[#080808] flex justify-between items-center">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">
              {bondMarkets.length} Market{bondMarkets.length !== 1 ? 's' : ''}
            </span>
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">
              Data:{' '}
              <span style={{ color: '#555' }}>RLD Protocol</span>
            </span>
          </div>
        </div>


      </main>
    </div>
  )
}
