"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2, CheckCircle2, Wallet, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  parseUnits,
  encodeFunctionData,
  createWalletClient,
  createPublicClient,
  custom,
  http,
} from "viem";
import { avalancheFuji } from "viem/chains";
import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { CONTRACTS, AVALANCHE_RPC_URL, EXPLORER } from "@/lib/constants";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { createSmartAccount, approveAndDeployToProtocol } from "@/lib/zerodev";
import { api } from "@/lib/api-client";

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type DepositStep = "idle" | "transferring" | "deploying" | "done";

/** Map raw error messages to user-friendly ones. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("User denied") || msg.includes("User rejected"))
    return "Transaction cancelled.";
  if (msg.includes("zd_getUserOperationGasPrice") || msg.includes("does not exist"))
    return "Gas estimation failed — please try again.";
  if (msg.includes("chainId"))
    return "Please switch MetaMask to Avalanche Fuji network.";
  if (msg.includes("insufficient"))
    return "Insufficient USDC balance.";
  if (msg.length > 120) return msg.slice(0, 100) + "…";
  return msg;
}

export default function DepositPanel() {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [deployedProtocol, setDeployedProtocol] = useState<string | null>(null);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const { data: protocolRates } = useProtocolRates();

  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1;

  // Determine best protocol from live rates
  const bestProtocol = (() => {
    const rates = protocolRates ?? [];
    const active = rates
      .filter((r) => r.isActive && !r.isComingSoon)
      .filter((r) => ["aave_v3", "benqi", "euler_v2", "spark"].includes(r.protocolId))
      .sort((a, b) => b.currentApy - a.currentApy);
    return active[0] ?? null;
  })();

  const nameMap: Record<string, string> = { aave_v3: "Aave V3", benqi: "Benqi", euler_v2: "Euler V2", spark: "Spark" };

  const bestProtocolName = bestProtocol
    ? nameMap[bestProtocol.protocolId] ?? bestProtocol.protocolId
    : "Best Protocol";

  async function handleDeposit() {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;

    setStep("transferring");
    setTransferTxHash(null);
    setMintTxHash(null);
    setDeployedProtocol(null);

    try {
      const provider = await wallet.getEthereumProvider();

      // Switch to Fuji if needed
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xA869" }],
        });
      } catch (switchErr: unknown) {
        const code = typeof switchErr === 'object' && switchErr !== null && 'code' in switchErr ? (switchErr as { code: number }).code : 0;
        if (code === 4902 || code === -32603) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0xA869",
              chainName: "Avalanche Fuji Testnet",
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
              blockExplorerUrls: ["https://testnet.snowtrace.io"],
            }],
          });
        }
      }

      const walletClient = createWalletClient({
        chain: avalancheFuji,
        transport: custom(provider),
      });

      const [account] = await walletClient.getAddresses();
      const amountWei = parseUnits(parsedAmount.toString(), 6);

      // Step 1: Transfer USDC from EOA → Smart Account (MetaMask popup)
      const transferHash = await walletClient.sendTransaction({
        account,
        to: CONTRACTS.USDC,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [smartAccountAddress as `0x${string}`, amountWei],
        }),
      });

      setTransferTxHash(transferHash);
      toast.success("USDC transferred to your smart account!");

      // Wait for transfer to be mined
      const publicClient = createPublicClient({
        chain: avalancheFuji,
        transport: http(AVALANCHE_RPC_URL),
      });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      // Step 2: Deposit to highest-APY protocol via smart account
      setStep("deploying");
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      // Get live rates and sort by APY descending
      const liveRates = protocolRates ?? await api.getCurrentRates();
      const candidateProtocols = liveRates
        .filter((r) => r.isActive && !r.isComingSoon)
        .filter((r) => ["aave_v3", "benqi", "euler_v2", "spark"].includes(r.protocolId))
        .sort((a, b) => b.currentApy - a.currentApy)
        .map((r) => r.protocolId as "aave_v3" | "benqi" | "euler_v2" | "spark");

      console.log("[SnowMind] Dashboard deposit candidates (highest APY first):", candidateProtocols);

      let depositedTo: string | null = null;
      for (const protocolId of candidateProtocols) {
        try {
          const result = await approveAndDeployToProtocol(
            kernelClient,
            smartAccountAddress as `0x${string}`,
            {
              AAVE_POOL: CONTRACTS.AAVE_POOL,
              BENQI_POOL: CONTRACTS.BENQI_POOL,
              EULER_VAULT: CONTRACTS.EULER_VAULT,
              SPARK_VAULT: CONTRACTS.SPARK_VAULT,
              USDC: CONTRACTS.USDC,
            },
            protocolId,
            parsedAmount,
          );
          console.log("[SnowMind] Dashboard deposit tx:", result.txHash, "protocol:", protocolId);
          setMintTxHash(result.txHash);
          depositedTo = protocolId;
          break;
        } catch (err) {
          console.error("[SnowMind] Dashboard deposit FAILED for", protocolId, err);
        }
      }

      if (!depositedTo) {
        throw new Error("Deposit failed on all protocols — please try again.");
      }

      const protocolName = nameMap[depositedTo] ?? depositedTo;
      setDeployedProtocol(protocolName);
      toast.success(`Deposited to ${protocolName}! Now earning yield.`);

      setStep("done");
      setAmount("");

      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-status"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-history"] });
    } catch (err) {
      toast.error(friendlyError(err));
      setStep("idle");
    }
  }

  const buttonLabel = {
    idle: "Deposit",
    transferring: "Transferring USDC…",
    deploying: `Depositing to ${bestProtocolName}…`,
    done: "Deposited!",
  }[step];

  return (
    <div className="crystal-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-glacier/[0.06]">
          <Wallet className="h-4 w-4 text-glacier" />
        </div>
        <div>
          <h2 className="text-sm font-medium text-arctic">Deposit USDC</h2>
          <p className="text-[11px] text-slate-500">
            Funds deposit to {bestProtocolName} ({bestProtocol ? `${(bestProtocol.currentApy * 100).toFixed(2)}% APY` : "best rate"})
          </p>
        </div>
      </div>

      {/* Amount input */}
      <div className="relative">
        <input
          type="number"
          min="1"
          step="any"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (step === "done") setStep("idle");
          }}
          disabled={step === "transferring" || step === "deploying"}
          className="w-full rounded-xl border border-[#E8E2DA] bg-[#FAFAF8] px-4 py-3 pr-16 text-lg font-mono text-[#1A1715] placeholder:text-[#B8B0A8] focus:border-glacier/40 focus:outline-none focus:ring-1 focus:ring-glacier/20 disabled:opacity-50"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[#5C5550]">
          USDC
        </span>
      </div>

      {/* Flow indicator */}
      {isValidAmount && step === "idle" && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
          <ArrowDown className="h-3 w-3" />
          <span>
            {parsedAmount.toFixed(2)} USDC → Smart Account → {bestProtocolName} (earning yield)
          </span>
        </div>
      )}

      {/* Deposit button */}
      <button
        onClick={handleDeposit}
        disabled={!isValidAmount || !wallet || !smartAccountAddress || step === "transferring" || step === "deploying"}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[#E84142]/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {(step === "transferring" || step === "deploying") && (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
        {step === "done" && <CheckCircle2 className="h-4 w-4" />}
        {buttonLabel}
      </button>

      {/* Transaction links */}
      {(transferTxHash || mintTxHash) && (
        <div className="mt-3 space-y-2">
          {transferTxHash && (
            <div className="flex items-center gap-2 rounded-lg border border-mint/20 bg-mint/5 px-3 py-2">
              <CheckCircle2 className="h-3 w-3 shrink-0 text-mint" />
              <span className="text-[11px] text-mint">USDC Transfer</span>
              <a
                href={EXPLORER.tx(transferTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-[10px] text-mint underline"
              >
                {transferTxHash.slice(0, 6)}…{transferTxHash.slice(-4)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
          {mintTxHash && (
            <div className="flex items-center gap-2 rounded-lg border border-glacier/20 bg-glacier/5 px-3 py-2">
              <CheckCircle2 className="h-3 w-3 shrink-0 text-glacier" />
              <span className="text-[11px] text-glacier">{deployedProtocol ?? "Protocol"} Deposit</span>
              <a
                href={EXPLORER.tx(mintTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-[10px] text-glacier underline"
              >
                {mintTxHash.slice(0, 6)}…{mintTxHash.slice(-4)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
