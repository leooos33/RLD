import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";

// ── Mock perps market data ────────────────────────────────────
const MARKETS = [
  {
    address: "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    pair: "ETH / USD",
    base: "USDC",
    price: 3_842.50,
    change24h: 2.34,
    fundingRate: 0.0045,
    openInterest: 45_600_000,
    volume24h: 128_500_000,
    liquidity: 62_300_000,
    protocol: "AAVE",
  },
  {
    address: "0xb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
    pair: "BTC / USD",
    base: "USDC",
    price: 105_230.00,
    change24h: 1.87,
    fundingRate: 0.0032,
    openInterest: 89_200_000,
    volume24h: 312_000_000,
    liquidity: 124_500_000,
    protocol: "AAVE",
  },
  {
    address: "0xc3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
    pair: "SOL / USD",
    base: "USDT",
    price: 198.45,
    change24h: -3.12,
    fundingRate: -0.0028,
    openInterest: 12_800_000,
    volume24h: 67_300_000,
    liquidity: 18_400_000,
    protocol: "Morpho",
  },
  {
    address: "0xd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
    pair: "ARB / USD",
    base: "USDC",
    price: 1.24,
    change24h: -1.45,
    fundingRate: -0.0015,
    openInterest: 3_200_000,
    volume24h: 18_500_000,
    liquidity: 5_600_000,
    protocol: "Morpho",
  },
  {
    address: "0xe5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
    pair: "LINK / USD",
    base: "USDT",
    price: 18.92,
    change24h: 4.56,
    fundingRate: 0.0058,
    openInterest: 5_400_000,
    volume24h: 28_900_000,
    liquidity: 8_200_000,
    protocol: "AAVE",
  },
  {
    address: "0xf6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5",
    pair: "AVAX / USD",
    base: "USDC",
    price: 42.18,
    change24h: 0.82,
    fundingRate: 0.0012,
    openInterest: 4_100_000,
    volume24h: 22_400_000,
    liquidity: 6_800_000,
    protocol: "Compound",
  },
  {
    address: "0xa7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6",
    pair: "DOGE / USD",
    base: "USDT",
    price: 0.3842,
    change24h: -0.54,
    fundingRate: -0.0008,
    openInterest: 2_800_000,
    volume24h: 15_200_000,
    liquidity: 4_100_000,
    protocol: "Morpho",
  },
  {
    address: "0xb8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7",
    pair: "OP / USD",
    base: "USDC",
    price: 2.85,
    change24h: 5.23,
    fundingRate: 0.0072,
    openInterest: 3_600_000,
    volume24h: 19_800_000,
    liquidity: 5_200_000,
    protocol: "Compound",
  },
];

