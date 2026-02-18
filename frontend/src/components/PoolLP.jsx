import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Droplets,
  Activity,
  TrendingUp,
  Shield,
  Layers,
  ArrowUpDown,
  Percent,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

import TradingTerminal, { InputGroup, SummaryRow } from "./TradingTerminal";
import StatItem from "./StatItem";
import RLDPerformanceChart from "./RLDChart";
import ClaimFeesModal from "./ClaimFeesModal";
import WithdrawModal from "./WithdrawModal";
import AddLiquidityModal from "./AddLiquidityModal";

// ── Mock Data ─────────────────────────────────────────────────
const POOL_DATA = {
  pair: "waUSDC / wRLP",
  protocol: "Uniswap V4",
  hookAddress: "0x7a3b...4f2e",
  hookAddressFull: "0x7a3b1234567890abcdef1234567890abcdef4f2e",
  feeTier: "0.30%",
  tickSpacing: 60,
  tvl: 2_450_000,
  volume24h: 890_000,
  fees24h: 2_670,
  fees7d: 18_200,
  apr: 12.4,
  aprWeekly: 0.24,
  aprYearly: 12.4,
  currentTick: -201_280,
  currentPrice: 1.0012,
  indexPrice: 1.0008,
  markPrice: 1.0014,
  fundingRate: 0.0042,
  fundingDirection: "longs", // "longs" pay "shorts"
  activeLiquidity: "1.2M",
  token0: { symbol: "waUSDC", name: "Wrapped aUSDC", decimals: 6 },
  token1: { symbol: "wRLP", name: "Wrapped RLP", decimals: 6 },
};

const USER_POSITIONS = Array.from({ length: 33 }, (_, i) => {
  const id = i + 1;
  const base = 1.0 + (Math.sin(id * 0.7) * 0.06);
  const spread = 0.02 + (id % 5) * 0.008;
  const priceLower = +(base - spread).toFixed(4);
  const priceUpper = +(base + spread).toFixed(4);
  const liq = Math.round(5000 + Math.random() * 60000);
  const t0 = Math.round(liq * (0.4 + Math.random() * 0.2));
  const t1 = liq - t0;
  const fee0 = +(Math.random() * 300).toFixed(2);
  const fee1 = +(Math.random() * 280).toFixed(2);
  const months = Math.floor(Math.random() * 6);
  const d = new Date(2026, 1 - months, 1 + Math.floor(Math.random() * 28));
  return {
    id,
    tickLower: -202_000 + id * 50,
    tickUpper: -200_000 - id * 50,
    priceLower,
    priceUpper,
    liquidity: liq.toLocaleString(),
    token0Amount: t0.toLocaleString(),
    token1Amount: t1.toLocaleString(),
    feesEarned0: fee0.toFixed(2),
    feesEarned1: fee1.toFixed(2),
    inRange: id % 3 !== 0,
    createdAt: d.toISOString().slice(0, 10),
  };
});

// Generate mock liquidity distribution chart data
const generateChartData = () => {
  const data = [];
  const now = Date.now();
  for (let i = 90; i >= 0; i--) {
    const ts = now - i * 86400000;
    const noise = () => (Math.random() - 0.5) * 0.02;
    data.push({
      timestamp: ts,
      poolPrice: 1.0 + noise() + Math.sin(i / 15) * 0.015,
      tvl: 2_200_000 + Math.random() * 500_000 + i * 2000,
    });
  }
  return data;
};

