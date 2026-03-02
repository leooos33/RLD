import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";

const RPC_URL = `${window.location.origin}/rpc`;

const BROKER_STATE_ABI = [
  "function getFullState() view returns (uint256 collateralBalance, uint256 positionBalance, uint128 debtPrincipal, uint256 debtValue, uint256 twammSellOwed, uint256 twammBuyOwed, uint256 v4LPValue, uint256 netAccountValue, uint256 healthFactor, bool isSolvent)",
  "function activeTokenId() view returns (uint256)",
  "function CORE() view returns (address)",
  "function marketId() view returns (bytes32)",
];

const CORE_ABI = [
  "function getMarketState(bytes32 marketId) view returns (uint128 normalizationFactor, uint128 lastAccrual, uint128 totalDebtPrincipal, uint128 debtCap)",
];

const POSM_ABI = [
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function positionInfo(uint256 tokenId) view returns (bytes32)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const STATE_VIEW_ABI = [
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
];

// ── Tick math helpers ─────────────────────────────────────────────

function decodePositionInfo(infoBytes32) {
  const val = BigInt(infoBytes32);
  const tickLowerRaw = Number((val >> 8n) & 0xFFFFFFn);
  const tickUpperRaw = Number((val >> 32n) & 0xFFFFFFn);
  const tickLower = tickLowerRaw >= 0x800000 ? tickLowerRaw - 0x1000000 : tickLowerRaw;
  const tickUpper = tickUpperRaw >= 0x800000 ? tickUpperRaw - 0x1000000 : tickUpperRaw;
  return { tickLower, tickUpper };
}

function tickToPrice(tick) {
  return Math.pow(1.0001, tick);
}

function safeSqrtPrice(tick) {
  const clamped = Math.max(-887270, Math.min(887270, tick));
  return Math.sqrt(Math.pow(1.0001, clamped));
}

function liquidityToAmounts(liquidity, tickLower, tickUpper, currentTick) {
  const sqrtPL = safeSqrtPrice(tickLower);
  const sqrtPU = safeSqrtPrice(tickUpper);
  const sqrtPC = safeSqrtPrice(currentTick);
  const L = Number(liquidity);
  let amount0 = 0, amount1 = 0;
  if (currentTick < tickLower) {
    amount0 = L * (1 / sqrtPL - 1 / sqrtPU);
  } else if (currentTick >= tickUpper) {
    amount1 = L * (sqrtPU - sqrtPL);
  } else {
    amount0 = L * (1 / sqrtPC - 1 / sqrtPU);
    amount1 = L * (sqrtPC - sqrtPL);
  }
  return { amount0: amount0 / 1e6, amount1: amount1 / 1e6 };
}

/**
 * useBrokerState — Fetches the complete broker state from PrimeBroker.getFullState().
 *
 * Returns NAV, balances, debt info, health, positions — everything for the position panel.
 *
 * @param {string} brokerAddress PrimeBroker contract address
 * @param {object} marketInfo    From useSimulation
 * @param {number} pollInterval  Refresh interval in ms (default 15s)
 */
export function useBrokerState(brokerAddress, marketInfo, pollInterval = 15000) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchState = useCallback(async () => {
    if (!brokerAddress) {
      setState(null);
      return;
    }

    try {
      setLoading(true);
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const broker = new ethers.Contract(brokerAddress, BROKER_STATE_ABI, provider);

      const [fullState, activeTokenId, coreAddr, marketId] = await Promise.all([
        broker.getFullState(),
        broker.activeTokenId(),
        broker.CORE(),
        broker.marketId(),
      ]);

      // Fetch normalization factor from RLDCore
      let normFactor = 1e18; // default 1.0
      try {
        const core = new ethers.Contract(coreAddr, CORE_ABI, provider);
        const marketState = await core.getMarketState(marketId);
        normFactor = Number(marketState.normalizationFactor);
      } catch (e) {
        console.warn("[BrokerState] getMarketState failed:", e);
      }

      // Parse BrokerState (all values in 6 decimals except healthFactor which is WAD 1e18)
      const collateralBalance = Number(fullState.collateralBalance) / 1e6;
      const positionBalance = Number(fullState.positionBalance) / 1e6;
      const debtPrincipal = Number(fullState.debtPrincipal) / 1e6;
      const trueDebt = (Number(fullState.debtPrincipal) * normFactor) / 1e18 / 1e6;
      const debtValue = Number(fullState.debtValue) / 1e6;
      const nav = Number(fullState.netAccountValue) / 1e6;
      const v4LPValue = Number(fullState.v4LPValue) / 1e6;
      const twammSellOwed = Number(fullState.twammSellOwed) / 1e6;
      const twammBuyOwed = Number(fullState.twammBuyOwed) / 1e6;

      // Health factor is WAD (1e18) — convert to multiplier
      const healthRaw = fullState.healthFactor;
      const isMaxHealth = healthRaw > BigInt(1e30); // type(uint256).max
      const healthFactor = isMaxHealth ? Infinity : Number(healthRaw) / 1e18;

      // Collateralization ratio: NAV / debtValue
      const colRatio = debtValue > 0 ? (nav / debtValue) * 100 : Infinity;

      // Normalization factor as a human-readable multiplier (e.g., 1.05 = 5% funding accrued)
      const normFactorDisplay = normFactor / 1e18;

      // LP position details
      let lpPosition = null;
      const tokenId = Number(activeTokenId);
      if (tokenId > 0) {
        const posmAddr = marketInfo?.infrastructure?.v4_position_manager;
        const stateViewAddr = marketInfo?.infrastructure?.v4_state_view;
        const twammHook = marketInfo?.infrastructure?.twamm_hook;
        const posToken = marketInfo?.position_token?.address;
        const colToken = marketInfo?.collateral?.address;

        if (posmAddr && stateViewAddr && twammHook && posToken && colToken) {
          try {
            const posm = new ethers.Contract(posmAddr, POSM_ABI, provider);
            const [infoBytes, liquidity] = await Promise.all([
              posm.positionInfo(tokenId),
              posm.getPositionLiquidity(tokenId),
            ]);

            const { tickLower, tickUpper } = decodePositionInfo(infoBytes);

            // Get current tick from StateView
            const [c0, c1] = posToken.toLowerCase() < colToken.toLowerCase()
              ? [posToken, colToken] : [colToken, posToken];
            const tickSpacing = marketInfo?.infrastructure?.tick_spacing || 5;
            const poolId = ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint24", "int24", "address"],
                [c0, c1, 500, tickSpacing, twammHook],
              ),
            );
            const stateView = new ethers.Contract(stateViewAddr, STATE_VIEW_ABI, provider);
            const slot0 = await stateView.getSlot0(poolId);
            const currentTick = Number(slot0.tick);

            const priceLower = tickToPrice(tickLower);
            const priceUpper = tickToPrice(tickUpper);
            const currentPrice = tickToPrice(currentTick);
            const { amount0, amount1 } = liquidityToAmounts(
              liquidity, tickLower, tickUpper, currentTick,
            );

            const inRange = currentTick >= tickLower && currentTick < tickUpper;

            // Fetch entry price from Transfer event + indexer
            let entryPrice = null;
            try {
              const transferFilter = posm.filters.Transfer(null, brokerAddress, tokenId);
              const transferLogs = await posm.queryFilter(transferFilter, 0, "latest");
              if (transferLogs.length > 0) {
                const mintBlock = transferLogs[0].blockNumber;
                const res = await fetch(`/api/block/${mintBlock}`);
                if (res.ok) {
                  const data = await res.json();
                  entryPrice = data.pool_states?.[0]?.mark_price || null;
                }
              }
            } catch (e) {
              console.warn("[BrokerState] entry price fetch failed:", e);
            }

            lpPosition = {
              tokenId,
              tickLower,
              tickUpper,
              priceLower: priceLower.toFixed(4),
              priceUpper: priceUpper.toFixed(4),
              currentPrice: currentPrice.toFixed(4),
              entryPrice: entryPrice ? parseFloat(entryPrice).toFixed(4) : null,
              amount0,
              amount1,
              inRange,
              value: v4LPValue,
            };
          } catch (e) {
            console.warn("[BrokerState] LP position fetch failed:", e);
            lpPosition = { tokenId, value: v4LPValue };
          }
        } else {
          lpPosition = { tokenId, value: v4LPValue };
        }
      }

      const parsed = {
        collateralBalance,
        positionBalance,
        debtPrincipal,
        trueDebt,
        debtValue,
        nav,
        v4LPValue,
        twammSellOwed,
        twammBuyOwed,
        healthFactor,
        isSolvent: fullState.isSolvent,
        colRatio,
        normFactor: normFactorDisplay,
        activeTokenId: tokenId,
        lpPosition,
      };

      if (mountedRef.current) {
        setState(parsed);
      }
    } catch (e) {
      console.warn("[BrokerState] fetch failed:", e);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [brokerAddress]);

  useEffect(() => {
    mountedRef.current = true;
    fetchState();
    const interval = setInterval(fetchState, pollInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchState, pollInterval]);

  return { brokerState: state, loading, refresh: fetchState };
}
