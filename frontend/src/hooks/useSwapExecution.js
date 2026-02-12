import { useState, useCallback } from "react";
import { ethers } from "ethers";

const RPC_URL = "http://127.0.0.1:8545";
const ANVIL_CHAIN_ID = 31337;

// BrokerRouter.executeLong ABI
const BROKER_ROUTER_ABI = [
  {
    name: "executeLong",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "broker", type: "address" },
      { name: "amountIn", type: "uint256" },
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
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];

// PrimeBroker.setOperator + operators check
const BROKER_ABI = [
  "function operators(address) view returns (bool)",
  "function setOperator(address operator, bool active)",
];

/**
 * useSwapExecution — Execute a LONG swap via BrokerRouter with MetaMask signing.
 *
 * Flow:
 * 1. Check if BrokerRouter is operator on broker (if not, prompt user to approve)
 * 2. Switch Anvil chain ID to 31337 for MetaMask compatibility
 * 3. Call BrokerRouter.executeLong(broker, amountIn, poolKey) via MetaMask signer
 * 4. Restore Anvil chain ID
 */
export function useSwapExecution(
  account,
  brokerAddress,
  infrastructure,
  collateralAddr,
  positionAddr,
) {
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("");
  const [txHash, setTxHash] = useState(null);

  const executeLong = useCallback(
    async (amountIn, onSuccess) => {
      if (
        !account ||
        !brokerAddress ||
        !infrastructure?.broker_router ||
        !collateralAddr ||
        !positionAddr
      ) {
        setError("Missing required addresses");
        return;
      }

      if (!window.ethereum) {
        setError("MetaMask not found");
        return;
      }

      setExecuting(true);
      setError(null);
      setTxHash(null);
      setStep("Checking operator status...");

      try {
        const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);

        // 1. Check if BrokerRouter is set as operator on the broker
        const broker = new ethers.Contract(
          brokerAddress,
          BROKER_ABI,
          rpcProvider,
        );
        const isOperator = await broker.operators(infrastructure.broker_router);

        if (!isOperator) {
          // Need to set operator via MetaMask
          setStep("Approving BrokerRouter as operator...");

          // Switch to MetaMask-compatible chain ID
          await rpcProvider.send("anvil_setChainId", [ANVIL_CHAIN_ID]);

          try {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x" + ANVIL_CHAIN_ID.toString(16) }],
            });
          } catch (switchErr) {
            console.warn("Network switch skipped:", switchErr);
          }

          const mmProvider = new ethers.BrowserProvider(window.ethereum, "any");
          const signer = await mmProvider.getSigner();
          const brokerSigned = new ethers.Contract(
            brokerAddress,
            BROKER_ABI,
            signer,
          );

          setStep("Confirm operator approval in wallet...");
          const opTx = await brokerSigned.setOperator(
            infrastructure.broker_router,
            true,
            { gasLimit: 200_000 },
          );
          setStep("Waiting for approval...");
          await opTx.wait();

          // Restore chain ID
          await rpcProvider.send("anvil_setChainId", [1]);
        }

        // 2. Execute the swap via MetaMask
        setStep("Preparing swap...");

        // Switch chain ID for MetaMask
        await rpcProvider.send("anvil_setChainId", [ANVIL_CHAIN_ID]);

        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x" + ANVIL_CHAIN_ID.toString(16) }],
          });
        } catch (switchErr) {
          console.warn("Network switch skipped:", switchErr);
        }

        const mmProvider = new ethers.BrowserProvider(window.ethereum, "any");
        const signer = await mmProvider.getSigner();

        const router = new ethers.Contract(
          infrastructure.broker_router,
          BROKER_ROUTER_ABI,
          signer,
        );

        // Build pool key
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

        // waUSDC has 6 decimals
        const amountInWei = ethers.parseUnits(String(amountIn), 6);

        setStep("Confirm swap in wallet...");
        const tx = await router.executeLong(
          brokerAddress,
          amountInWei,
          poolKey,
          { gasLimit: 1_000_000 },
        );
        setTxHash(tx.hash);

        setStep("Waiting for confirmation...");
        const receipt = await tx.wait();

        // Restore chain ID
        await rpcProvider.send("anvil_setChainId", [1]);

        if (receipt.status === 1) {
          setStep("Swap confirmed ✓");
          if (onSuccess) onSuccess(receipt);
        } else {
          setError("Transaction reverted");
          setStep("");
        }
      } catch (e) {
        console.error("Swap execution failed:", e);
        const msg =
          e.code === "ACTION_REJECTED"
            ? "Transaction rejected"
            : e.shortMessage || e.message || "Swap failed";
        setError(msg);
        setStep("");

        // Try to restore chain ID
        try {
          const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
          await rpcProvider.send("anvil_setChainId", [1]);
        } catch (_) {}
      } finally {
        setExecuting(false);
      }
    },
    [account, brokerAddress, infrastructure, collateralAddr, positionAddr],
  );

  return { executeLong, executing, error, step, txHash };
}
