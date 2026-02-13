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
import BondCard from "./BondCard";
import ratesCsv from "../assets/aave_usdc_rates_full_history_2026-01-27.csv?raw";

/**
 * Story Page — Pitch Deck (concise, aligned to RLD Whitepaper)
 * Route: /story
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

/** Protocol architecture diagram — matches terminal aesthetic */
const MechanismDiagram = () => {
  const hArrow = (
    <svg width="48" height="12" className="shrink-0">
      <line
        x1="0"
        y1="6"
        x2="48"
        y2="6"
        stroke="white"
        strokeOpacity="0.3"
        strokeDasharray="4 3"
      />
      <polygon points="4,2 4,10 0,6" fill="white" fillOpacity="0.3" />
      <polygon points="44,2 44,10 48,6" fill="white" fillOpacity="0.3" />
    </svg>
  );

  const vArrowDown = (
    <>
      <svg width="2" height="28">
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="28"
          stroke="white"
          strokeOpacity="0.3"
          strokeDasharray="4 3"
        />
      </svg>
      <svg width="8" height="6">
        <polygon points="0,0 8,0 4,6" fill="white" fillOpacity="0.4" />
      </svg>
    </>
  );

  const vArrowUp = (
    <>
      <svg width="8" height="6">
        <polygon points="0,6 8,6 4,0" fill="white" fillOpacity="0.4" />
      </svg>
      <svg width="2" height="28">
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="28"
          stroke="white"
          strokeOpacity="0.3"
          strokeDasharray="4 3"
        />
      </svg>
    </>
  );

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className="flex items-center gap-0">
        {/* Left: Oracle */}
        <div className="border border-dashed border-white/20 p-3">
          <div className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold mb-2">
            Interest rates oracle
          </div>
          <div className="space-y-1.5">
            <DBox>AAVE</DBox>
            <DBox>Morpho</DBox>
            <DBox>Euler</DBox>
            <DBox>Fluid</DBox>
          </div>
        </div>

        {hArrow}

        {/* Center: CDP with Short above (absolute) */}
        <div className="relative">
          {/* Short label + arrow — positioned above CDP, doesn't affect flow */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 flex flex-col items-center mb-1">
            <span className="text-[12px] text-white font-bold uppercase tracking-widest mb-1">
              Short
            </span>
            {vArrowDown}
          </div>
          <DBox className="px-10 py-4 text-center font-bold text-[13px]">
            CDP
          </DBox>
        </div>

        {hArrow}

        {/* Right: Pool with Long below (absolute) */}
        <div className="relative">
          <div className="flex items-stretch">
            <DBox className="text-center">Uniswap V4</DBox>
            <DBox className="text-center border-l-0">RLP - USDC</DBox>
          </div>
          {/* Long label + arrow — positioned below pool, doesn't affect flow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 flex flex-col items-center mt-1">
            {vArrowUp}
            <span className="text-[12px] text-white font-bold uppercase tracking-widest mt-1">
              Long
            </span>
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

const BondsDiagram = () => (
  <div className="w-full h-full flex items-center justify-center p-4">
    <div
      className="flex flex-col items-center gap-0"
      style={{ transform: "scale(1.3)", transformOrigin: "center" }}
    >
      {/* Single pool at top */}
      <DBox className="px-12 py-3 font-bold text-[12px] border-yellow-500/40 text-yellow-400">
        Single Liquidity Pool (RLP – USDC)
      </DBox>

      {/* Vertical connectors fanning down */}
      <div className="flex items-start gap-6 mt-0">
        {BOND_DURATIONS.map((d, i) => (
          <div key={i} className="flex flex-col items-center">
            {/* Dashed vertical line */}
            <svg width="2" height="32">
              <line
                x1="1"
                y1="0"
                x2="1"
                y2="32"
                stroke="white"
                strokeOpacity="0.25"
                strokeDasharray="4 3"
              />
            </svg>
            <svg width="8" height="6">
              <polygon points="0,0 8,0 4,6" fill="white" fillOpacity="0.35" />
            </svg>

            {/* Duration box */}
            <DBox className="mt-1 px-6 py-2 text-center font-bold">
              {d.label}
            </DBox>

            {/* TWAMM unwind bar */}
            <div className="mt-2 w-full">
              <div className="text-[8px] text-gray-600 uppercase tracking-widest mb-1 text-center">
                Unwind
              </div>
              <div className="h-1.5 w-full bg-white/5 border border-white/10">
                <div
                  className="h-full bg-yellow-500/50"
                  style={{ width: `${d.fill * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom label */}
      <div className="mt-4 text-[10px] text-gray-600 uppercase tracking-widest">
        ← 1 block ·········································· 5 years →
      </div>
    </div>
  </div>
);
/** Leveraged basis trade diagram */
const BasisTradeDiagram = () => {
  const hLine = (w = 40) => (
    <svg width={w} height="12" className="shrink-0">
      <line
        x1="0"
        y1="6"
        x2={w}
        y2="6"
        stroke="white"
        strokeOpacity="0.25"
        strokeDasharray="4 3"
      />
      <polygon
        points={`${w - 4},2 ${w - 4},10 ${w},6`}
        fill="white"
        fillOpacity="0.3"
      />
    </svg>
  );

  const vLine = (h = 24) => (
    <svg width="2" height={h} className="mx-auto">
      <line
        x1="1"
        y1="0"
        x2="1"
        y2={h}
        stroke="white"
        strokeOpacity="0.25"
        strokeDasharray="4 3"
      />
    </svg>
  );

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div
        className="flex flex-col items-center"
        style={{ transform: "scale(1.25)", transformOrigin: "center" }}
      >
        {/* Top row: Lending ←→ Trader */}
        <div className="flex items-center gap-0">
          <div className="flex flex-col items-center">
            <DBox className="px-6 py-3 text-center border-green-500/40">
              <div className="text-green-400 font-bold text-[12px]">
                Lending Protocol
              </div>
              <div className="text-[9px] text-gray-500 mt-1">AAVE / Morpho</div>
            </DBox>
          </div>

          <div className="flex flex-col items-center gap-1 px-2">
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-gray-500 uppercase tracking-widest">
                Deposit sUSDe
              </span>
              {hLine(50)}
            </div>
            <div className="flex items-center gap-1">
              <svg width="50" height="12" className="shrink-0 rotate-180">
                <line
                  x1="0"
                  y1="6"
                  x2="50"
                  y2="6"
                  stroke="white"
                  strokeOpacity="0.25"
                  strokeDasharray="4 3"
                />
                <polygon
                  points="46,2 46,10 50,6"
                  fill="white"
                  fillOpacity="0.3"
                />
              </svg>
              <span className="text-[8px] text-gray-500 uppercase tracking-widest">
                Borrow USDT
              </span>
            </div>
          </div>

          <DBox className="px-8 py-3 text-center font-bold text-[13px]">
            Trader
          </DBox>
        </div>

        {/* Vertical: Rate risk */}
        <div className="flex flex-col items-center mt-1">
          {vLine(20)}
          <DBox className="px-4 py-1.5 text-center border-red-500/30">
            <span className="text-red-400 text-[9px]">
              ⚠ Rate spike → margin squeezed
            </span>
          </DBox>
          {vLine(20)}
          <svg width="8" height="6">
            <polygon points="0,0 8,0 4,6" fill="white" fillOpacity="0.35" />
          </svg>
        </div>

        {/* Hedge: Long RLP */}
        <DBox className="px-8 py-3 text-center border-green-500/40 mt-1">
          <div className="text-green-400 font-bold text-[12px]">Long RLP</div>
          <div className="text-[9px] text-gray-500 mt-1">Rate hedge</div>
        </DBox>

        {/* Result */}
        <div className="flex flex-col items-center mt-1">
          {vLine(16)}
          <svg width="8" height="6">
            <polygon points="0,0 8,0 4,6" fill="white" fillOpacity="0.35" />
          </svg>
        </div>

        <DBox className="px-6 py-2.5 text-center border-green-500/40 mt-1">
          <span className="text-green-400 text-[10px] font-bold">
            Rate ↑ → RLP profit offsets cost
          </span>
          <div className="text-[10px] text-white font-bold mt-1">
            = FIXED BORROWING COST
          </div>
        </DBox>
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

export default function Story() {
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
          <div className="hidden lg:flex justify-center items-center">
            <div className="w-[340px]">
              <BondCard
                nft={{
                  tokenId: "0042",
                  currency: "USDC",
                  rate: 8.4,
                  principal: 25000,
                  maturityDate: "2026-05-15T00:00:00Z",
                  status: "ACTIVE",
                }}
              />
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
      <footer className="border-t border-white/10 relative bg-[#050505] overflow-hidden">
        <div className="absolute inset-0 pattern-grid opacity-10 pointer-events-none" />

        <div className="p-6 md:p-12 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 relative z-10">
          <div className="space-y-4 col-span-2 md:col-span-1">
            <div className="text-[13px] font-bold tracking-[0.2em] flex items-center gap-2 text-white">
              <div className="w-2 h-2 bg-white" />
              RLD
            </div>
            <p className="text-[11px] text-gray-600 leading-relaxed max-w-xs">
              Interest Rate Derivatives Layer.
              <br />
              One pool. Every maturity. Protected yield.
            </p>
          </div>

          <div className="space-y-4">
            <div className="text-[11px] text-white font-bold uppercase tracking-widest border-b border-white/10 pb-2 w-fit">
              Protocol
            </div>
            <ul className="space-y-2">
              {["Whitepaper", "Github"].map((item) => (
                <li key={item}>
                  <a
                    href="#"
                    className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors hover:pl-1 block"
                  >
                    [{item}]
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="text-[11px] text-white font-bold uppercase tracking-widest border-b border-white/10 pb-2 w-fit">
              Interface
            </div>
            <ul className="space-y-2">
              {[
                { label: "Bonds", href: "/bonds" },
                { label: "Markets", href: "/markets" },
                { label: "Portfolio", href: "/portfolio" },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a
                    href={href}
                    className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors hover:pl-1 block"
                  >
                    [{label}]
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="text-[11px] text-white font-bold uppercase tracking-widest border-b border-white/10 pb-2 w-fit">
              Community
            </div>
            <ul className="space-y-2">
              {["Twitter", "Telegram", "Discord"].map((item) => (
                <li key={item}>
                  <a
                    href="#"
                    className="text-[11px] text-gray-500 hover:text-white uppercase tracking-widest transition-colors hover:pl-1 block"
                  >
                    [{item}]
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 p-6 md:px-12 py-6 flex flex-col md:flex-row justify-between items-center text-[10px] text-gray-600 uppercase tracking-widest relative z-10">
          <div>© 2025 RLD Protocol. All rights reserved.</div>
          <div className="flex gap-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-white transition-colors">
              Privacy Policy
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Terms of Service
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
