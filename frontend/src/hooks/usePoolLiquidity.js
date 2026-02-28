import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";

const RPC_URL = `${window.location.origin}/rpc`;

// ── PrimeBroker LP ABI ────────────────────────────────────────────
const BROKER_LP_ABI = [
  "function addPoolLiquidity(address twammHook, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128 amount0Max, uint128 amount1Max) external returns (uint256 tokenId)",
  "function removePoolLiquidity(uint256 tokenId, uint128 liquidity) external returns (uint256 amount0, uint256 amount1)",
  "function setActiveV4Position(uint256 newTokenId) external",
  "function activeTokenId() view returns (uint256)",
  "function hookAddress() view returns (address)",
];

const POSM_ABI = [
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function positionInfo(uint256 tokenId) view returns (bytes32)",
];

// ── Tick math helpers ─────────────────────────────────────────────

/**
 * Convert price to Uniswap V4 tick, aligned to tick spacing.
 * price = 1.0001^tick → tick = log(price) / log(1.0001)
 */
function priceToTick(price, tickSpacing = 5) {
  if (price <= 0) return 0;
  const raw = Math.log(price) / Math.log(1.0001);
  return Math.floor(raw / tickSpacing) * tickSpacing;
}

/**
 * Compute V4 concentrated liquidity from token amounts and price range.
 *
 * Follows standard Uni V3/V4 math:
 *   amount0 = L × (1/√pC − 1/√pU)   (when in range)
 *   amount1 = L × (√pC − √pL)        (when in range)
 *
 * We solve for L from whichever amount the user supplied, or min(L0, L1)
 * when both are supplied.
 */
const MAX_UINT128 = (1n << 128n) - 1n;

function safeSqrtPrice(tick) {
  // Clamp tick to avoid Infinity/zero from Math.pow
  const clamped = Math.max(-887270, Math.min(887270, tick));
  return Math.sqrt(Math.pow(1.0001, clamped));
}

/**
 * Decode tickLower and tickUpper from V4 PositionInfo (packed bytes32).
 * Layout (LSB → MSB):
 *   [0..7]   hasSubscriber (8 bits)
 *   [8..31]  tickLower     (24 bits, int24)
 *   [32..55] tickUpper     (24 bits, int24)
 *   [56..255] poolId       (200 bits)
 */
function decodePositionInfo(infoBytes32) {
  const val = BigInt(infoBytes32);
  const tickLowerRaw = Number((val >> 8n) & 0xFFFFFFn);
  const tickUpperRaw = Number((val >> 32n) & 0xFFFFFFn);
  // Sign-extend int24
  const tickLower = tickLowerRaw >= 0x800000 ? tickLowerRaw - 0x1000000 : tickLowerRaw;
  const tickUpper = tickUpperRaw >= 0x800000 ? tickUpperRaw - 0x1000000 : tickUpperRaw;
  return { tickLower, tickUpper };
}

/**
 * Compute token0/token1 amounts from liquidity and tick range (human-readable, 6 decimals).
 */
function liquidityToAmounts(liquidity, tickLower, tickUpper, currentTick) {
  const sqrtPL = safeSqrtPrice(tickLower);
  const sqrtPU = safeSqrtPrice(tickUpper);
  const sqrtPC = safeSqrtPrice(currentTick);
  const L = Number(liquidity);

  let amount0 = 0;
  let amount1 = 0;

  if (currentTick < tickLower) {
    // Below range: all token0
    amount0 = L * (1 / sqrtPL - 1 / sqrtPU);
  } else if (currentTick >= tickUpper) {
    // Above range: all token1
    amount1 = L * (sqrtPU - sqrtPL);
  } else {
    // In range: both tokens
    amount0 = L * (1 / sqrtPC - 1 / sqrtPU);
    amount1 = L * (sqrtPC - sqrtPL);
  }

  // Convert from raw (6 decimals) to human
  return {
    amount0: amount0 / 1e6,
    amount1: amount1 / 1e6,
  };
}

