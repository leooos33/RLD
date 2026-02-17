import React from "react";
import {
  ArrowRight,
  Layers,
  TrendingUp,
  Shield,
  Zap,
  Target,
  BarChart3,
  Briefcase,
  GitBranch,
} from "lucide-react";
import RLDPerformanceChart from "./RLDChart";
import ratesCsv from "../assets/aave_usdc_rates_full_history_2026-01-27.csv?raw";

/**
 * Homepage — Pitch Deck (concise, aligned to RLD Whitepaper)
 * Route: /
 */

const TWAR_WINDOW = 3600; // 1 hour smoothing

/** Pearson correlation */
function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length === 0) return 0;
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}

const slides = [
  {
    index: "01",
    label: "PROBLEM",
    title: "Rates are volatile, untradeable, unhedgeable.",
    body: "$50B+ in DeFi lending. Very limited protection with small fragmented liquidity and high slippage.",
    bullets: [
      "LPs want fixed predictable yield",
      "Carry traders need fixed borrowing cost to lock margins",
      "General demand for solvency protection (CDS)",
    ],
    accent: "red",
    visual: "chart",
    cta: { label: "Launch App", href: "/bonds" },
  },
  {
    index: "02",
    label: "MECHANISM",
    title: "A perpetual that tracks the cost of money.",
    body: "CDP-based perpetual futures:",
    bullets: [
      "Oracle: USDC borrowing rates from lending protocols",
      "Price: 100 × Rate",
      "5% -> 10% -> 2x on notional",
      "No expirations and liquidity fragmentation",
    ],
    accent: "cyan",
    visual: "diagram",
    cta: { label: "Launch App", href: "/bonds" },
  },
  {
    index: "03",
    label: "FIXED_YIELD",
    title: "Fixed yield. Any duration. One pool.",
    body: "Deposit + short RLP to create synthetic bonds.",
    bullets: [
      "Demand: fixed-yield generation",
      "Problem: Rate Volatility",
      "Solution: Short RLP to fix yield + receive funding",
      "Result: 1 pool, any duration, no fragmentation",
    ],
    accent: "yellow",
    visual: "bonds",
    cta: { label: "Launch App", href: "/bonds" },
  },
  {
    index: "04",
    label: "FIXED_BORROWING",
    title: "Lock your cost of capital.",
    body: "Buy Long RLP to pre-pay interest at today's rate. Rate spikes offset by hedge profit.",
    bullets: [
      "Leveraged basis-trade: Collateral: sUSDe, Debt: USDT",
      "Problem: USDC borrowing cost goes up → strategy unprofitable",
      "Solution: buy long RLP to fix interest rate costs",
    ],
    accent: "green",
    visual: "basis",
    cta: { label: "Launch App", href: "/bonds" },
  },
  {
    index: "05",
    label: "RATE_PERPS",
    title: "Rate-Level Perps",
    body: "Go long/short on USDC borrowing cost to capitalize on:",
    bullets: [
      "Natural interest rate asymmetry",
      "USDC rate and ETH price cointegration",
      "Cross-rates arbitrage",
    ],
    accent: "cyan",
    visual: "perps",
    icon: <TrendingUp size={20} />,
    cta: { label: "Launch App", href: "/bonds" },
  },
  {
    index: "06",
    label: "CDS",
    title: "Parametric insurance. Trustless.",
    body: "Default = 100% utilization → rate cap → Long RLP pays out 6–10× instantly. No claims, no disputes.",
    accent: "pink",
    visual: "stream",
    cta: { label: "Launch App", href: "/bonds" },
  },
  {
    index: "07",
    label: "LP_STRUCTURE",
    title: "Mean-reverting rates. LP paradise.",
    body: "Rates oscillate 4–15%. Concentrated ranges earn consistent fees, no long-term IL. One pool serves every maturity.",
    icon: <GitBranch size={20} />,
    accent: "cyan",
    visual: "rates",
    cta: { label: "Launch App", href: "/bonds" },
  },
];

const accentMap = {
  red: { text: "text-red-400", border: "border-red-500/40", dot: "bg-red-500" },
  cyan: {
    text: "text-cyan-400",
    border: "border-cyan-500/40",
    dot: "bg-cyan-400",
  },
  yellow: {
    text: "text-yellow-400",
    border: "border-yellow-500/40",
    dot: "bg-yellow-400",
  },
  green: {
    text: "text-green-400",
    border: "border-green-500/40",
    dot: "bg-green-400",
  },
  purple: {
    text: "text-purple-400",
    border: "border-purple-500/40",
    dot: "bg-purple-400",
  },
  pink: {
    text: "text-pink-400",
    border: "border-pink-500/40",
    dot: "bg-pink-400",
  },
};

/** Pre-process CSV into the same format App.jsx uses for RLDPerformanceChart */
function buildChartData() {
  if (!ratesCsv) return { chartData: [], correlation: 0 };
  const lines = ratesCsv.trim().split("\n");

  // Parse all hourly rows
  const hourly = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (!parts[0]) continue;
    hourly.push({
      timestamp: parseInt(parts[0], 10),
      apy: parseFloat(parts[2]),
      eth_price: parseFloat(parts[4]),
    });
  }

  // Compute TWAR with 3600s sliding window, then downsample to daily
  const result = [];
  const historyQueue = [];
  let runningArea = 0;
  let runningTime = 0;

  for (let i = 0; i < hourly.length; i++) {
    const cur = hourly[i];
    const prevTs = i > 0 ? hourly[i - 1].timestamp : cur.timestamp;
    let dt = cur.timestamp - prevTs;
    if (dt < 0) dt = 0;
    const stepArea = cur.apy * dt;
    historyQueue.push({ dt, area: stepArea, timestamp: cur.timestamp });
    runningArea += stepArea;
    runningTime += dt;

    while (
      historyQueue.length > 0 &&
      cur.timestamp - historyQueue[0].timestamp > TWAR_WINDOW
    ) {
      const removed = historyQueue.shift();
      runningArea -= removed.area;
      runningTime -= removed.dt;
    }
    const twar =
      runningTime > 0 ? Math.max(0, runningArea / runningTime) : cur.apy;

    // Downsample: keep every 24th point (daily)
    if (i % 24 === 0) {
      result.push({
        timestamp: cur.timestamp,
        apy: cur.apy,
        twar,
        ethPrice: cur.eth_price || null,
      });
    }
  }

  // Correlation
  const apys = result.map((d) => d.apy);
  const prices = result.map((d) => d.ethPrice || 0);
  const corr = calculateCorrelation(apys, prices);

  return { chartData: result, correlation: corr };
}

