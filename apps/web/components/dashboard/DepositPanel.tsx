"use client";

import { useState } from "react";
import { ArrowDown, Loader2, CheckCircle2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { parseUnits, encodeFunctionData, createWalletClient, custom } from "viem";
import { avalancheFuji } from "viem/chains";
import { useWallets } from "@privy-io/react-auth";
import { CONTRACTS } from "@/lib/constants";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";

const ERC20_TRANSFER_ABI = [
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

export default function DepositPanel() {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();

  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1;

  async function handleDeposit() {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;

    setStep("transferring");
    try {
      // Get the EIP-1193 provider from Privy wallet
      const provider = await wallet.getEthereumProvider();

      // Switch to Fuji if needed
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xA869" }], // 43113
        });
      } catch {
        // Chain may already be selected or user rejected
      }

      const walletClient = createWalletClient({
        chain: avalancheFuji,
        transport: custom(provider),
      });

      const [account] = await walletClient.getAddresses();

      // Send USDC.transfer(smartAccountAddress, amount) from EOA
      const hash = await walletClient.sendTransaction({
        account,
        to: CONTRACTS.USDC,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [
            smartAccountAddress as `0x${string}`,
            parseUnits(parsedAmount.toString(), 6),
          ],
        }),
      });

      setTxHash(hash);
      toast.success("USDC transferred to your smart account!");

      // Now trigger the optimizer to deploy idle USDC to protocols
      setStep("deploying");
      try {
        await api.triggerRebalance(smartAccountAddress);
        toast.success("Funds being deployed to optimal protocols!");
      } catch {
        toast.info("Funds deposited. They'll be auto-deployed in the next optimization cycle.");
      }

      setStep("done");
      setAmount("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      toast.error(msg);
      setStep("idle");
    }
  }

  const buttonLabel = {
    idle: "Deposit",
    transferring: "Confirming Transfer…",
    deploying: "Deploying to Protocols…",
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
            Funds auto-deploy to optimal yield protocols
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
            {parsedAmount.toFixed(2)} USDC → Your Smart Account → Optimal Protocols
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

      {/* Success info */}
      {step === "done" && txHash && (
        <div className="mt-3 rounded-lg border border-mint/20 bg-mint/5 px-3 py-2">
          <p className="text-[11px] text-mint">
            Deposit confirmed!{" "}
            <a
              href={`https://testnet.snowtrace.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on Snowtrace
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