function computeLiquidity(amount0, amount1, tickLower, tickUpper, currentTick) {
  const sqrtPL = safeSqrtPrice(tickLower);
  const sqrtPU = safeSqrtPrice(tickUpper);
  const sqrtPC = safeSqrtPrice(currentTick);

  const candidates = [];

  if (currentTick < tickLower) {
    // Only token0 matters
    if (amount0 > 0) {
      const denom = 1 / sqrtPL - 1 / sqrtPU;
      if (denom > 0) candidates.push(amount0 / denom);
    }
  } else if (currentTick >= tickUpper) {
    // Only token1 matters
    if (amount1 > 0) {
      const denom = sqrtPU - sqrtPL;
      if (denom > 0) candidates.push(amount1 / denom);
    }
  } else {
    // Both tokens needed
    if (amount0 > 0) {
      const denom = 1 / sqrtPC - 1 / sqrtPU;
      if (denom > 0) candidates.push(amount0 / denom);
    }
    if (amount1 > 0) {
      const denom = sqrtPC - sqrtPL;
      if (denom > 0) candidates.push(amount1 / denom);
    }
  }

  if (candidates.length === 0) return 0n;
  const L = Math.min(...candidates);
  if (!isFinite(L) || L <= 0) return 0n;

  // Cap to uint128 max
  let result = BigInt(Math.floor(L));
  if (result > MAX_UINT128) result = MAX_UINT128;

  console.log("[LP] computeLiquidity:", {
    tickLower, tickUpper, currentTick: Math.round(currentTick),
    sqrtPL, sqrtPU, sqrtPC,
    amount0, amount1,
    liquidity: result.toString(),
  });

  return result;
}

// ── Hook ──────────────────────────────────────────────────────────

/**
 * usePoolLiquidity — Execute LP operations on PrimeBroker via MetaMask.
 *
 * Provides:
 *  - executeAddLiquidity() — calls broker.addPoolLiquidity()
 *  - executeRemoveLiquidity() — calls broker.removePoolLiquidity()
 *  - activePosition — { tokenId, liquidity } from on-chain
 *  - refreshPosition() — re-read active position
 */
export { liquidityToAmounts };