const { chartData: STATIC_CHART_DATA } = buildChartData();

// Jan 1, 2025 – Jan 27, 2026 filtered subset
const START_2025 = 1735689600; // Jan 1, 2025 00:00:00 UTC
const STATIC_CHART_DATA_2025 = STATIC_CHART_DATA.filter(
  (d) => d.timestamp >= START_2025,
);

const CHART_AREAS = [
  { key: "apy", name: "Spot", color: "#22d3ee" },
  { key: "ethPrice", name: "ETH Price", color: "#a1a1aa", yAxisId: "right" },
  { key: "twar", name: "TWAR", color: "#ec4899" },
];

// 95th percentile band for rate oscillation chart (slide 06)
const RATE_AREAS = [{ key: "apy", name: "Borrow Rate", color: "#22d3ee" }];
const STATIC_CHART_DATA_WEEKLY = STATIC_CHART_DATA.filter(
  (_, i) => i % 7 === 0,
);
const sortedApys = STATIC_CHART_DATA.map((d) => d.apy)
  .filter((v) => v != null)
  .sort((a, b) => a - b);
const p2_5 = sortedApys[Math.floor(sortedApys.length * 0.025)];
const p97_5 = sortedApys[Math.floor(sortedApys.length * 0.975)];
const RATE_REF_LINES = [
  { y: p2_5, stroke: "#a1a1aa", label: `P2.5 ${p2_5.toFixed(1)}%` },
  { y: p97_5, stroke: "#ef4444", label: `P97.5 ${p97_5.toFixed(1)}%` },
];

const RateChartPanel = () => (
  <div className="flex flex-col w-full h-full">
    <div className="flex justify-between items-end mb-2 px-1">
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400" />
          <span className="text-[10px] uppercase tracking-widest">
            Borrow_Rate
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0 border-t border-dashed border-zinc-400" />
          <span className="text-[10px] uppercase tracking-widest text-zinc-400">
            P2.5
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0 border-t border-dashed border-red-500" />
          <span className="text-[10px] uppercase tracking-widest text-red-400">
            P97.5
          </span>
        </div>
      </div>
      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
        AAVE V3 · 3Y · 95th Pctl
      </span>
    </div>
    <div className="flex-1 min-h-0 w-full border border-white/10 p-3 bg-[#080808]">
      <RLDPerformanceChart
        data={STATIC_CHART_DATA_WEEKLY}
        resolution="1W"
        areas={RATE_AREAS}
        referenceLines={RATE_REF_LINES}
      />
    </div>
  </div>
);

const PERPS_CHART_AREAS = [
  { key: "apy", name: "USDC Rate", color: "#ec4899" },
  { key: "ethPrice", name: "ETH Price", color: "#22d3ee", yAxisId: "right" },
];

const PerpsChartPanel = () => (
  <div className="flex flex-col w-full h-full">
    <div className="flex justify-between items-end mb-2 px-1">
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-pink-500" />
          <span className="text-[10px] uppercase tracking-widest">
            USDC Rate
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400" />
          <span className="text-[10px] uppercase tracking-widest">
            ETH Price
          </span>
        </div>
      </div>
    </div>
    <div className="flex-1 min-h-0 w-full border border-white/10 p-3 bg-[#080808]">
      <RLDPerformanceChart
        data={STATIC_CHART_DATA_2025}
        resolution="1D"
        areas={PERPS_CHART_AREAS}
      />
    </div>
    <div className="flex justify-between items-center mt-2 px-1">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-green-500 font-bold">
          Live Feed
        </span>
      </div>
      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
        Jan 1, 25 – Jan 1, 26 Data
      </span>
    </div>
  </div>
);

/** Reusable chart panel */
const ChartPanel = ({ data, label }) => (
  <div className="flex flex-col w-full h-full">
    <div className="flex justify-between items-end mb-2 px-1">
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400" />
          <span className="text-[10px] uppercase tracking-widest">
            Spot_Rate
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-pink-500" />
          <span className="text-[10px] uppercase tracking-widest">
            RATE_TWAR_1H
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-zinc-400" />
          <span className="text-[10px] uppercase tracking-widest">
            ETH_Price
          </span>
        </div>
      </div>
      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
        {label}
      </span>
    </div>
    <div className="flex-1 min-h-0 w-full border border-white/10 p-3 bg-[#080808]">
      <RLDPerformanceChart data={data} resolution="1D" areas={CHART_AREAS} />
    </div>
  </div>
);

/** Dashed-box helper */
const DBox = ({ children, className = "" }) => (
  <div
    className={`border border-dashed border-white/30 px-5 py-2.5 text-[11px] uppercase tracking-widest text-white text-center whitespace-nowrap ${className}`}
  >
    {children}
  </div>
);

