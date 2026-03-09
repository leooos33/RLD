import { useRef, useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Nav from '../Nav'
import { useSim } from '../context/SimulationContext'
import { useTradeLogic } from '../hooks/useTradeLogic'
import { formatUSD, formatPct } from '../utils/helpers'
import { OrderPanel } from './OrderPanel'
import { YourBondsTable } from './YourBondsTable'
import { PerformanceChart } from './PerformanceChart'

const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

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

function Spinner() {
  return (
    <svg className="animate-spin text-[#444]" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
    </svg>
  )
}

export default function BondMarketPage() {
  const { marketId } = useParams()
  const { market, poolTVL, protocolStats, marketInfo, loading } = useSim()

  // Hoist trade state here so chart and order panel stay in sync
  const tradeLogic = useTradeLogic()

  // Mirror order-panel height → chart
  const panelRef   = useRef(null)
  const [panelHeight, setPanelHeight] = useState(500)
  useEffect(() => {
    if (!panelRef.current) return
    const obs = new ResizeObserver(entries => {
      setPanelHeight(entries[0].contentRect.height)
    })
    obs.observe(panelRef.current)
    return () => obs.disconnect()
  }, [])

  const totalOI  = (protocolStats?.totalCollateral || 0) + (protocolStats?.totalDebtUsd || 0)
  const apy      = market?.indexPrice ?? null

  const colSymbol = marketInfo?.collateral?.symbol || marketId || 'waUSDC'
  const colName   = marketInfo?.collateral?.name   || 'Wrapped Aave USDC'

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      {/* grain */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }} />

      <Nav activePage="bonds" />

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Breadcrumb ── */}
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
          <a href="/#/bonds" className="text-[#444] hover:text-[#888] transition-colors duration-200">
            Bond Repository
          </a>
          <span className="text-[#2a2a2a]">/</span>
          <span className="text-[#888]">{colSymbol}</span>
        </div>

        {/* ── Market header ── */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
              {colSymbol}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
                Fixed Yield Bond
              </span>
              <span className="font-mono text-[10px] text-[#333]">·</span>
              <span className="font-mono text-[10px] tracking-widest text-[#444] uppercase">{colName}</span>
            </div>
          </div>

          {/* Metric strip */}
          <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
            <div className="grid grid-cols-2 lg:grid-cols-3 divide-y lg:divide-y-0 divide-[#1a1a1a]">
              <MetricCell
                label="Current APY"
                value={loading ? <Spinner /> : apy !== null ? formatPct(apy) : null}
                accent
              />
              <MetricCell
                label="Open Interest"
                value={loading ? <Spinner /> : formatUSD(totalOI)}
              />
              <MetricCell
                label="Pool Liquidity"
                value={loading ? <Spinner /> : formatUSD(poolTVL || 0)}
              />
            </div>
          </div>
        </div>

        {/* ── Main grid: terminal (left) | chart + positions (right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">

          {/* Left: order panel — fixed height matches chart */}
          <div ref={panelRef} style={{ height: '575px' }}>
            <OrderPanel
              market={market}
              marketInfo={marketInfo}
              apy={apy}
              tradeLogic={tradeLogic}
            />
          </div>

          {/* Right: chart stacked above your bonds */}
          <div className="flex flex-col gap-6">
            {/* Chart — height mirrors the terminal panel */}
            <div style={{ height: panelHeight }}>
              <PerformanceChart
                notional={tradeLogic.notional}
                apy={apy || 0}
                maturityDays={tradeLogic.maturityDays}
              />
            </div>

            <YourBondsTable apy={apy} marketInfo={marketInfo} />
          </div>
        </div>

      </main>
    </div>
  )
}
