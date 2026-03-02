import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Shield,
  TrendingUp,
  Layers,
  Zap,
  Lock,
  Activity,
  ChevronRight,
  GitBranch,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────
 * OPTION B — Interactive Documentation
 *
 * Compact hero + scrollable dense sections with interactive diagrams.
 * Hyperliquid / Ethena-style. Dense, rewards scrolling.
 * ──────────────────────────────────────────────────────────────────── */

/* ── Reusable Sub-Components ───────────────────────────────────── */

const SectionLabel = ({
  index,
  label,
  accent = "text-cyan-400",
  dot = "bg-cyan-400",
}) => (
  <div className="flex items-center gap-3 mb-4">
    <div className={`w-2 h-2 ${dot}`} />
    <span
      className={`text-[10px] font-bold tracking-[0.4em] uppercase ${accent}`}
    >
      {label}
    </span>
    <span className="text-[10px] text-gray-700 tracking-[0.15em]">
      [{index}]
    </span>
  </div>
);

const InfoCard = ({
  title,
  value,
  sub,
  accent = "text-cyan-400",
  border = "border-white/10",
}) => (
  <div className={`border ${border} bg-[#080808] p-4 space-y-1`}>
    <div className="text-[9px] text-gray-600 uppercase tracking-widest">
      {title}
    </div>
    <div className={`text-lg font-mono font-light tracking-tight ${accent}`}>
      {value}
    </div>
    {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
  </div>
);

const FlowStep = ({
  num,
  title,
  desc,
  accent = "text-cyan-400",
  last = false,
}) => (
  <div className="flex gap-3">
    <div className="flex flex-col items-center">
      <div
        className={`w-6 h-6 border ${accent === "text-cyan-400" ? "border-cyan-500/40" : accent === "text-pink-400" ? "border-pink-500/40" : accent === "text-yellow-400" ? "border-yellow-500/40" : "border-green-500/40"} flex items-center justify-center text-[9px] font-bold ${accent}`}
      >
        {num}
      </div>
      {!last && <div className="w-px h-full bg-white/10 min-h-[20px]" />}
    </div>
    <div className="pb-4">
      <div className="text-[11px] text-white font-bold uppercase tracking-[0.15em]">
        {title}
      </div>
      <div className="text-[10px] text-gray-500 mt-1 leading-relaxed">
        {desc}
      </div>
    </div>
  </div>
);

const ComparisonRow = ({ label, traditional, rld }) => (
  <div className="grid grid-cols-3 gap-3 py-2 border-b border-white/5 last:border-0">
    <div className="text-[10px] text-gray-500 uppercase tracking-widest">
      {label}
    </div>
    <div className="text-[10px] text-red-400/60 line-through">
      {traditional}
    </div>
    <div className="text-[10px] text-cyan-400 font-bold">{rld}</div>
  </div>
);

/* ── Broker Account Preview ────────────────────────────────────── */
const BrokerPreview = () => {
  const [activeTab, setActiveTab] = React.useState("overview");

  return (
    <div className="border border-white/10 bg-[#080808]">
      <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-white" />
          Broker_Account
        </span>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
          <span className="text-[9px] text-gray-700 tracking-[0.15em]">
            ::LIVE
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5">
        {["overview", "positions", "collateral"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-[9px] font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab
                ? "text-cyan-400 bg-cyan-500/5 border-b-2 border-cyan-500"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-2">
        {activeTab === "overview" && (
          <>
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Net Account Value
                </div>
                <div className="text-xl text-white font-mono font-light">
                  $147,230
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Health
                </div>
                <div className="text-xl text-green-400 font-mono font-light">
                  6.09
                </div>
              </div>
            </div>
            <div className="h-1.5 w-full bg-white/5 mt-3">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-green-500"
                style={{ width: "85%" }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-gray-600">
              <span>Collateral: $125,000</span>
              <span>Debt: $24,180</span>
            </div>
          </>
        )}
        {activeTab === "positions" && (
          <div className="space-y-2">
            {[
              {
                type: "wRLP Long",
                size: "12,400",
                pnl: "+$2,480",
                color: "text-cyan-400",
              },
              {
                type: "V4 LP",
                size: "$8,200",
                pnl: "+$340",
                color: "text-green-400",
              },
              {
                type: "TWAMM Sell",
                size: "$1,630",
                pnl: "Streaming",
                color: "text-yellow-400",
              },
            ].map((p) => (
              <div
                key={p.type}
                className="flex items-center justify-between py-1.5 border-b border-white/5"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-1 h-1 ${p.color.replace("text-", "bg-")}`}
                  />
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                    {p.type}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono text-gray-400">
                    {p.size}
                  </span>
                  <span className={`text-[10px] font-mono ${p.color}`}>
                    {p.pnl}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTab === "collateral" && (
          <div className="space-y-2">
            <div className="text-[10px] text-gray-500 leading-relaxed">
              All asset types count toward cross-margin NAV:
            </div>
            {[
              "waUSDC deposits",
              "wRLP token balance",
              "Uniswap V4 LP NFTs",
              "Active TWAMM orders",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 py-1">
                <div className="w-1 h-1 bg-cyan-400/60" />
                <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                  {item}
                </span>
              </div>
            ))}
            <div className="border border-dashed border-green-500/20 p-2 mt-2">
              <span className="text-[9px] text-green-400 uppercase tracking-widest">
                = Maximum Capital Efficiency
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function LandingInteractive() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    setTimeout(() => setVisible(true), 100);
  }, []);

  const fade = (i) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 80}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 80}ms`,
  });

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-mono">
      {/* ── HERO ──────────────────────────────────── */}
      <section className="border-b border-white/10 relative overflow-hidden">
        <div className="absolute inset-0 pattern-grid opacity-5 pointer-events-none" />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-24 text-center">
          <div
            className="flex items-center justify-center gap-3 text-gray-600 text-[10px] font-bold tracking-[0.4em] uppercase mb-6"
            style={fade(0)}
          >
            <div className="w-2 h-2 bg-white" /> RLD Protocol
          </div>
          <h1
            className="text-4xl md:text-6xl font-bold tracking-tighter leading-[0.95] text-white uppercase mb-4"
            style={fade(1)}
          >
            Rate Derivatives
            <br />
            for DeFi Natives
          </h1>
          <p
            className="text-sm text-gray-500 max-w-xl mx-auto mb-8"
            style={fade(2)}
          >
            CDP perps on borrowing rates. Synthetic bonds via TWAMM. Parametric
            CDS. Everything in one Uni V4 pool.
          </p>
          <div className="flex justify-center gap-4" style={fade(3)}>
            <Link
              to="/bonds"
              className="border border-white/80 text-white px-8 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-white hover:text-black transition-all flex items-center gap-2"
            >
              Launch App <ArrowRight size={14} />
            </Link>
            <a
              href="https://docs.rld.finance"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-white/20 text-gray-400 px-8 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:border-white/50 hover:text-white transition-all"
            >
              Read Docs
            </a>
          </div>

          {/* Three pillars summary */}
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 mt-12 mx-auto max-w-3xl"
            style={fade(4)}
          >
            {[
              {
                title: "Synthetic Bonds",
                desc: "Fix yield or borrowing cost, any duration",
                accent: "text-yellow-400",
              },
              {
                title: "Rate Trading",
                desc: "Long/short the cost of leverage",
                accent: "text-cyan-400",
              },
              {
                title: "Solvency Insurance",
                desc: "Parametric CDS, 6–10× payout",
                accent: "text-pink-400",
              },
            ].map((p) => (
              <div key={p.title} className="bg-[#080808] p-5 text-center">
                <div
                  className={`text-[10px] font-bold uppercase tracking-[0.2em] ${p.accent} mb-1`}
                >
                  {p.title}
                </div>
                <div className="text-[10px] text-gray-500">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 1: SYNTHETIC BONDS ─────────────── */}
      <section className="border-b border-white/10 py-16 px-6 md:px-12">
        <div className="max-w-[1200px] mx-auto">
          <SectionLabel
            index="01"
            label="Synthetic Bonds"
            accent="text-yellow-400"
            dot="bg-yellow-400"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-5">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                One pool. Infinite maturities.
              </h2>
              <p className="text-sm text-gray-400 leading-relaxed border-l-2 border-yellow-500/40 pl-4">
                TWAMM linear unwind converts a perpetual hedge into a synthetic
                bond with programmable expiry — from 1 block to 5 years. No PT
                tokens. No dated vaults. No liquidity fragmentation.
              </p>

              {/* vs Traditional table */}
              <div className="border border-white/10 bg-[#080808] p-4">
                <div className="grid grid-cols-3 gap-3 pb-2 border-b border-white/10 mb-2">
                  <div className="text-[9px] text-gray-600 uppercase tracking-widest"></div>
                  <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                    Traditional
                  </div>
                  <div className="text-[9px] text-cyan-400 uppercase tracking-widest font-bold">
                    RLD
                  </div>
                </div>
                <ComparisonRow
                  label="Liquidity"
                  traditional="Fragmented"
                  rld="1 unified pool"
                />
                <ComparisonRow
                  label="Maturities"
                  traditional="Fixed dates"
                  rld="Any duration"
                />
                <ComparisonRow
                  label="Rollover"
                  traditional="Manual"
                  rld="Automated TWAMM"
                />
                <ComparisonRow
                  label="Slippage"
                  traditional="High"
                  rld="Concentrated LP"
                />
                <ComparisonRow
                  label="Capital Eff"
                  traditional="Low"
                  rld="Cross-margin"
                />
              </div>

              {/* Flow */}
              <div className="space-y-0 mt-4">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest mb-3">
                  Fixed Yield Flow
                </div>
                <FlowStep
                  num="1"
                  title="Deposit aUSDC"
                  desc="Earning floating supply rate"
                  accent="text-yellow-400"
                />
                <FlowStep
                  num="2"
                  title="Mint Short RLP"
                  desc="CDP mints wRLP tokens against collateral"
                  accent="text-yellow-400"
                />
                <FlowStep
                  num="3"
                  title="Sell → Loop"
                  desc="Sell wRLP for USDC, re-supply as collateral"
                  accent="text-yellow-400"
                />
                <FlowStep
                  num="4"
                  title="TWAMM Unwind"
                  desc="Linear decay: Q(t) = Q₀ × (1 − t/T). Hedge matches remaining duration."
                  accent="text-yellow-400"
                  last
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <InfoCard
                  title="Fixed Yield"
                  value="8.40%"
                  sub="Synthetic bond, 1Y maturity"
                  accent="text-yellow-400"
                  border="border-yellow-500/20"
                />
                <InfoCard
                  title="Max LTV"
                  value="~9%"
                  sub="Natural over-collateralization"
                  accent="text-green-400"
                  border="border-green-500/20"
                />
                <InfoCard
                  title="Duration"
                  value="Any"
                  sub="1 block to 5 years"
                  accent="text-cyan-400"
                />
                <InfoCard
                  title="Pools"
                  value="1"
                  sub="All maturities share liquidity"
                  accent="text-white"
                />
              </div>

              {/* Monte Carlo results */}
              <div className="border border-white/10 bg-[#080808] p-4 space-y-3">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Monte Carlo · 1000 paths · 365d
                </div>
                <div className="space-y-2">
                  {[
                    {
                      regime: "Bull (10%→25%)",
                      yield: "11.62%",
                      ltv: "26.1%",
                      color: "text-green-400",
                    },
                    {
                      regime: "Bear (10%→2%)",
                      yield: "10.87%",
                      ltv: "14.9%",
                      color: "text-cyan-400",
                    },
                    {
                      regime: "Chaotic (σ=0.40)",
                      yield: "11.78%",
                      ltv: "50.5%",
                      color: "text-yellow-400",
                    },
                  ].map((r) => (
                    <div
                      key={r.regime}
                      className="flex items-center justify-between py-1.5 border-b border-white/5"
                    >
                      <span className="text-[10px] text-gray-500">
                        {r.regime}
                      </span>
                      <div className="flex gap-6">
                        <span className={`text-[10px] font-mono ${r.color}`}>
                          {r.yield}
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          LTV {r.ltv}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[9px] text-gray-600 italic">
                  Target: 10% fixed yield. All regimes outperform target with
                  max LTV ≪ liquidation threshold.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: TRADING + INFRASTRUCTURE ───── */}
      <section className="border-b border-white/10 py-16 px-6 md:px-12">
        <div className="max-w-[1200px] mx-auto">
          <SectionLabel
            index="02"
            label="Volatility Trading"
            accent="text-cyan-400"
            dot="bg-cyan-400"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-5">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                Rates = Leveraged Beta
              </h2>
              <p className="text-sm text-gray-400 leading-relaxed border-l-2 border-cyan-500/40 pl-4">
                DeFi borrowing rates amplify crypto volatility by 6×. They lag
                asset prices by 7–14 days. They mean-revert to a 4–15% band.
                Every property is alpha.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <InfoCard
                  title="BTC +83%"
                  value="+502%"
                  sub="Rate amplification (2024)"
                  accent="text-pink-400"
                  border="border-pink-500/20"
                />
                <InfoCard
                  title="Lag"
                  value="7–14d"
                  sub="Systematic arb window"
                  accent="text-cyan-400"
                  border="border-cyan-500/20"
                />
                <InfoCard
                  title="Cointegration"
                  value="p=0.02"
                  sub="ETH price ↔ USDC rate"
                  accent="text-green-400"
                  border="border-green-500/20"
                />
                <InfoCard
                  title="Mean Range"
                  value="4–15%"
                  sub="LP sweet spot"
                  accent="text-yellow-400"
                  border="border-yellow-500/20"
                />
              </div>

              {/* LP thesis */}
              <div className="border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <GitBranch size={12} className="text-cyan-400" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                    LP Paradise
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 leading-relaxed">
                  Mean-reverting rates + concentrated liquidity = consistent
                  fees, minimal IL. Price oscillates within range instead of
                  trending away.
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Broker Preview */}
              <BrokerPreview />

              {/* Order Types */}
              <div className="border border-white/10 bg-[#080808]">
                <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400 flex items-center gap-2">
                    <Zap size={12} /> On-Chain Order Engine
                  </span>
                  <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                    Uniswap V4
                  </span>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    {
                      type: "Market",
                      desc: "Atomic swap via concentrated liquidity",
                      tag: "Instant",
                      accent: "text-cyan-400",
                      tagBorder: "border-cyan-500/30",
                    },
                    {
                      type: "Limit",
                      desc: "Hook-based conditional execution at target rate",
                      tag: "Conditional",
                      accent: "text-yellow-400",
                      tagBorder: "border-yellow-500/30",
                    },
                    {
                      type: "TWAP",
                      desc: "TWAMM streaming — powers synthetic bonds",
                      tag: "Streaming",
                      accent: "text-green-400",
                      tagBorder: "border-green-500/30",
                    },
                  ].map((o) => (
                    <div
                      key={o.type}
                      className="px-4 py-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-1.5 h-1.5 ${o.accent.replace("text-", "bg-")}`}
                        />
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white">
                            {o.type}
                          </span>
                          <div className="text-[9px] text-gray-500 mt-0.5">
                            {o.desc}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`border px-2 py-0.5 text-[9px] uppercase tracking-widest ${o.tagBorder} ${o.accent}`}
                      >
                        {o.tag}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                    No_Off-Chain_Keeper
                  </span>
                  <div className="w-1.5 h-1.5 bg-green-500 animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: CDS ────────────────────────── */}
      <section className="border-b border-white/10 py-16 px-6 md:px-12">
        <div className="max-w-[1200px] mx-auto">
          <SectionLabel
            index="03"
            label="Solvency Insurance"
            accent="text-pink-400"
            dot="bg-pink-500"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-5">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                Parametric CDS. No Claims. Pure Math.
              </h2>
              <p className="text-sm text-gray-400 leading-relaxed border-l-2 border-pink-500/40 pl-4">
                When utilization hits 100%, rates spike to cap. Long RLP pays
                out 6–10× automatically. No governance votes, no dispute
                resolution. The interest rate model IS the trigger.
              </p>

              {/* Payout curve */}
              <div className="border border-white/10 bg-[#080808] p-4">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest mb-3">
                  Payout Curve
                </div>
                <div className="space-y-0">
                  <FlowStep
                    num="1"
                    title="Normal: Rate 10%"
                    desc="RLP price ≈ $10. Low funding cost to hold."
                    accent="text-pink-400"
                  />
                  <FlowStep
                    num="2"
                    title="Stress: Util > 90%"
                    desc="Rate begins accelerating through kink region."
                    accent="text-pink-400"
                  />
                  <FlowStep
                    num="3"
                    title="Crisis: Util = 100%"
                    desc="Rate hits 75%+ cap. RLP price = $75. Immediate 7.5× payout."
                    accent="text-pink-400"
                    last
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Stream case study */}
              <div className="border border-red-500/20 bg-[#080808]">
                <div className="px-4 py-2.5 border-b border-red-500/20 bg-[#0a0a0a] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400 flex items-center gap-2">
                    <Shield size={12} /> Stream Finance Crisis
                  </span>
                  <span className="border border-red-500/30 px-2 py-0.5 text-[9px] text-red-400 uppercase tracking-widest">
                    Nov 2025
                  </span>
                </div>
                <div className="p-4 space-y-2">
                  <div className="text-[10px] text-gray-400 leading-relaxed">
                    $93M bankruptcy. Total liquidity freeze. Euler USDC
                    utilization hit 100%. Borrowing rates: 4% → 75% in one
                    block.
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <InfoCard
                      title="Rate"
                      value="75%"
                      sub="From 4% baseline"
                      accent="text-red-400"
                      border="border-red-500/20"
                    />
                    <InfoCard
                      title="Long RLP"
                      value="+18.75×"
                      sub="Instant hedge payout"
                      accent="text-pink-400"
                      border="border-pink-500/20"
                    />
                  </div>
                  <div className="text-[9px] text-gray-600 mt-2">
                    A depositor with $1M in Euler + RLD CDS would have recovered
                    their entire position.
                  </div>
                </div>
              </div>

              {/* Isolation */}
              <div className="border border-white/10 bg-[#080808] p-4 space-y-3">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Collateral Isolation
                </div>
                <div className="text-[10px] text-gray-400 leading-relaxed">
                  CDS markets use uncorrelated collateral (ETH/stETH). If the
                  insured protocol goes to zero, the insurance pot remains
                  solvent.
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { label: "Collateral", value: "ETH / stETH" },
                    { label: "Lock Period", value: "7 days" },
                    { label: "Auto-Seize", value: "Util > 99% · 24h" },
                    { label: "Settlement", value: "Global pro-rata" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between py-1 border-b border-white/5"
                    >
                      <span className="text-[9px] text-gray-600 uppercase tracking-widest">
                        {s.label}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 bg-[#080808]">
        <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-white" />
            <span className="text-sm font-bold tracking-widest uppercase text-white">
              RLD
            </span>
            <span className="text-[10px] text-gray-600 ml-2">
              Interest Rate Derivatives Layer
            </span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-700 uppercase tracking-[0.2em]">
            <span>Built on Uniswap V4</span>
            <span className="text-white/10">|</span>
            <span>Powered by AAVE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