// ── Component ─────────────────────────────────────────────────
export default function PoolLP() {
  const [activeTab, setActiveTab] = useState("ADD");
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");
  const [minPrice, setMinPrice] = useState("0.95");
  const [maxPrice, setMaxPrice] = useState("1.05");
  const [removePercent, setRemovePercent] = useState(100);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [expandedPosition, setExpandedPosition] = useState(null);
  const [actionDropdown, setActionDropdown] = useState(null);
  const [claimPosition, setClaimPosition] = useState(null);
  const [withdrawPosition, setWithdrawPosition] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [chartView, setChartView] = useState("PRICE");
  const [posPage, setPosPage] = useState(1);
  const [removePage, setRemovePage] = useState(1);

  const POS_PER_PAGE = 10;
  const REMOVE_PER_PAGE = 5;
  const totalPosPages = Math.ceil(USER_POSITIONS.length / POS_PER_PAGE);
  const totalRemovePages = Math.ceil(USER_POSITIONS.length / REMOVE_PER_PAGE);
  const paginatedPositions = USER_POSITIONS.slice((posPage - 1) * POS_PER_PAGE, posPage * POS_PER_PAGE);
  const paginatedRemove = USER_POSITIONS.slice((removePage - 1) * REMOVE_PER_PAGE, removePage * REMOVE_PER_PAGE);

  const chartData = useMemo(generateChartData, []);

  const CHART_VIEWS = useMemo(
    () => ({
      PRICE: {
        label: "Price",
        areas: [
          { key: "poolPrice", name: "Pool Price", color: "#22d3ee" },
        ],
      },
      LIQUIDITY: {
        label: "Liquidity",
        areas: [
          { key: "poolPrice", name: "Active Liq", color: "#a855f7" },
        ],
      },
      TVL: {
        label: "TVL",
        areas: [
          { key: "tvl", name: "TVL", color: "#22c55e" },
        ],
      },
      VOLUME: {
        label: "Volume",
        areas: [
          { key: "tvl", name: "Volume 24H", color: "#f59e0b" },
        ],
      },
    }),
    [],
  );

  const activeChartConfig = CHART_VIEWS[chartView];

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-mono selection:bg-white selection:text-black flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full px-6 flex-1 flex flex-col gap-6 pt-0 pb-12">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* === LEFT COLUMN (Span 9) === */}
          <div className="xl:col-span-9 flex flex-col gap-4">
            {/* 1. METRICS GRID */}
            <div className="border border-white/10 grid grid-cols-1 lg:grid-cols-12">
              {/* Branding */}
              <div className="lg:col-span-4 flex flex-col justify-between p-6 border-b lg:border-b-0 lg:border-r border-white/10 h-full min-h-[180px]">
                <div>
                  <div className="text-sm text-gray-700 mb-6 font-mono leading-tight tracking-tight">
                    {POOL_DATA.hookAddress}
                  </div>
                  <h2 className="text-3xl font-medium tracking-tight mb-2 leading-none">
                    {POOL_DATA.pair}
                    <br />
                    <span className="text-gray-600 uppercase">Liquidity Pool</span>
                  </h2>
                </div>
                <div className="mt-auto pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-sm uppercase tracking-widest text-gray-500">
                    {POOL_DATA.protocol}
                  </span>
                  <a
                    href={`https://etherscan.io/address/${POOL_DATA.hookAddressFull}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm uppercase tracking-widest text-purple-400 font-mono flex items-center gap-1 hover:text-purple-300 transition-colors"
                  >
                    <Droplets size={10} />
                    V4_HOOK
                    <ExternalLink size={9} className="opacity-60" />
                  </a>
                </div>
              </div>

              {/* Stats Cards — 3 panels */}
              <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                {/* PRICE */}
                <div className="p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px]">
                  <div className="text-sm text-gray-500 uppercase tracking-widest mb-4 flex justify-between">
                    PRICE <ArrowUpDown size={15} className="opacity-90" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <StatItem
                      label="INDEX"
                      value={POOL_DATA.indexPrice.toFixed(4)}
                    />
                    <StatItem
                      label="MARK"
                      value={POOL_DATA.markPrice.toFixed(4)}
                    />
                    <div className="col-span-2">
                      <div className="text-sm text-gray-500 uppercase tracking-widest mb-1">Funding</div>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-sm font-light tracking-tight ${POOL_DATA.fundingDirection === "longs" ? "text-red-400" : "text-green-400"}`}>
                          {POOL_DATA.fundingRate.toFixed(4)}%
                        </span>
                        <span className="text-sm text-gray-500 uppercase tracking-widest">
                          {POOL_DATA.fundingDirection === "longs" ? "Longs pay Shorts" : "Shorts pay Longs"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* POOL */}
                <div className="p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px]">
                  <div className="text-sm text-gray-500 uppercase tracking-widest mb-4 flex justify-between">
                    POOL <Droplets size={15} className="opacity-90" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <StatItem
                      label="TVL"
                      value={`$${(POOL_DATA.tvl / 1e6).toFixed(2)}M`}
                    />
                    <StatItem
                      label="VOLUME"
                      value={`$${(POOL_DATA.volume24h / 1e3).toFixed(0)}K`}
                    />
                    <StatItem
                      label="FEES_24H"
                      value={`$${POOL_DATA.fees24h.toLocaleString()}`}
                    />
                    <StatItem label="FEE" value={POOL_DATA.feeTier} />
                  </div>
                </div>

                {/* YIELD APR */}
                <div className="p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px]">
                  <div className="text-sm text-gray-500 uppercase tracking-widest mb-4 flex justify-between">
                    YIELD APR <TrendingUp size={15} className="opacity-90" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <StatItem
                      label="WEEKLY"
                      value={`${POOL_DATA.aprWeekly}%`}
                      valueClassName="text-green-400"
                    />
                    <StatItem
                      label="YEARLY"
                      value={`${POOL_DATA.aprYearly}%`}
                      valueClassName="text-green-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2. CHART */}
            <div className="relative flex-1 min-h-[350px] md:min-h-[400px] border border-white/10">
              {/* Chart Header — series legend left, view tabs right */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#0a0a0a]">
                {/* LEFT: Series legend */}
                <div className="flex items-center gap-5">
                  {activeChartConfig.areas.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="w-2 h-2"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-sm uppercase tracking-widest text-gray-400">
                        {s.name}
                      </span>
                    </div>
                  ))}
                </div>

                {/* RIGHT: View switcher */}
                <div className="flex items-center gap-1">
                  {Object.entries(CHART_VIEWS).map(([key, view]) => (
                    <button
                      key={key}
                      onClick={() => setChartView(key)}
                      className={`px-3 py-1 text-sm font-semibold uppercase tracking-widest transition-colors ${
                        chartView === key
                          ? "text-white bg-white/10"
                          : "text-gray-600 hover:text-gray-400"
                      }`}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart body */}
              <div className="h-[350px] md:h-[500px] w-full p-4">
                <RLDPerformanceChart
                  data={chartData}
                  areas={activeChartConfig.areas}
                  resolution="1D"
                />
              </div>
            </div>
          </div>

          {/* === RIGHT COLUMN: TRADING TERMINAL (Span 3) === */}
          <TradingTerminal
            title="Pool_Liquidity"
            Icon={Droplets}
            subTitle="V4"
            tabs={[
              {
                id: "ADD",
                label: "Add",
                onClick: () => setActiveTab("ADD"),
                isActive: activeTab === "ADD",
                color: "cyan",
              },
              {
                id: "REMOVE",
                label: "Remove",
                onClick: () => setActiveTab("REMOVE"),
                isActive: activeTab === "REMOVE",
                color: "pink",
              },
            ]}
            actionButton={{
              label: activeTab === "ADD" ? "Add Liquidity" : "Remove Liquidity",
              onClick: () => {
                if (activeTab === "ADD") {
                  setShowAddModal(true);
                } else if (activeTab === "REMOVE" && selectedPosition) {
                  const pos = USER_POSITIONS.find(p => p.id === selectedPosition);
                  if (pos) setWithdrawPosition(pos);
                }
              },
              disabled: false,
              variant: activeTab === "ADD" ? "cyan" : "pink",
            }}
            footer={null}
          >
            {/* === ADD LIQUIDITY === */}
            {activeTab === "ADD" && (
              <>
                {/* Price Range */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm uppercase tracking-widest font-bold text-gray-500">
                      Price Range
                    </span>
                    <button
                      onClick={() => { setMinPrice("0.0001"); setMaxPrice("100"); }}
                      className="text-sm text-cyan-500 uppercase tracking-widest hover:text-cyan-400 transition-colors"
                    >
                      Full Range
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-white/10 bg-[#060606] p-3">
                      <div className="text-sm text-gray-500 uppercase tracking-widest mb-1">
                        Min Price
                      </div>
                      <input
                        type="number"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        className="w-full bg-transparent text-white text-sm font-mono focus:outline-none"
                        placeholder="0.00"
                      />
                      <div className="text-sm text-gray-600 mt-1">
                        {POOL_DATA.token0.symbol} per {POOL_DATA.token1.symbol}
                      </div>
                    </div>
                    <div className="border border-white/10 bg-[#060606] p-3">
                      <div className="text-sm text-gray-500 uppercase tracking-widest mb-1">
                        Max Price
                      </div>
                      <input
                        type="number"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                        className="w-full bg-transparent text-white text-sm font-mono focus:outline-none"
                        placeholder="0.00"
                      />
                      <div className="text-sm text-gray-600 mt-1">
                        {POOL_DATA.token0.symbol} per {POOL_DATA.token1.symbol}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Token Amounts */}
                <InputGroup
                  label={POOL_DATA.token0.symbol}
                  subLabel="Balance: 50,000.00"
                  value={token0Amount}
                  onChange={setToken0Amount}
                  suffix={POOL_DATA.token0.symbol}
                  onMax={() => setToken0Amount("50000")}
                />
                <InputGroup
                  label={POOL_DATA.token1.symbol}
                  subLabel="Balance: 48,200.00"
                  value={token1Amount}
                  onChange={setToken1Amount}
                  suffix={POOL_DATA.token1.symbol}
                  onMax={() => setToken1Amount("48200")}
                />

                {/* Summary */}
                <div className="space-y-2 pt-2 border-t border-white/10">
                  <SummaryRow label="Pool" value={POOL_DATA.pair} />
                  <SummaryRow label="Fee Tier" value={POOL_DATA.feeTier} />
                  <SummaryRow
                    label="Current Price"
                    value={POOL_DATA.currentPrice.toFixed(4)}
                  />
                  <SummaryRow
                    label="Est. APR"
                    value={`${POOL_DATA.apr}%`}
                    valueColor="text-green-400"
                  />
                </div>
              </>
            )}

            {/* === REMOVE LIQUIDITY === */}
            {activeTab === "REMOVE" && (
              <>
                {/* Position Selector */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm uppercase tracking-widest font-bold text-gray-500">
                      {selectedPosition ? "Position" : "Select Position"}
                    </span>
                    {selectedPosition && (
                      <button
                        onClick={() => setSelectedPosition(null)}
                        className="text-sm text-pink-500 uppercase tracking-widest hover:text-pink-400 transition-colors"
                      >
                        Change
                      </button>
                    )}
                  </div>

                  {/* Collapsed: show selected position only */}
                  {selectedPosition && (() => {
                    const pos = USER_POSITIONS.find(p => p.id === selectedPosition);
                    if (!pos) return null;
                    return (
                      <div className="flex items-center justify-between p-3 border border-pink-500/50 bg-pink-500/5">
                        <div>
                          <div className="text-sm font-mono text-white">
                            #{pos.id} · {pos.priceLower.toFixed(2)} – {pos.priceUpper.toFixed(2)}
                          </div>
                          <div className="text-sm text-gray-500 font-mono">
                            ${pos.liquidity} liquidity
                          </div>
                        </div>
                        <span className="text-sm font-mono text-green-400">
                          +${(parseFloat(pos.feesEarned0) + parseFloat(pos.feesEarned1)).toFixed(2)}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Expanded: show paginated list */}
                  {!selectedPosition && (
                    <>
                      {paginatedRemove.map((pos) => (
                        <button
                          key={pos.id}
                          onClick={() => setSelectedPosition(pos.id)}
                          className="w-full text-left border p-3 transition-all border-white/10 bg-[#060606] hover:border-white/20 flex items-center justify-between"
                        >
                          <div>
                            <div className="text-sm font-mono text-white">
                              #{pos.id} · {pos.priceLower.toFixed(2)} –{" "}
                              {pos.priceUpper.toFixed(2)}
                            </div>
                            <div className="text-sm text-gray-500 font-mono">
                              ${pos.liquidity} liquidity
                            </div>
                          </div>
                          <div
                            className="text-sm font-mono text-green-400"
                          >
                            +${(parseFloat(pos.feesEarned0) + parseFloat(pos.feesEarned1)).toFixed(2)}
                          </div>
                        </button>
                      ))}
                      {/* Remove tab pagination */}
                      {totalRemovePages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                          <button
                            onClick={() => setRemovePage(Math.max(1, removePage - 1))}
                            disabled={removePage === 1}
                            className="text-sm font-mono uppercase tracking-widest text-gray-500 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
                          >
                            ← Prev
                          </button>
                          <span className="text-sm font-mono text-gray-600">
                            {removePage} / {totalRemovePages}
                          </span>
                          <button
                            onClick={() => setRemovePage(Math.min(totalRemovePages, removePage + 1))}
                            disabled={removePage === totalRemovePages}
                            className="text-sm font-mono uppercase tracking-widest text-gray-500 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
                          >
                            Next →
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Remove Percentage */}
                {selectedPosition && (
                  <>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm uppercase tracking-widest font-bold text-gray-500">
                          Amount
                        </span>
                        <span className="text-xl font-mono text-white">
                          {removePercent}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={removePercent}
                        onChange={(e) =>
                          setRemovePercent(Number(e.target.value))
                        }
                        className="w-full accent-pink-500 h-1"
                      />
                      <div className="grid grid-cols-4 gap-2">
                        {[25, 50, 75, 100].map((pct) => (
                          <button
                            key={pct}
                            onClick={() => setRemovePercent(pct)}
                            className={`py-1.5 text-sm font-bold uppercase tracking-widest border transition-colors ${
                              removePercent === pct
                                ? "border-pink-500/50 text-pink-400 bg-pink-500/10"
                                : "border-white/10 text-gray-500 hover:text-white hover:border-white/20"
                            }`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <SummaryRow
                        label={POOL_DATA.token0.symbol}
                        value={`${(
                          (parseFloat(
                            USER_POSITIONS.find(
                              (p) => p.id === selectedPosition,
                            )?.token0Amount.replace(",", "") || 0,
                          ) *
                            removePercent) /
                          100
                        ).toFixed(2)}`}
                      />
                      <SummaryRow
                        label={POOL_DATA.token1.symbol}
                        value={`${(
                          (parseFloat(
                            USER_POSITIONS.find(
                              (p) => p.id === selectedPosition,
                            )?.token1Amount.replace(",", "") || 0,
                          ) *
                            removePercent) /
                          100
                        ).toFixed(2)}`}
                      />
                      <SummaryRow
                        label="Unclaimed Fees"
                        value={`$${(
                          parseFloat(
                            USER_POSITIONS.find(
                              (p) => p.id === selectedPosition,
                            )?.feesEarned0.replace(",", "") || 0,
                          ) +
                          parseFloat(
                            USER_POSITIONS.find(
                              (p) => p.id === selectedPosition,
                            )?.feesEarned1.replace(",", "") || 0,
                          )
                        ).toFixed(2)}`}
                        valueColor="text-green-400"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </TradingTerminal>
        </div>

        {/* 3. POSITIONS TABLE (aligned to left panel width) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-9 border border-white/10">
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-widest">
                    Your Positions
                  </h3>
                </div>
                <div className="text-sm text-gray-500 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={12} />
                  ACTIVE
                </div>
              </div>

              {/* Table Header */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-sm text-gray-500 uppercase tracking-widest border-b border-white/5 text-center">
                <div className="col-span-1 text-left">#</div>
                <div className="col-span-2 text-left">Range</div>
                <div className="col-span-2">Liquidity</div>
                <div className="col-span-2">Token 0</div>
                <div className="col-span-2">Token 1</div>
                <div className="col-span-2">Fees Earned</div>
                <div className="col-span-1">Action</div>
              </div>

              {/* Table Rows */}
              {paginatedPositions.map((pos) => (
                <div key={pos.id}>
                  <div
                    className="grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors border-b border-white/5 last:border-b-0 items-center text-center"
                  >
                    <div className="col-span-1 text-sm text-gray-500 font-mono text-left">
                      {pos.id}
                    </div>
                    <div className="col-span-2 text-left">
                      <div className="text-sm font-mono text-white">
                        {pos.priceLower.toFixed(4)} –{" "}
                        {pos.priceUpper.toFixed(4)}
                      </div>
                    </div>
                    <div className="col-span-2 text-sm font-mono text-white">
                      ${pos.liquidity}
                    </div>
                    <div className="col-span-2 text-sm font-mono text-white">
                      {pos.token0Amount}{" "}
                      <span className="text-gray-500 text-sm">
                        {POOL_DATA.token0.symbol}
                      </span>
                    </div>
                    <div className="col-span-2 text-sm font-mono text-white">
                      {pos.token1Amount}{" "}
                      <span className="text-gray-500 text-sm">
                        {POOL_DATA.token1.symbol}
                      </span>
                    </div>
                    <div className="col-span-2 text-sm font-mono">
                      <span className="text-green-400">
                        +$
                        {(
                          parseFloat(pos.feesEarned0.replace(",", "")) +
                          parseFloat(pos.feesEarned1.replace(",", ""))
                        ).toFixed(2)}
                      </span>
                    </div>
                    <div className="col-span-1 relative flex justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionDropdown(actionDropdown === pos.id ? null : pos.id);
                        }}
                        className="p-1.5 text-gray-600 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <ChevronDown size={16} className={`transition-transform ${actionDropdown === pos.id ? 'rotate-180' : ''}`} />
                      </button>
                      {actionDropdown === pos.id && (
                        <div className="absolute right-0 top-full mt-1 z-50 border border-white/10 bg-[#0a0a0a] backdrop-blur-sm min-w-[150px]">
                          <button
                            onClick={() => {
                              setActionDropdown(null);
                              setClaimPosition(pos);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/5 transition-colors font-mono"
                          >
                            Claim Fees
                          </button>
                          <button
                            onClick={() => {
                              setActionDropdown(null);
                              setWithdrawPosition(pos);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/5 transition-colors border-t border-white/5 font-mono"
                          >
                            Withdraw
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Positions table pagination */}
              {totalPosPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-white/5">
                  <button
                    onClick={() => setPosPage(Math.max(1, posPage - 1))}
                    disabled={posPage === 1}
                    className="text-sm font-mono uppercase tracking-widest text-gray-500 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  <span className="text-sm font-mono text-gray-600">
                    Page {posPage} of {totalPosPages} · {USER_POSITIONS.length} positions
                  </span>
                  <button
                    onClick={() => setPosPage(Math.min(totalPosPages, posPage + 1))}
                    disabled={posPage === totalPosPages}
                    className="text-sm font-mono uppercase tracking-widest text-gray-500 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
          </div>{/* close col-span-9 */}
        </div>{/* close grid */}
      </div>{/* close max-w container */}

      {/* Claim Fees Modal */}
      <ClaimFeesModal
        isOpen={!!claimPosition}
        onClose={() => setClaimPosition(null)}
        onConfirm={() => {
          // TODO: execute claim transaction
          setClaimPosition(null);
        }}
        position={claimPosition}
        token0={POOL_DATA.token0}
        token1={POOL_DATA.token1}
      />

      {/* Withdraw Modal */}
      <WithdrawModal
        isOpen={!!withdrawPosition}
        onClose={() => setWithdrawPosition(null)}
        onConfirm={(percent) => {
          // TODO: execute withdraw transaction
          setWithdrawPosition(null);
        }}
        position={withdrawPosition}
        token0={POOL_DATA.token0}
        token1={POOL_DATA.token1}
      />

      {/* Add Liquidity Modal */}
      <AddLiquidityModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onConfirm={() => {
          // TODO: execute add liquidity transaction
          setShowAddModal(false);
        }}
        minPrice={minPrice}
        maxPrice={maxPrice}
        token0Amount={token0Amount}
        token1Amount={token1Amount}
        token0={POOL_DATA.token0}
        token1={POOL_DATA.token1}
        pool={POOL_DATA}
      />
    </div>
  );
}