/** Protocol architecture diagram — hero-style terminal panel cards */
const MechanismDiagram = () => {
  const containerRef = React.useRef(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* shared transition style per step index */
  const step = (i) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms`,
  });

  /* Horizontal connector arrow */
  const hConnector = (label, i) => (
    <div
      className="flex flex-col items-center justify-center gap-1 shrink-0 px-1"
      style={step(i)}
    >
      {label && (
        <span className="text-[9px] text-gray-600 uppercase tracking-[0.2em]">
          {label}
        </span>
      )}
      <div className="flex items-center gap-0">
        <div className="w-1.5 h-1.5 border border-white/30 rotate-45" />
        <div
          className="w-10 h-px bg-gradient-to-r from-white/30 to-white/30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0, rgba(255,255,255,0.3) 4px, transparent 4px, transparent 8px)",
          }}
        />
        <svg width="8" height="8" className="shrink-0">
          <polygon points="0,0 8,4 0,8" fill="white" fillOpacity="0.3" />
        </svg>
      </div>
    </div>
  );

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      ref={containerRef}
    >
      <div className="flex items-stretch gap-0">
        {/* ── ORACLE PANEL ── */}
        <div
          className="border border-white/10 bg-[#080808] w-[190px] flex flex-col"
          style={step(0)}
        >
          <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500" />
              Oracle
            </span>
            <span className="text-[9px] text-gray-700 tracking-[0.15em]">
              ::01
            </span>
          </div>
          <div className="px-4 py-3 space-y-1.5 flex-1">
            {["AAVE", "Morpho", "Euler", "Fluid"].map((p) => (
              <div key={p} className="flex items-center gap-2">
                <div className="w-1 h-1 bg-green-500/60" />
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                  {p}
                </span>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
            <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
              Rate_Feeds
            </span>
            <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
          </div>
        </div>

        {hConnector("Rates", 1)}

        {/* ── CDP ENGINE PANEL ── */}
        <div className="relative" style={step(2)}>
          {/* Short label — positioned above */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 flex flex-col items-center mb-2">
            <div className="border border-pink-500/30 bg-pink-500/5 px-4 py-1.5 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-pink-500" />
              <span className="text-[10px] text-pink-400 font-bold uppercase tracking-[0.2em]">
                Short
              </span>
            </div>
            <div className="h-4 w-px bg-pink-500/30" />
            <svg width="8" height="6">
              <polygon points="0,0 8,0 4,6" fill="#ec4899" fillOpacity="0.5" />
            </svg>
          </div>

          <div className="border border-white/10 bg-[#080808] w-[190px] flex flex-col">
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-white" />
                CDP_Engine
              </span>
              <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                ::02
              </span>
            </div>
            <div className="px-4 py-3 flex-1">
              <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                Index Price
              </div>
              <div className="text-lg text-white font-mono font-light tracking-tight">
                100 × Rate
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 pt-2.5 border-t border-white/5">
                {["Funding", "Margin", "Settle", "Liq."].map((t) => (
                  <div key={t} className="flex items-center gap-1.5">
                    <div className="w-1 h-1 bg-white/40" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {t}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
              <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                Perpetual
              </span>
              <div className="w-1.5 h-1.5 bg-cyan-400 animate-pulse" />
            </div>
          </div>
        </div>

        {hConnector("Trade", 3)}

        {/* ── UNISWAP V4 POOL PANEL ── */}
        <div className="relative" style={step(4)}>
          <div className="border border-white/10 bg-[#080808] w-[190px] flex flex-col">
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-cyan-400" />
                Uniswap_V4
              </span>
              <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                ::03
              </span>
            </div>
            <div className="px-4 py-3 flex-1">
              <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                Pool
              </div>
              <div className="text-lg text-white font-mono font-light tracking-tight">
                RLP — USDC
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 pt-2.5 border-t border-white/5">
                {["Market", "Limit", "TWAP", "LP"].map((t) => (
                  <div key={t} className="flex items-center gap-1.5">
                    <div className="w-1 h-1 bg-cyan-400/60" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {t}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
              <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                Concentrated_LP
              </span>
              <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
            </div>
          </div>

          {/* Long label — positioned below */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 flex flex-col items-center mt-2">
            <svg width="8" height="6">
              <polygon points="0,6 8,6 4,0" fill="#22d3ee" fillOpacity="0.5" />
            </svg>
            <div className="h-4 w-px bg-cyan-400/30" />
            <div className="border border-cyan-400/30 bg-cyan-400/5 px-4 py-1.5 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-cyan-400" />
              <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-[0.2em]">
                Long
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** TWAMM bond duration diagram */
const BOND_DURATIONS = [
  { label: "30D", fill: 0.15 },
  { label: "90D", fill: 0.35 },
  { label: "1Y", fill: 0.65 },
  { label: "5Y", fill: 1.0 },
];

const BondsDiagram = () => {
  const containerRef = React.useRef(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const step = (i) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms`,
  });

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      ref={containerRef}
    >
      <div
        className="flex flex-col items-center gap-0"
        style={{ transform: "scale(1.25)", transformOrigin: "center" }}
      >
        {/* ── TOP: POOL PANEL ── */}
        <div
          className="border border-white/10 bg-[#080808] w-full"
          style={step(0)}
        >
          <div className="px-4 py-2 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-yellow-400 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-yellow-400" />
              Single_Pool
            </span>
            <span className="text-[9px] text-gray-700 tracking-[0.15em]">
              RLP — USDC
            </span>
          </div>
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
              Any_Duration
            </span>
            <div className="w-1.5 h-1.5 bg-yellow-400 animate-pulse shadow-[0_0_8px_#eab308]" />
          </div>
        </div>

        {/* ── VERTICAL CONNECTORS ── */}
        <div className="flex items-start gap-3">
          {BOND_DURATIONS.map((d, i) => (
            <div
              key={i}
              className="flex flex-col items-center"
              style={step(1 + i)}
            >
              {/* Connector line */}
              <div className="h-5 w-px bg-yellow-500/30" />
              <svg width="8" height="6">
                <polygon
                  points="0,0 8,0 4,6"
                  fill="#eab308"
                  fillOpacity="0.5"
                />
              </svg>

              {/* ── DURATION CARD ── */}
              <div className="border border-white/10 bg-[#080808] w-[120px] mt-0.5">
                <div className="px-3 py-1.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-yellow-400" />
                    {d.label}
                  </span>
                  <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                    ::0{i + 1}
                  </span>
                </div>
                <div className="px-3 py-2">
                  <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                    Unwind
                  </div>
                  <div className="h-1.5 w-full bg-white/5 border border-white/10">
                    <div
                      className="h-full bg-yellow-500/50"
                      style={{ width: `${d.fill * 100}%` }}
                    />
                  </div>
                </div>
                <div className="px-3 py-1.5 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
                    TWAMM
                  </span>
                  <div className="w-1 h-1 bg-green-500/60" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── TIMELINE LABEL ── */}
        <div
          className="mt-3 w-full flex items-center justify-between text-[9px] text-gray-600 uppercase tracking-[0.2em]"
          style={step(5)}
        >
          <span>← 1 block</span>
          <div className="flex-1 mx-2 border-t border-dashed border-white/10" />
          <span>5 years →</span>
        </div>
      </div>
    </div>
  );
};
/** Leveraged basis trade diagram */
const BasisTradeDiagram = () => {
  const containerRef = React.useRef(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const step = (i) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms`,
  });

  /* Horizontal connector */
  const hConnector = (labelTop, labelBottom) => (
    <div className="flex flex-col items-center gap-1 shrink-0 px-1">
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-gray-600 uppercase tracking-[0.2em]">
          {labelTop}
        </span>
        <div className="flex items-center gap-0">
          <div className="w-1.5 h-1.5 border border-white/30 rotate-45" />
          <div
            className="w-8 h-px"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0, rgba(255,255,255,0.3) 4px, transparent 4px, transparent 8px)",
            }}
          />
          <svg width="8" height="8" className="shrink-0">
            <polygon points="0,0 8,4 0,8" fill="white" fillOpacity="0.3" />
          </svg>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0">
          <svg width="8" height="8" className="shrink-0 rotate-180">
            <polygon points="0,0 8,4 0,8" fill="white" fillOpacity="0.3" />
          </svg>
          <div
            className="w-8 h-px"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0, rgba(255,255,255,0.3) 4px, transparent 4px, transparent 8px)",
            }}
          />
          <div className="w-1.5 h-1.5 border border-white/30 rotate-45" />
        </div>
        <span className="text-[9px] text-gray-600 uppercase tracking-[0.2em]">
          {labelBottom}
        </span>
      </div>
    </div>
  );

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      ref={containerRef}
    >
      <div
        className="flex flex-col items-center"
        style={{ transform: "scale(1.25)", transformOrigin: "center" }}
      >
        {/* Top row: Trader ←→ Lending */}
        <div className="flex items-center gap-0" style={step(0)}>
          {/* Trader Panel */}
          <div className="border border-white/10 bg-[#080808] w-[120px]">
            <div className="px-3 py-1.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-white" />
                Trader
              </span>
              <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                ::01
              </span>
            </div>
            <div className="px-3 py-2">
              <div className="text-[9px] text-gray-500 uppercase tracking-widest">
                Basis_Trade
              </div>
            </div>
          </div>

          {hConnector("Deposit_sUSDe", "Borrow_USDT")}

          {/* Lending Panel */}
          <div className="border border-white/10 bg-[#080808] w-[140px]">
            <div className="px-3 py-1.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-green-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-green-500" />
                Lending
              </span>
              <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                ::02
              </span>
            </div>
            <div className="px-3 py-2">
              <div className="text-[9px] text-gray-500 uppercase tracking-widest">
                AAVE / Morpho
              </div>
            </div>
          </div>
        </div>

        {/* Vertical: Rate risk */}
        <div className="flex flex-col items-center" style={step(1)}>
          <div className="h-3 w-px bg-white/20" />
          <div className="border border-red-500/20 bg-red-500/5 px-4 py-1.5 pb-2.5">
            <span className="text-[9px] text-red-400 uppercase tracking-[0.15em]">
              ⚠ Rate_spike → margin_squeezed
            </span>
          </div>
          <div className="h-3 w-px bg-white/20" />
          <svg width="8" height="6">
            <polygon points="0,0 8,0 4,6" fill="white" fillOpacity="0.35" />
          </svg>
        </div>

        {/* Hedge: Long RLP */}
        <div
          className="border border-white/10 bg-[#080808] w-[160px] mt-0.5"
          style={step(2)}
        >
          <div className="px-3 py-1.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-green-400 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500" />
              Long_RLP
            </span>
            <span className="text-[9px] text-gray-700 tracking-[0.15em]">
              ::03
            </span>
          </div>
          <div className="px-3 py-1.5 flex items-center justify-between">
            <span className="text-[9px] text-gray-700 uppercase tracking-[0.2em]">
              Rate_Hedge
            </span>
          </div>
        </div>

        {/* Connector down */}
        <div className="flex flex-col items-center" style={step(3)}>
          <div className="h-4 w-px bg-green-500/30" />
          <svg width="8" height="6">
            <polygon points="0,0 8,0 4,6" fill="#22c55e" fillOpacity="0.5" />
          </svg>
        </div>

        {/* Result */}
        <div
          className="border border-green-500/20 bg-[#080808] w-[220px] mt-0.5"
          style={step(4)}
        >
          <div className="px-3 py-1.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-green-400 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500" />
              Result
            </span>
            <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
          </div>
          <div className="px-3 py-2 text-center">
            <div className="text-[9px] text-green-400 uppercase tracking-widest mb-1">
              Rate Up → RLP Profit Offsets Cost
            </div>
            <div className="text-[10px] text-white font-bold uppercase tracking-[0.15em]">
              = Fixed_Borrowing_Cost
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Stream Finance crisis data (daily, from euler_stream_case.csv, values in $M) */
const STREAM_DATA = [
  {
    timestamp: 1758668400,
    borrowApy: 5.0,
    supplyApy: 0.0,
    totalBorrows: 0.0,
    totalDeposits: 0.0,
  },
  {
    timestamp: 1758754800,
    borrowApy: 5.0,
    supplyApy: 0.0,
    totalBorrows: 0.0,
    totalDeposits: 0.0,
  },
  {
    timestamp: 1758841200,
    borrowApy: 19.92,
    supplyApy: 16.19,
    totalBorrows: 19.44,
    totalDeposits: 19.81,
  },
  {
    timestamp: 1758927600,
    borrowApy: 10.22,
    supplyApy: 7.54,
    totalBorrows: 30.57,
    totalDeposits: 36.27,
  },
  {
    timestamp: 1759014000,
    borrowApy: 10.75,
    supplyApy: 8.71,
    totalBorrows: 42.09,
    totalDeposits: 45.44,
  },
  {
    timestamp: 1759100400,
    borrowApy: 10.29,
    supplyApy: 7.69,
    totalBorrows: 42.72,
    totalDeposits: 50.0,
  },
  {
    timestamp: 1759186800,
    borrowApy: 11.38,
    supplyApy: 9.48,
    totalBorrows: 47.58,
    totalDeposits: 50.0,
  },
  {
    timestamp: 1759273200,
    borrowApy: 10.87,
    supplyApy: 9.0,
    totalBorrows: 51.07,
    totalDeposits: 54.01,
  },
  {
    timestamp: 1759359600,
    borrowApy: 10.89,
    supplyApy: 9.04,
    totalBorrows: 51.03,
    totalDeposits: 53.79,
  },
  {
    timestamp: 1759446000,
    borrowApy: 10.79,
    supplyApy: 8.8,
    totalBorrows: 66.49,
    totalDeposits: 71.29,
  },
  {
    timestamp: 1759532400,
    borrowApy: 10.71,
    supplyApy: 8.62,
    totalBorrows: 92.02,
    totalDeposits: 100.0,
  },
  {
    timestamp: 1759618800,
    borrowApy: 10.72,
    supplyApy: 8.64,
    totalBorrows: 92.13,
    totalDeposits: 100.02,
  },
  {
    timestamp: 1759705200,
    borrowApy: 10.72,
    supplyApy: 8.64,
    totalBorrows: 92.16,
    totalDeposits: 100.04,
  },
  {
    timestamp: 1759791600,
    borrowApy: 10.71,
    supplyApy: 8.63,
    totalBorrows: 92.11,
    totalDeposits: 100.06,
  },
  {
    timestamp: 1759878000,
    borrowApy: 10.21,
    supplyApy: 7.74,
    totalBorrows: 96.86,
    totalDeposits: 115.0,
  },
  {
    timestamp: 1759964400,
    borrowApy: 10.22,
    supplyApy: 7.53,
    totalBorrows: 96.89,
    totalDeposits: 115.0,
  },
  {
    timestamp: 1760050800,
    borrowApy: 10.19,
    supplyApy: 7.47,
    totalBorrows: 96.35,
    totalDeposits: 115.01,
  },
  {
    timestamp: 1760137200,
    borrowApy: 27.98,
    supplyApy: 24.48,
    totalBorrows: 96.39,
    totalDeposits: 96.39,
  },
  {
    timestamp: 1760223600,
    borrowApy: 17.05,
    supplyApy: 14.46,
    totalBorrows: 96.89,
    totalDeposits: 100.01,
  },
  {
    timestamp: 1760310000,
    borrowApy: 10.6,
    supplyApy: 8.38,
    totalBorrows: 96.92,
    totalDeposits: 107.32,
  },
  {
    timestamp: 1760396400,
    borrowApy: 10.61,
    supplyApy: 8.41,
    totalBorrows: 97.0,
    totalDeposits: 107.17,
  },
  {
    timestamp: 1760482800,
    borrowApy: 10.67,
    supplyApy: 8.54,
    totalBorrows: 97.16,
    totalDeposits: 106.26,
  },
  {
    timestamp: 1760569200,
    borrowApy: 10.65,
    supplyApy: 8.49,
    totalBorrows: 97.22,
    totalDeposits: 106.74,
  },
  {
    timestamp: 1760655600,
    borrowApy: 10.8,
    supplyApy: 8.84,
    totalBorrows: 97.25,
    totalDeposits: 104.0,
  },
  {
    timestamp: 1760742000,
    borrowApy: 10.81,
    supplyApy: 8.84,
    totalBorrows: 97.28,
    totalDeposits: 104.0,
  },
  {
    timestamp: 1760828400,
    borrowApy: 10.81,
    supplyApy: 8.85,
    totalBorrows: 97.3,
    totalDeposits: 104.02,
  },
  {
    timestamp: 1760914800,
    borrowApy: 10.81,
    supplyApy: 8.85,
    totalBorrows: 97.33,
    totalDeposits: 104.0,
  },
  {
    timestamp: 1761001200,
    borrowApy: 10.81,
    supplyApy: 8.85,
    totalBorrows: 97.36,
    totalDeposits: 104.01,
  },
  {
    timestamp: 1761087600,
    borrowApy: 10.81,
    supplyApy: 8.86,
    totalBorrows: 97.39,
    totalDeposits: 104.0,
  },
  {
    timestamp: 1761174000,
    borrowApy: 10.81,
    supplyApy: 8.86,
    totalBorrows: 97.41,
    totalDeposits: 104.0,
  },
  {
    timestamp: 1761260400,
    borrowApy: 14.07,
    supplyApy: 11.82,
    totalBorrows: 97.42,
    totalDeposits: 101.5,
  },
  {
    timestamp: 1761346800,
    borrowApy: 11.32,
    supplyApy: 9.42,
    totalBorrows: 96.57,
    totalDeposits: 101.51,
  },
  {
    timestamp: 1761433200,
    borrowApy: 11.57,
    supplyApy: 9.64,
    totalBorrows: 96.51,
    totalDeposits: 101.36,
  },
  {
    timestamp: 1761519600,
    borrowApy: 11.48,
    supplyApy: 9.56,
    totalBorrows: 96.46,
    totalDeposits: 101.34,
  },
  {
    timestamp: 1761606000,
    borrowApy: 10.9,
    supplyApy: 9.06,
    totalBorrows: 96.0,
    totalDeposits: 101.06,
  },
  {
    timestamp: 1761692400,
    borrowApy: 21.48,
    supplyApy: 18.45,
    totalBorrows: 95.07,
    totalDeposits: 96.84,
  },
  {
    timestamp: 1761778800,
    borrowApy: 15.42,
    supplyApy: 13.01,
    totalBorrows: 94.39,
    totalDeposits: 97.92,
  },
  {
    timestamp: 1761865200,
    borrowApy: 21.14,
    supplyApy: 18.14,
    totalBorrows: 94.57,
    totalDeposits: 96.43,
  },
  {
    timestamp: 1761951600,
    borrowApy: 18.11,
    supplyApy: 15.41,
    totalBorrows: 93.28,
    totalDeposits: 95.97,
  },
  {
    timestamp: 1762038000,
    borrowApy: 13.19,
    supplyApy: 11.05,
    totalBorrows: 93.01,
    totalDeposits: 97.17,
  },
  {
    timestamp: 1762124400,
    borrowApy: 17.04,
    supplyApy: 14.44,
    totalBorrows: 93.05,
    totalDeposits: 96.05,
  },
  {
    timestamp: 1762210800,
    borrowApy: 75.0,
    supplyApy: 65.62,
    totalBorrows: 90.37,
    totalDeposits: 90.37,
  },
  {
    timestamp: 1762297200,
    borrowApy: 75.0,
    supplyApy: 65.62,
    totalBorrows: 90.51,
    totalDeposits: 90.51,
  },
  {
    timestamp: 1762383600,
    borrowApy: 75.0,
    supplyApy: 65.62,
    totalBorrows: 90.65,
    totalDeposits: 90.65,
  },
  {
    timestamp: 1762470000,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1762556400,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1762642800,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1762729200,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1762815600,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1762902000,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1762988400,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1763074800,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.7,
    totalDeposits: 90.7,
  },
  {
    timestamp: 1763161200,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763247600,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763334000,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763420400,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763506800,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763593200,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763679600,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763766000,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763852400,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
  {
    timestamp: 1763938800,
    borrowApy: 0.2,
    supplyApy: 0.17,
    totalBorrows: 90.71,
    totalDeposits: 90.71,
  },
];

const STREAM_CHART_AREAS = [
  { key: "borrowApy", name: "Borrow APY", color: "#ef4444" },
  { key: "supplyApy", name: "Supply APY", color: "#a1a1aa" },
  {
    key: "totalBorrows",
    name: "Borrows ($M)",
    color: "#ec4899",
    yAxisId: "right",
  },
  {
    key: "totalDeposits",
    name: "Deposits ($M)",
    color: "#22d3ee",
    yAxisId: "right",
  },
];

const StreamChartPanel = () => (
  <div className="flex flex-col w-full h-full">
    <div className="flex justify-between items-end mb-2 px-1">
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-red-500" />
          <span className="text-[10px] uppercase tracking-widest">
            Borrow_APY
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-zinc-400" />
          <span className="text-[10px] uppercase tracking-widest">
            Supply_APY
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-pink-500" />
          <span className="text-[10px] uppercase tracking-widest">Borrows</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-400" />
          <span className="text-[10px] uppercase tracking-widest">
            Deposits
          </span>
        </div>
      </div>
      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
        Euler · Stream Default · Sep – Nov 2025
      </span>
    </div>
    <div className="flex-1 min-h-0 w-full border border-white/10 p-3 bg-[#080808]">
      <RLDPerformanceChart
        data={STREAM_DATA}
        resolution="1D"
        areas={STREAM_CHART_AREAS}
      />
    </div>
  </div>
);

export default function Homepage() {
  const [heroVisible, setHeroVisible] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setHeroVisible(true), 100);
    return () => clearTimeout(t);
  }, []);
  const heroStep = (i) => ({
    opacity: heroVisible ? 1 : 0,
    transform: heroVisible ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 100}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 100}ms`,
  });
  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-mono">
      {/* HERO */}
      <section className="h-screen w-screen flex flex-col justify-center px-6 md:px-24 py-20 border-b border-white/10 relative overflow-hidden">
        <div className="absolute inset-0 pattern-grid opacity-10 pointer-events-none" />
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="max-w-3xl space-y-6">
            <div className="flex items-center gap-3 text-gray-600 text-[10px] font-bold tracking-[0.4em] uppercase">
              <div className="w-2 h-2 bg-white" />
              RLD Protocol
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter leading-[0.95] text-white uppercase">
              The Interest Rate
              <br />
              Derivatives Layer
            </h1>
            <p className="text-sm text-gray-500 font-bold tracking-wide border-l-2 border-gray-600 pl-4">
              Trade Rates. Fix Yields. Insure Solvency.
            </p>
            <div className="flex gap-4 pt-4">
              <a
                href="/bonds"
                className="border border-white/80 text-white px-6 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-white hover:text-black transition-all flex items-center gap-2"
              >
                Launch App <ArrowRight size={14} />
              </a>
              <a
                href="https://docs.rld.finance"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/20 text-gray-400 px-6 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:border-white/50 hover:text-white transition-all flex items-center gap-2"
              >
                Docs <ArrowRight size={14} />
              </a>
            </div>
            <div className="pt-8 flex items-center gap-3 text-gray-600 text-[10px] uppercase tracking-[0.3em] animate-pulse">
              <ArrowRight size={12} className="rotate-90" />
              Scroll
            </div>
          </div>
          <div className="hidden lg:flex flex-col items-center">
            {/* Application Cards — 3 use cases */}
            <div className="grid grid-cols-3 gap-3 mb-3" style={heroStep(0)}>
              {/* BONDS */}
              <div className="w-[280px] border border-white/10 bg-[#080808]">
                <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-cyan-400" />
                    Bond
                  </span>
                  <span className="text-[9px] text-gray-600 tracking-[0.15em]">
                    #0042
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                        Fixed APY
                      </div>
                      <div className="text-xl text-cyan-400 font-mono font-light tracking-tight">
                        8.40%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                        Principal
                      </div>
                      <div className="text-[12px] text-white font-mono">
                        25,000 USDC
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2.5 border-t border-white/5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-cyan-500 animate-pulse" />
                      <span className="text-[9px] text-cyan-500 uppercase tracking-widest">
                        Active
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-600 uppercase tracking-widest">
                      453 Days
                    </span>
                  </div>
                </div>
              </div>

              {/* CDS */}
              <div className="w-[280px] border border-white/10 bg-[#080808]">
                <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-pink-500" />
                    CDS
                  </span>
                  <span className="text-[9px] text-gray-600 tracking-[0.15em]">
                    #0108
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                        Payout
                      </div>
                      <div className="text-xl text-pink-400 font-mono font-light tracking-tight">
                        10×
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                        Coverage
                      </div>
                      <div className="text-[12px] text-white font-mono">
                        100,000 USDC
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2.5 border-t border-white/5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-pink-500 animate-pulse" />
                      <span className="text-[9px] text-pink-400 uppercase tracking-widest">
                        Armed
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-600 uppercase tracking-widest">
                      aUSDT
                    </span>
                  </div>
                </div>
              </div>

              {/* VAULTS */}
              <div className="w-[280px] border border-white/10 bg-[#080808]">
                <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-green-500" />
                    Vault
                  </span>
                  <span className="text-[9px] text-gray-600 tracking-[0.15em]">
                    #0077
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                        Strategy APY
                      </div>
                      <div className="text-xl text-green-400 font-mono font-light tracking-tight">
                        12.3%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">
                        Deposited
                      </div>
                      <div className="text-[12px] text-white font-mono">
                        50,000 USDC
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2.5 border-t border-white/5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-green-500 animate-pulse" />
                      <span className="text-[9px] text-green-400 uppercase tracking-widest">
                        Earning
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-600 uppercase tracking-widest">
                      AAVE V3
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Protocol Stack — Terminal Panel Style */}
            <div
              className="w-[380px] border border-white/10 bg-[#080808]"
              style={heroStep(1)}
            >
              {/* Panel header */}
              <div className="px-5 py-3 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                  <Layers size={12} className="text-gray-500" />
                  Protocol_Stack
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
                  <span className="text-[10px] text-gray-600 uppercase tracking-[0.2em]">
                    Live
                  </span>
                </div>
              </div>

              {/* Layers */}
              <div>
                {/* Layer 1: Applications */}
                <div className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-pink-500" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-pink-400">
                        Applications
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                      ::0001
                    </span>
                  </div>
                  <div className="pl-4 flex items-center gap-2">
                    {["Bonds", "CDS", "Vaults"].map((item, j) => (
                      <React.Fragment key={item}>
                        {j > 0 && <span className="text-white/10">|</span>}
                        <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                          {item}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Layer 2: RLD Core + Uniswap V4 (side by side) */}
                <div className="grid grid-cols-2 border-t border-white/5">
                  <div className="px-4 py-4 hover:bg-white/[0.02] transition-colors border-r border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-white" />
                        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white">
                          RLD Core
                        </span>
                      </div>
                      <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                        ::0010
                      </span>
                    </div>
                    <div className="pl-4 flex flex-col gap-1">
                      {["CDP_Engine", "Long/Short", "Funding"].map((item) => (
                        <span
                          key={item}
                          className="text-[10px] text-gray-500 uppercase tracking-widest"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-4 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-cyan-400" />
                        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400">
                          Uniswap_V4
                        </span>
                      </div>
                      <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                        ::0100
                      </span>
                    </div>
                    <div className="pl-4 flex flex-col gap-1">
                      {["Market", "Limit", "TWAP"].map((item) => (
                        <span
                          key={item}
                          className="text-[10px] text-gray-500 uppercase tracking-widest"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Layer 3: Lending Protocols */}
                <div className="px-5 py-4 border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-green-500" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-green-400">
                        Lending Protocols
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-700 tracking-[0.15em]">
                      ::0011
                    </span>
                  </div>
                  <div className="pl-4 flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      AAVE
                    </span>
                    <span className="text-white/10">|</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      Morpho
                    </span>
                    <span className="text-white/10">|</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      Euler
                    </span>
                    <span className="text-white/10">|</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      Fluid
                    </span>
                  </div>
                </div>
              </div>

              {/* Panel footer */}
              <div className="px-5 py-2.5 border-t border-white/10 bg-[#0a0a0a] flex items-center justify-between">
                <span className="text-[9px] text-gray-600 uppercase tracking-[0.2em]">
                  4 layers
                </span>
                <span className="text-[9px] text-gray-600 uppercase tracking-[0.2em]">
                  Ethereum Mainnet
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SLIDES */}
      {slides.map((slide) => {
        const colors = accentMap[slide.accent];
        const hasVisual = !!slide.visual;

        return (
          <section
            key={slide.index}
            className="h-screen w-screen flex items-center px-6 md:px-24 py-20 border-b border-white/10 relative group hover:bg-white/[0.01] transition-colors"
          >
            <div className="absolute top-6 right-6 md:top-10 md:right-10 text-[10px] font-bold text-gray-700 tracking-widest">
              [{slide.index}]
            </div>

            <div
              className={`w-full ${hasVisual ? "grid grid-cols-1 lg:grid-cols-2 gap-12 items-center" : ""}`}
            >
              {/* Text */}
              <div className="max-w-xl space-y-5">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 ${colors.dot}`} />
                  <span
                    className={`text-[10px] font-bold tracking-[0.4em] uppercase ${colors.text}`}
                  >
                    {slide.label}
                  </span>
                </div>
                <h2 className="text-2xl md:text-4xl font-bold tracking-tight leading-tight text-white">
                  {slide.title}
                </h2>
                <p
                  className={`text-sm md:text-base text-gray-400 leading-relaxed border-l-2 ${colors.border} pl-4`}
                >
                  {slide.body}
                </p>
                {slide.bullets && (
                  <div className="space-y-2 pt-1">
                    {slide.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span
                          className={`text-[10px]  ${colors.text} opacity-60`}
                        >
                          ▸
                        </span>
                        <span className="text-[12px] text-gray-500 uppercase tracking-widest leading-relaxed">
                          {b}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {slide.cta && (
                  <a
                    href={slide.cta.href}
                    className="inline-flex items-center gap-2 border border-white/80 text-white px-6 py-3 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-white hover:text-black transition-all mt-2"
                  >
                    {slide.cta.label} <ArrowRight size={14} />
                  </a>
                )}
              </div>

              {/* Visual (right side) */}
              {slide.visual === "chart" && (
                <div className="hidden lg:flex h-[400px]">
                  <ChartPanel
                    data={STATIC_CHART_DATA_2025}
                    label="Jan 2025 – Jan 2026"
                  />
                </div>
              )}
              {slide.visual === "diagram" && (
                <div className="hidden lg:flex">
                  <MechanismDiagram />
                </div>
              )}
              {slide.visual === "bonds" && (
                <div className="hidden lg:flex">
                  <BondsDiagram />
                </div>
              )}
              {slide.visual === "basis" && (
                <div className="hidden lg:flex">
                  <BasisTradeDiagram />
                </div>
              )}
              {slide.visual === "stream" && (
                <div className="hidden lg:flex h-[400px]">
                  <StreamChartPanel />
                </div>
              )}
              {slide.visual === "rates" && (
                <div className="hidden lg:flex h-[400px]">
                  <RateChartPanel />
                </div>
              )}
              {slide.visual === "perps" && (
                <div className="hidden lg:flex h-[400px]">
                  <PerpsChartPanel />
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* FOOTER */}
      <footer className="border-t border-white/10 bg-[#080808]">
        <div className="max-w-[1800px] mx-auto px-6 md:px-12">
          {/* Main footer row */}
          <div className="py-10 grid grid-cols-2 md:grid-cols-12 gap-y-10 gap-x-6">
            {/* Brand block */}
            <div className="col-span-2 md:col-span-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-white" />
                <span className="text-sm font-bold tracking-widest uppercase text-white">
                  RLD
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed max-w-[280px]">
                Interest Rate Derivatives Layer.
                <br />
                One pool. Every maturity. Protected yield.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
                <span className="text-[10px] text-gray-600 uppercase tracking-[0.2em]">
                  Mainnet
                </span>
              </div>
            </div>

            {/* Protocol links */}
            <div className="col-span-1 md:col-span-2 space-y-4">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                <span className="text-white/10">//</span> Protocol
              </div>
              <ul className="space-y-2.5">
                {[
                  { label: "Whitepaper", href: "#" },
                  { label: "Github", href: "#" },
                  { label: "Docs", href: "https://docs.rld.finance" },
                ].map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={
                        href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors block"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Interface links */}
            <div className="col-span-1 md:col-span-2 space-y-4">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                <span className="text-white/10">//</span> Interface
              </div>
              <ul className="space-y-2.5">
                {[
                  { label: "Terminal", href: "/app" },
                  { label: "Bonds", href: "/bonds" },
                  { label: "Markets", href: "/markets" },
                  { label: "Portfolio", href: "/portfolio" },
                ].map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors block"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Community links */}
            <div className="col-span-1 md:col-span-2 space-y-4">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                <span className="text-white/10">//</span> Community
              </div>
              <ul className="space-y-2.5">
                {["Twitter", "Telegram", "Discord"].map((item) => (
                  <li key={item}>
                    <a
                      href="#"
                      className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors block"
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal links */}
            <div className="col-span-1 md:col-span-2 space-y-4">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                <span className="text-white/10">//</span> Legal
              </div>
              <ul className="space-y-2.5">
                {["Privacy Policy", "Terms of Service"].map((item) => (
                  <li key={item}>
                    <a
                      href="#"
                      className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors block"
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/5 py-5 flex flex-col md:flex-row justify-between items-center gap-3">
            <span className="text-[10px] text-gray-700 uppercase tracking-[0.2em]">
              © 2025 RLD Protocol
            </span>
            <div className="flex items-center gap-4 text-[10px] text-gray-700 uppercase tracking-[0.2em]">
              <span>Built on Uniswap V4</span>
              <span className="text-white/10">|</span>
              <span>Powered by AAVE</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
