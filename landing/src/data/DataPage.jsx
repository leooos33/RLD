import { useState, useEffect, useMemo, useRef } from 'react'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'
import useSWR from 'swr'
import Nav from '../Nav'

// ── Grain ────────────────────────────────────────────────────────
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

// ── Asset/series config (mirrors explore page) ───────────────────
const ASSETS = [
  { symbol: 'USDC', name: 'USD Coin',     decimals: 6,  debtToken: '0x72E95b8931767C79bA4EeE721354d6E99a61D004', color: '#22d3ee' },
  { symbol: 'DAI',  name: 'Dai Stablecoin',decimals:18, debtToken: '0xcF8d0c70c850859266f5C338b38F9D663181C314', color: '#facc15' },
  { symbol: 'USDT', name: 'Tether USD',   decimals: 6,  debtToken: '0x6df1C1E379bC5a00a7b4C6e67A203333772f45A8', color: '#4ade80' },
]

const SERIES_CONFIG = [
  { key: 'apy_usdc', label: 'USDC Rate',      name: 'USDC Rate',      color: '#22d3ee' },
  { key: 'apy_dai',  label: 'DAI Rate',       name: 'DAI Rate',       color: '#facc15' },
  { key: 'apy_usdt', label: 'USDT Rate',      name: 'USDT Rate',      color: '#4ade80' },
  { key: 'apy_sofr', label: 'SOFR (Risk Free)',name: 'SOFR',          color: '#c084fc' },
  { key: 'ethPrice', label: 'ETH Price',      name: 'ETH Price',      color: '#a1a1aa', yAxisId: 'right' },
]

const TIMEFRAMES = [
  { l: '1D', d: 1    },
  { l: '1W', d: 7    },
  { l: '1M', d: 30   },
  { l: '3M', d: 90   },
  { l: '1Y', d: 365  },
]

const RESOLUTIONS = ['1H', '4H', '1D', '1W']

const GQL_URL = '/graphql'

// ── Helpers ──────────────────────────────────────────────────────
function fmtCurrency(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  return `$${Math.round(v).toLocaleString()}`
}

function dateRange(days) {
  const end   = new Date()
  const start = new Date(end - days * 86400e3)
  const fmt   = d => d.toISOString().split('T')[0]
  return { start: fmt(start), end: fmt(end) }
}

// ── Inline Rate Chart (recharts) ──────────────────────────────────
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

