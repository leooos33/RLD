import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { RPC_URL } from "../utils/anvil";
import { SIM_API } from "../config/simulationConfig";

// ── ABI fragments ─────────────────────────────────────────────────

const BROKER_ABI = [
  "function CORE() view returns (address)",
  "function marketId() view returns (bytes32)",
  "function frozen() view returns (bool)",
  "function activeTwammOrder() view returns (tuple(address,address,uint24,int24,address) key, tuple(address,uint160,bool) orderKey, bytes32 orderId)",
  "function collateralToken() view returns (address)",
];

const CORE_ABI = [
  "function getPosition(bytes32,address) view returns (tuple(uint128 debtPrincipal))",
  "function getMarketState(bytes32) view returns (tuple(uint128 normalizationFactor, uint128 totalDebt, uint128 badDebt, uint48 lastUpdateTimestamp))",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

/**
 * useBondPositions — Fetch bond data from indexer API + on-chain state.
 *
 * Primary source: /api/bonds?owner=<account> (indexer)
 * Fallback: localStorage bonds not yet indexed
 *
 * Each bond's live state (debt, TWAMM order, collateral) is enriched via RPC.
 *
 * @param {string}  account        Connected wallet address
 * @param {number}  entryRate      Fallback rate if no metadata
 * @param {number}  pollInterval   Polling ms (default 15000)
 */
export function useBondPositions(account, entryRate, pollInterval = 15000) {
  const [bonds, setBonds] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    if (!account) return;

    try {
      setLoading(true);

      // 1. Fetch indexed bonds from API
      let indexedBrokers = new Set();
      let apiBonds = [];
      try {
        const res = await fetch(
          `${SIM_API}/api/bonds?owner=${account.toLowerCase()}&status=all`,
        );
        if (res.ok) {
          const data = await res.json();
          apiBonds = data.bonds || [];
          for (const b of apiBonds) {
            indexedBrokers.add(b.broker_address?.toLowerCase());
          }
        }
      } catch {
        // API may be unavailable — fall through to localStorage
      }

      // 2. Get localStorage bonds not yet in the indexer
      const listKey = `rld_bonds_${account.toLowerCase()}`;
      const localAddresses = JSON.parse(localStorage.getItem(listKey) || "[]");
      const unindexed = localAddresses.filter(
        (addr) => !indexedBrokers.has(addr.toLowerCase()),
      );

      // 3. Merge: all API bond addresses + unindexed localStorage addresses
      const allBrokers = [
        ...apiBonds.map((b) => b.broker_address),
        ...unindexed,
      ];

      if (allBrokers.length === 0) {
        setBonds([]);
        return;
      }

      // Build lookup from indexed data for metadata
      const indexedMeta = {};
      for (const b of apiBonds) {
        indexedMeta[b.broker_address?.toLowerCase()] = b;
      }

      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const results = [];

      for (const brokerAddr of allBrokers) {
        try {
          const meta = indexedMeta[brokerAddr.toLowerCase()] || null;
          const bond = await fetchSingleBond(provider, brokerAddr, entryRate, meta);
          if (bond) results.push(bond);
        } catch (err) {
          console.warn(`[BondPositions] Error fetching ${brokerAddr}:`, err.message);
        }
      }

      setBonds(results);
    } catch (err) {
      console.warn("[BondPositions] fetch error:", err.message);
    } finally {
      setLoading(false);
    }
  }, [account, entryRate]);

  useEffect(() => {
    fetchPositions();
    const id = setInterval(fetchPositions, pollInterval);
    return () => clearInterval(id);
  }, [fetchPositions, pollInterval]);

  return { bonds, loading, refresh: fetchPositions };
}

// ── Fetch a single bond's on-chain + metadata ───────────────────

