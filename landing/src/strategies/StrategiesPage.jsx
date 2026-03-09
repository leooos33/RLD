import { Link } from 'react-router-dom'
import Nav from '../Nav'

// ── Grain ────────────────────────────────────────────────────────
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`

// ── Strategy data (from old Vaults.jsx) ─────────────────────────
const STRATEGIES = [
  {
    id: '001', slug: 'fixed-yield', route: '/bonds',
    name: 'Fixed Yield',
    headline: 'Lock in a guaranteed rate',
    description: 'Synthetic bonds — earn a predictable, fixed return on your USDC.',
    apy: 8.4, tvl: 12_500_000, asset: 'USDC', protocol: 'AAVE V3',
    risk: 'LOW', status: 'ACTIVE', linked: true,
    features: ['Fixed rate', 'No liquidation risk', 'Auto-compounding'],
  },
  {
    id: '002', slug: 'delta-neutral',
    name: 'Delta Neutral',
    headline: 'Capitalize on market volatility',
    description: 'Cointegration: wstETH + short interest rate to capture funding rate spreads.',
    apy: 14.2, tvl: 8_200_000, asset: 'USDC', protocol: 'Morpho',
    risk: 'MEDIUM', status: 'SOON', linked: false,
    features: ['Market neutral', 'Funding arbitrage', 'Auto-rebalancing'],
  },
  {
    id: '003', slug: 'basis-trade', route: '/strategies/basis-trade',
    name: 'Basis Trade',
    headline: 'Leveraged carry trade',
    description: 'High-yield carry strategy using sUSDe collateral with built-in rate hedging.',
    apy: 22.1, tvl: 3_100_000, asset: 'sUSDe', protocol: 'AAVE V3',
    risk: 'HIGH', status: 'ACTIVE', linked: true,
    features: ['High yield', 'Rate hedged', 'sUSDe native'],
  },
  {
    id: '004', slug: 'rate-arbitrage',
    name: 'Rate Arbitrage',
    headline: 'Earn delta-neutral yield from rate arbitrage',
    description: 'Automatically captures yield spreads between lending protocols when rates diverge.',
    apy: 18.7, tvl: 4_800_000, asset: 'USDC', protocol: 'Multi',
    risk: 'HIGH', status: 'SOON', linked: false,
    features: ['Cross-protocol', 'Automated execution', 'Spread capture'],
  },
  {
    id: '005', slug: 'cds-vault',
    name: 'CDS Vault',
    headline: 'Insure against pool failures',
    description: 'Earn premiums by providing solvency insurance.',
    apy: 6.8, tvl: 1_900_000, asset: 'USDC', protocol: 'Euler',
    risk: 'MEDIUM', status: 'SOON', linked: false,
    features: ['Asymmetric upside', 'Low premium', 'Parametric payout'],
  },
]

// ── Risk accent system ───────────────────────────────────────────
const RISK = {
  LOW:    { apyColor: '#4ade80', headerColor: '#4ade80', headerBg: '#0a1a0f', label: 'Conservative', sub: 'Lower risk · Stable returns' },
  MEDIUM: { apyColor: '#22d3ee', headerColor: '#22d3ee', headerBg: '#06141a', label: 'Balanced',     sub: 'Moderate risk · Higher yield' },
  HIGH:   { apyColor: '#f472b6', headerColor: '#f472b6', headerBg: '#1a0610', label: 'Aggressive',   sub: 'Higher risk · Maximum yield' },
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtTVL(v) {
  if (v >= 1e9) return `$${(v/1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`
  return `$${v}`
}

const ASSET_LOGOS = {
  USDC:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  sUSDe: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x9D39A5DE30e57443BfF2A8307A4256c8797A3497/logo.png',
}

// ── Stat cell ─────────────────────────────────────────────────────
function StatCell({ label, value, sub, accent = false }) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5 border-r border-[#1a1a1a] last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">{label}</span>
      <span className="font-mono text-[20px] leading-none" style={{ color: accent ? '#22d3ee' : '#e4e4e4' }}>
        {value}
      </span>
      {sub && <span className="font-mono text-[10px] text-[#444]">{sub}</span>}
    </div>
  )
}

// ── Strategy Card ─────────────────────────────────────────────────
function StratCard({ s }) {
  const r = RISK[s.risk]
  const isActive = s.status === 'ACTIVE'

  const cardContent = (
    <div
      className="relative border border-[#1a1a1a] bg-[#0b0b0b] flex flex-col h-full group transition-colors duration-200"
      style={isActive ? undefined : { opacity: 0.65 }}
    >
      {/* Coming soon tooltip */}
      {!isActive && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100
                        transition-opacity pointer-events-none z-20 whitespace-nowrap
                        font-mono text-[9px] tracking-[0.2em] uppercase px-3 py-1.5
                        border border-[#2a2a2a] bg-[#0b0b0b] text-[#555]">
          Coming Soon
        </div>
      )}

      {/* APY hero */}
      <div className="px-5 pt-5 pb-4 border-b border-[#1a1a1a]"
        style={{ background: isActive ? r.headerBg : '#0c0c0c' }}>
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-bold text-[13px] tracking-[0.1em] uppercase text-white">{s.name}</span>
          </div>
          <img src={ASSET_LOGOS[s.asset] || ASSET_LOGOS.USDC} alt={s.asset}
            className="w-8 h-8 rounded-full object-contain opacity-70"
          />
        </div>
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#444]">Projected APY</span>
            <span className="font-mono text-[24px] leading-none font-light"
              style={{ color: isActive ? r.apyColor : '#333' }}>
              {isActive ? `${s.apy.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#444]">TVL</span>
            <span className="font-mono text-[16px] leading-none text-[#ccc]"
              style={{ color: isActive ? '#e4e4e4' : '#333' }}>
              {isActive ? fmtTVL(s.tvl) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4 flex-1 flex flex-col gap-3">
        <div>
          <p className="font-mono font-bold text-[13px] text-white mb-1">{s.headline}</p>
          <p className="font-mono text-[11px] text-[#555] leading-relaxed">{s.description}</p>
        </div>

        {/* Feature tags */}
        <div className="flex flex-wrap gap-1.5">
          {s.features.map(f => (
            <span key={f}
              className="font-mono text-[9px] tracking-[0.18em] uppercase px-2 py-0.5
                         border border-[#1a1a1a] text-[#444]">
              {f}
            </span>
          ))}
        </div>

        {/* Footer row */}
        <div className="mt-auto flex items-center justify-between border-[#131313]">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 ${isActive ? 'animate-pulse' : ''}`}
              style={{ background: isActive ? r.apyColor : '#2a2a2a' }}/>
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase"
              style={{ color: isActive ? r.apyColor : '#333' }}>
              {isActive ? 'Live' : 'Coming Soon'}
            </span>
          </div>
          {isActive ? (
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#555]
                             group-hover:text-[#ccc] transition-colors flex items-center gap-1">
              View Strategy
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          ) : (
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#2a2a2a]">
              Explore Trade
            </span>
          )}
        </div>
      </div>

      {/* Risk label strip */}
      <div className="px-5 py-2 border-t border-[#131313] bg-[#090909] flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-[#444]">
          {s.asset} Deposit
        </span>
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase"
          style={{ color: isActive ? r.apyColor : '#2a2a2a' }}>
          {s.risk} RISK
        </span>
      </div>
    </div>
  )

  if (s.linked && isActive) {
    return (
      <Link to={s.route || `/strategies/${s.slug}`}
        className="block h-full transition-all">
        {cardContent}
      </Link>
    )
  }
  return <div className={`h-full ${isActive ? 'cursor-pointer' : 'cursor-not-allowed'}`}>{cardContent}</div>
}

// ═══════════════════════════════════════════
//  STRATEGIES PAGE
// ═══════════════════════════════════════════
export default function StrategiesPage() {
  const totalTVL   = STRATEGIES.reduce((s, v) => s + v.tvl, 0)
  const avgAPY     = STRATEGIES.reduce((s, v) => s + v.apy, 0) / STRATEGIES.length
  const activeCount= STRATEGIES.filter(v => v.status === 'ACTIVE').length

  const columns = [
    { risk: 'LOW',    ...RISK.LOW    },
    { risk: 'MEDIUM', ...RISK.MEDIUM },
    { risk: 'HIGH',   ...RISK.HIGH   },
  ]

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ backgroundImage: GRAIN_SVG, backgroundSize: '192px 192px' }}/>
      <Nav activePage="strategies"/>

      <main className="relative z-10 flex-1 max-w-[1400px] mx-auto w-full px-6 md:px-14 py-10 flex flex-col gap-8">

        {/* ── Header ── */}
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-bold tracking-tight text-white" style={{ fontSize: '28px', lineHeight: 1 }}>
            Strategies
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[12px] tracking-[0.22em] uppercase" style={{ color: '#22d3ee' }}>
              {STRATEGIES.length} Vault Strategies · RLD Protocol
            </span>
          </div>
        </div>

        {/* ── Stats strip ── */}
        <div className="border border-[#1a1a1a] bg-[#0b0b0b]">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 divide-[#1a1a1a]">
            <StatCell label="Total TVL"     value={fmtTVL(totalTVL)} sub="Across all vaults"/>
            <StatCell label="Avg APY"       value={`${avgAPY.toFixed(1)}%`} sub="Projected" accent/>
            <StatCell label="Active Vaults" value={`${activeCount} / ${STRATEGIES.length}`} sub="Live strategies"/>
          </div>
        </div>

        {/* ── Flat CSS grid: headers row 1, cards rows 2-3, equal height per row ── */}
        {(() => {
          // Column definitions
          const COLS = [
            { risk: 'LOW',    col: 1, ...RISK.LOW    },
            { risk: 'MEDIUM', col: 2, ...RISK.MEDIUM },
            { risk: 'HIGH',   col: 3, ...RISK.HIGH   },
          ]
          // Assign each strategy to its column
          const withCol = STRATEGIES.map(s => ({
            ...s,
            gridCol: COLS.find(c => c.risk === s.risk)?.col ?? 1,
          }))
          // Assign row within its column (2nd card gets row 3, 1st gets row 2)
          const rowCounters = { 1: 2, 2: 2, 3: 2 }
          const withPos = withCol.map(s => {
            const row = rowCounters[s.gridCol]
            rowCounters[s.gridCol]++
            return { ...s, gridRow: row }
          })

          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-[auto_1fr_1fr] gap-4">
              {/* Row 1: column headers */}
              {COLS.map(col => {
                const items = STRATEGIES.filter(s => s.risk === col.risk)
                return (
                  <div key={col.risk}
                    className="px-4 py-2.5 border border-[#1a1a1a] flex items-center gap-3"
                    style={{ background: col.headerBg }}>
                    <div className="w-2 h-2 shrink-0" style={{ background: col.headerColor }}/>
                    <span className="font-mono text-[11px] font-bold tracking-[0.18em] uppercase"
                      style={{ color: col.headerColor }}>{col.label}</span>
                    <span className="ml-auto font-mono text-[11px] text-[#444] tracking-[0.12em] uppercase">{col.sub}</span>
                  </div>
                )
              })}

              {/* Rows 2-3: cards, explicitly placed so same-row cards share height */}
              {withPos.map(s => (
                <div key={s.id}
                  style={{ gridColumn: s.gridCol, gridRow: s.gridRow }}>
                  <StratCard s={s}/>
                </div>
              ))}
            </div>
          )
        })()}

      </main>
    </div>
  )
}
