import { useState, useMemo } from 'react'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { formatUSD, formatPct } from '../utils/helpers'

// ── Grain texture ────────────────────────────────────────────────
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

// ── Helpers ──────────────────────────────────────────────────────
function formatPrice(val) {
  if (val == null || isNaN(val)) return '—'
  if (val >= 1) return `${(val * 100).toFixed(4)}%`   // indexPrice is a rate (e.g. 0.0281 → 2.81%)
  return `${(val * 100).toFixed(4)}%`
}

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

// ── Spinner ──────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin text-[#444]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

// ── Change badge ─────────────────────────────────────────────────
function ChangeBadge({ value }) {
  if (value == null) return <span className="font-mono text-[13px] text-[#444]">—</span>
  const pos = value >= 0
  return (
    <span className={`font-mono text-[13px] ${pos ? 'text-[#6a9] ' : 'text-[#c66]'}`}>
      {pos ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}

// ═══════════════════════════════════════════
//  PERPS PAGE
// ═══════════════════════════════════════════
export default function PerpsPage() {
  const [sortKey, setSortKey] = useState('openInterest')
  const [sortDir, setSortDir] = useState('desc')

  const { market, pool, poolTVL, volumeData, protocolStats, marketInfo, oracleChange24h, loading } = useSim()

  // ── Build markets array ───────────────────────────────────────
  const markets = useMemo(() => {
    if (!market || !pool || !marketInfo) return []

    const posSymbol = marketInfo.position_token?.symbol || 'wRLP'
    const colSymbol = marketInfo.collateral?.symbol     || 'waUSDC'
    const oi        = (protocolStats?.totalCollateral || 0) + (protocolStats?.totalDebtUsd || 0)
    const hookAddr  = marketInfo.infrastructure?.twamm_hook || '0x0'

    return [{
      id:           hookAddr,
      pair:         `${posSymbol} / USD`,
      base:         colSymbol,
      protocol:     'Aave V3 · Uni V4',
      indexPrice:   market.indexPrice || 0,     // rate (e.g. 0.0281 = 2.81%)
      markPrice:    pool.markPrice    || 0,
      change24h:    oracleChange24h   ?? 0,
      openInterest: oi,
      volume24h:    volumeData?.volumeUsd || 0,
      liquidity:    poolTVL           || 0,
    }]
  }, [market, pool, poolTVL, volumeData, protocolStats, marketInfo, oracleChange24h])

  // ── Sort ─────────────────────────────────────────────────────
  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    return [...markets].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [markets, sortKey, sortDir])

  const totalOI       = markets.reduce((s, m) => s + m.openInterest, 0)
  const totalVolume   = markets.reduce((s, m) => s + m.volume24h, 0)
  const totalLiquidity = markets.reduce((s, m) => s + m.liquidity, 0)

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      {/* grain */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }} />

      <Nav activePage="perps" />

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Page header ── */}
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
            Perps Repository
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
              Rate Perpetuals
            </span>
            <span className="font-mono text-[10px] text-[#333]">·</span>
            <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">Aave V3 · Uniswap V4</span>
          </div>
        </div>

        {/* ── Metric strip ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-[#1a1a1a]">
            <MetricCell label="Open Interest"  value={loading ? <Spinner /> : formatUSD(totalOI)} />
            <MetricCell label="Volume 24H"     value={loading ? <Spinner /> : formatUSD(totalVolume)} />
            <MetricCell label="Pool Liquidity" value={loading ? <Spinner /> : formatUSD(totalLiquidity)} />
            <MetricCell label="Active Markets" value={loading ? <Spinner /> : String(markets.length)} accent />
          </div>
        </div>

        {/* ── Table ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          {/* Column headers */}
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr]
                          gap-x-6 px-6 py-3 border-b border-[#1a1a1a] bg-[#090909]">
            <ColHeader label="Market"        col="pair"         sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <ColHeader label="Index Rate"    col="indexPrice"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="24H Δ"         col="change24h"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="Base"          col="base"         sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="Open Interest" col="openInterest" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="Volume 24H"    col="volume24h"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="Liquidity"     col="liquidity"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
          </div>

          {/* Rows */}
          {loading && markets.length === 0 ? (
            <div className="px-6 py-12 flex justify-center"><Spinner /></div>
          ) : sorted.length === 0 ? (
            <div className="px-6 py-12 text-center font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">
              No markets available
            </div>
          ) : (
            sorted.map(m => (
              <a
                key={m.id}
                href={`/#/perps/${m.id}`}
                className="flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr]
                           gap-y-4 md:gap-x-6 px-6 py-5
                           hover:bg-[#111] transition-colors duration-200
                           border-b border-[#141414] last:border-b-0
                           group md:items-center cursor-pointer"
              >
                {/* Market name */}
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[14px] tracking-[0.06em] text-[#ccc] group-hover:text-white transition-colors">
                    {m.pair}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-widest" style={{ color: '#22d3ee' }}>Interest Rate Perp</span>
                    <span className="font-mono text-[10px] text-[#333]">·</span>
                    <span className="font-mono text-[10px] text-[#444] tracking-widest">{m.protocol}</span>
                  </div>
                </div>

                {/* Mobile labels */}
                <div className="md:hidden grid grid-cols-2 gap-4">
                  {[
                    { label: 'Index Rate',  val: formatPct(m.indexPrice) },
                    { label: '24H Δ',       val: <ChangeBadge value={m.change24h} /> },
                    { label: 'Open Int',    val: formatUSD(m.openInterest) },
                    { label: 'Volume 24H',  val: formatUSD(m.volume24h) },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex flex-col gap-1">
                      <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#555]">{label}</span>
                      <span className="font-mono text-[12px] text-[#ccc]">{val}</span>
                    </div>
                  ))}
                </div>

                {/* Desktop cells */}
                <div className="hidden md:block font-mono text-[13px] text-right" style={{ color: '#22d3ee' }}>{formatPct(m.indexPrice)}</div>
                <div className="hidden md:flex justify-end"><ChangeBadge value={m.change24h} /></div>
                <div className="hidden md:block font-mono text-[13px] text-[#555] text-right">{m.base}</div>
                <div className="hidden md:block font-mono text-[13px] text-[#ccc] text-right">{formatUSD(m.openInterest)}</div>
                <div className="hidden md:block font-mono text-[13px] text-[#ccc] text-right">{formatUSD(m.volume24h)}</div>
                <div className="hidden md:block font-mono text-[13px] text-right" style={{ color: '#22d3ee', opacity: 0.8 }}>{formatUSD(m.liquidity)}</div>
              </a>
            ))
          )}

          {/* Footer */}
          <div className="px-6 py-3 border-t border-[#1a1a1a] bg-[#080808]
                          flex items-center justify-between
                          font-mono text-[9px] tracking-[0.18em] uppercase text-[#333]">
            <span>Showing {sorted.length} market{sorted.length !== 1 ? 's' : ''}</span>
            <span>
              Data:{' '}
              <a href="https://rld.fi" target="_blank" rel="noopener noreferrer"
                 className="hover:text-[#888] transition-colors duration-200">
                RLD Protocol
              </a>
            </span>
          </div>
        </div>

      </main>
    </div>
  )
}