function RateChartTooltip({ active, payload, label, resolution }) {
  if (!active || !payload?.length) return null
  const isDaily = resolution === '1D' || resolution === '1W'
  const opts = { month: 'short', day: 'numeric', year: 'numeric' }
  if (!isDaily) { opts.hour = '2-digit'; opts.minute = '2-digit' }
  const dateStr = new Date(label * 1000).toLocaleString('en-US', opts)
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }} className="p-3 font-mono text-[11px] z-50">
      <p className="text-[#444] mb-2 border-b border-[#1a1a1a] pb-1">{dateStr}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2" style={{ background: entry.color }} />
          <span className="text-[#888]">{entry.name}:</span>
          <span className="text-white font-bold">
            {entry.name.includes('Price') || entry.name === 'ETH Price'
              ? `$${Number(entry.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `${Number(entry.value).toFixed(2)}%`}
          </span>
        </div>
      ))}
    </div>
  )
}

function RateChart({ data, areas = [], resolution = '1H' }) {
  const containerRef = useRef(null)
  const [zoomState, setZoomState] = useState(null)
  const [yDomain, setYDomain]     = useState(['auto', 'auto'])
  const isDragging   = useRef(false)
  const lastMouseX   = useRef(0)
  const rafId        = useRef(null)
  const prevMeta     = useRef({ startTs: 0, length: 0 })

  useEffect(() => {
    if (!data?.length) return
    const firstTs = data[0].timestamp
    const pm = prevMeta.current
    const same = Math.abs(firstTs - pm.startTs) < 3600 && Math.abs(data.length - pm.length) < pm.length * 0.25 + 5
    setZoomState(prev => {
      if (same && prev) return { start: Math.min(prev.start, data.length - 1), end: Math.min(prev.end, data.length - 1) }
      return { start: 0, end: data.length - 1 }
    })
    prevMeta.current = { startTs: firstTs, length: data.length }
  }, [data])

  const visibleData = useMemo(() => {
    if (!data || !zoomState) return []
    const slice = data.slice(zoomState.start, zoomState.end + 1)
    const MAX = 1000
    if (slice.length <= MAX) return slice
    const step = Math.ceil(slice.length / MAX)
    const sampled = []
    for (let i = 0; i < slice.length; i += step) sampled.push(slice[i])
    if (sampled[sampled.length - 1] !== slice[slice.length - 1]) sampled.push(slice[slice.length - 1])
    return sampled
  }, [data, zoomState])

  useEffect(() => {
    if (!visibleData.length) return
    const leftKeys = areas.filter(a => !a.yAxisId || a.yAxisId === 'left').map(a => a.key)
    let min = Infinity, max = -Infinity
    visibleData.forEach(d => leftKeys.forEach(k => {
      const v = d[k]; if (v != null) { if (v < min) min = v; if (v > max) max = v }
    }))
    if (min === Infinity || max === -Infinity) { setYDomain(['auto', 'auto']); return }
    const pad = (max - min) * 0.08
    setYDomain([Math.max(0, min - pad), max + pad])
  }, [visibleData, areas])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !data?.length) return

    const handleWheel = e => {
      e.preventDefault()
      setZoomState(cur => {
        if (!cur) return null
        const len = cur.end - cur.start, tot = data.length
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const shift = (e.deltaX / (el.clientWidth || 1000)) * len * 2.5
          let s = cur.start + shift, f = cur.end + shift
          if (s < 0) { f -= s; s = 0 }
          if (f > tot - 1) { s -= f - (tot - 1); f = tot - 1 }
          return { start: Math.round(Math.max(0, s)), end: Math.round(Math.min(tot - 1, f)) }
        }
        const factor = 1 + e.deltaY * 0.004
        let nl = Math.max(5, Math.min(tot, len * factor))
        let s = cur.start + (len - nl) / 2, f = cur.end - (len - nl) / 2
        if (s < 0) { f -= s; s = 0 }
        if (f > tot - 1) { s -= f - (tot - 1); f = tot - 1 }
        return { start: Math.round(Math.max(0, s)), end: Math.round(Math.min(tot - 1, f)) }
      })
    }
    const down = e => { isDragging.current = true; lastMouseX.current = e.clientX; el.style.cursor = 'grabbing' }
    const move = e => {
      if (!isDragging.current) return
      e.preventDefault()
      if (rafId.current) cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const dx = lastMouseX.current - e.clientX; lastMouseX.current = e.clientX
        setZoomState(cur => {
          if (!cur) return null
          const len = cur.end - cur.start, tot = data.length
          const shift = (dx / (el.clientWidth || 1000)) * len
          let s = cur.start + shift, f = cur.end + shift
          if (s < 0) { s = 0; f = len }
          if (f > tot - 1) { f = tot - 1; s = f - len }
          return { start: Math.round(Math.max(0, s)), end: Math.round(Math.min(tot - 1, f)) }
        })
      })
    }
    const up = () => { isDragging.current = false; el.style.cursor = 'auto' }
    el.addEventListener('wheel', handleWheel, { passive: false })
    el.addEventListener('mousedown', down)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    el.addEventListener('mouseleave', up)
    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('mousedown', down)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      el.removeEventListener('mouseleave', up)
    }
  }, [data])

  const formatTick = unix => {
    const d = new Date(unix * 1000)
    if (resolution === '1D' || resolution === '1W')
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    const dur = (visibleData[visibleData.length - 1]?.timestamp || 0) - (visibleData[0]?.timestamp || 0)
    if (dur < 172800) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    if (dur < 15552000) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }

  if (!data?.length) return <div className="flex items-center justify-center h-full font-mono text-[10px] text-[#333] uppercase tracking-widest">No data</div>

  return (
    <div ref={containerRef} className="w-full h-full select-none" style={{ touchAction: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={visibleData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {areas.map(a => (
              <linearGradient key={a.key} id={`g-${a.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={a.color} stopOpacity={0.25}/>
                <stop offset="95%" stopColor={a.color} stopOpacity={0}/>
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false}/>
          <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin','dataMax']}
            tickFormatter={formatTick} stroke="#555" fontSize={12} tick={{ fill: '#666' }} tickMargin={10} minTickGap={60}/>
          <YAxis stroke="#555" fontSize={12} tick={{ fill: '#666' }} domain={yDomain}
            tickFormatter={v => `${Number(v).toFixed(1)}%`} width={52} allowDataOverflow/>
          {areas.some(a => a.yAxisId === 'right') && (
            <YAxis yAxisId="right" orientation="right" stroke="#555" fontSize={12} tick={{ fill: '#666' }}
              domain={['auto','auto']} tickFormatter={v => `$${Number(v).toFixed(0)}`} width={56}/>
          )}
          <Tooltip content={<RateChartTooltip resolution={resolution}/>} cursor={{ stroke: '#2a2a2a', strokeDasharray: '4 4' }}/>
          {areas.map((a, i) => (
            <Area key={i} {...(a.yAxisId ? { yAxisId: a.yAxisId } : {})}
              type="monotone" dataKey={a.key} stroke={a.color} strokeWidth={1.5}
              fill={`url(#g-${a.key})`} name={a.name} isAnimationActive={false} connectNulls/>
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── FilterDropdown ───────────────────────────────────────────────
function FilterDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const isAll = selected.size === options.length
  const toggle = opt => { const n = new Set(selected); n.has(opt) ? n.delete(opt) : n.add(opt); onChange(n) }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="h-[28px] border border-[#1a1a1a] bg-[#0b0b0b] flex items-center justify-between px-3 gap-4
                   font-mono text-[10px] tracking-[0.15em] uppercase transition-colors hover:border-[#333]"
        style={{ minWidth: '140px', color: '#ccc' }}>
        <div className="flex items-center gap-2">
          <span className="text-[#555]">{label}</span>
          <span className="text-[#22d3ee]">{isAll ? 'ALL' : selected.size}</span>
        </div>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 border border-[#1a1a1a] bg-[#0b0b0b] z-50 flex flex-col min-w-[180px]">
          {/* Select All */}
          <button onClick={() => onChange(isAll ? new Set() : new Set(options))}
            className="flex items-center gap-3 px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase
                       border-b border-[#1a1a1a] transition-colors hover:bg-[#111]"
            style={{ color: isAll ? '#22d3ee' : '#555' }}>
            <div className="w-3 h-3 border flex items-center justify-center shrink-0"
              style={{ borderColor: isAll ? '#22d3ee' : '#2a2a2a', background: isAll ? '#22d3ee' : 'transparent' }}>
              {isAll && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="#000" strokeWidth="1.5" strokeLinecap="round"/></svg>}
            </div>
            All
          </button>
          {options.map(opt => {
            const on = selected.has(opt)
            return (
              <button key={opt} onClick={() => toggle(opt)}
                className="flex items-center gap-3 px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase
                           border-b border-[#131313] last:border-b-0 transition-colors hover:bg-[#111]"
                style={{ color: on ? '#22d3ee' : '#444' }}>
                <div className="w-3 h-3 border flex items-center justify-center shrink-0"
                  style={{ borderColor: on ? '#22d3ee' : '#2a2a2a', background: on ? '#22d3ee' : 'transparent' }}>
                  {on && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="#000" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                </div>
                {opt}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Stat cell ────────────────────────────────────────────────────
function StatCell({ label, value, sub, accent = false }) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5 border-r border-[#1a1a1a] last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">{label}</span>
      <span className="font-mono text-[20px] leading-none" style={{ color: accent ? '#22d3ee' : '#e4e4e4' }}>
        {value ?? '···'}
      </span>
      {sub && <span className="font-mono text-[10px] text-[#444]">{sub}</span>}
    </div>
  )
}

// ── Spinner ──────────────────────────────────────────────────────
function Spinner({ size = 14 }) {
  return (
    <svg className="animate-spin text-[#444]" width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

// ═══════════════════════════════════════════
//  DATA PAGE
// ═══════════════════════════════════════════
export default function DataPage() {
  const [selectedTF, setSelectedTF] = useState('1M')
  const [resolution,  setResolution] = useState('1D')
  const [hiddenSeries, setHiddenSeries] = useState(new Set())
  const [marketData, setMarketData]   = useState([])
  const [mktLoading, setMktLoading]   = useState(true)
  const [selectedProtocols, setSelectedProtocols] = useState(new Set(['AAVE']))
  const [selectedAssets, setSelectedAssets]       = useState(new Set(['USDC', 'DAI', 'USDT']))

  const toggleSeries = key => setHiddenSeries(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  // ── Date range ───────────────────────────────────────────────
  const { start, end } = useMemo(() => {
    const days = TIMEFRAMES.find(t => t.l === selectedTF)?.d || 30
    return dateRange(days)
  }, [selectedTF])

  // ── Chart data via GraphQL ─────────────────────────────────
  const chartKey = `chart:${resolution}:${start}:${end}`
  const { data: chartGql, isLoading: chartLoading } = useSWR(chartKey, async () => {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{
        rates(symbols: ["USDC","DAI","USDT","SOFR"], resolution: "${resolution}", startDate: "${start}", endDate: "${end}") {
          symbol data { timestamp apy ethPrice }
        }
        ethPrices(resolution: "${resolution}", startDate: "${start}", endDate: "${end}") { timestamp price }
      }` }),
    })
    return (await res.json())?.data || null
  }, { revalidateOnFocus: false })

  const chartData = useMemo(() => {
    if (!chartGql?.rates) return []
    const rmap = {}
    chartGql.rates.forEach(s => { rmap[s.symbol] = s.data || [] })
    const base = rmap['USDC'] || []
    if (!base.length) return []
    const getBucket = ts => {
      const s = { '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800 }[resolution] || 3600
      return Math.floor(ts / s) * s
    }
    const merged = new Map()
    const put = (ts, k, v) => { const b = getBucket(ts); if (!merged.has(b)) merged.set(b, { timestamp: b }); merged.get(b)[k] = v }
    base.forEach(r => put(r.timestamp, 'apy_usdc', r.apy))
    ;(rmap['DAI'] || []).forEach(r => put(r.timestamp, 'apy_dai', r.apy))
    ;(rmap['USDT'] || []).forEach(r => put(r.timestamp, 'apy_usdt', r.apy))
    ;(rmap['SOFR'] || []).forEach(r => put(r.timestamp, 'apy_sofr', r.apy))
    ;(chartGql.ethPrices || base).forEach(r => put(r.timestamp, 'ethPrice', r.price ?? r.ethPrice))
    const sorted = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp)
    let lastSofr = null
    return sorted.map(p => {
      if (p.apy_sofr != null) lastSofr = p.apy_sofr
      else if (lastSofr != null) p.apy_sofr = lastSofr
      return p
    })
  }, [chartGql, resolution])

  const activeAreas = useMemo(() =>
    SERIES_CONFIG.filter(s => !hiddenSeries.has(s.key)).map(s => ({
      key: s.key, name: s.name, color: s.color, yAxisId: s.yAxisId,
    }))
  , [hiddenSeries])

  // ── Market data (debt + APY) via GraphQL + on-chain ─────────
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const rpcUrl = 'https://eth.llamarpc.com'
        const provider = new JsonRpcProvider(rpcUrl)
        const ABI = ['function totalSupply() view returns (uint256)']
        let apyMap = {}
        try {
          const r = await fetch(GQL_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `{ rates(symbols: ${JSON.stringify(ASSETS.map(a => a.symbol))}, limit: 1) { symbol data { apy } } }` }),
          })
          const j = await r.json()
          ;(j?.data?.rates || []).forEach(s => { apyMap[s.symbol] = s.data?.[0]?.apy || 0 })
        } catch {}
        const results = await Promise.all(ASSETS.map(async a => {
          let debt = 0
          try { debt = parseFloat(formatUnits(await new Contract(a.debtToken, ABI, provider).totalSupply(), a.decimals)) } catch {}
          return { ...a, apy: apyMap[a.symbol] || 0, debt }
        }))
        results.sort((a, b) => b.debt - a.debt)
        setMarketData(results)
      } catch {}
      setMktLoading(false)
    }
    fetch_()
  }, [])

  // ── Aggregate stats ──────────────────────────────────────────
  const stats = useMemo(() => {
    const totalDebt = marketData.reduce((s, m) => s + m.debt, 0)
    const avgApy    = totalDebt > 0 ? marketData.reduce((s, m) => s + m.apy * m.debt, 0) / totalDebt : 0
    const top       = marketData.reduce((p, c) => c.debt > p.debt ? c : p, { symbol: '—', debt: 0 })
    return { totalDebt, avgApy, topSymbol: top.symbol, dominance: totalDebt > 0 ? (top.debt / totalDebt) * 100 : 0 }
  }, [marketData])

  // ── SVG Download ─────────────────────────────────────────────
  const handleDownload = () => {
    const svg = document.querySelector('#rate-chart-wrap svg')
    if (!svg) return
    const ser = new XMLSerializer()
    let src = ser.serializeToString(svg)
    if (!src.match(/^<svg[^>]+xmlns=/)) src = src.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
    const { width: w, height: h } = svg.getBoundingClientRect()
    const final = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#080808"/>${src}</svg>`
    const link = Object.assign(document.createElement('a'), {
      href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(final),
      download: `rates-${new Date().toISOString().split('T')[0]}.svg`,
    })
    document.body.appendChild(link); link.click(); document.body.removeChild(link)
  }

  const filteredMarkets = marketData.filter(m => selectedAssets.has(m.symbol))

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }} />
      <Nav activePage="data" />

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Header ── */}
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
            Global Liquidity
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
              Market Depth &amp; Interest Rate Dynamics
            </span>
            <span className="font-mono text-[10px] text-[#333]">·</span>
            <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">Aave V3 · Ethereum</span>
          </div>
        </div>

        {/* ── Stats strip ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          <div className="grid grid-cols-2 lg:grid-cols-3 divide-y lg:divide-y-0 divide-[#1a1a1a]">
            <StatCell label="Total Active Debt"
              value={mktLoading ? <Spinner /> : fmtCurrency(stats.totalDebt)}
              sub="Live on-chain" />
            <StatCell label="Avg Borrow Rate"
              value={mktLoading ? <Spinner /> : `${stats.avgApy.toFixed(2)}%`}
              sub="Debt-weighted" accent />
            <StatCell label="Top Market"
              value={mktLoading ? <Spinner /> : stats.topSymbol}
              sub={mktLoading ? '' : `${stats.dominance.toFixed(1)}% dominance`} />
          </div>
        </div>

        {/* ── Chart panel ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          {/* Chart controls */}
          <div className="px-6 py-3 border-b border-[#1a1a1a] flex flex-wrap items-center justify-between gap-4">
            {/* Series legend / toggles */}
            <div className="flex flex-wrap items-center gap-5">
              {SERIES_CONFIG.map(s => (
                <button key={s.key} onClick={() => toggleSeries(s.key)}
                  className="flex items-center gap-2 transition-opacity"
                  style={{ opacity: hiddenSeries.has(s.key) ? 0.3 : 1 }}>
                  <div className="w-2 h-2 shrink-0" style={{ background: s.color }} />
                  <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ccc]">{s.label}</span>
                </button>
              ))}
            </div>
            {/* Timeframe + resolution + download */}
            <div className="flex items-center gap-3">
              {/* Resolution */}
              <div className="flex items-center border border-[#1a1a1a]">
                {RESOLUTIONS.map(r => (
                  <button key={r} onClick={() => setResolution(r)}
                    className="px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase border-r border-[#1a1a1a] last:border-r-0 transition-colors"
                    style={{ color: resolution === r ? '#22d3ee' : '#444', background: resolution === r ? '#0f1f1f' : 'transparent' }}>
                    {r}
                  </button>
                ))}
              </div>
              {/* Timeframe */}
              <div className="flex items-center border border-[#1a1a1a]">
                {TIMEFRAMES.map(tf => (
                  <button key={tf.l} onClick={() => setSelectedTF(tf.l)}
                    className="px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase border-r border-[#1a1a1a] last:border-r-0 transition-colors"
                    style={{ color: selectedTF === tf.l ? '#22d3ee' : '#444', background: selectedTF === tf.l ? '#0f1f1f' : 'transparent' }}>
                    {tf.l}
                  </button>
                ))}
              </div>
              {/* SVG download */}
              <button onClick={handleDownload}
                className="hidden md:flex items-center gap-1.5 font-mono text-[10px] tracking-[0.15em] uppercase text-[#444] hover:text-[#888] transition-colors">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M5.5 1v7M2 6l3.5 3.5L9 6M1 10h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                SVG
              </button>
            </div>
          </div>

          {/* Chart */}
          <div id="rate-chart-wrap" className="p-4" style={{ height: '420px' }}>
            {chartLoading && !chartData.length
              ? <div className="flex items-center justify-center h-full"><Spinner size={20}/></div>
              : <RateChart data={chartData} areas={activeAreas} resolution={resolution} />
            }
          </div>
        </div>

        {/* ── Filters + table ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          {/* Filter bar: two dropdowns */}
          <div className="px-6 py-3 border-b border-[#1a1a1a] bg-[#090909] flex items-center gap-4 flex-wrap">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555] mr-2">Filters</span>
            <FilterDropdown
              label="Protocols"
              options={['AAVE', 'MORPHO', 'EULER', 'FLUID']}
              selected={selectedProtocols}
              onChange={setSelectedProtocols}
            />
            <FilterDropdown
              label="Assets"
              options={['USDC', 'DAI', 'USDT']}
              selected={selectedAssets}
              onChange={setSelectedAssets}
            />
          </div>

          {/* Column headers */}
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-x-6 px-6 py-3 border-b border-[#1a1a1a] bg-[#090909]">
            {['Asset', 'Protocol', 'Total Debt', 'Borrow APY', 'Network'].map((h, i) => (
              <span key={h} className={`font-mono text-[10px] tracking-[0.2em] uppercase text-[#555] ${i > 0 ? 'text-center' : ''}`}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {mktLoading ? (
            <div className="flex justify-center py-16"><Spinner size={20}/></div>
          ) : filteredMarkets.length === 0 ? (
            <div className="px-6 py-12 text-center font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">No assets selected</div>
          ) : filteredMarkets.map(m => (
            <div key={m.symbol}
              className="flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-y-3 md:gap-x-6 px-6 py-5
                         border-b border-[#131313] last:border-b-0 md:items-center
                         hover:bg-[#0f0f0f] transition-colors">
              {/* Asset */}
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[14px] tracking-[0.06em] text-[#ccc]">{m.symbol}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] tracking-widest" style={{ color: m.color }}>Rate</span>
                  <span className="font-mono text-[10px] text-[#333]">·</span>
                  <span className="font-mono text-[10px] text-[#444] tracking-widest">{m.name}</span>
                </div>
              </div>
              {/* Protocol */}
              <div className="md:text-center">
                <span className="font-mono text-[12px] text-[#555]">AAVE</span>
              </div>
              {/* Debt */}
              <div className="md:text-center">
                <span className="font-mono text-[12px] text-[#ccc]">{fmtCurrency(m.debt)}</span>
              </div>
              {/* APY */}
              <div className="md:text-center">
                <span className="font-mono text-[12px]" style={{ color: m.color }}>{m.apy.toFixed(2)}%</span>
              </div>
              {/* Network */}
              <div className="md:text-center">
                <span className="font-mono text-[11px] text-[#444]">ETHEREUM</span>
              </div>
            </div>
          ))}

          {/* Footer */}
          <div className="px-6 py-3 border-t border-[#1a1a1a] bg-[#080808] flex justify-between items-center
                          font-mono text-[9px] tracking-[0.18em] uppercase text-[#333]">
            <span>Showing {filteredMarkets.length} asset{filteredMarkets.length !== 1 ? 's' : ''}</span>
            <span>Data: <span className="text-[#555]">Aave V3</span></span>
          </div>
        </div>

      </main>
    </div>
  )
}
