import React, { useState, useMemo, useEffect } from "react";
import {
  Loader2,
  Terminal,
  Activity,
  TrendingUp,
  TrendingDown,
  Shield,
  Layers,
  Gauge,
  ArrowUpDown,
  RefreshCw,
  Droplets,
  Wallet,
  CheckCircle,
} from "lucide-react";
import { useSimulation } from "../hooks/useSimulation";
import { useChartControls } from "../hooks/useChartControls";
import { useWallet } from "../context/WalletContext";
import { useFaucet } from "../hooks/useFaucet";
import { CONTRACTS, MARKET_ID } from "../config/simulationConfig";
import RLDPerformanceChart from "./RLDChart";
import ChartControlBar from "./ChartControlBar";

import BrokerPositions from "./BrokerPositions";
import StatItem from "./StatItem";
import TradingTerminal, { InputGroup, SummaryRow } from "./TradingTerminal";
import SettingsButton from "./SettingsButton";

// ── Sub-components ────────────────────────────────────────────

function SimMetricBox({ label, value, sub, Icon = Activity, dimmed }) {
  return (
    <div
      className={`p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px] ${
        dimmed ? "opacity-30" : ""
      }`}
    >
      <div className="text-[10px] md:text-[12px] text-gray-500 uppercase tracking-widest mb-2 flex justify-between">
        {label} <Icon size={15} className="opacity-90" />
      </div>
      <div>
        <div className="text-2xl md:text-3xl font-light text-white mb-1 md:mb-2 tracking-tight">
          {value}
        </div>
        <div className="text-[10px] md:text-[12px] text-gray-500 uppercase tracking-widest">
          {sub}
        </div>
      </div>
    </div>
  );
}

