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

import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { CONTRACTS, AVALANCHE_RPC_URL, EXPLORER, CHAIN } from "@/lib/constants";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { createSmartAccount, BENQI_ABI } from "@/lib/zerodev";

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
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
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
    return "Please switch MetaMask to Avalanche C-Chain.";
  if (msg.includes("insufficient"))
    return "Insufficient USDC balance.";
  // Truncate long messages (raw calldata)
  if (msg.length > 120) return msg.slice(0, 100) + "…";
  return msg;
}

export default function DepositPanel() {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1;

  async function handleDeposit() {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;

    setStep("transferring");
    setTransferTxHash(null);
    setMintTxHash(null);

    try {
      const provider = await wallet.getEthereumProvider();

      // Switch to correct chain if needed
      const hexChainId = `0x${CHAIN.id.toString(16)}` as const;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChainId }],
        });
      } catch (switchErr: unknown) {
        const code = typeof switchErr === 'object' && switchErr !== null && 'code' in switchErr ? (switchErr as { code: number }).code : 0;
        if (code === 4902 || code === -32603) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: hexChainId,
              chainName: CHAIN.name,
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: [AVALANCHE_RPC_URL],
              blockExplorerUrls: [EXPLORER.base],
            }],
          });
        }
      }

      const walletClient = createWalletClient({
        chain: CHAIN,
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
        chain: CHAIN,
        transport: http(AVALANCHE_RPC_URL),
      });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      // Step 2: Deposit to Benqi via smart account (UserOp — signs via wallet)
      setStep("deploying");
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      const mintHash = await kernelClient.sendTransaction({
        calls: [
          // Approve USDC to Benqi Pool
          {
            to: CONTRACTS.USDC,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "approve",
              args: [CONTRACTS.BENQI_POOL, amountWei],
            }),
          },
          // Mint (deposit) to Benqi
          {
            to: CONTRACTS.BENQI_POOL,
            value: 0n,
            data: encodeFunctionData({
              abi: BENQI_ABI,
              functionName: "mint",
              args: [amountWei],
            }),
          },
        ],
      });

      setMintTxHash(mintHash);
      toast.success("Deposited to Benqi! Now earning yield.");

      setStep("done");
      setAmount("");

      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-status"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-history"] });
    } catch (err) {
      toast.error(friendlyError(err));
      // If transfer succeeded but Benqi deposit failed, stay on "deploying" state isn't helpful
      setStep(transferTxHash ? "idle" : "idle");
    }
  }

  const buttonLabel = {
    idle: "Deposit",
    transferring: "Transferring USDC…",
    deploying: "Depositing to Benqi…",
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
            Funds deposit directly to Benqi for yield
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
            {parsedAmount.toFixed(2)} USDC → Smart Account → Benqi (earning yield)
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
              <span className="text-[11px] text-glacier">Benqi Deposit</span>
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
