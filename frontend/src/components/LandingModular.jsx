import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Shield,
  TrendingUp,
  Lock,
  Zap,
  Activity,
  GitBranch,
  Layers,
  ChevronDown,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────
 * OPTION C — Modular Hybrid
 *
 * Half-screen hero + 3 expandable module sections.
 * Each module is a self-contained panel that expands on click.
 * ──────────────────────────────────────────────────────────────────── */

/* ── Module Component ──────────────────────────────────────────── */
const Module = ({
  index,
  title,
  subtitle,
  accent,
  accentDot,
  icon: Icon,
  children,
  defaultOpen = false,
}) => {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div
      className={`border ${open ? "border-white/20" : "border-white/10"} bg-[#080808] transition-colors`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-700 font-mono">
              [{index}]
            </span>
            <div className={`w-2 h-2 ${accentDot}`} />
          </div>
          <div className="text-left">
            <div
              className={`text-[10px] font-bold uppercase tracking-[0.3em] ${accent} mb-0.5`}
            >
              {title}
            </div>
            <div className="text-sm text-gray-500 font-bold tracking-wide">
              {subtitle}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {Icon && <Icon size={16} className={accent} />}
          <ChevronDown
            size={14}
            className={`text-gray-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Content — expandable */}
      <div
        className={`overflow-hidden transition-all duration-500 ease-in-out ${open ? "max-h-[3000px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="border-t border-white/10 px-6 py-6">{children}</div>
      </div>
    </div>
  );
};

const Stat = ({ label, value, color = "text-white" }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
    <span className="text-[9px] text-gray-600 uppercase tracking-widest">
      {label}
    </span>
    <span className={`text-[11px] font-mono ${color}`}>{value}</span>
  </div>
);

const Bullet = ({ children, accent = "text-cyan-400" }) => (
  <div className="flex items-start gap-2">
    <span className={`text-[10px] ${accent} opacity-60 mt-0.5`}>▸</span>
    <span className="text-[11px] text-gray-400 leading-relaxed">
      {children}
    </span>
  </div>
);

const MiniCard = ({
  title,
  value,
  sub,
  accent = "text-cyan-400",
  border = "border-white/10",
}) => (
  <div className={`border ${border} bg-[#0a0a0a] p-3 space-y-1`}>
    <div className="text-[9px] text-gray-600 uppercase tracking-widest">
      {title}
    </div>
    <div className={`text-lg font-mono font-light tracking-tight ${accent}`}>
      {value}
    </div>
    {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
  </div>
);

export default function LandingModular() {
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
      {/* ── HERO (half screen) ──────────────────── */}
      <section className="h-[50vh] min-h-[400px] flex flex-col justify-center border-b border-white/10 relative overflow-hidden">
        <div className="absolute inset-0 pattern-grid opacity-5 pointer-events-none" />
        <div className="relative z-10 max-w-[1200px] mx-auto w-full px-6 md:px-12">
          <div
            className="flex items-center gap-3 text-gray-600 text-[10px] font-bold tracking-[0.4em] uppercase mb-4"
            style={fade(0)}
          >
            <div className="w-2 h-2 bg-white" /> RLD Protocol
          </div>
          <h1
            className="text-4xl md:text-6xl font-bold tracking-tighter leading-[0.95] text-white uppercase mb-4"
            style={fade(1)}
          >
            Interest Rate
            <br />
            Derivatives Layer
          </h1>
          <div
            className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8"
            style={fade(2)}
          >
            <p className="text-sm text-gray-500 font-bold tracking-wide border-l-2 border-gray-600 pl-4 max-w-lg">
              CDP perps on borrowing rates. One Uni V4 pool. Cross-margin
              broker. Market, Limit, and TWAP orders — all on-chain.
            </p>
            <div className="flex gap-3 shrink-0">
              <Link
                to="/bonds"
                className="border border-white/80 text-white px-6 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-white hover:text-black transition-all flex items-center gap-2"
              >
                Launch App <ArrowRight size={14} />
              </Link>
              <a
                href="https://docs.rld.finance"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/20 text-gray-400 px-6 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:border-white/50 hover:text-white transition-all"
              >
                Docs
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── KEY METRICS BAR ────────────────────── */}
      <div className="border-b border-white/10 bg-[#080808]" style={fade(3)}>
        <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-4 grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6">
          {[
            {
              label: "Index Price",
              value: "P = 100 × r",
              accent: "text-cyan-400",
            },
            {
              label: "Order Types",
              value: "Market · Limit · TWAP",
              accent: "text-white",
            },
            {
              label: "Margin",
              value: "Cross-Margin",
              accent: "text-green-400",
            },
            {
              label: "Collateral",
              value: "Assets + LP + TWAMM",
              accent: "text-yellow-400",
            },
            { label: "Venue", value: "Uniswap V4", accent: "text-cyan-400" },
          ].map((m) => (
            <div key={m.label}>
              <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                {m.label}
              </div>
              <div className={`text-[11px] font-mono font-bold ${m.accent}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── MODULES ───────────────────────────── */}
      <div
        className="max-w-[1200px] mx-auto px-6 md:px-12 py-8 space-y-3"
        style={fade(4)}
      >
        {/* MODULE 1: Synthetic Bonds */}
        <Module
          index="01"
          title="Synthetic Bonds"
          subtitle="Fixed yield & fixed borrowing — any duration, one pool"
          accent="text-yellow-400"
          accentDot="bg-yellow-400"
          icon={Lock}
          defaultOpen={true}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: explanation */}
            <div className="space-y-4">
              <div className="text-sm text-gray-400 leading-relaxed">
                A perpetual + TWAMM linear unwind = synthetic expiry for any
                duration. No dated vaults, no PT tokens, no liquidity splits.
              </div>

              <div className="space-y-3">
                {/* Fixed Yield */}
                <div className="border border-white/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 bg-cyan-400" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Fixed Yield
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 leading-relaxed">
                    Deposit aUSDC → mint Short RLP → sell → loop. Rate drops?
                    Hedge profits offset. Rate rises? Floating yield covers.
                  </div>
                  <div className="space-y-0">
                    <Stat
                      label="Mechanism"
                      value="Deposit + Short RLP + TWAMM"
                      color="text-cyan-400"
                    />
                    <Stat
                      label="Max LTV at 10%"
                      value="~9.09% (1100% CR)"
                      color="text-green-400"
                    />
                    <Stat
                      label="Duration"
                      value="1 block → 5 years"
                      color="text-yellow-400"
                    />
                  </div>
                </div>

                {/* Fixed Borrowing */}
                <div className="border border-white/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 bg-green-400" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Fixed Borrowing
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 leading-relaxed">
                    Buy Long RLP → pre-pay interest at today's rate. Rate
                    spikes? Hedge profit offsets extra cost.
                  </div>
                  <div className="space-y-0">
                    <Stat
                      label="Use Case"
                      value="Basis trade hedge (sUSDe/USDT)"
                      color="text-green-400"
                    />
                    <Stat
                      label="Effective Cost"
                      value="~4.19% (vs 9% market)"
                      color="text-green-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: data */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MiniCard
                  title="Target Yield"
                  value="10%"
                  sub="1Y synthetic bond"
                  accent="text-yellow-400"
                  border="border-yellow-500/20"
                />
                <MiniCard
                  title="Pools Required"
                  value="1"
                  sub="vs. N dated vaults"
                  accent="text-white"
                />
              </div>

              {/* Monte Carlo */}
              <div className="border border-white/10 bg-[#0a0a0a] p-4 space-y-3">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Simulation · 1000 paths · 365d maturity
                </div>
                {[
                  {
                    regime: "Bull (rates 10%→25%)",
                    yield: "11.62%",
                    vol: "±0.20%",
                    ltv: "26.1%",
                    outcome: "Outperformance",
                  },
                  {
                    regime: "Bear (rates 10%→2%)",
                    yield: "10.87%",
                    vol: "±0.13%",
                    ltv: "14.9%",
                    outcome: "Capital Protection",
                  },
                  {
                    regime: "Chaotic (σ=0.40)",
                    yield: "11.78%",
                    vol: "±0.81%",
                    ltv: "50.5%",
                    outcome: "Noise Cancellation",
                  },
                ].map((r) => (
                  <div
                    key={r.regime}
                    className="space-y-1 pb-2 border-b border-white/5 last:border-0"
                  >
                    <div className="flex justify-between">
                      <span className="text-[10px] text-gray-500">
                        {r.regime}
                      </span>
                      <span className="text-[10px] font-mono text-green-400">
                        {r.yield}
                      </span>
                    </div>
                    <div className="flex justify-between text-[9px] text-gray-600">
                      <span>σ: {r.vol}</span>
                      <span>Max LTV: {r.ltv}</span>
                      <span className="text-gray-500">{r.outcome}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* TWAMM formula */}
              <div className="border border-dashed border-yellow-500/20 p-3 space-y-1">
                <div className="text-[9px] text-yellow-400/80 uppercase tracking-widest">
                  TWAMM Linear Unwind
                </div>
                <div className="text-[13px] text-gray-300 font-mono">
                  Q(t) = Q₀ × (1 − t/T)
                </div>
                <div className="text-[9px] text-gray-600">
                  Hedge decays linearly. At every block, hedge size = remaining
                  duration risk. Realizes TWAP of rate over entire maturity.
                </div>
              </div>
            </div>
          </div>
        </Module>

        {/* MODULE 2: Volatility Trading + Infrastructure */}
        <Module
          index="02"
          title="Volatility Trading"
          subtitle="Rate perps, cross-margin broker, on-chain order engine"
          accent="text-cyan-400"
          accentDot="bg-cyan-400"
          icon={TrendingUp}
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Rate Perps */}
            <div className="space-y-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-cyan-400" /> Rate-Level Perps
              </div>
              <div className="text-[10px] text-gray-500 leading-relaxed">
                CDP perps tracking DeFi borrowing rates. P = 100 × Rate. 5% rate
                = $5 price. Rates double → position doubles.
              </div>
              <div className="border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
                <div className="text-[9px] text-cyan-400 uppercase tracking-widest font-bold">
                  Alpha Sources
                </div>
                <Bullet accent="text-cyan-400">
                  6× amplification — rates react 6× more than ETH
                </Bullet>
                <Bullet accent="text-cyan-400">
                  7–14 day lag — front-run the utilization curve
                </Bullet>
                <Bullet accent="text-cyan-400">
                  Mean reversion — rates oscillate 4–15%
                </Bullet>
                <Bullet accent="text-cyan-400">
                  Long RLP ≈ Long Volatility
                </Bullet>
              </div>
              <div className="space-y-0">
                <Stat
                  label="BTC +83% →"
                  value="Rates +502%"
                  color="text-pink-400"
                />
                <Stat
                  label="Cointegration"
                  value="p = 0.02"
                  color="text-green-400"
                />
                <Stat
                  label="Lag Correlation"
                  value="0.336 (14d)"
                  color="text-yellow-400"
                />
              </div>
            </div>

            {/* Cross-Margin Broker */}
            <div className="space-y-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-white" /> Cross-Margin Broker
              </div>
              <div className="text-[10px] text-gray-500 leading-relaxed">
                One account handles everything. All asset types count toward
                NAV.
              </div>
              <div className="border border-white/10 bg-[#0a0a0a] p-3 space-y-2">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest mb-2">
                  Collateral Sources
                </div>
                {[
                  {
                    asset: "waUSDC",
                    type: "Deposit",
                    value: "$125,000",
                    color: "text-cyan-400",
                  },
                  {
                    asset: "wRLP",
                    type: "Position",
                    value: "12,400",
                    color: "text-pink-400",
                  },
                  {
                    asset: "V4 LP NFT",
                    type: "Liquidity",
                    value: "$8,200",
                    color: "text-green-400",
                  },
                  {
                    asset: "TWAMM",
                    type: "Order",
                    value: "$1,630",
                    color: "text-yellow-400",
                  },
                ].map((a) => (
                  <div
                    key={a.asset}
                    className="flex items-center justify-between border-b border-white/5 pb-1.5 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1 h-1 ${a.color.replace("text-", "bg-")}`}
                      />
                      <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                        {a.asset}
                      </span>
                    </div>
                    <span className={`text-[10px] font-mono ${a.color}`}>
                      {a.value}
                    </span>
                  </div>
                ))}
                <div className="border-t border-white/5 pt-2 mt-1 flex items-center justify-between">
                  <span className="text-[9px] text-gray-600 uppercase tracking-widest">
                    NAV
                  </span>
                  <span className="text-[11px] font-mono text-white font-bold">
                    $147,230
                  </span>
                </div>
              </div>
              <Stat label="Health Factor" value="6.09" color="text-green-400" />
              <Stat label="Margin Mode" value="Cross" color="text-cyan-400" />
            </div>

            {/* Order Types */}
            <div className="space-y-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-cyan-400" /> On-Chain Orders
              </div>
              <div className="text-[10px] text-gray-500 leading-relaxed">
                All orders execute on-chain via Uniswap V4. No off-chain
                matching, no keeper dependency.
              </div>
              {[
                {
                  type: "Market",
                  desc: "Atomic swap via concentrated liquidity",
                  tag: "Instant",
                  accent: "text-cyan-400",
                  icon: Zap,
                },
                {
                  type: "Limit",
                  desc: "Hook-based conditional at target rate",
                  tag: "Conditional",
                  accent: "text-yellow-400",
                  icon: Activity,
                },
                {
                  type: "TWAP",
                  desc: "TWAMM streaming — 1h to 5Y",
                  tag: "Streaming",
                  accent: "text-green-400",
                  icon: TrendingUp,
                },
              ].map((o) => (
                <div
                  key={o.type}
                  className="border border-white/10 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <o.icon size={12} className={o.accent} />
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white">
                        {o.type}
                      </span>
                    </div>
                    <span
                      className={`border px-2 py-0.5 text-[9px] uppercase tracking-widest ${o.accent} ${o.accent === "text-cyan-400" ? "border-cyan-500/30" : o.accent === "text-yellow-400" ? "border-yellow-500/30" : "border-green-500/30"}`}
                    >
                      {o.tag}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500">{o.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </Module>

        {/* MODULE 3: CDS */}
        <Module
          index="03"
          title="Solvency Insurance"
          subtitle="Parametric CDS — no claims, no disputes, pure math"
          accent="text-pink-400"
          accentDot="bg-pink-500"
          icon={Shield}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="text-sm text-gray-400 leading-relaxed">
                When utilization hits 100%, rates spike to cap. Long RLP pays
                out 6–10× automatically. The interest rate model IS the
                insurance trigger.
              </div>

              {/* Payout math */}
              <div className="border border-pink-500/20 bg-pink-500/5 p-4 space-y-2">
                <div className="text-[9px] text-pink-400 uppercase tracking-widest font-bold">
                  Payout Mechanics
                </div>
                <div className="space-y-0">
                  <Stat
                    label="Normal State"
                    value="Rate 10% → RLP = $10"
                    color="text-gray-400"
                  />
                  <Stat
                    label="Crisis Trigger"
                    value="Util 100% → Rate Cap"
                    color="text-red-400"
                  />
                  <Stat
                    label="Default Payout"
                    value="Rate 75% → RLP = $75 → 7.5×"
                    color="text-pink-400"
                  />
                </div>
              </div>

              {/* Collateral isolation */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white">
                  Collateral Isolation
                </div>
                <Bullet accent="text-pink-400">
                  Uncorrelated collateral (ETH/stETH) — insured protocol can go
                  to $0
                </Bullet>
                <Bullet accent="text-pink-400">
                  7-day withdrawal delay — shorts can't front-run a hack
                </Bullet>
                <Bullet accent="text-pink-400">
                  Auto-seize: util &gt; 99% + rates &gt; 80% for 24h → global
                  settlement
                </Bullet>
              </div>
            </div>

            <div className="space-y-4">
              {/* Stream Crisis */}
              <div className="border border-red-500/20 bg-[#0a0a0a]">
                <div className="px-4 py-2.5 border-b border-red-500/20 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400 flex items-center gap-2">
                    <Shield size={12} /> Stream Finance
                  </span>
                  <span className="border border-red-500/30 px-2 py-0.5 text-[9px] text-red-400 uppercase tracking-widest">
                    Nov 2025
                  </span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="text-[10px] text-gray-400 leading-relaxed">
                    $93M bankruptcy. Total liquidity freeze. USDC borrowing
                    rates: 4% → 75% overnight.
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniCard
                      title="Rate"
                      value="75%"
                      sub="From 4%"
                      accent="text-red-400"
                      border="border-red-500/20"
                    />
                    <MiniCard
                      title="Payout"
                      value="18.75×"
                      sub="Long RLP"
                      accent="text-pink-400"
                      border="border-pink-500/20"
                    />
                    <MiniCard
                      title="Recovery"
                      value="14d"
                      sub="Mean reversion"
                      accent="text-gray-400"
                    />
                  </div>
                </div>
              </div>

              {/* Demand side example */}
              <div className="border border-white/10 p-4 space-y-2">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Use Case: $1B wstETH Whale
                </div>
                <div className="text-[10px] text-gray-500 leading-relaxed">
                  2.5% staking yield → $25M/year. Allocate to RLD CDS premium.
                  Protocol hack → recover full $1B principal from insurance
                  payout.
                </div>
                <div className="space-y-0">
                  <Stat
                    label="Premium"
                    value="~2.5% APY"
                    color="text-pink-400"
                  />
                  <Stat
                    label="Coverage"
                    value="$1,000,000,000"
                    color="text-white"
                  />
                  <Stat
                    label="Funded By"
                    value="stETH staking rewards"
                    color="text-green-400"
                  />
                </div>
              </div>
            </div>
          </div>
        </Module>
      </div>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 bg-[#080808] mt-4">
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