function EventsFeed({ events = [] }) {
  if (events.length === 0) {
    return (
      <div className="text-xs text-gray-600 uppercase tracking-widest text-center py-4">
        No recent swaps
      </div>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-white/5 max-h-[200px] overflow-y-auto custom-scrollbar">
      {events.slice(0, 10).map((e) => {
        const amount0 = BigInt(e.data?.amount0 || "0");
        const amount1 = BigInt(e.data?.amount1 || "0");
        const isBuy = amount0 < 0n;
        const ts = new Date(e.timestamp * 1000);
        const timeStr = ts.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        return (
          <div
            key={e.id}
            className="py-2 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 ${
                  isBuy
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {isBuy ? "BUY" : "SELL"}
              </span>
              <span className="text-[11px] text-gray-500 font-mono">
                {timeStr}
              </span>
            </div>
            <div className="text-[11px] font-mono text-gray-400 flex-shrink-0">
              {formatAmount(amount0, amount1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatAmount(a0, a1) {
  // Show the outgoing amount (negative side) as the size
  const raw = a0 < 0n ? -a0 : -a1;
  const num = Number(raw) / 1e6;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toFixed(0);
}

// ── Main Component ────────────────────────────────────────────

export default function SimulationTerminal() {
  const sim = useSimulation({ pollInterval: 2000 });
  const {
    connected,
    loading,
    error,
    market,
    pool,
    funding,
    fundingFromNF,
    oracleChange24h,
    volumeData,
    protocolStats,
    marketInfo,
    brokers,
    chartData,
    events,
    blockChanged,
    blockNumber,
    totalBlocks,
    totalEvents,
  } = sim;

  // Wallet & Faucet
  const { account, connectWallet } = useWallet();
  const {
    requestFaucet,
    loading: faucetLoading,
    error: faucetError,
    step: faucetStep,
    waUsdcBalance,
  } = useFaucet(account);

  // Chart controls
  const controls = useChartControls({
    defaultRange: "ALL",
    defaultDays: 9999,
    defaultResolution: "1D",
  });
  const { resolution } = controls;

  // Trading State
  const [tradeSide, setTradeSide] = useState("LONG");
  const [collateral, setCollateral] = useState(1000);
  const [shortCR, setShortCR] = useState(150);

  // PnL Simulation State
  const [simTargetRate, setSimTargetRate] = useState(null);

  // Chart series visibility
  const [hiddenSeries, setHiddenSeries] = useState([]);
  const toggleSeries = (key) => {
    setHiddenSeries((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  // Chart stats
  const chartStats = useMemo(() => {
    if (!chartData.length) return null;
    const indexes = chartData
      .filter((d) => d.indexPrice != null)
      .map((d) => d.indexPrice);
    const marks = chartData
      .filter((d) => d.markPrice != null)
      .map((d) => d.markPrice);

    if (indexes.length === 0) return null;
    const mean = indexes.reduce((a, b) => a + b, 0) / indexes.length;
    const min = Math.min(...indexes);
    const max = Math.max(...indexes);
    const variance =
      indexes.reduce((s, v) => s + (v - mean) ** 2, 0) / indexes.length;
    return {
      mean,
      min,
      max,
      vol: Math.sqrt(variance),
      markMean:
        marks.length > 0 ? marks.reduce((a, b) => a + b, 0) / marks.length : 0,
    };
  }, [chartData]);

  const areas = useMemo(
    () =>
      [
        { key: "indexPrice", name: "Index Price", color: "#22d3ee" },
        { key: "markPrice", name: "Mark Price", color: "#ec4899" },
      ].filter((a) => !hiddenSeries.includes(a.key)),
    [hiddenSeries],
  );

  // ── Trading calculations ────────────────────────────────────
  const currentRate = market?.indexPrice || 0;

  const { notional, liqRate } = useMemo(() => {
    if (tradeSide === "LONG") {
      return { notional: collateral, liqRate: null };
    }
    const crDecimal = shortCR / 100;
    return {
      notional: crDecimal > 0 ? collateral / crDecimal : 0,
      liqRate: currentRate * (shortCR / 110),
    };
  }, [tradeSide, collateral, shortCR, currentRate]);

  const handleShortAmountChange = (newAmount) => {
    if (newAmount > 0) {
      const newCR = (collateral / newAmount) * 100;
      setShortCR(Math.min(Math.max(newCR, 110), 1500));
    }
  };

  const handleLongAmountChange = (newAmount) => {
    setCollateral(newAmount);
  };

  // Init sim target rate when data loads
  useEffect(() => {
    if (simTargetRate === null && currentRate > 0) {
      setSimTargetRate(currentRate);
    }
  }, [currentRate, simTargetRate]);

  const simPnL = useMemo(() => {
    if (!simTargetRate) return { value: 0, percent: 0 };
    let pnl = 0;
    if (tradeSide === "LONG") {
      pnl = ((simTargetRate - currentRate) / 100) * notional;
    } else {
      pnl = ((currentRate - simTargetRate) / 100) * notional;
    }
    const percent = collateral > 0 ? (pnl / collateral) * 100 : 0;
    return { value: pnl, percent };
  }, [simTargetRate, tradeSide, currentRate, notional, collateral]);

  // ── Error / Loading ─────────────────────────────────────────
  if (error && !connected) {
    return (
      <div className="min-h-screen bg-[#050505] text-gray-300 font-mono flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-red-500 text-xs uppercase tracking-widest">
            SIM_DISCONNECTED
          </div>
          <div className="text-gray-600 text-[11px] max-w-xs">
            Cannot reach simulation indexer. Make sure the Docker simulation
            stack is running.
          </div>
          <div className="text-[10px] text-gray-700 font-mono">
            Expected at: http://localhost:8080
          </div>
        </div>
      </div>
    );
  }

  if (loading || !market) {
    return (
      <div className="min-h-screen bg-[#050505] text-gray-300 font-mono flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
          <span className="text-[10px] uppercase tracking-widest text-gray-500">
            Connecting to simulation...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-[#e0e0e0] font-mono selection:bg-white selection:text-black flex flex-col">
      {/* MAIN CONTENT */}
      <div className="max-w-[1800px] mx-auto w-full px-6 flex-1 flex flex-col gap-6 pt-0 pb-12">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          {/* === LEFT COLUMN (Span 9) === */}
          <div className="xl:col-span-9 flex flex-col gap-4">
            {/* 1. METRICS GRID */}
            <div className="border border-white/10 grid grid-cols-1 lg:grid-cols-12">
              {/* Branding */}
              <div className="lg:col-span-4 flex flex-col justify-between p-6 border-b lg:border-b-0 lg:border-r border-white/10 h-full min-h-[180px]">
                <div>
                  <div className="text-[10px] text-gray-700 mb-6 font-mono leading-tight tracking-tight">
                    {MARKET_ID.slice(0, 18)}...{MARKET_ID.slice(-8)}
                  </div>
                  <h2 className="text-3xl font-medium tracking-tight mb-2 leading-none">
                    RLD PROTOCOL
                    <br />
                    <span className="text-gray-600">SIMULATION</span>
                  </h2>
                </div>
                <div className="mt-auto pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">
                    RLD_Core
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-cyan-500 font-mono">
                    {CONTRACTS.rldCore.slice(0, 6)}...
                    {CONTRACTS.rldCore.slice(-4)}
                  </span>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                {/* PRICE */}
                <div className="p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px]">
                  <div className="text-[10px] md:text-[12px] text-gray-500 uppercase tracking-widest mb-4 flex justify-between">
                    PRICE <Terminal size={15} className="opacity-90" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <StatItem
                      label="ORACLE"
                      value={market.indexPrice.toFixed(4)}
                    />
                    <StatItem
                      label="24H_CHG"
                      value={
                        oracleChange24h != null
                          ? `${oracleChange24h >= 0 ? "+" : ""}${oracleChange24h.toFixed(2)}%`
                          : "—"
                      }
                      valueClassName={
                        oracleChange24h != null
                          ? oracleChange24h >= 0
                            ? "text-green-400"
                            : "text-red-400"
                          : "text-white"
                      }
                    />
                    <StatItem
                      label="MARK"
                      value={pool ? pool.markPrice.toFixed(4) : "—"}
                    />
                    <StatItem
                      label="FUNDING_ANN"
                      value={
                        fundingFromNF
                          ? `${fundingFromNF.annualPct >= 0 ? "+" : ""}${fundingFromNF.annualPct.toFixed(2)}%`
                          : "—"
                      }
                    />
                  </div>
                </div>

                {/* PROTOCOL */}
                <div className="p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px]">
                  <div className="text-[10px] md:text-[12px] text-gray-500 uppercase tracking-widest mb-4 flex justify-between">
                    PROTOCOL <Shield size={15} className="opacity-90" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <StatItem
                      label="TVL"
                      value={
                        protocolStats
                          ? `$${(protocolStats.totalCollateral / 1e6).toFixed(2)}M`
                          : "—"
                      }
                    />
                    <StatItem
                      label="VOL_24H"
                      value={volumeData?.volume_formatted || "—"}
                    />
                    <StatItem
                      label="TOTAL_DEBT"
                      value={
                        protocolStats
                          ? `$${(protocolStats.totalDebtUsd / 1e6).toFixed(2)}M`
                          : "—"
                      }
                    />
                    <StatItem
                      label="HEALTH"
                      value={
                        protocolStats
                          ? `${protocolStats.overCollat.toFixed(1)}%`
                          : "—"
                      }
                      valueClassName={
                        protocolStats
                          ? protocolStats.overCollat >= 200
                            ? "text-green-400"
                            : protocolStats.overCollat >= 120
                              ? "text-yellow-400"
                              : "text-red-400"
                          : "text-white"
                      }
                    />
                  </div>
                </div>

                {/* MARKET */}
                <div className="p-4 md:p-6 flex flex-col justify-between h-full min-h-[120px] md:min-h-[180px]">
                  <div className="text-[10px] md:text-[12px] text-gray-500 uppercase tracking-widest flex justify-between">
                    MARKET <Shield size={15} className="opacity-90" />
                  </div>
                  <div className="grid grid-cols-[3fr_2fr] gap-x-4 gap-y-6 mt-auto">
                    <StatItem
                      label="COLLATERAL"
                      value={marketInfo?.collateral?.name || "—"}
                      valueClassName="text-white !text-[17px] whitespace-nowrap"
                    />
                    <StatItem
                      label="MIN_COL"
                      value={marketInfo?.risk_params?.min_col_ratio_pct || "—"}
                    />
                    <StatItem
                      label="POS_TOKEN"
                      value={marketInfo?.position_token?.symbol || "—"}
                      valueClassName="text-white !text-[17px]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2. CONTROLS */}
            <ChartControlBar controls={controls} />

            {/* 3. CHART */}
            <div className="relative flex-1 min-h-[350px] md:min-h-[400px]">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-4 px-1 gap-3 md:gap-0">
                <div className="flex gap-4 md:gap-8 flex-wrap">
                  {[
                    {
                      key: "indexPrice",
                      label: "Index_Price",
                      bg: "bg-cyan-400",
                    },
                    {
                      key: "markPrice",
                      label: "Mark_Price",
                      bg: "bg-pink-500",
                    },
                  ].map((s) => (
                    <div
                      key={s.key}
                      className={`flex items-center gap-2 cursor-pointer transition-all ${
                        hiddenSeries.includes(s.key)
                          ? "opacity-50 line-through"
                          : "opacity-100 hover:opacity-80"
                      }`}
                      onClick={() => toggleSeries(s.key)}
                    >
                      <div className={`w-2 h-2 ${s.bg}`}></div>
                      <span className="text-[11px] uppercase tracking-widest">
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Period stats */}
                {chartStats && (
                  <div className="text-[11px] font-mono text-gray-500 uppercase tracking-widest flex items-center gap-4">
                    <span>
                      Range:{" "}
                      <span className="text-white">
                        {chartStats.min.toFixed(2)} –{" "}
                        {chartStats.max.toFixed(2)}
                      </span>
                    </span>
                    <span>
                      Vol:{" "}
                      <span className="text-white">
                        ±{chartStats.vol.toFixed(3)}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              <div className="h-[350px] md:h-[500px] w-full border border-white/10 p-4 bg-[#080808]">
                {chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="animate-spin text-gray-700" />
                  </div>
                ) : (
                  <RLDPerformanceChart
                    data={chartData}
                    areas={areas}
                    resolution={resolution}
                  />
                )}
              </div>
            </div>
          </div>

          {/* === RIGHT COLUMN: TRADING TERMINAL (Span 3) — matches /app layout === */}
          <TradingTerminal
            account={account}
            connectWallet={connectWallet}
            title="Synthetic_Rates"
            Icon={Terminal}
            subTitle="SIM"
            tabs={[
              {
                id: "LONG",
                label: "Long",
                onClick: () => setTradeSide("LONG"),
                isActive: tradeSide === "LONG",
                color: "cyan",
              },
              {
                id: "SHORT",
                label: "Short",
                onClick: () => setTradeSide("SHORT"),
                isActive: tradeSide === "SHORT",
                color: "pink",
              },
            ]}
            actionButton={{
              label: "SIM_ONLY · READ_ONLY",
              onClick: () => {},
              disabled: true,
              variant: tradeSide === "LONG" ? "cyan" : "pink",
            }}
            footer={
              <div className="border-t border-white/10 p-6 flex flex-col gap-4 bg-[#0a0a0a]">
                <div className="flex justify-between items-center">
                  <span className="text-xs uppercase tracking-widest text-gray-500 font-bold">
                    PnL_Simulator
                  </span>
                  <RefreshCw
                    size={15}
                    className="text-gray-600 cursor-pointer hover:text-white transition-colors"
                    onClick={() => setSimTargetRate(currentRate)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[13px] text-gray-500 font-mono">
                    <span>Rate_Scenario</span>
                    <span>
                      {simTargetRate ? simTargetRate.toFixed(2) : "0.00"}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="0.1"
                    value={simTargetRate || currentRate}
                    onChange={(e) => setSimTargetRate(Number(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-none appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-none"
                  />
                  <div className="flex justify-between gap-1">
                    {[-50, -10, 10, 50].map((pct) => (
                      <SettingsButton
                        key={pct}
                        onClick={() =>
                          setSimTargetRate(currentRate * (1 + pct / 100))
                        }
                        className="flex-1"
                      >
                        {pct > 0 ? "+" : ""}
                        {pct}%
                      </SettingsButton>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-end">
                    <span className="text-[13px] text-gray-500">
                      Est. PnL (1Y)
                    </span>
                    <div
                      className={`text-right ${
                        simPnL.value >= 0 ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      <div className="text-xl font-mono leading-none">
                        {simPnL.value >= 0 ? "+" : ""}
                        {simPnL.value.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}{" "}
                        USDC
                      </div>
                      <div className="text-[12px] font-mono mt-1">
                        {simPnL.percent.toFixed(2)}% ROI
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            }
          >
            {/* Faucet Section */}
            {account && (
              <div className="border border-white/10 p-4 space-y-3 bg-white/[0.02]">
                <button
                  onClick={() => requestFaucet(account)}
                  disabled={faucetLoading}
                  className={`w-full py-2.5 text-[11px] font-bold tracking-[0.15em] uppercase transition-all focus:outline-none rounded-none border ${
                    faucetLoading
                      ? "border-white/10 text-gray-600 cursor-wait"
                      : "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/50"
                  }`}
                >
                  {faucetLoading ? (
                    <Loader2 size={14} className="animate-spin mx-auto" />
                  ) : waUsdcBalance ? (
                    <span className="flex items-center justify-center gap-2">
                      <Droplets size={12} />
                      Faucet · Request Again
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Droplets size={12} />
                      Request 100K waUSDC + ETH
                    </span>
                  )}
                </button>
                {faucetError && (
                  <div className="text-[10px] text-red-400 font-mono truncate">
                    Error: {faucetError}
                  </div>
                )}
              </div>
            )}

            {/* Collateral Input */}
            <InputGroup
              label="Collateral"
              subLabel={
                waUsdcBalance
                  ? `BAL: ${parseFloat(waUsdcBalance).toLocaleString()}`
                  : "SIM_MODE"
              }
              value={collateral}
              onChange={(v) => setCollateral(Number(v))}
              suffix="USDC"
            />

            {/* LONG: Amount */}
            {tradeSide === "LONG" && (
              <InputGroup
                label="Amount_Notional"
                value={notional > 0 ? parseFloat(notional.toFixed(2)) : ""}
                onChange={(v) => handleLongAmountChange(Number(v))}
                suffix="USDC"
              />
            )}

            {/* SHORT: Amount & CR */}
            {tradeSide === "SHORT" && (
              <>
                <InputGroup
                  label="Amount_Notional"
                  value={notional > 0 ? parseFloat(notional.toFixed(2)) : ""}
                  onChange={(v) => handleShortAmountChange(Number(v))}
                  suffix="USDC"
                />

                <div className="space-y-2">
                  <div className="flex justify-between text-[12px] uppercase tracking-widest font-bold text-gray-500">
                    <span>Collateral_Ratio</span>
                    <span className="text-white">{shortCR.toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="110"
                    max="1500"
                    step="10"
                    value={shortCR}
                    onChange={(e) => setShortCR(Number(e.target.value))}
                    className="w-full h-0.5 bg-white/10 rounded-none appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-none"
                  />
                  <div className="flex justify-between text-[12px] text-gray-500 font-mono">
                    <span>110%</span>
                    <span>1500%</span>
                  </div>
                </div>
              </>
            )}

            {/* Stats Box */}
            <div className="border border-white/10 p-4 space-y-2 bg-white/[0.02] text-[12px]">
              <SummaryRow
                label="Entry_Rate"
                value={`${currentRate.toFixed(4)}`}
              />
              <div className="flex justify-between items-center">
                <span className="text-gray-500 uppercase text-[12px]">
                  Liq. Rate
                </span>
                <span className="font-mono text-orange-500 text-[12px]">
                  {liqRate ? `${liqRate.toFixed(4)}` : "None"}
                </span>
              </div>
              <SummaryRow
                label="Notional"
                value={`$${notional.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}`}
              />
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-500 uppercase text-[12px]">
                  Est. Fee
                </span>
                <span className="font-mono text-gray-400">
                  {(notional * 0.001).toFixed(2)} USDC
                </span>
              </div>
            </div>
          </TradingTerminal>
        </div>

        {/* === BOTTOM ROW: BROKER POSITIONS | FUNDING | EVENTS (full width) === */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Broker Positions */}
          <div className="border border-white/10 bg-[#080808] flex flex-col">
            <div className="p-4 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center h-[50px]">
              <h3 className="text-xs font-bold tracking-widest text-white uppercase flex items-center gap-2">
                <Layers size={14} className="text-gray-500" />
                Broker_Positions
              </h3>
              <span className="text-[11px] text-gray-600 uppercase tracking-widest font-mono">
                {brokers.length} Active
              </span>
            </div>
            <div className="p-4 md:p-5 flex-1">
              <BrokerPositions brokers={brokers} />
            </div>
          </div>

          {/* Funding Direction */}
          <div className="border border-white/10 bg-[#080808] flex flex-col">
            <div className="p-4 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center h-[50px]">
              <h3 className="text-xs font-bold tracking-widest text-white uppercase flex items-center gap-2">
                <ArrowUpDown size={14} className="text-gray-500" />
                Funding_Direction
              </h3>
              {funding && (
                <span
                  className={`text-[11px] font-bold uppercase tracking-widest ${
                    funding.direction === "LONGS_PAY"
                      ? "text-green-500"
                      : "text-red-500"
                  }`}
                >
                  {funding.direction.replace("_", " ")}
                </span>
              )}
            </div>
            <div className="p-4 md:p-5 flex-1">
              {funding ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">
                      Spread
                    </div>
                    <div
                      className={`text-xl font-mono font-bold ${
                        funding.spread >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {funding.spread >= 0 ? "+" : ""}
                      {funding.spread.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">
                      Spread %
                    </div>
                    <div
                      className={`text-xl font-mono font-bold ${
                        funding.spreadPct >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {funding.spreadPct >= 0 ? "+" : ""}
                      {funding.spreadPct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-gray-700 text-xs uppercase tracking-widest">
                  No funding data
                </div>
              )}
            </div>
          </div>

          {/* Recent Swaps */}
          <div className="border border-white/10 bg-[#080808] flex flex-col">
            <div className="p-4 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center h-[50px]">
              <h3 className="text-xs font-bold tracking-widest text-white uppercase flex items-center gap-2">
                <Gauge size={14} className="text-gray-500" />
                Recent_Swaps
              </h3>
            </div>
            <div className="p-4 md:p-5 flex-1">
              <EventsFeed events={events} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function formatLiquidity(val) {
  if (val >= 1e18) return `${(val / 1e18).toFixed(1)}E`;
  if (val >= 1e15) return `${(val / 1e15).toFixed(1)}P`;
  if (val >= 1e12) return `${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
  return val.toLocaleString();
}

function formatDebt(val) {
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}
