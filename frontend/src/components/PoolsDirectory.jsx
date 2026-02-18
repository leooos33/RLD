import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Droplets, ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";

// ── Mock pool data ────────────────────────────────────────────
const POOLS = [
  {
    address: "0x7a3b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f4f2e",
    pair: "waUSDC / wRLP",
    token0: "waUSDC",
    token1: "wRLP",
    protocol: "Uniswap V4",
    feeTier: "0.30%",
    tvl: 2_450_000,
    volume24h: 890_000,
    volume7d: 5_230_000,
    fees24h: 2_670,
    fees7d: 15_690,
    apr7d: 12.4,
    apr30d: 10.8,
    positions: 33,
    createdAt: "2025-10-15",
  },
  {
    address: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    pair: "USDC / ETH",
    token0: "USDC",
    token1: "ETH",
    protocol: "Uniswap V4",
    feeTier: "0.05%",
    tvl: 18_700_000,
    volume24h: 4_200_000,
    volume7d: 28_500_000,
    fees24h: 2_100,
    fees7d: 14_250,
    apr7d: 8.2,
    apr30d: 7.5,
    positions: 156,
    createdAt: "2025-08-01",
  },
  {
    address: "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    pair: "WBTC / ETH",
    token0: "WBTC",
    token1: "ETH",
    protocol: "Uniswap V4",
    feeTier: "0.30%",
    tvl: 9_800_000,
    volume24h: 2_100_000,
    volume7d: 14_700_000,
    fees24h: 6_300,
    fees7d: 44_100,
    apr7d: 15.8,
    apr30d: 13.2,
    positions: 89,
    createdAt: "2025-09-22",
  },
  {
    address: "0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
    pair: "DAI / USDC",
    token0: "DAI",
    token1: "USDC",
    protocol: "Uniswap V4",
    feeTier: "0.01%",
    tvl: 31_200_000,
    volume24h: 12_500_000,
    volume7d: 87_500_000,
    fees24h: 1_250,
    fees7d: 8_750,
    apr7d: 3.1,
    apr30d: 2.9,
    positions: 210,
    createdAt: "2025-07-10",
  },
  {
    address: "0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e",
    pair: "stETH / ETH",
    token0: "stETH",
    token1: "ETH",
    protocol: "Uniswap V4",
    feeTier: "0.01%",
    tvl: 45_600_000,
    volume24h: 8_900_000,
    volume7d: 62_300_000,
    fees24h: 890,
    fees7d: 6_230,
    apr7d: 2.4,
    apr30d: 2.1,
    positions: 312,
    createdAt: "2025-06-05",
  },
  {
    address: "0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    pair: "ARB / ETH",
    token0: "ARB",
    token1: "ETH",
    protocol: "Uniswap V4",
    feeTier: "0.30%",
    tvl: 3_200_000,
    volume24h: 1_450_000,
    volume7d: 10_150_000,
    fees24h: 4_350,
    fees7d: 30_450,
    apr7d: 18.6,
    apr30d: 16.1,
    positions: 67,
    createdAt: "2025-11-01",
  },
  {
    address: "0x6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a",
    pair: "LINK / ETH",
    token0: "LINK",
    token1: "ETH",
    protocol: "Uniswap V4",
    feeTier: "0.30%",
    tvl: 5_100_000,
    volume24h: 1_800_000,
    volume7d: 12_600_000,
    fees24h: 5_400,
    fees7d: 37_800,
    apr7d: 14.2,
    apr30d: 12.8,
    positions: 78,
    createdAt: "2025-10-01",
  },
  {
    address: "0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b",
    pair: "UNI / ETH",
    token0: "UNI",
    token1: "ETH",
    protocol: "Uniswap V4",
    feeTier: "0.30%",
    tvl: 4_300_000,
    volume24h: 950_000,
    volume7d: 6_650_000,
    fees24h: 2_850,
    fees7d: 19_950,
    apr7d: 11.3,
    apr30d: 9.7,
    positions: 54,
    createdAt: "2025-10-20",
  },
];

