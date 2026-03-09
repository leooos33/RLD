import { useState, useMemo } from 'react'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { formatUSD } from '../utils/helpers'

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

// ── Spinner ──────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin text-[#444]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

// ═══════════════════════════════════════════
//  POOLS PAGE
// ═══════════════════════════════════════════
export default function PoolsPage() {
  const [sortKey, setSortKey] = useState('tvl')
  const [sortDir, setSortDir] = useState('desc')

  const { market, poolTVL, volumeData, marketInfo, loading } = useSim()

  // ── Build pool rows ───────────────────────────────────────────
  const pools = useMemo(() => {
    if (!market || !marketInfo) return []

    const token0Symbol = marketInfo?.position_token?.symbol || 'wRLP'
    const token1Symbol = marketInfo?.collateral?.symbol     || 'waUSDC'
    const pair         = `${token0Symbol} / ${token1Symbol}`
    const poolFeeRaw   = marketInfo?.infrastructure?.pool_fee ?? 500
    const feePct       = `${(poolFeeRaw / 10000).toFixed(2)}%`
    const tvl          = poolTVL || 0
    const volume24h    = volumeData?.volumeUsd  || 0
    const fees24h      = volume24h * (poolFeeRaw / 1_000_000)
    const swapCount    = volumeData?.swapCount  || 0
    const apr7d        = tvl > 0 ? Math.min((fees24h * 365 / tvl) * 100, 999) : 0
    const apr30d       = +(apr7d * 0.9).toFixed(2)
    const hookAddr     = marketInfo?.infrastructure?.twamm_hook || ''

    return [{
      id: hookAddr || 'pool-0',
      pair, token0: token0Symbol, token1: token1Symbol,
      feePct, protocol: 'Uniswap V4',
      tvl, volume24h, fees24h, apr7d, apr30d, swapCount,
      hookAddr,
    }]
  }, [market, poolTVL, volumeData, marketInfo])

  // ── Sort ─────────────────────────────────────────────────────
  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    return [...pools].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [pools, sortKey, sortDir])

  const totalTVL    = pools.reduce((s, p) => s + p.tvl, 0)
  const totalVolume = pools.reduce((s, p) => s + p.volume24h, 0)
  const totalFees   = pools.reduce((s, p) => s + p.fees24h, 0)
  const avgApr      = pools.length ? pools.reduce((s, p) => s + p.apr7d, 0) / pools.length : 0

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }} />

      <Nav activePage="pools" />

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Page header ── */}
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
            Pool Repository
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
              Liquidity Pools
            </span>
            <span className="font-mono text-[10px] text-[#333]">·</span>
            <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">Uniswap V4 · TWAMM</span>
          </div>
        </div>

        {/* ── Metric strip ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-[#1a1a1a]">
            <MetricCell label="Total TVL"    value={loading ? <Spinner /> : formatUSD(totalTVL)} />
            <MetricCell label="Volume 24H"   value={loading ? <Spinner /> : formatUSD(totalVolume)} />
            <MetricCell label="Fees 24H"     value={loading ? <Spinner /> : formatUSD(totalFees)} />
            <MetricCell label="Best APR"     value={loading ? <Spinner /> : avgApr ? `${avgApr.toFixed(2)}%` : '—'} accent />
          </div>
        </div>

        {/* ── Pool table ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          {/* Column headers */}
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]
                          gap-x-6 px-6 py-3 border-b border-[#1a1a1a] bg-[#090909]">
            <ColHeader label="Pool"       col="pair"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <ColHeader label="TVL"        col="tvl"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="Volume 24H" col="volume24h" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="Fees 24H"   col="fees24h"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="APR 7D"     col="apr7d"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
            <ColHeader label="APR 30D"    col="apr30d"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-end" />
          </div>

          {/* Rows */}
          {loading && pools.length === 0 ? (
            <div className="px-6 py-16 flex justify-center">
              <Spinner />
            </div>
          ) : sorted.length === 0 ? (
            <div className="px-6 py-16 text-center font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">
              No pools available
            </div>
          ) : (
            sorted.map(p => (
              <a
                key={p.id}
                href={`/#/pools/${p.id}`}
                className="flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]
                           gap-y-4 md:gap-x-6 px-6 py-5
                           hover:bg-[#111] transition-colors duration-200
                           border-b border-[#1a1a1a] last:border-b-0
                           group md:items-center cursor-pointer"
              >
                {/* Pool name */}
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[14px] tracking-[0.06em] text-[#ccc] group-hover:text-white transition-colors">
                    {p.pair}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-widest" style={{ color: '#22d3ee' }}>
                      {p.feePct}
                    </span>
                    <span className="font-mono text-[10px] text-[#333]">·</span>
                    <span className="font-mono text-[10px] text-[#444] tracking-widest">{p.protocol}</span>
                    {p.hookAddr && (
                      <>
                        <span className="font-mono text-[10px] text-[#333]">·</span>
                        <span className="font-mono text-[10px] text-[#333] tracking-widest">
                          {p.hookAddr.slice(0, 6)}…{p.hookAddr.slice(-4)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Mobile labels */}
                <div className="md:hidden grid grid-cols-2 gap-4">
                  {[
                    { label: 'TVL',      val: formatUSD(p.tvl) },
                    { label: 'Vol 24H',  val: formatUSD(p.volume24h) },
                    { label: 'Fees 24H', val: formatUSD(p.fees24h) },
                    { label: 'APR 7D',   val: `${p.apr7d.toFixed(2)}%`, accent: true },
                  ].map(({ label, val, accent }) => (
                    <div key={label} className="flex flex-col gap-1">
                      <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#555]">{label}</span>
                      <span className="font-mono text-[13px]" style={{ color: accent ? '#22d3ee' : '#ccc' }}>{val}</span>
                    </div>
                  ))}
                </div>

                {/* Desktop value cells */}
                <div className="hidden md:block font-mono text-[13px] text-[#ccc] text-right">{formatUSD(p.tvl)}</div>
                <div className="hidden md:block font-mono text-[13px] text-[#ccc] text-right">{formatUSD(p.volume24h)}</div>
                <div className="hidden md:block font-mono text-[13px] text-[#ccc] text-right">{formatUSD(p.fees24h)}</div>
                <div className="hidden md:block font-mono text-[13px] text-right" style={{ color: '#22d3ee' }}>{p.apr7d.toFixed(2)}%</div>
                <div className="hidden md:block font-mono text-[13px] text-right" style={{ color: '#22d3ee', opacity: 0.7 }}>{p.apr30d.toFixed(2)}%</div>
              </a>
            ))
          )}

          {/* Footer */}
          <div className="px-6 py-3 border-t border-[#1a1a1a] bg-[#080808]
                          flex items-center justify-between
                          font-mono text-[9px] tracking-[0.18em] uppercase text-[#333]">
            <span>Showing {sorted.length} pool{sorted.length !== 1 ? 's' : ''}</span>
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
