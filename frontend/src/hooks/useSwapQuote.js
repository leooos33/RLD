import { useState, useCallback, useRef, useEffect } from "react";
import { ethers } from "ethers";

const RPC_URL = "http://127.0.0.1:8545";

// V4Quoter ABI — quoteExactInputSingle
const QUOTER_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
];

/**
 * useSwapQuote — Fetch a precise V4 swap quote using the on-chain V4Quoter.
 *
 * @param {object} infrastructure - { v4_quoter, twamm_hook, pool_fee, tick_spacing }
 * @param {string} collateralAddr - waUSDC address
 * @param {string} positionAddr   - wRLP address
 * @param {number} amountIn       - User-entered collateral amount (human units, 6 decimals)
 * @param {number} debounceMs     - Debounce interval (default: 500ms)
 */
export function useSwapQuote(
  infrastructure,
  collateralAddr,
  positionAddr,
  amountIn,
  debounceMs = 500,
) {
  const [quote, setQuote] = useState(null); // { amountOut, entryRate, notional, estFee, gasEstimate }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchQuote = useCallback(async () => {
    if (
      !infrastructure?.v4_quoter ||
      !collateralAddr ||
      !positionAddr ||
      !amountIn ||
      amountIn <= 0
    ) {
      setQuote(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const quoter = new ethers.Contract(
        infrastructure.v4_quoter,
        QUOTER_ABI,
        provider,
      );

      // Build pool key — token0 must be < token1 by address
      const token0 =
        collateralAddr.toLowerCase() < positionAddr.toLowerCase()
          ? collateralAddr
          : positionAddr;
      const token1 =
        collateralAddr.toLowerCase() < positionAddr.toLowerCase()
          ? positionAddr
          : collateralAddr;

      const poolKey = {
        currency0: token0,
        currency1: token1,
        fee: infrastructure.pool_fee || 500,
        tickSpacing: infrastructure.tick_spacing || 5,
        hooks: infrastructure.twamm_hook,
      };

      // Determine swap direction: selling collateral for position
      const zeroForOne =
        collateralAddr.toLowerCase() < positionAddr.toLowerCase();

      // waUSDC has 6 decimals
      const exactAmount = ethers.parseUnits(String(amountIn), 6);

      // V4Quoter.quoteExactInputSingle is NOT a view function —
      // it calls PoolManager.unlock() which reverts internally.
      // Use eth_call (staticCall) to simulate without sending a tx.
      const result = await quoter.quoteExactInputSingle.staticCall({
        poolKey,
        zeroForOne,
        exactAmount,
        hookData: "0x",
      });

      const amountOutRaw = result[0]; // BigInt
      const gasEstimateRaw = result[1]; // BigInt

      // wRLP also has 6 decimals (it wraps aUSDC-based LP)
      const amountOutFormatted = parseFloat(
        ethers.formatUnits(amountOutRaw, 6),
      );

      // Trading fee: pool_fee / 1e6 (e.g., 500 = 0.05%)
      const poolFeeRate = (infrastructure.pool_fee || 500) / 1e6;
      const tradingFee = amountIn * poolFeeRate;

      // Entry rate: price per wRLP in waUSDC terms
      const entryRate =
        amountOutFormatted > 0 ? amountIn / amountOutFormatted : 0;

      // Notional = amountOut * entryRate = amountIn (by definition)
      const notional = amountIn;

      setQuote({
        amountOut: amountOutFormatted,
        entryRate,
        notional,
        estFee: tradingFee,
        gasEstimate: Number(gasEstimateRaw),
        amountOutRaw: amountOutRaw.toString(),
      });
    } catch (e) {
      console.warn("Quote failed:", e);
      setError(e.message || "Quote failed");
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [infrastructure, collateralAddr, positionAddr, amountIn]);

  // Debounced fetch
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fetchQuote, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [fetchQuote, debounceMs]);

  return { quote, loading, error };
}