const formatUSD = (val) => {
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toLocaleString()}`;
};

const SORT_KEYS = ["pair", "tvl", "volume24h", "fees24h", "apr", "positions"];

export default function PoolsDirectory() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState("tvl");
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

  const filteredPools = useMemo(() => {
    const pools = [...POOLS];
    pools.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return pools;
  }, [sortKey, sortDir]);

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-mono selection:bg-white selection:text-black flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full px-6 flex-1 flex flex-col gap-6 pt-0 pb-12">

        {/* Header Metrics */}
        <div className="border border-white/10 grid grid-cols-1 lg:grid-cols-12">
          {/* Branding */}
          <div className="lg:col-span-5 flex flex-col justify-center p-6 border-b lg:border-b-0 lg:border-r border-white/10 min-h-[140px]">
            <div className="flex items-center gap-3 mb-2">
              <Droplets size={18} className="text-cyan-400" />
              <h1 className="text-2xl font-medium tracking-tight">
                Liquidity Pools
              </h1>
            </div>
            <p className="text-sm text-gray-500 tracking-widest uppercase">
              {POOLS.length} active pools · Uniswap V4
            </p>
          </div>

          {/* Metrics */}
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
            {/* TVL */}
            <div className="p-6 flex flex-col justify-center">
              <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">
                Total TVL
              </div>
              <div className="text-2xl font-light tracking-tight text-white">
                {formatUSD(POOLS.reduce((s, p) => s + p.tvl, 0))}
              </div>
            </div>

            {/* Trade Volume */}
            <div className="p-6 flex flex-col justify-center">
              <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">
                Trade Volume 24H
              </div>
              <div className="text-2xl font-light tracking-tight text-white">
                {formatUSD(POOLS.reduce((s, p) => s + p.volume24h, 0))}
              </div>
            </div>

            {/* Fees 24H */}
            <div className="p-6 flex flex-col justify-center">
              <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">
                Fees 24H
              </div>
              <div className="text-2xl font-light tracking-tight text-green-400">
                {formatUSD(POOLS.reduce((s, p) => s + p.fees24h, 0))}
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="border border-white/10">
          {/* Table Header */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-sm text-gray-500 uppercase tracking-widest border-b border-white/5 bg-[#0a0a0a]">
            <button onClick={() => toggleSort("pair")} className="col-span-3 relative flex items-center gap-1.5 text-left hover:text-white transition-colors">
              Pool <SortIcon col="pair" />
            </button>
            <button onClick={() => toggleSort("tvl")} className="col-span-2 relative text-center hover:text-white transition-colors">
              TVL <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="tvl" /></span>
            </button>
            <button onClick={() => toggleSort("volume24h")} className="col-span-2 relative text-center hover:text-white transition-colors">
              Volume 24H <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="volume24h" /></span>
            </button>
            <button onClick={() => toggleSort("fees24h")} className="col-span-2 relative text-center hover:text-white transition-colors">
              Fees 24H <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="fees24h" /></span>
            </button>
            <button onClick={() => toggleSort("apr7d")} className="col-span-1 relative text-center hover:text-white transition-colors">
              APR 7D <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="apr7d" /></span>
            </button>
            <button onClick={() => toggleSort("apr30d")} className="col-span-2 relative text-center hover:text-white transition-colors">
              APR 30D <span className="absolute ml-1 top-1/2 -translate-y-1/2"><SortIcon col="apr30d" /></span>
            </button>
          </div>

          {/* Table Rows */}
          {filteredPools.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-600 text-sm uppercase tracking-widest">
              No pools found
            </div>
          ) : (
            filteredPools.map((pool) => (
              <div
                key={pool.address}
                onClick={() => navigate(`/markets/pools/${pool.address}`)}
                className="grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors border-b border-white/5 last:border-b-0 cursor-pointer group items-center"
              >
                {/* Pool */}
                <div className="col-span-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.4)]" />
                    <div>
                      <div className="text-sm font-mono text-white group-hover:text-cyan-400 transition-colors">
                        {pool.pair}
                      </div>
                      <div className="text-sm text-gray-600 flex items-center gap-2">
                        {pool.feeTier}
                        <span className="text-gray-700">·</span>
                        <span className="text-gray-700">{pool.address.slice(0, 6)}...{pool.address.slice(-4)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* TVL */}
                <div className="col-span-2 text-sm font-mono text-white text-center">
                  {formatUSD(pool.tvl)}
                </div>

                {/* Volume 24H */}
                <div className="col-span-2 text-sm font-mono text-white text-center">
                  {formatUSD(pool.volume24h)}
                </div>

                {/* Fees 24H */}
                <div className="col-span-2 text-sm font-mono text-white text-center">
                  {formatUSD(pool.fees24h)}
                </div>

                {/* APR 7D */}
                <div className="col-span-1 text-sm font-mono text-green-400 text-center">
                  {pool.apr7d}%
                </div>

                {/* APR 30D */}
                <div className="col-span-2 text-sm font-mono text-green-400 text-center">
                  {pool.apr30d}%
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
