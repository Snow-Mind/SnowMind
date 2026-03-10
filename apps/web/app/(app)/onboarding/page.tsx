"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  createPublicClient,
  http,
  parseUnits,
  encodeFunctionData,
  formatUnits,
} from "viem";
import { avalancheFuji } from "viem/chains";
import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";
import { EXPLORER, CONTRACTS } from "@/lib/constants";
import { createSmartAccount, BENQI_ABI } from "@/lib/zerodev";
import { cn } from "@/lib/utils";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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

// ── Component ───────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const wallet =
    wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  const [copied, setCopied] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoActivateRef = useRef(false);

  const balanceNum = parseFloat(usdcBalance);
  const hasFunds = balanceNum >= 0.01;

  // Poll USDC balance of smart account
  useEffect(() => {
    if (!smartAccountAddress) return;

    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL),
    });

    const checkBalance = async () => {
      try {
        const balance = await publicClient.readContract({
          address: CONTRACTS.USDC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [smartAccountAddress as `0x${string}`],
        });
        setUsdcBalance(formatUnits(balance as bigint, 6));
      } catch {
        /* ignore polling errors */
      }
    };

    checkBalance();
    pollRef.current = setInterval(checkBalance, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [smartAccountAddress]);

  // Auto-activate when funds are detected
  useEffect(() => {
    if (hasFunds && wallet && !activating && !activated && !autoActivateRef.current) {
      autoActivateRef.current = true;
      handleActivate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFunds, wallet, activating, activated]);

  const handleCopy = () => {
    if (!smartAccountAddress) return;
    navigator.clipboard.writeText(smartAccountAddress);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async () => {
    if (!wallet || !smartAccountAddress || !hasFunds) return;
    setActivating(true);
    try {
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);
      const amountWei = parseUnits(balanceNum.toFixed(6), 6);

      // Deploy USDC to Benqi (approve + mint)
      await kernelClient.sendTransaction({
        calls: [
          {
            to: CONTRACTS.USDC,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "approve",
              args: [CONTRACTS.BENQI_POOL, amountWei],
            }),
          },
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

      // Register risk profile with backend (best-effort)
      try {
        await api.saveRiskProfile(smartAccountAddress, "moderate");
      } catch {
        /* non-critical */
      }

      // Invalidate queries so dashboard picks up the new allocation
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-status"] });

      setActivated(true);
      toast.success("Agent activated! Redirecting to dashboard…");
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User denied") || msg.includes("User rejected")) {
        toast.error("Transaction cancelled.");
      } else {
        toast.error(msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
      }
    } finally {
      setActivating(false);
    }
  };

  // Determine current step
  const currentStep = activated ? 3 : hasFunds ? 2 : 1;

  const steps = [
    { num: 1, label: "Account Created", done: true },
    { num: 2, label: "Fund Account", done: hasFunds },
    { num: 3, label: "Activate Agent", done: activated },
  ];

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-lg py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-8"
      >
        {/* Header */}
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold text-[#1A1715]">
            Activate Your Agent
          </h1>
          <p className="mt-2 text-sm text-[#5C5550]">
            Fund your smart account and let the AI optimizer go to work.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center">
          {steps.map((step, i) => (
            <div key={step.num} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all",
                    step.done
                      ? "bg-[#059669] text-white"
                      : currentStep === step.num
                        ? "bg-[#E84142] text-white"
                        : "bg-[#E8E2DA] text-[#8A837C]",
                  )}
                >
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    step.num
                  )}
                </div>
                <span className="mt-1.5 text-[10px] font-medium text-[#5C5550]">
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-3 mb-5 h-px w-16",
                    step.done ? "bg-[#059669]" : "bg-[#E8E2DA]",
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Smart Account Card */}
        <div className="rounded-xl border border-[#E8E2DA] bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#059669]/10">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
            </div>
            <span className="text-sm font-medium text-[#1A1715]">
              Smart Account
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-[#F5F0EB] px-3 py-2.5">
            <code className="flex-1 truncate font-mono text-xs text-[#1A1715]">
              {smartAccountAddress}
            </code>
            <button
              onClick={handleCopy}
              className="text-[#8A837C] hover:text-[#1A1715]"
            >
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            {smartAccountAddress && (
              <a
                href={EXPLORER.address(smartAccountAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8A837C] hover:text-[#1A1715]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Fund Account Card */}
        <div
          className={cn(
            "rounded-xl border p-5 transition-all",
            hasFunds
              ? "border-[#059669]/20 bg-[#059669]/[0.03]"
              : "border-[#E84142]/20 bg-white",
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                hasFunds ? "bg-[#059669]/10" : "bg-[#E84142]/10",
              )}
            >
              {hasFunds ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
              ) : (
                <Wallet className="h-3.5 w-3.5 text-[#E84142]" />
              )}
            </div>
            <span className="text-sm font-medium text-[#1A1715]">
              Fund Your Account
            </span>
          </div>
          {hasFunds ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#5C5550]">USDC Balance</span>
              <span className="font-mono text-lg font-semibold text-[#059669]">
                ${parseFloat(usdcBalance).toFixed(2)}
              </span>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#5C5550]">
                Send USDC (Fuji) to your smart account address above.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-[#8A837C]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Waiting for deposit…
              </div>
            </>
          )}
        </div>

        {/* Auto-deploying indicator */}
        {hasFunds && !activated && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-xl border border-[#E84142]/20 bg-white p-6 text-center"
          >
            {activating ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-[#E84142]" />
                <p className="text-sm font-medium text-[#1A1715]">Deploying funds to Benqi…</p>
                <p className="text-xs text-[#5C5550]">This may require a wallet signature</p>
              </>
            ) : (
              <button
                onClick={handleActivate}
                disabled={!wallet}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
              >
                <Zap className="h-4 w-4" />
                Activate Agent
              </button>
            )}
          </motion.div>
        )}

        {/* Activated state */}
        {activated && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3 rounded-xl bg-[#059669]/[0.05] border border-[#059669]/20 p-6 text-center"
          >
            <CheckCircle2 className="h-8 w-8 text-[#059669]" />
            <p className="text-sm font-medium text-[#1A1715]">
              Agent Activated
            </p>
            <p className="text-xs text-[#5C5550]">
              Redirecting to dashboard…
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