const formatUSD = (val) => {
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toLocaleString()}`;
};

const formatPrice = (val) => {
  if (val >= 1000) return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 1) return `$${val.toFixed(2)}`;
  return `$${val.toFixed(4)}`;
};

export default function PerpsDirectory() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState("volume24h");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ArrowUpDown size={10} className="opacity-30" />;
    return sortDir === "desc"
      ? <ChevronDown size={10} className="text-cyan-400" />
      : <ChevronUp size={10} className="text-cyan-400" />;
  };

  const sortedMarkets = useMemo(() => {
    const markets = [...MARKETS];
    markets.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return markets;
  }, [sortKey, sortDir]);

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-mono selection:bg-white selection:text-black flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full px-6 flex-1 flex flex-col gap-6 pt-0 pb-12">

        {/* Header Metrics */}
        <div className="border border-white/10 grid grid-cols-1 lg:grid-cols-12">
          {/* Branding */}
          <div className="lg:col-span-5 flex flex-col justify-center p-6 border-b lg:border-b-0 lg:border-r border-white/10 min-h-[140px]">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp size={18} className="text-cyan-400" />
              <h1 className="text-2xl font-medium tracking-tight">
                Perpetual Markets
              </h1>
            </div>
            <p className="text-sm text-gray-500 tracking-widest uppercase">
              {MARKETS.length} active markets · RLD Protocol
            </p>
          </div>

          {/* Metrics */}
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
            {/* Total OI */}
            <div className="p-6 flex flex-col justify-center">
              <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">
                Open Interest
              </div>
              <div className="text-2xl font-light tracking-tight text-cyan-400">
                {formatUSD(MARKETS.reduce((s, m) => s + m.openInterest, 0))}
              </div>
            </div>

            {/* Volume 24H */}
            <div className="p-6 flex flex-col justify-center">
              <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">
                Volume 24H
              </div>
              <div className="text-2xl font-light tracking-tight text-white">
                {formatUSD(MARKETS.reduce((s, m) => s + m.volume24h, 0))}
              </div>
            </div>

            {/* Total Liquidity */}
            <div className="p-6 flex flex-col justify-center">
              <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">
                Pool Liquidity
              </div>
              <div className="text-2xl font-light tracking-tight text-white">
                {formatUSD(MARKETS.reduce((s, m) => s + m.liquidity, 0))}
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="border border-white/10">
          {/* Table Header */}
          <div className="hidden md:grid grid-cols-8 gap-4 px-6 py-3 text-sm text-gray-500 uppercase tracking-widest border-b border-white/5 bg-[#0a0a0a]">
            <button onClick={() => toggleSort("pair")} className="relative flex items-center gap-1.5 text-left hover:text-white transition-colors">
              Market <SortIcon col="pair" />
            </button>
            <button onClick={() => toggleSort("price")} className="relative text-center hover:text-white transition-colors">
              Price <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="price" /></span>
            </button>
            <button onClick={() => toggleSort("change24h")} className="relative text-center hover:text-white transition-colors">
              24H <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="change24h" /></span>
            </button>
            <button onClick={() => toggleSort("base")} className="relative text-center hover:text-white transition-colors">
              Base <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="base" /></span>
            </button>
            <button onClick={() => toggleSort("protocol")} className="relative text-center hover:text-white transition-colors">
              Protocol <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="protocol" /></span>
            </button>
            <button onClick={() => toggleSort("openInterest")} className="relative text-center hover:text-white transition-colors">
              Open Interest <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="openInterest" /></span>
            </button>
            <button onClick={() => toggleSort("volume24h")} className="relative text-center hover:text-white transition-colors">
              Volume 24H <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="volume24h" /></span>
            </button>
            <button onClick={() => toggleSort("liquidity")} className="relative text-center hover:text-white transition-colors">
              Pool Liquidity <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="liquidity" /></span>
            </button>
          </div>

          {/* Table Rows */}
          {sortedMarkets.map((market) => (
            <div
              key={market.address}
              onClick={() => navigate(`/markets/perps/${market.address}`)}
              className="grid grid-cols-1 md:grid-cols-8 gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors border-b border-white/5 last:border-b-0 cursor-pointer group items-center"
            >
              {/* Market */}
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.4)]" />
                <div className="text-sm font-mono text-white group-hover:text-cyan-400 transition-colors">
                  {market.pair}
                </div>
              </div>

              {/* Price */}
              <div className="text-sm font-mono text-white text-center">
                {formatPrice(market.price)}
              </div>

              {/* 24H Change */}
              <div className={`text-sm font-mono text-center ${market.change24h >= 0 ? "text-green-400" : "text-red-400"}`}>
                {market.change24h >= 0 ? "+" : ""}{market.change24h.toFixed(2)}%
              </div>

              {/* Base */}
              <div className="text-sm font-mono text-gray-400 text-center">
                {market.base}
              </div>

              {/* Protocol */}
              <div className="text-sm font-mono text-gray-400 text-center">
                {market.protocol}
              </div>

              {/* Open Interest */}
              <div className="text-sm font-mono text-white text-center">
                {formatUSD(market.openInterest)}
              </div>

              {/* Volume 24H */}
              <div className="text-sm font-mono text-white text-center">
                {formatUSD(market.volume24h)}
              </div>

              {/* Pool Liquidity */}
              <div className="text-sm font-mono text-white text-center">
                {formatUSD(market.liquidity)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