async function fetchSingleBond(provider, brokerAddr, fallbackRate, indexedMeta) {
  const broker = new ethers.Contract(brokerAddr, BROKER_ABI, provider);

  // Get core address + market ID
  const [coreAddr, marketId, collateralTokenAddr, frozen] = await Promise.all([
    broker.CORE(),
    broker.marketId(),
    broker.collateralToken(),
    broker.frozen(),
  ]);

  const core = new ethers.Contract(coreAddr, CORE_ABI, provider);
  const collateralToken = new ethers.Contract(collateralTokenAddr, ERC20_ABI, provider);

  // Get position data
  const [position, marketState, brokerWaUSDC] = await Promise.all([
    core.getPosition(marketId, brokerAddr),
    core.getMarketState(marketId),
    collateralToken.balanceOf(brokerAddr),
  ]);

  const debtPrincipal = position.debtPrincipal ?? position[0];

  // Skip if no debt (empty broker)
  if (debtPrincipal === 0n) return null;

  // TWAMM order
  const twammOrder = await broker.activeTwammOrder();
  const orderExpiration = BigInt(twammOrder.orderKey[1]);
  const orderId = twammOrder.orderId;

  // Block time
  const block = await provider.getBlock("latest");
  const now = BigInt(block.timestamp);

  // Read metadata: prefer indexer data, then localStorage
  let savedMeta = null;
  if (indexedMeta) {
    // Use indexed data from API
    savedMeta = {
      notionalUSD: Number(indexedMeta.notional || 0) / 1e6,
      durationHours: (indexedMeta.duration || 0) / 3600,
      createdAt: (indexedMeta.created_timestamp || 0) * 1000,
      txHash: indexedMeta.created_tx || null,
      ratePercent: fallbackRate || 0,
    };
  } else {
    try {
      const key = `rld_bond_${brokerAddr.toLowerCase()}`;
      const raw = localStorage.getItem(key);
      if (raw) savedMeta = JSON.parse(raw);
    } catch {}
  }

  // Compute values
  const normFactor = BigInt(marketState.normalizationFactor ?? marketState[0]);
  const trueDebt = (BigInt(debtPrincipal) * normFactor) / (10n ** 18n);
  const debtUsd = Number(ethers.formatUnits(trueDebt, 6));
  const freeWaUSDC = Number(ethers.formatUnits(brokerWaUSDC, 6));

  // TWAMM timing
  const hasActiveOrder = orderId !== ethers.ZeroHash;
  const expirationSec = Number(orderExpiration);
  const nowSec = Number(now);
  const remainingSec = Math.max(0, expirationSec - nowSec);
  const remainingDays = Math.max(0, Math.ceil(remainingSec / 86400));
  const isMatured = hasActiveOrder && remainingSec <= 0;

  // Bond ID from broker address
  const tokenId = parseInt(brokerAddr.slice(-4), 16) % 10000;

  // Use saved metadata
  const notional = savedMeta?.notionalUSD || debtUsd;
  const rate = savedMeta?.ratePercent || fallbackRate || 0;
  const durationHours = savedMeta?.durationHours || 0;
  const maturityDays = durationHours
    ? Math.ceil(durationHours / 24)
    : remainingDays;
  const createdAt = savedMeta?.createdAt || 0;

  // Elapsed — use chain time (block.timestamp), NOT Date.now(),
  // because the simulation runs on forked Ethereum timestamps (~Jan 2025)
  // while wall-clock time is much later (~Mar 2026).
  const chainNowMs = nowSec * 1000;
  const elapsedMs = createdAt ? chainNowMs - createdAt : 0;
  const elapsedDays = Math.max(0, Math.floor(elapsedMs / 86400000));

  // Accrued = notional × rate × elapsed/365
  const accrued = notional * (rate / 100) * (elapsedDays / 365);

  return {
    id: tokenId,
    brokerAddress: brokerAddr,
    principal: notional,
    debtTokens: debtUsd,
    fixedRate: rate,
    maturityDays,
    elapsed: elapsedDays,
    remaining: remainingDays,
    maturityDate: hasActiveOrder
      ? new Date(expirationSec * 1000).toISOString().slice(0, 10)
      : "—",
    frozen,
    isMatured,
    accrued,
    freeCollateral: freeWaUSDC,
    orderId,
    hasActiveOrder,
    txHash: savedMeta?.txHash || null,
    // Indexed metadata (for closed bonds)
    status: indexedMeta?.status || "active",
  };
}
