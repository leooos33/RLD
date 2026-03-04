import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { RPC_URL, getAnvilSigner, restoreAnvilChainId } from "../utils/anvil";

// ── ABI fragments ─────────────────────────────────────────────────

const BOND_FACTORY_ABI = [
  "function mintBond(uint256 notional, uint256 hedgeAmount, uint256 duration, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey) returns (address broker)",
  "event BondMinted(address indexed user, address indexed broker, uint256 notional, uint256 hedge, uint256 duration)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const BROKER_CLOSE_ABI = [
  "function unfreeze()",
  "function frozen() view returns (bool)",
  "function activeTwammOrder() view returns (tuple(address,address,uint24,int24,address) key, tuple(address,uint160,bool) orderKey, bytes32 orderId)",
  "function cancelTwammOrder() returns (uint256 buyTokensOut, uint256 sellTokensRefund)",
  "function claimExpiredTwammOrder() returns (uint256 claimed0, uint256 claimed1)",
  "function modifyPosition(bytes32 rawMarketId, int256 deltaCollateral, int256 deltaDebt)",
  "function withdrawCollateral(address recipient, uint256 amount)",
  "function withdrawPositionToken(address recipient, uint256 amount)",
  "function setOperator(address operator, bool approved)",
  "function marketId() view returns (bytes32)",
  "function CORE() view returns (address)",
  "function collateralToken() view returns (address)",
  "function positionToken() view returns (address)",
];

const CORE_ABI = [
  "function getPosition(bytes32,address) view returns (tuple(uint128 debtPrincipal))",
  "function getMarketState(bytes32) view returns (tuple(uint128 normalizationFactor, uint128 totalDebt, uint128 badDebt, uint48 lastUpdateTimestamp))",
];

const ROUTER_ABI = [
  "function closeShort(address broker, uint256 collateralToSpend, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey) returns (uint256 debtRepaid)",
];

// ── Hook ──────────────────────────────────────────────────────────

/**
 * useBondExecution — Create and close bonds.
 *
 * Bond creation flow:
 *   1. Ensure waUSDC approval for BondFactory
 *   2. Call bondFactory.mintBond(notional, hedge, duration, poolKey)
 *      → Creates broker, funds it, opens short, TWAMM, freezes, transfers NFT
 *   3. Parse BondMinted event for broker address
 *
 * Bond close flow:
 *   1. Unfreeze broker
 *   2. Claim/cancel TWAMM order (returns wRLP + waUSDC)
 *   3. If wRLP < debt: use BrokerRouter.closeShort to buy shortfall
 *   4. Repay all debt via modifyPosition
 *   5. Withdraw remaining collateral to user
 *
 * @param {string} account           Connected wallet address
 * @param {object} infrastructure    { bond_factory, broker_router, twamm_hook, pool_fee, tick_spacing }
 * @param {string} collateralAddr    waUSDC address
 * @param {string} positionAddr      wRLP address
 */
