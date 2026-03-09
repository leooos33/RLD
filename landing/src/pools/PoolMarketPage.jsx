import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { formatUSD } from '../utils/helpers'
import { useWallet } from '../hooks/useWallet'

// ── Grain ────────────────────────────────────────────────────────
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

// ── Helpers ──────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin text-[#444]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

// ── Metric header cell ───────────────────────────────────────────
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

// ── Liquidity Depth Chart — dual color (pink / cyan) ─────────────
function DepthChart({ bins, currentPrice }) {
  const ref = useRef(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el); return () => ro.disconnect()
  }, [])

  if (!bins || bins.length === 0) {
    return (
      <div ref={ref} className="w-full h-full flex items-center justify-center">
        <span className="font-mono text-[10px] text-[#333] tracking-[0.2em] uppercase">Loading depth data…</span>
      </div>
    )
  }

  const getDepth = b => (b.amount0 ?? 0) + (b.amount1 ?? 0)
  const maxDepth = Math.max(...bins.map(getDepth), 0.01)
  const M = { top: 18, right: 10, bottom: 28, left: 56 }
  const pw = dims.w - M.left - M.right
  const ph = dims.h - M.top - M.bottom
  const bw = pw / bins.length
  const xOf = i => M.left + i * bw + bw / 2
  const yOf = d => M.top + ph - (d / maxDepth) * ph * 0.9

  let cpx = null, cpBin = -1
  if (currentPrice && bins.length) {
    const minP = bins[0].priceFrom, maxP = bins[bins.length - 1].priceTo
    if (currentPrice >= minP && currentPrice <= maxP) {
      cpx = M.left + ((currentPrice - minP) / (maxP - minP)) * pw
      cpBin = bins.findIndex(b => currentPrice >= b.priceFrom && currentPrice < b.priceTo)
    }
  }

  const pts = bins.map((b, i) => ({ x: xOf(i), y: yOf(getDepth(b)) }))
  const baseline = M.top + ph
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaD = `M${pts[0].x.toFixed(1)},${baseline} L${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} ` +
    pathD.slice(pathD.indexOf('L')) +
    ` L${pts[pts.length - 1].x.toFixed(1)},${baseline}Z`

  const fmtAmt = v => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
    return v.toFixed(1)
  }

  const uid = useRef(Math.random().toString(36).slice(2)).current

  return (
    <div ref={ref} className="w-full h-full relative" onMouseLeave={() => setHovered(null)}>
      {dims.w > 0 && ph > 0 && (
        <svg width={dims.w} height={dims.h} className="font-mono">
          <defs>
            <linearGradient id={`dp-left-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ec4899" stopOpacity={0.55}/>
              <stop offset="100%" stopColor="#ec4899" stopOpacity={0.04}/>
            </linearGradient>
            <linearGradient id={`dp-right-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45}/>
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.04}/>
            </linearGradient>
            <clipPath id={`dp-plot-${uid}`}><rect x={M.left} y={M.top} width={pw} height={ph}/></clipPath>
            {cpx != null && <>
              <clipPath id={`dp-lc-${uid}`}><rect x={0} y={0} width={cpx} height={dims.h}/></clipPath>
              <clipPath id={`dp-rc-${uid}`}><rect x={cpx} y={0} width={dims.w - cpx} height={dims.h}/></clipPath>
            </>}
          </defs>

          {/* Grid */}
          {[0.33, 0.66, 1].map(f => (
            <line key={f} x1={M.left} y1={M.top + ph * (1 - f)} x2={M.left + pw} y2={M.top + ph * (1 - f)}
              stroke="#1c1c1c" strokeDasharray="3 3"/>
          ))}

          {/* Area fills + outlines */}
          <g clipPath={`url(#dp-plot-${uid})`}>
            {cpx != null ? <>
              <path d={areaD} fill={`url(#dp-left-${uid})`}  clipPath={`url(#dp-lc-${uid})`}/>
              <path d={areaD} fill={`url(#dp-right-${uid})`} clipPath={`url(#dp-rc-${uid})`}/>
              <path d={pathD} fill="none" stroke="#ec4899" strokeWidth={1.5} strokeOpacity={0.8} clipPath={`url(#dp-lc-${uid})`}/>
              <path d={pathD} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.8} clipPath={`url(#dp-rc-${uid})`}/>
            </> : <>
              <path d={areaD} fill={`url(#dp-right-${uid})`}/>
              <path d={pathD} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.8}/>
            </>}
          </g>

          {/* Hover highlight */}
          {hovered !== null && (
            <rect x={M.left + hovered * bw} y={yOf(getDepth(bins[hovered]))}
              width={bw} height={baseline - yOf(getDepth(bins[hovered]))}
              fill={hovered <= cpBin ? '#ec4899' : '#22d3ee'} opacity={0.18}/>
          )}

          {/* Invisible hover targets */}
          {bins.map((_, i) => (
            <rect key={i} x={M.left + i * bw} y={M.top} width={bw} height={ph}
              fill="transparent" onMouseEnter={() => setHovered(i)}/>
          ))}

          {/* Current price line */}
          {cpx != null && <>
            <line x1={cpx} y1={M.top} x2={cpx} y2={baseline}
              stroke="#fff" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.6}/>
            <text x={cpx} y={M.top - 4} textAnchor="middle" fill="#22d3ee" fontSize={11} fontFamily="monospace" fontWeight="600">
              {currentPrice.toFixed(4)}
            </text>
          </>}

          {/* Baseline */}
          <line x1={M.left} y1={baseline} x2={M.left + pw} y2={baseline} stroke="#2a2a2a"/>

          {/* X labels */}
          {bins.map((b, i) => {
            if (i % Math.max(1, Math.floor(bins.length / 5)) !== 0) return null
            return <text key={i} x={xOf(i)} y={baseline + 16} textAnchor="middle" fill="#555" fontSize={10} fontFamily="monospace">
              {Number(b.price).toFixed(2)}
            </text>
          })}

          {/* Y labels */}
          {[0.5, 1].map(f => (
            <text key={f} x={M.left - 6} y={M.top + ph * (1 - f) + 4} textAnchor="end" fill="#555" fontSize={10} fontFamily="monospace">
              {fmtAmt(maxDepth * f)}
            </text>
          ))}
        </svg>
      )}

      {/* Tooltip */}
      {hovered !== null && dims.w > 0 && (() => {
        const bin = bins[hovered]
        const x = xOf(hovered)
        const tipY = yOf(getDepth(bin))
        const isLeft = hovered <= cpBin
        return (
          <div className="absolute pointer-events-none bg-[#0a0a0a] border px-3 py-2 z-10"
            style={{
              borderColor: isLeft ? '#ec489940' : '#22d3ee40',
              left: Math.min(Math.max(x - 80, 4), dims.w - 190),
              top: Math.max(tipY - 70, 4)
            }}>
            <div className="font-mono text-[9px] tracking-widest mb-1" style={{ color: isLeft ? '#ec4899' : '#22d3ee' }}>
              {Number(bin.priceFrom).toFixed(4)} – {Number(bin.priceTo).toFixed(4)}
            </div>
            <div className="font-mono text-[12px] text-[#ccc]">
              {fmtAmt((bin.amount0 ?? 0) + (bin.amount1 ?? 0))} units
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Price Line Chart ─────────────────────────────────────────────
function PriceChart({ data }) {
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

  const M = { top: 18, right: 10, bottom: 28, left: 68 }
  const pw = dims.w - M.left - M.right
  const ph = dims.h - M.top - M.bottom
  const allVals = data.flatMap(d => [d.markPrice, d.indexPrice].filter(Boolean))
  const minV = Math.min(...allVals) * 0.998
  const maxV = Math.max(...allVals) * 1.002
  const xOf = i => M.left + (i / (data.length - 1)) * pw
  const yOf = v => M.top + ph - ((v - minV) / (maxV - minV)) * ph
  const linePath = (key) => data
    .map((d, i) => d[key] != null
      ? `${i === 0 || data[i - 1]?.[key] == null ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d[key]).toFixed(1)}`
      : null)
    .filter(Boolean).join(' ')

  const fmtPct = v => `${(v * 100).toFixed(4)}%`
  const hovData = hovered !== null ? data[hovered] : null

  return (
    <div ref={ref} className="w-full h-full relative font-mono" onMouseLeave={() => setHovered(null)}>
      {dims.w > 0 && ph > 0 && (
        <svg width={dims.w} height={dims.h}>
          {/* Grid */}
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={M.left} y1={M.top + ph * (1 - f)} x2={M.left + pw} y2={M.top + ph * (1 - f)}
              stroke="#1c1c1c" strokeDasharray="3 3"/>
          ))}

          {/* Mark price — pink */}
          <path d={linePath('markPrice')} fill="none" stroke="#ec4899" strokeWidth={1.5} strokeOpacity={0.85}/>
          {/* Index price — cyan dashed */}
          <path d={linePath('indexPrice')} fill="none" stroke="#22d3ee" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.75}/>

          {/* Baseline */}
          <line x1={M.left} y1={M.top + ph} x2={M.left + pw} y2={M.top + ph} stroke="#2a2a2a"/>

          {/* Y labels */}
          {[0.25, 0.5, 0.75, 1].map(f => (
            <text key={f} x={M.left - 6} y={M.top + ph * (1 - f) + 4} textAnchor="end" fill="#555" fontSize={10} fontFamily="monospace">
              {fmtPct(minV + (maxV - minV) * f)}
            </text>
          ))}

          {/* X labels */}
          {[0, Math.floor(data.length / 2), data.length - 1].map(i => (
            <text key={i} x={xOf(i)} y={M.top + ph + 18} textAnchor="middle" fill="#555" fontSize={10} fontFamily="monospace">
              {new Date(data[i].timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ))}

          {/* Hover vertical */}
          {hovered !== null && (
            <line x1={xOf(hovered)} y1={M.top} x2={xOf(hovered)} y2={M.top + ph}
              stroke="#333" strokeWidth={1}/>
          )}

          {/* Invisible hover targets */}
          {data.map((_, i) => (
            <rect key={i} x={M.left + (i / data.length) * pw} y={M.top}
              width={pw / data.length} height={ph}
              fill="transparent" onMouseEnter={() => setHovered(i)}/>
          ))}
        </svg>
      )}

      {/* Tooltip */}
      {hovData && (
        <div className="absolute pointer-events-none top-2 right-2 bg-[#0a0a0a] border border-[#2a2a2a] px-3 py-2 text-right">
          {hovData.markPrice && (
            <div className="font-mono text-[11px]" style={{ color: '#ec4899' }}>
              Mark {fmtPct(hovData.markPrice)}
            </div>
          )}
          {hovData.indexPrice && (
            <div className="font-mono text-[11px]" style={{ color: '#22d3ee' }}>
              Index {fmtPct(hovData.indexPrice)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Volume Bar Chart ─────────────────────────────────────────────
function VolumeChart({ data }) {
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
      <span className="font-mono text-[10px] text-[#333] tracking-[0.2em] uppercase">No volume data</span>
    </div>
  )

  const M = { top: 18, right: 10, bottom: 28, left: 68 }
  const pw = dims.w - M.left - M.right
  const ph = dims.h - M.top - M.bottom
  const maxV = Math.max(...data.map(d => d.volumeUsd || 0), 1)
  const bw = Math.max(2, pw / data.length - 1.5)
  const fmtUSD = v => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`

  return (
    <div ref={ref} className="w-full h-full relative font-mono" onMouseLeave={() => setHovered(null)}>
      {dims.w > 0 && ph > 0 && (
        <svg width={dims.w} height={dims.h}>
          {[0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1={M.left} y1={M.top + ph * (1 - f)} x2={M.left + pw} y2={M.top + ph * (1 - f)}
              stroke="#1c1c1c" strokeDasharray="3 3"/>
          ))}
          {data.map((d, i) => {
            const barH = ((d.volumeUsd || 0) / maxV) * ph * 0.9
            const x = M.left + (i / data.length) * pw
            const y = M.top + ph - barH
            const isHov = hovered === i
            return <rect key={i} x={x} y={y} width={bw} height={barH}
              fill={isHov ? '#4ade80' : '#22c55e'} opacity={isHov ? 0.9 : 0.6}
              onMouseEnter={() => setHovered(i)}/>
          })}
          <line x1={M.left} y1={M.top + ph} x2={M.left + pw} y2={M.top + ph} stroke="#2a2a2a"/>
          {[0.5, 1].map(f => (
            <text key={f} x={M.left - 6} y={M.top + ph * (1 - f) + 4} textAnchor="end" fill="#555" fontSize={10} fontFamily="monospace">
              {fmtUSD(maxV * f)}
            </text>
          ))}
          {[0, Math.floor(data.length / 2), data.length - 1].map(i => (
            <text key={i} x={M.left + (i / data.length) * pw + bw / 2} y={M.top + ph + 18}
              textAnchor="middle" fill="#555" fontSize={10} fontFamily="monospace">
              {new Date((data[i].timestamp || 0) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ))}
        </svg>
      )}
      {hovered !== null && data[hovered] && (
        <div className="absolute pointer-events-none top-2 right-2 bg-[#0a0a0a] border border-[#22c55e30] px-3 py-1.5">
          <div className="font-mono text-[12px] text-[#4ade80]">{fmtUSD(data[hovered].volumeUsd || 0)}</div>
          <div className="font-mono text-[9px] text-[#555] tracking-widest">
            {new Date((data[hovered].timestamp || 0) * 1000).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  )
}

// ── LP Panel ─────────────────────────────────────────────────────
function LPPanel({ poolData }) {
  const [tab, setTab] = useState('ADD')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [amt0, setAmt0] = useState('')
  const [amt1, setAmt1] = useState('')

  const [bal0, setBal0] = useState(null)
  const [bal1, setBal1] = useState(null)

  const { address } = useWallet()

  // Fetch pool token balances when wallet connected
  useEffect(() => {
    if (!address || !poolData) { setBal0(null); setBal1(null); return }
    const RPC = 'https://rld.fi/rpc'
    const call = async (token) => {
      try {
        const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0')
        const res = await fetch(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: token, data }, 'latest'], id: 1 }),
        })
        const json = await res.json()
        return json.result ? Number(BigInt(json.result)) / 1e18 : 0
      } catch { return 0 }
    }
    // wRLPwaUSDC token0 and waUSDC token1 — use marketInfo addresses if available
    const t0addr = poolData?.token0?.address
    const t1addr = poolData?.token1?.address
    if (t0addr) call(t0addr).then(setBal0)
    if (t1addr) call(t1addr).then(setBal1)
  }, [address, poolData?.token0?.address, poolData?.token1?.address])

  useEffect(() => {
    if (!poolData?.currentPrice) return
    const cp = poolData.currentPrice
    setMin((cp * 0.8).toFixed(4))
    setMax((cp * 1.2).toFixed(4))
  }, [poolData?.currentPrice])

  const computePaired = (val, src) => {
    const pMin = parseFloat(min), pMax = parseFloat(max), cp = poolData?.currentPrice
    if (!pMin || !pMax || !cp || pMin >= pMax || !val) return ''
    const sqrtL = Math.sqrt(pMin), sqrtU = Math.sqrt(pMax), sqrtC = Math.sqrt(cp)
    const amt = parseFloat(val)
    if (!amt || amt <= 0) return ''
    if (cp <= pMin) return src === 'amt0' ? '0' : ''
    if (cp >= pMax) return src === 'amt1' ? '0' : ''
    if (src === 'amt0') {
      const d = 1 / sqrtC - 1 / sqrtU; if (d <= 0) return ''
      return ((amt / d) * (sqrtC - sqrtL)).toFixed(6)
    } else {
      const d = sqrtC - sqrtL; if (d <= 0) return ''
      return ((amt / d) * (1 / sqrtC - 1 / sqrtU)).toFixed(6)
    }
  }

  const t0sym = poolData?.token0?.symbol || 'wRLP'
  const t1sym = poolData?.token1?.symbol || 'waUSDC'

  return (
    <div className="border border-[#1e1e1e] bg-[#0b0b0b] flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-[#1e1e1e]">
        {['ADD', 'REMOVE'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-3.5 font-mono text-[11px] tracking-[0.2em] uppercase transition-colors duration-200 relative"
            style={{ color: tab === t ? '#fff' : '#444' }}>
            {t}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#22d3ee]"/>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-6 p-5 flex-1">
        {tab === 'ADD' ? (
          <>
            {/* Price range */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#999]">Price Range</span>
                <button
                  onClick={() => {
                    if (!poolData?.currentPrice) return
                    setMin('0.0001')
                    setMax('999999')
                  }}
                  className="font-mono text-[10px] tracking-[0.18em] uppercase transition-colors hover:opacity-80"
                  style={{ color: '#22d3ee' }}
                >
                  Full Range
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[{ label: 'Min', val: min, set: setMin }, { label: 'Max', val: max, set: setMax }].map(({ label, val, set }) => (
                  <div key={label} className="flex flex-col gap-1.5">
                    <span className="font-mono text-[9px] text-[#444] tracking-widest">{label}</span>
                    <input type="number" value={val} onChange={e => set(e.target.value)} placeholder="0.0000"
                      className="w-full bg-[#111] border border-[#222] px-3 py-2.5
                                 font-mono text-[13px] text-[#e4e4e4] placeholder-[#2a2a2a]
                                 focus:outline-none focus:border-[#22d3ee40] transition-colors"/>
                  </div>
                ))}
              </div>
            </div>

            {/* Token amounts with balances */}
            <div className="flex flex-col gap-3">
              {[
                { sym: t0sym, val: amt0, bal: bal0, onChange: v => { setAmt0(v); setAmt1(computePaired(v, 'amt0')) } },
                { sym: t1sym, val: amt1, bal: bal1, onChange: v => { setAmt1(v); setAmt0(computePaired(v, 'amt1')) } },
              ].map(({ sym, val, bal, onChange }) => (
                <div key={sym} className="flex flex-col border border-[#222] focus-within:border-[#22d3ee30] transition-colors">
                  {/* Token header row */}
                  <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                    <span className="font-mono text-[11px] tracking-[0.18em] uppercase" style={{ color: '#22d3ee' }}>{sym}</span>
                    <span className="font-mono text-[11px] tracking-widest text-[#555]">
                      Balance: <span className="text-[#888]">{bal != null ? bal.toFixed(4) : '0'}</span>
                    </span>
                  </div>
                  {/* Input row */}
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <input type="number" value={val} onChange={e => onChange(e.target.value)} placeholder="0.00"
                      className="flex-1 bg-transparent font-mono text-[15px] text-[#ccc] placeholder-[#2a2a2a] focus:outline-none"/>
                    <span className="font-mono text-[10px] tracking-widest shrink-0 text-[#555]">{sym}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="border-t border-[#1e1e1e] pt-4 flex flex-col gap-2.5">
              {[
                ['Fee Tier',      poolData?.feeTier ?? '—'],
                ['Current Price', poolData?.currentPrice != null ? poolData.currentPrice.toFixed(2) : '—'],
              ].map(([l, v]) => (
                <div key={l} className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#444]">{l}</span>
                  <span className="font-mono text-[13px] text-[#aaa]">{v}</span>
                </div>
              ))}
            </div>

            {address ? (
              <button className="mt-auto w-full py-3.5 transition-all duration-200 group
                                 font-mono text-[11px] tracking-[0.2em] uppercase
                                 border border-[#222] hover:border-[#22d3ee40] bg-[#0f0f0f] hover:bg-[#0d1f1f]
                                 text-[#666] hover:text-[#22d3ee]">
                Add Liquidity
              </button>
            ) : (
              <button className="mt-auto w-full py-3.5 bg-[#0f0f0f] hover:bg-[#161616] transition-colors
                                 font-mono text-[10px] tracking-[0.2em] uppercase text-[#444]
                                 border border-[#222] hover:border-[#333] cursor-not-allowed">
                Connect Wallet to Add Liquidity
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">Your Positions</span>
              <div className="border border-[#1e1e1e] py-10 flex flex-col items-center justify-center gap-3">
                <span className="font-mono text-[11px] text-[#333] tracking-[0.2em] uppercase">No LP Positions</span>
                <span className="font-mono text-[10px] text-[#2a2a2a] text-center max-w-[200px]">
                  You don't have any active positions yet.
                </span>
              </div>
            </div>
            <button className="mt-auto w-full py-3.5 bg-[#0f0f0f] hover:bg-[#161616] transition-colors
                               font-mono text-[10px] tracking-[0.2em] uppercase text-[#444]
                               border border-[#222] hover:border-[#333] cursor-not-allowed">
              Connect Wallet to Remove Liquidity
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
//  POOL MARKET PAGE
// ═══════════════════════════════════════════
export default function PoolMarketPage() {
  const { poolId } = useParams()
  const { market, pool, poolTVL, volumeData, volumeHistory, chartData, marketInfo, loading } = useSim()

  // Liquidity distribution
  const [bins, setBins] = useState([])
  useEffect(() => {
    fetch('/api/liquidity-distribution?num_bins=60')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.bins?.length) setBins(d.bins) })
      .catch(() => {})
  }, [])

  // Derive pool data
  const poolData = useMemo(() => {
    if (!pool || !market || !marketInfo) return null
    const t0sym = marketInfo.position_token?.symbol || 'wRLP'
    const t1sym = marketInfo.collateral?.symbol     || 'waUSDC'
    const feeTierRaw = marketInfo.infrastructure?.pool_fee || 500
    const tvl       = poolTVL || 0
    const volume24h = volumeData?.volumeUsd || 0
    const fees24h   = volume24h * (feeTierRaw / 1_000_000)
    const apr       = tvl > 0 ? Math.min((fees24h * 365 / tvl) * 100, 999) : 0
    const hookAddr  = marketInfo.infrastructure?.twamm_hook || ''
    return {
      pair:         `${t0sym} / ${t1sym}`,
      feeTier:      `${(feeTierRaw / 10000).toFixed(2)}%`,
      tickSpacing:  marketInfo.infrastructure?.tick_spacing || 5,
      tvl, volume24h, fees24h, apr,
      currentPrice: pool.markPrice  || 0,
      currentTick:  pool.tick,
      indexPrice:   market.indexPrice || 0,
      hookAddr,
      hookShort: hookAddr ? `${hookAddr.slice(0, 6)}…${hookAddr.slice(-4)}` : '—',
      token0: { symbol: t0sym, name: marketInfo.position_token?.name || 'Wrapped RLP' },
      token1: { symbol: t1sym, name: marketInfo.collateral?.name     || 'Wrapped aUSDC' },
      t0sym, t1sym,
    }
  }, [pool, market, marketInfo, poolTVL, volumeData])

  // Chart controls
  const [chartView, setChartView] = useState('PRICE')
  const [resolution, setResolution] = useState('1H')
  const [timeframe, setTimeframe] = useState('1W')

  const tfHours = { '1D': 24, '1W': 168, '1M': 720 }

  // Use the data's own max timestamp as 'now' — simulation runs on forked chain timestamps
  const filteredChartData = useMemo(() => {
    if (!chartData?.length) return chartData ?? []
    const maxTs = Math.max(...chartData.map(d => d.timestamp))
    const cutoff = maxTs - tfHours[timeframe] * 3600
    const filtered = chartData.filter(d => d.timestamp >= cutoff)
    return filtered.length ? filtered : chartData
  }, [chartData, timeframe])

  const filteredVolumeHistory = useMemo(() => {
    if (!volumeHistory?.length) return volumeHistory ?? []
    const maxTs = Math.max(...volumeHistory.map(d => d.timestamp))
    const cutoff = maxTs - tfHours[timeframe] * 3600
    const filtered = volumeHistory.filter(d => d.timestamp >= cutoff)
    return filtered.length ? filtered : volumeHistory
  }, [volumeHistory, timeframe])

  // Dropdown state for resolution/timeframe
  const [resOpen, setResOpen]  = useState(false)
  const [tfOpen,  setTfOpen]   = useState(false)
  const resRef = useRef(null)
  const tfRef  = useRef(null)
  useEffect(() => {
    const handler = e => {
      if (resRef.current && !resRef.current.contains(e.target)) setResOpen(false)
      if (tfRef.current  && !tfRef.current.contains(e.target))  setTfOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Height sync
  const panelRef = useRef(null)
  const [panelH, setPanelH] = useState(560)
  useEffect(() => {
    const el = panelRef.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setPanelH(e.contentRect.height))
    ro.observe(el); return () => ro.disconnect()
  }, [])

  const VIEWS = ['PRICE', 'LIQUIDITY', 'VOLUME']
  const RESOLUTIONS = ['1H', '4H', '1D']
  const TIMEFRAMES  = ['1D', '1W', '1M']

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }} />

      <Nav activePage="pools" />

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Breadcrumb ── */}
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase">
          <a href="/#/pools" className="text-[#444] hover:text-[#888] transition-colors">Pools</a>
          <span className="text-[#2a2a2a]">/</span>
          <span className="text-[#888]">{poolData?.pair ?? '—'}</span>
        </div>

        {/* ── Page header ── */}
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
            {poolData?.t0sym ?? '···'} / {poolData?.t1sym ?? '···'}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
              Liquidity Pool
            </span>
            <span className="font-mono text-[10px] text-[#333]">·</span>
            <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">Uniswap V4</span>
            {poolData?.hookShort && (
              <>
                <span className="font-mono text-[10px] text-[#333]">·</span>
                <span className="font-mono text-[10px] text-[#333] tracking-widest">{poolData.hookShort}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Metric strip ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          <div className="grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 divide-[#1a1a1a]">
            <MetricCell label="TVL"        value={loading ? <Spinner /> : formatUSD(poolData?.tvl)} />
            <MetricCell label="Volume 24H" value={loading ? <Spinner /> : formatUSD(poolData?.volume24h)} />
            <MetricCell label="Fees 24H"   value={loading ? <Spinner /> : formatUSD(poolData?.fees24h)} />
            <MetricCell label="APR"        value={loading ? <Spinner /> : poolData ? `${poolData.apr.toFixed(2)}%` : '—'} accent />
            <MetricCell label="Fee Tier"   value={loading ? <Spinner /> : poolData?.feeTier ?? '—'} />
          </div>
        </div>

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">

          {/* Left: LP panel */}
          <div ref={panelRef} style={{ height: '575px' }}>
            <LPPanel poolData={poolData} />
          </div>

          {/* Right: chart + positions */}
          <div className="flex flex-col gap-6">
            {/* Chart panel */}
            <div className="border border-[#1a1a1a] bg-[#0b0b0b] flex flex-col"
              style={{ height: `${panelH}px` }}>

              {/* Chart header */}
              <div className="px-4 py-2.5 border-b border-[#1a1a1a] flex items-center justify-between gap-4 flex-wrap">
                {/* Tabs */}
                <div className="flex items-center">
                  {VIEWS.map(v => (
                    <button key={v} onClick={() => setChartView(v)}
                      className="px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors duration-200 relative"
                      style={{ color: chartView === v ? '#fff' : '#444' }}>
                      {v}
                      {chartView === v && (
                        <span className="absolute bottom-0 left-0 right-0 h-[1px]"
                          style={{ backgroundColor: v === 'VOLUME' ? '#22c55e' : '#22d3ee' }}/>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3 ml-auto">
                  {/* Resolution + timeframe dropdowns (not for LIQUIDITY) */}
                  {chartView !== 'LIQUIDITY' && (
                    <>
                      {/* Resolution dropdown */}
                      <div ref={resRef} className="relative">
                        <button onClick={() => { setResOpen(o => !o); setTfOpen(false) }}
                          className="flex items-center gap-2 px-3 py-1.5 border border-[#222] bg-[#111]
                                     font-mono text-[11px] tracking-[0.15em] uppercase text-[#aaa] hover:text-white
                                     transition-colors">
                          Resolution: <span className="text-[#22d3ee]">{resolution}</span>
                          <span className="text-[#444] text-[9px]">{resOpen ? '▲' : '▼'}</span>
                        </button>
                        {resOpen && (
                          <div className="absolute top-full left-0 mt-1 border border-[#222] bg-[#0e0e0e] z-20 min-w-full">
                            {RESOLUTIONS.map(r => (
                              <button key={r} onClick={() => { setResolution(r); setResOpen(false) }}
                                className="w-full px-3 py-2 font-mono text-[11px] tracking-[0.15em] uppercase text-left
                                           transition-colors hover:bg-[#141414]"
                                style={{ color: resolution === r ? '#22d3ee' : '#666' }}>
                                {r}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Timeframe dropdown */}
                      <div ref={tfRef} className="relative">
                        <button onClick={() => { setTfOpen(o => !o); setResOpen(false) }}
                          className="flex items-center gap-2 px-3 py-1.5 border border-[#222] bg-[#111]
                                     font-mono text-[11px] tracking-[0.15em] uppercase text-[#aaa] hover:text-white
                                     transition-colors">
                          Timeframe: <span className="text-[#22d3ee]">{timeframe}</span>
                          <span className="text-[#444] text-[9px]">{tfOpen ? '▲' : '▼'}</span>
                        </button>
                        {tfOpen && (
                          <div className="absolute top-full left-0 mt-1 border border-[#222] bg-[#0e0e0e] z-20 min-w-full">
                            {TIMEFRAMES.map(tf => (
                              <button key={tf} onClick={() => { setTimeframe(tf); setTfOpen(false) }}
                                className="w-full px-3 py-2 font-mono text-[11px] tracking-[0.15em] uppercase text-left
                                           transition-colors hover:bg-[#141414]"
                                style={{ color: timeframe === tf ? '#22d3ee' : '#666' }}>
                                {tf}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Context legend */}
                  {chartView === 'PRICE' && (
                    <div className="flex items-center gap-3 font-mono text-[9px] tracking-[0.18em]">
                      <span className="flex items-center gap-1.5 text-[#ec4899]">
                        <span className="w-3 h-px bg-[#ec4899] inline-block"/> Mark
                      </span>
                      <span className="flex items-center gap-1.5 text-[#22d3ee]">
                        <span className="w-3 h-px border-t border-dashed border-[#22d3ee] inline-block"/> Index
                      </span>
                    </div>
                  )}
                  {chartView === 'LIQUIDITY' && (
                    <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.18em]">
                      <span className="flex items-center gap-1.5 text-[#ec4899]">
                        <span className="w-3 h-px bg-[#ec4899] inline-block"/> Below
                      </span>
                      <span className="flex items-center gap-1.5 text-[#22d3ee]">
                        <span className="w-3 h-px bg-[#22d3ee] inline-block"/> Above
                      </span>
                    </div>
                  )}
                  {chartView === 'VOLUME' && (
                    <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-[#22c55e]">
                      <span className="w-3 h-2 bg-[#22c55e] opacity-60 inline-block"/> Volume
                    </div>
                  )}
                </div>
              </div>

              {/* Chart body */}
              <div className="flex-1 p-4">
                {chartView === 'PRICE'     && <PriceChart  data={filteredChartData} />}
                {chartView === 'LIQUIDITY' && <DepthChart  bins={bins} currentPrice={poolData?.currentPrice} />}
                {chartView === 'VOLUME'    && <VolumeChart data={filteredVolumeHistory} />}
              </div>
            </div>

            {/* Your positions */}
            <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
              <div className="px-5 py-3.5 border-b border-[#1a1a1a] flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#888]">
                  Your Positions
                </span>
                <span className="font-mono text-[9px] tracking-widest text-[#333] uppercase">↗ None</span>
              </div>
              <div className="px-5 py-12 flex flex-col items-center justify-center gap-2">
                <span className="font-mono text-[11px] text-[#333] tracking-[0.2em] uppercase">No LP Positions</span>
                <span className="font-mono text-[10px] text-[#2a2a2a] text-center max-w-xs">
                  You don't have any active positions yet. Use the panel above to add liquidity.
                </span>
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