export function usePoolLiquidity(brokerAddress, marketInfo) {
  const [executing, setExecuting] = useState(false);
  const [executionStep, setExecutionStep] = useState("");
  const [executionError, setExecutionError] = useState(null);
  const [activePosition, setActivePosition] = useState(null);

  const twammHook = marketInfo?.infrastructure?.twamm_hook;
  const tickSpacing = marketInfo?.infrastructure?.tick_spacing || 5;
  const posmAddr = marketInfo?.infrastructure?.v4_position_manager;

  // ── Read active position from chain ───────────────────────────
  const refreshPosition = useCallback(async () => {
    if (!brokerAddress) return;
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const broker = new ethers.Contract(brokerAddress, BROKER_LP_ABI, provider);
      const tokenId = await broker.activeTokenId();

      if (tokenId === 0n) {
        setActivePosition(null);
        return;
      }

      let liquidity = 0n;
      let tickLower = 0;
      let tickUpper = 0;
      if (posmAddr) {
        const posm = new ethers.Contract(posmAddr, POSM_ABI, provider);
        liquidity = await posm.getPositionLiquidity(tokenId);

        // Read packed position info to get tick range
        try {
          const info = await posm.positionInfo(tokenId);
          const decoded = decodePositionInfo(info);
          tickLower = decoded.tickLower;
          tickUpper = decoded.tickUpper;
        } catch (e) {
          console.warn("[LP] Could not decode position info:", e);
        }
      }

      setActivePosition({ tokenId, liquidity, tickLower, tickUpper });
    } catch (err) {
      console.warn("[LP] Failed to read active position:", err);
    }
  }, [brokerAddress, posmAddr]);

  // Auto-fetch on mount / broker change
  useEffect(() => {
    refreshPosition();
  }, [refreshPosition]);

  // ── Add Liquidity ─────────────────────────────────────────────
  const executeAddLiquidity = useCallback(
    async (minPrice, maxPrice, amount0Str, amount1Str, currentPrice, onSuccess) => {
      if (!brokerAddress || !twammHook) {
        setExecutionError("Broker or hook address not available");
        return;
      }

      setExecuting(true);
      setExecutionError(null);

      try {
        // 1. Price → tick
        setExecutionStep("Computing tick range...");
        const tickLower = priceToTick(parseFloat(minPrice), tickSpacing);
        const tickUpper = priceToTick(parseFloat(maxPrice), tickSpacing);

        if (tickLower >= tickUpper) {
          throw new Error("Min price must be less than max price");
        }

        // 2. Parse amounts (6 decimals for both tokens)
        const amt0 = parseFloat(amount0Str || "0");
        const amt1 = parseFloat(amount1Str || "0");
        if (amt0 <= 0 && amt1 <= 0) {
          throw new Error("Enter at least one token amount");
        }

        const amount0Raw = ethers.parseUnits(amt0.toFixed(6), 6);
        const amount1Raw = ethers.parseUnits(amt1.toFixed(6), 6);

        // 3. Compute liquidity
        const currentTick = Math.log(parseFloat(currentPrice)) / Math.log(1.0001);
        const liquidity = computeLiquidity(
          Number(amount0Raw),
          Number(amount1Raw),
          tickLower,
          tickUpper,
          currentTick,
        );

        if (liquidity <= 0n) {
          throw new Error("Computed liquidity is zero — increase amounts");
        }

        // 4. Connect MetaMask
        setExecutionStep("Connecting wallet...");
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();

        // 5. Send addPoolLiquidity tx
        setExecutionStep("Sending add liquidity tx...");
        const broker = new ethers.Contract(brokerAddress, BROKER_LP_ABI, signer);

        // Use generous slippage (2×) for the simulation
        const slippage = 2n;
        const a0Max = amount0Raw > 0n ? amount0Raw * slippage : ethers.MaxUint256;
        const a1Max = amount1Raw > 0n ? amount1Raw * slippage : ethers.MaxUint256;

        console.log("[LP] addPoolLiquidity params:", {
          twammHook,
          tickLower,
          tickUpper,
          liquidity: liquidity.toString(),
          amount0Max: a0Max.toString(),
          amount1Max: a1Max.toString(),
        });

        const tx = await broker.addPoolLiquidity(
          twammHook,
          tickLower,
          tickUpper,
          liquidity,
          a0Max,
          a1Max,
        );

        setExecutionStep("Waiting for confirmation...");
        const receipt = await tx.wait();

        // 6. Refresh position
        await refreshPosition();

        setExecutionStep("Liquidity added ✓");
        if (onSuccess) onSuccess(receipt);
      } catch (err) {
        console.error("[LP] addPoolLiquidity failed:", err);
        setExecutionError(err.reason || err.shortMessage || err.message || "Transaction failed");
      } finally {
        setExecuting(false);
      }
    },
    [brokerAddress, twammHook, tickSpacing, refreshPosition],
  );

  // ── Remove Liquidity ──────────────────────────────────────────
  const executeRemoveLiquidity = useCallback(
    async (tokenId, percent, onSuccess) => {
      if (!brokerAddress) {
        setExecutionError("Broker address not available");
        return;
      }

      setExecuting(true);
      setExecutionError(null);

      try {
        // Read current liquidity
        setExecutionStep("Reading position...");
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const posm = new ethers.Contract(posmAddr, POSM_ABI, provider);
        const currentLiquidity = await posm.getPositionLiquidity(tokenId);

        if (currentLiquidity === 0n) {
          throw new Error("Position has no liquidity");
        }

        // Compute removal amount based on percent
        const removeAmount = (currentLiquidity * BigInt(percent)) / 100n;
        if (removeAmount === 0n) {
          throw new Error("Removal amount is zero");
        }

        // Connect MetaMask
        setExecutionStep("Connecting wallet...");
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const signer = await browserProvider.getSigner();

        // Send removePoolLiquidity tx
        setExecutionStep("Sending remove liquidity tx...");
        const broker = new ethers.Contract(brokerAddress, BROKER_LP_ABI, signer);
        const tx = await broker.removePoolLiquidity(tokenId, removeAmount);

        setExecutionStep("Waiting for confirmation...");
        const receipt = await tx.wait();

        // Refresh position
        await refreshPosition();

        setExecutionStep("Liquidity removed ✓");
        if (onSuccess) onSuccess(receipt);
      } catch (err) {
        console.error("[LP] removePoolLiquidity failed:", err);
        setExecutionError(err.reason || err.shortMessage || err.message || "Transaction failed");
      } finally {
        setExecuting(false);
      }
    },
    [brokerAddress, posmAddr, refreshPosition],
  );

  return {
    executeAddLiquidity,
    executeRemoveLiquidity,
    activePosition,
    refreshPosition,
    executing,
    executionStep,
    executionError,
    clearError: () => setExecutionError(null),
  };
}