export function useBondExecution(
  account,
  infrastructure,
  collateralAddr,
  positionAddr,
) {
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("");
  const [txHash, setTxHash] = useState(null);

  /**
   * Create a bond in a single transaction.
   *
   * @param {number} notionalUSD    Bond notional in USD
   * @param {number} durationHours  Bond duration in hours (>= 1)
   * @param {number} ratePercent    Entry rate (e.g. 5.25)
   * @param {Function} onSuccess    Called with { receipt, brokerAddress }
   */
  const createBond = useCallback(
    async (notionalUSD, durationHours, ratePercent, onSuccess) => {
      if (
        !account ||
        !collateralAddr ||
        !positionAddr
      ) {
        setError("Missing parameters");
        return;
      }

      // Bond factory address (from API or fallback)
      const bondFactoryAddr = infrastructure?.bond_factory
        || "0x0a5fF8eAE2104805E18a2F3646776d577Fc9Cf26";

      if (!infrastructure?.twamm_hook) {
        setError("Missing infrastructure");
        return;
      }

      setExecuting(true);
      setError(null);
      setStep("Preparing...");

      try {
        // ── Get signer ──────────────────────────────────────────
        setStep("Syncing chain ID...");
        const signer = await getAnvilSigner();

        // ── Build pool key ──────────────────────────────────────
        const sorted = positionAddr.toLowerCase() < collateralAddr.toLowerCase();
        const poolKey = {
          currency0: sorted ? positionAddr : collateralAddr,
          currency1: sorted ? collateralAddr : positionAddr,
          fee: infrastructure.pool_fee || 500,
          tickSpacing: infrastructure.tick_spacing || 5,
          hooks: infrastructure.twamm_hook,
        };

        // ── Compute amounts ─────────────────────────────────────
        // Hedge amount = notional × rate × duration / 8760
        // Minimum: max(1% of notional, $1) to avoid TWAMM sell rate underflow
        const hedgeUSD = Math.max(
          notionalUSD * (ratePercent / 100) * (durationHours / 8760),
          notionalUSD * 0.01,  // at least 1% of notional
          1.0,                 // at least $1
        );
        const notionalWei = ethers.parseUnits(notionalUSD.toString(), 6);
        const hedgeWei = ethers.parseUnits(hedgeUSD.toFixed(6), 6);
        const totalWei = notionalWei + hedgeWei;

        console.log("[Bond] Notional:", notionalUSD, "Hedge:", hedgeUSD.toFixed(6));

        // ── Ensure approval ─────────────────────────────────────
        setStep("Checking approval...");
        const collateral = new ethers.Contract(collateralAddr, ERC20_ABI, signer);
        const allowance = await collateral.allowance(account, bondFactoryAddr);

        if (allowance < totalWei) {
          setStep("Approve waUSDC for BondFactory...");
          const approveTx = await collateral.approve(
            bondFactoryAddr,
            ethers.MaxUint256,
          );
          await approveTx.wait();
          console.log("[Bond] Approved BondFactory");
        }

        // ── Mint bond (single TX) ───────────────────────────────
        setStep("Minting bond...");
        const bondFactory = new ethers.Contract(
          bondFactoryAddr,
          BOND_FACTORY_ABI,
          signer,
        );

        const durationSec = Math.floor(durationHours * 3600);

        console.log("[Bond] mintBond params:", {
          notionalWei: notionalWei.toString(),
          hedgeWei: hedgeWei.toString(),
          durationSec,
          poolKey,
        });

        const tx = await bondFactory.mintBond(
          notionalWei,
          hedgeWei,
          durationSec,
          [
            poolKey.currency0,
            poolKey.currency1,
            poolKey.fee,
            poolKey.tickSpacing,
            poolKey.hooks,
          ],
          { gasLimit: 10_000_000 },
        );
        setTxHash(tx.hash);

        setStep("Waiting for confirmation...");
        const receipt = await tx.wait();

        if (receipt.status === 1) {
          // Parse BondMinted event for broker address
          let brokerAddress = null;
          const iface = new ethers.Interface(BOND_FACTORY_ABI);
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog({
                topics: log.topics,
                data: log.data,
              });
              if (parsed?.name === "BondMinted") {
                brokerAddress = parsed.args.broker;
                break;
              }
            } catch {
              // Not our event
            }
          }

          // Save bond metadata to localStorage
          if (brokerAddress) {
            try {
              const bondMeta = {
                notionalUSD,
                ratePercent,
                durationHours,
                createdAt: Date.now(),
                txHash: receipt.hash,
                brokerAddress,
              };
              const key = `rld_bond_${brokerAddress.toLowerCase()}`;
              localStorage.setItem(key, JSON.stringify(bondMeta));

              // Also save to bond list for enumeration
              const listKey = `rld_bonds_${account.toLowerCase()}`;
              const existing = JSON.parse(localStorage.getItem(listKey) || "[]");
              if (!existing.includes(brokerAddress.toLowerCase())) {
                existing.push(brokerAddress.toLowerCase());
                localStorage.setItem(listKey, JSON.stringify(existing));
              }
            } catch {}
          }

          setStep("Bond created ✓");
          if (onSuccess) onSuccess({ ...receipt, brokerAddress });
        } else {
          setError("Transaction reverted");
          setStep("");
        }
      } catch (e) {
        console.error("[Bond] createBond failed:", e);
        let msg = "Bond creation failed";
        if (e.reason) msg = e.reason;
        else if (e.message?.includes("user rejected")) msg = "User rejected";
        else if (e.data) {
          try {
            msg = ethers.toUtf8String("0x" + e.data.slice(138));
          } catch {}
        }
        setError(msg);
        setStep("");
      } finally {
        setExecuting(false);
        try { await restoreAnvilChainId(); } catch {}
      }
    },
    [account, infrastructure, collateralAddr, positionAddr],
  );

  /**
   * Close a bond: unfreeze → handle TWAMM → repay debt → withdraw.
   *
   * @param {string}   brokerAddress  The bond's PrimeBroker clone address
   * @param {Function} onSuccess      Called with { receipt } on completion
   */
  const closeBond = useCallback(
    async (brokerAddress, onSuccess) => {
      if (!account || !brokerAddress) {
        setError("Missing parameters");
        return;
      }

      if (!infrastructure?.broker_router || !infrastructure?.twamm_hook) {
        setError("Missing infrastructure addresses");
        return;
      }

      setExecuting(true);
      setError(null);
      setStep("Preparing...");

      try {
        const signer = await getAnvilSigner();
        const provider = signer.provider || new ethers.JsonRpcProvider(RPC_URL);
        const broker = new ethers.Contract(brokerAddress, BROKER_CLOSE_ABI, signer);

        // ── 1. Unfreeze ───────────────────────────────────────────
        const isFrozen = await broker.frozen();
        if (isFrozen) {
          setStep("Unfreezing broker...");
          const tx1 = await broker.unfreeze({ gasLimit: 500_000 });
          await tx1.wait();
          console.log("[CloseBond] Unfrozen");
        }

        // ── 2. Handle TWAMM order ─────────────────────────────────
        const twammOrder = await broker.activeTwammOrder();
        const orderId = twammOrder[2]; // orderId (bytes32)
        const hasOrder = orderId !== ethers.ZeroHash;

        if (hasOrder) {
          // Check if expired: orderKey.expiration <= block.timestamp
          const orderExpiration = BigInt(twammOrder[1][1]); // orderKey[1] = expiration
          const block = await provider.getBlock("latest");
          const now = BigInt(block.timestamp);
          const isExpired = now >= orderExpiration;

          if (isExpired) {
            setStep("Claiming expired TWAMM order...");
            const tx2 = await broker.claimExpiredTwammOrder({ gasLimit: 1_000_000 });
            await tx2.wait();
            console.log("[CloseBond] Claimed expired TWAMM");
          } else {
            setStep("Cancelling active TWAMM order...");
            const tx2 = await broker.cancelTwammOrder({ gasLimit: 1_000_000 });
            await tx2.wait();
            console.log("[CloseBond] Cancelled active TWAMM");
          }
        }

        // ── 3. Check balances vs debt ─────────────────────────────
        setStep("Checking balances...");
        const [rawMarketId, coreAddr, collTokenAddr, posTokenAddr] = await Promise.all([
          broker.marketId(),
          broker.CORE(),
          broker.collateralToken(),
          broker.positionToken(),
        ]);

        const core = new ethers.Contract(coreAddr, CORE_ABI, provider);
        const posToken = new ethers.Contract(posTokenAddr, ERC20_ABI, provider);
        const collToken = new ethers.Contract(collTokenAddr, ERC20_ABI, provider);

        const position = await core.getPosition(rawMarketId, brokerAddress);
        const debtPrincipal = BigInt(position[0]);

        if (debtPrincipal > 0n) {
          const wrlpBalance = await posToken.balanceOf(brokerAddress);

          // ── 3a. If wRLP < debt, buy shortfall via BrokerRouter ──
          if (wrlpBalance < debtPrincipal) {
            const shortfall = debtPrincipal - wrlpBalance;
            setStep(`Buying ${Number(shortfall) / 1e6} wRLP shortfall...`);

            // Set BrokerRouter as operator so it can call broker functions
            const routerAddr = infrastructure.broker_router;
            const txOp = await broker.setOperator(routerAddr, true, { gasLimit: 200_000 });
            await txOp.wait();

            // Build pool key
            const sorted = posTokenAddr.toLowerCase() < collTokenAddr.toLowerCase();
            const poolKeyArr = [
              sorted ? posTokenAddr : collTokenAddr,
              sorted ? collTokenAddr : posTokenAddr,
              infrastructure.pool_fee || 500,
              infrastructure.tick_spacing || 5,
              infrastructure.twamm_hook,
            ];

            // Estimate collateral to spend: shortfall × 1.05 (5% slippage buffer)
            // In real tokens (6 decimals), spending waUSDC to get wRLP
            const waUSDCBalance = await collToken.balanceOf(brokerAddress);
            // Spend up to 50% of available waUSDC or estimated shortfall value
            const maxSpend = waUSDCBalance / 2n > 0n ? waUSDCBalance / 2n : waUSDCBalance;
            const collateralToSpend = maxSpend < waUSDCBalance ? maxSpend : waUSDCBalance;

            const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);
            const tx3 = await router.closeShort(
              brokerAddress,
              collateralToSpend,
              poolKeyArr,
              { gasLimit: 3_000_000 },
            );
            await tx3.wait();
            console.log("[CloseBond] Bought wRLP shortfall via closeShort");
          }

          // ── 4. Repay all debt ─────────────────────────────────────
          setStep("Repaying debt...");
          // Re-fetch debt after potential closeShort
          const posAfter = await core.getPosition(rawMarketId, brokerAddress);
          const currentDebt = BigInt(posAfter[0]);

          if (currentDebt > 0n) {
            const tx4 = await broker.modifyPosition(
              rawMarketId,
              0n, // no collateral change
              -BigInt(currentDebt), // repay all debt
              { gasLimit: 2_000_000 },
            );
            await tx4.wait();
            console.log("[CloseBond] Debt repaid:", currentDebt.toString());
          }
        }

        // ── 5. Withdraw remaining tokens to user ──────────────────
        setStep("Withdrawing tokens...");
        const finalWaUSDC = await collToken.balanceOf(brokerAddress);
        if (finalWaUSDC > 0n) {
          const tx5 = await broker.withdrawCollateral(
            account,
            finalWaUSDC,
            { gasLimit: 500_000 },
          );
          await tx5.wait();
          setTxHash(tx5.hash);
          console.log("[CloseBond] Withdrawn waUSDC:", ethers.formatUnits(finalWaUSDC, 6));
        }

        // Also withdraw any leftover wRLP
        const finalWRLP = await posToken.balanceOf(brokerAddress);
        if (finalWRLP > 0n) {
          const tx6 = await broker.withdrawPositionToken(
            account,
            finalWRLP,
            { gasLimit: 500_000 },
          );
          await tx6.wait();
          console.log("[CloseBond] Withdrawn wRLP:", ethers.formatUnits(finalWRLP, 6));
        }

        // ── 6. Clean up localStorage ──────────────────────────────
        try {
          const listKey = `rld_bonds_${account.toLowerCase()}`;
          const existing = JSON.parse(localStorage.getItem(listKey) || "[]");
          const filtered = existing.filter(
            (a) => a.toLowerCase() !== brokerAddress.toLowerCase(),
          );
          localStorage.setItem(listKey, JSON.stringify(filtered));
          localStorage.removeItem(`rld_bond_${brokerAddress.toLowerCase()}`);
        } catch {}

        setStep("Bond closed ✓");
        if (onSuccess) onSuccess({ brokerAddress });
      } catch (e) {
        console.error("[CloseBond] failed:", e);
        let msg = "Close bond failed";
        if (e.reason) msg = e.reason;
        else if (e.message?.includes("user rejected")) msg = "User rejected";
        else if (e.message?.includes("revert")) {
          // Try to parse revert reason
          const match = e.message.match(/reason="([^"]+)"/);
          if (match) msg = match[1];
        }
        setError(msg);
        setStep("");
      } finally {
        setExecuting(false);
        try { await restoreAnvilChainId(); } catch {}
      }
    },
    [account, infrastructure, collateralAddr, positionAddr],
  );

  return {
    createBond,
    closeBond,
    executing,
    error,
    step,
    txHash,
  };
}
