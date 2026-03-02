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
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────
 * OPTION A — Terminal Dashboard
 *
 * Dense 3-column Bloomberg-style layout. No scroll-jacking.
 * Each column = one product pillar: Bonds │ Trading │ CDS
 * Compact hero band at top, then 3 deep panels.
 * ──────────────────────────────────────────────────────────────────── */

const TermPanel = ({ title, tag, accent, accentDot, children, footer }) => (
  <div className="border border-white/10 bg-[#080808] flex flex-col h-full">
    <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between shrink-0">
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2 ${accent}`}
      >
        <div className={`w-1.5 h-1.5 ${accentDot}`} />
        {title}
      </span>
      <span className="text-[9px] text-gray-700 tracking-[0.15em]">{tag}</span>
    </div>
    <div className="px-4 py-4 flex-1 space-y-3 overflow-y-auto">{children}</div>
    {footer && (
      <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between shrink-0">
        {footer}
      </div>
    )}
  </div>
);

const Stat = ({ label, value, color = "text-white" }) => (
  <div className="flex items-center justify-between">
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

const Tag = ({ children, color = "border-white/10 text-gray-500" }) => (
  <span
    className={`border px-2 py-0.5 text-[9px] uppercase tracking-widest ${color}`}
  >
    {children}
  </span>
);

/* ── Broker Account Panel ──────────────────────────────────────── */
const BrokerPanel = () => (
  <TermPanel
    title="Broker_Account"
    tag="::XMRG"
    accent="text-white"
    accentDot="bg-white"
    footer={
      <>
        <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
          Cross_Margin
        </span>
        <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
      </>
    }
  >
    <div className="text-[9px] text-gray-600 uppercase tracking-widest mb-1">
      NAV
    </div>
    <div className="text-2xl text-white font-mono font-light tracking-tight">
      $147,230.00
    </div>
    <div className="border-t border-white/5 pt-3 space-y-2 mt-2">
      <Stat label="Collateral" value="125,000 waUSDC" color="text-cyan-400" />
      <Stat label="Positions" value="12,400 wRLP" color="text-pink-400" />
      <Stat label="LP_Value" value="$8,200" color="text-green-400" />
      <Stat label="TWAMM_Orders" value="$1,630" color="text-yellow-400" />
    </div>
    <div className="border-t border-white/5 pt-3 mt-2 space-y-2">
      <Stat label="Debt" value="$24,180" color="text-red-400" />
      <Stat label="Health" value="6.09" color="text-green-400" />
      <Stat label="Col_Ratio" value="608%" color="text-green-400" />
    </div>
    <div className="border border-dashed border-white/10 p-3 mt-3 space-y-1.5">
      <div className="text-[9px] text-gray-600 uppercase tracking-widest">
        Assets as Collateral
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {["waUSDC", "wRLP", "V4 LP NFT", "TWAMM Orders"].map((a) => (
          <div key={a} className="flex items-center gap-1.5">
            <div className="w-1 h-1 bg-cyan-400/60" />
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">
              {a}
            </span>
          </div>
        ))}
      </div>
    </div>
  </TermPanel>
);

/* ── Order Types Panel ─────────────────────────────────────────── */
const OrderPanel = () => (
  <TermPanel
    title="Order_Types"
    tag="::V4"
    accent="text-cyan-400"
    accentDot="bg-cyan-400"
    footer={
      <>
        <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
          Uniswap_V4_Hook
        </span>
        <div className="w-1.5 h-1.5 bg-cyan-400 animate-pulse" />
      </>
    }
  >
    {/* Market */}
    <div className="border border-white/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-cyan-400" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
            Market
          </span>
        </div>
        <Tag color="border-cyan-500/30 text-cyan-400">Instant</Tag>
      </div>
      <div className="text-[10px] text-gray-500 leading-relaxed">
        Atomic execution via Uniswap V4 concentrated liquidity. Single-block
        settlement.
      </div>
      <div className="flex gap-2">
        <div className="flex-1 border border-cyan-500/20 bg-cyan-500/5 py-1.5 text-center text-[9px] text-cyan-400 font-bold uppercase tracking-widest">
          Long RLP
        </div>
        <div className="flex-1 border border-pink-500/20 bg-pink-500/5 py-1.5 text-center text-[9px] text-pink-400 font-bold uppercase tracking-widest">
          Short RLP
        </div>
      </div>
    </div>

    {/* Limit */}
    <div className="border border-white/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-yellow-400" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
            Limit
          </span>
        </div>
        <Tag color="border-yellow-500/30 text-yellow-400">Conditional</Tag>
      </div>
      <div className="text-[10px] text-gray-500 leading-relaxed">
        On-chain limit orders via hook callbacks. Trigger at target rate level.
        No off-chain keeper.
      </div>
      <Stat label="Example" value="Buy @ Rate ≤ 4.5%" color="text-yellow-400" />
    </div>

    {/* TWAP */}
    <div className="border border-white/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={12} className="text-green-400" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
            TWAP
          </span>
        </div>
        <Tag color="border-green-500/30 text-green-400">Streaming</Tag>
      </div>
      <div className="text-[10px] text-gray-500 leading-relaxed">
        Time-weighted execution via TWAMM hook. Stream orders from 1 hour to 5
        years. Powers synthetic bonds.
      </div>
      <Stat label="Sell_Rate" value="0.00014 /sec" color="text-green-400" />
      <Stat label="Duration" value="24h – 5Y" color="text-gray-400" />
    </div>
  </TermPanel>
);

export default function LandingTerminal() {
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
      {/* ── HERO BAND ────────────────────────────── */}
      <section className="border-b border-white/10 py-10 px-6 md:px-12 max-w-[1800px] mx-auto">
        <div
          className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
          style={fade(0)}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-gray-600 text-[10px] font-bold tracking-[0.4em] uppercase">
              <div className="w-2 h-2 bg-white" /> RLD Protocol
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tighter leading-[0.95] text-white uppercase">
              The Interest Rate
              <br />
              Derivatives Layer
            </h1>
            <p className="text-sm text-gray-500 font-bold tracking-wide border-l-2 border-gray-600 pl-4 max-w-md">
              Trade rates. Fix yields. Insure solvency. One pool, every
              maturity.
            </p>
          </div>
          <div className="flex gap-4" style={fade(1)}>
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
              className="border border-white/20 text-gray-400 px-6 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:border-white/50 hover:text-white transition-all flex items-center gap-2"
            >
              Docs <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* ── 3-COLUMN DASHBOARD ──────────────────── */}
      <section className="max-w-[1800px] mx-auto px-6 md:px-12 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── COLUMN 1: SYNTHETIC BONDS ── */}
          <div className="space-y-4" style={fade(2)}>
            <TermPanel
              title="Synthetic_Bonds"
              tag="::01"
              accent="text-yellow-400"
              accentDot="bg-yellow-400"
              footer={
                <>
                  <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                    TWAMM_Unwind
                  </span>
                  <div className="w-1.5 h-1.5 bg-yellow-400 animate-pulse shadow-[0_0_8px_#eab308]" />
                </>
              }
            >
              <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                Core Thesis
              </div>
              <div className="text-sm text-white font-bold leading-snug mt-1">
                One pool. Infinite maturities. Zero fragmentation.
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed mt-2">
                Perpetual + TWAMM linear unwind = synthetic expiry for any
                duration. No dated vaults, no PT tokens, no liquidity splits.
              </div>

              <div className="border-t border-white/5 pt-3 mt-3 space-y-3">
                {/* Fixed Yield */}
                <div className="border border-white/10 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Lock size={12} className="text-cyan-400" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Fixed Yield
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Short RLP → lock yield. Rate drops → hedge profits offset.
                  </div>
                  <Stat
                    label="Mechanism"
                    value="Deposit + Short RLP"
                    color="text-cyan-400"
                  />
                  <Stat
                    label="Duration"
                    value="1 block → 5 years"
                    color="text-gray-400"
                  />
                  <Stat
                    label="Max LTV"
                    value="~9% (10% yield)"
                    color="text-green-400"
                  />
                </div>

                {/* Fixed Borrowing */}
                <div className="border border-white/10 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Lock size={12} className="text-green-400" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Fixed Borrowing
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Long RLP → lock cost of capital. Rate spikes → hedge profits
                    offset.
                  </div>
                  <Stat
                    label="Use Case"
                    value="Basis trade hedge"
                    color="text-green-400"
                  />
                  <Stat
                    label="Effective Cost"
                    value="~4.19% (vs 9% mkt)"
                    color="text-green-400"
                  />
                </div>
              </div>

              {/* Math */}
              <div className="border border-dashed border-yellow-500/20 p-3 mt-2 space-y-1">
                <div className="text-[9px] text-yellow-400/80 uppercase tracking-widest">
                  TWAMM Unwind
                </div>
                <div className="text-[11px] text-gray-400 font-mono">
                  Q(t) = Q₀ × (1 − t/T)
                </div>
                <div className="text-[9px] text-gray-600">
                  Hedge size decays linearly → matches remaining duration risk
                  at every block
                </div>
              </div>
            </TermPanel>
          </div>

          {/* ── COLUMN 2: VOLATILITY TRADING ── */}
          <div className="space-y-4" style={fade(3)}>
            <TermPanel
              title="Volatility_Trading"
              tag="::02"
              accent="text-cyan-400"
              accentDot="bg-cyan-400"
              footer={
                <>
                  <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                    Rate_Perps
                  </span>
                  <div className="w-1.5 h-1.5 bg-cyan-400 animate-pulse" />
                </>
              }
            >
              <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                Index Price
              </div>
              <div className="text-2xl text-cyan-400 font-mono font-light tracking-tight">
                P = 100 × Rate
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed mt-2">
                CDP-based perpetual. 5% → $5, 10% → $10. Rates = leveraged beta
                to crypto — 6× amplification during BTC rally.
              </div>

              {/* Key insight */}
              <div className="border border-cyan-500/20 bg-cyan-500/5 p-3 mt-3 space-y-2">
                <div className="text-[9px] text-cyan-400 uppercase tracking-widest font-bold">
                  The Edge
                </div>
                <Bullet accent="text-cyan-400">
                  Rates lag asset prices by 7–14 days → systematic arb window
                </Bullet>
                <Bullet accent="text-cyan-400">
                  Mean-reverting rates → LP sweet spot (tight ranges, consistent
                  fees)
                </Bullet>
                <Bullet accent="text-cyan-400">
                  Long RLP ≈ Long Volatility — bet on leverage demand
                </Bullet>
              </div>

              {/* Stats */}
              <div className="border-t border-white/5 pt-3 mt-3 space-y-2">
                <Stat
                  label="BTC +83%"
                  value="Rates +502%"
                  color="text-pink-400"
                />
                <Stat label="Amplification" value="6×" color="text-cyan-400" />
                <Stat
                  label="Coint. p-value"
                  value="0.02"
                  color="text-green-400"
                />
                <Stat
                  label="Lag Corr (14d)"
                  value="0.336"
                  color="text-yellow-400"
                />
              </div>
            </TermPanel>

            {/* Broker account mini */}
            <BrokerPanel />
          </div>

          {/* ── COLUMN 3: CDS ── */}
          <div className="space-y-4" style={fade(4)}>
            <TermPanel
              title="CDS_Insurance"
              tag="::03"
              accent="text-pink-400"
              accentDot="bg-pink-500"
              footer={
                <>
                  <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                    Parametric
                  </span>
                  <div className="w-1.5 h-1.5 bg-pink-500 animate-pulse shadow-[0_0_8px_#ec4899]" />
                </>
              }
            >
              <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                Trigger
              </div>
              <div className="text-2xl text-pink-400 font-mono font-light tracking-tight">
                100% Util → 6–10×
              </div>
              <div className="text-[11px] text-gray-500 leading-relaxed mt-2">
                Algorithmic insurance. No claims, no governance votes, no
                disputes. Rate cap = instant payout. Pure smart contract
                mechanics.
              </div>

              {/* The mechanic */}
              <div className="border border-pink-500/20 bg-pink-500/5 p-3 mt-3 space-y-2">
                <div className="text-[9px] text-pink-400 uppercase tracking-widest font-bold">
                  How It Works
                </div>
                <div className="space-y-1.5">
                  <Stat
                    label="Normal"
                    value="Rate 10% → P ≈ $10"
                    color="text-gray-400"
                  />
                  <Stat
                    label="Crisis"
                    value="Rate 75% → P ≈ $75"
                    color="text-red-400"
                  />
                  <Stat
                    label="Payout"
                    value="7.5× on entry"
                    color="text-pink-400"
                  />
                </div>
              </div>

              {/* Stream crisis */}
              <div className="border border-white/10 p-3 mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield size={12} className="text-red-400" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Case Study
                    </span>
                  </div>
                  <Tag color="border-red-500/30 text-red-400">Nov 2025</Tag>
                </div>
                <div className="text-[10px] text-gray-500">
                  Stream Finance $93M bankruptcy. USDC rates: 4% → 75%
                  overnight. Util hit 100%. Total liquidity freeze.
                </div>
                <Stat
                  label="Rate Spike"
                  value="4% → 75%"
                  color="text-red-400"
                />
                <Stat
                  label="Long RLP PnL"
                  value="+18.75×"
                  color="text-pink-400"
                />
                <Stat
                  label="Resolution"
                  value="14 days"
                  color="text-gray-400"
                />
              </div>

              {/* Collateral isolation */}
              <div className="border border-dashed border-white/10 p-3 mt-2 space-y-1.5">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                  Collateral Isolation
                </div>
                <Bullet accent="text-pink-400">
                  Uncorrelated collateral (ETH/stETH) — no contagion
                </Bullet>
                <Bullet accent="text-pink-400">
                  7-day withdrawal delay — no front-running
                </Bullet>
                <Bullet accent="text-pink-400">
                  Auto-seize on util &gt; 99% for 24h
                </Bullet>
              </div>
            </TermPanel>

            {/* Order types */}
            <OrderPanel />
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 bg-[#080808] mt-8">
        <div className="max-w-[1800px] mx-auto px-6 md:px-12 py-8 flex flex-col md:flex-row justify-between items-center gap-4">
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
