"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
  Zap,
  Shield,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  createPublicClient,
  createWalletClient,
  custom,
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
import { EXPLORER, CONTRACTS, AVALANCHE_RPC_URL } from "@/lib/constants";
import { createSmartAccount, grantAndSerializeSessionKey, BENQI_ABI } from "@/lib/zerodev";
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

// Activation sub-steps (Giza-style progress)
type ActivationPhase =
  | "idle"
  | "transferring-usdc"
  | "creating-client"
  | "granting-session-key"
  | "registering-backend"
  | "deploying-funds"
  | "done"
  | "error";

const PHASE_LABELS: Record<ActivationPhase, string> = {
  idle: "",
  "transferring-usdc": "Transferring USDC to smart account…",
  "creating-client": "Connecting to your smart account…",
  "granting-session-key": "Granting agent permissions…",
  "registering-backend": "Registering with optimizer…",
  "deploying-funds": "Deploying funds to protocols…",
  done: "Agent activated!",
  error: "Activation failed",
};

// ── Component ───────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const setAgentActivated = usePortfolioStore((s) => s.setAgentActivated);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const wallet =
    wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  const [copied, setCopied] = useState(false);
  const [eoaBalance, setEoaBalance] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [activationPhase, setActivationPhase] = useState<ActivationPhase>("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activateGuardRef = useRef(false);

  const eoaBalanceNum = parseFloat(eoaBalance);
  const parsedAmount = parseFloat(depositAmount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1 && parsedAmount <= eoaBalanceNum;
  const hasWalletFunds = eoaBalanceNum >= 1;

  // Poll USDC balance of user's EOA wallet
  useEffect(() => {
    if (!wallet) return;

    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(AVALANCHE_RPC_URL),
    });

    const checkBalance = async () => {
      try {
        const balance = await publicClient.readContract({
          address: CONTRACTS.USDC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [wallet.address as `0x${string}`],
        });
        setEoaBalance(formatUnits(balance as bigint, 6));
      } catch {
        /* ignore polling errors */
      }
    };

    checkBalance();
    pollRef.current = setInterval(checkBalance, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [wallet]);

  const handleCopy = () => {
    if (!smartAccountAddress) return;
    navigator.clipboard.writeText(smartAccountAddress);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Giza-style activation: single atomic flow with granular progress
  const handleActivate = async () => {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;
    if (activateGuardRef.current) return; // prevent double invocation
    activateGuardRef.current = true;
    setActivating(true);

    const amountWei = parseUnits(parsedAmount.toFixed(6), 6);

    try {
      // Phase 0: Transfer USDC from EOA wallet → smart account (just a sign)
      setActivationPhase("transferring-usdc");
      const provider = await wallet.getEthereumProvider();

      // Switch to Fuji if needed
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xA869" }],
        });
      } catch {
        // Chain may already be selected
      }

      const walletClient = createWalletClient({
        chain: avalancheFuji,
        transport: custom(provider),
      });
      const [eoaAddress] = await walletClient.getAddresses();

      const transferHash = await walletClient.sendTransaction({
        account: eoaAddress,
        to: CONTRACTS.USDC,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [smartAccountAddress as `0x${string}`, amountWei],
        }),
      });

      // Wait for transfer to be mined before proceeding
      const publicClient = createPublicClient({
        chain: avalancheFuji,
        transport: http(AVALANCHE_RPC_URL),
      });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });
      toast.success("USDC transferred to smart account!");

      // Phase 1: Create kernel client
      setActivationPhase("creating-client");
      const viemAccount = await toViemAccount({ wallet });
      const { kernelAccount, kernelClient } = await createSmartAccount(viemAccount);

      // Phase 2: Grant session key (required for autonomous rebalancing)
      setActivationPhase("granting-session-key");
      const sessionKeyResult = await grantAndSerializeSessionKey(
        kernelAccount,
        kernelClient,
        {
          AAVE_POOL: CONTRACTS.AAVE_POOL,
          BENQI_POOL: CONTRACTS.BENQI_POOL,
          EULER_VAULT: CONTRACTS.EULER_VAULT,
          USDC: CONTRACTS.USDC,
        },
        {
          maxAmountUSDC: 10_000,
          durationDays: 30,
          maxOpsPerDay: 20,
        },
      );

      // Phase 3: Register account with session key
      setActivationPhase("registering-backend");
      await api.registerAccount({
        smartAccountAddress,
        ownerAddress: wallet.address,
        sessionKeyData: {
          serializedPermission: sessionKeyResult.serializedPermission,
          sessionKeyAddress: sessionKeyResult.sessionKeyAddress,
          expiresAt: sessionKeyResult.expiresAt,
        },
      });

      // Phase 4: Deploy USDC from smart account to Benqi (best-effort)
      setActivationPhase("deploying-funds");
      try {
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
      } catch (deployErr) {
        // Non-fatal: scheduler will detect idle USDC and deploy it
        console.warn("Initial fund deployment skipped — agent will handle it:", deployErr);
      }

      // Best-effort risk profile
      try {
        await api.saveRiskProfile(smartAccountAddress, "moderate");
      } catch { /* non-critical */ }

      // Done — refresh dashboard data
      setActivationPhase("done");
      setAgentActivated(true);
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-status"] });
      queryClient.invalidateQueries({ queryKey: ["account-detail"] });

      setActivated(true);
      toast.success("Agent activated! Redirecting to dashboard…");
      setTimeout(() => router.push("/dashboard"), 2000);
    } catch (err) {
      setActivationPhase("error");
      activateGuardRef.current = false; // allow retry
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User denied") || msg.includes("User rejected")) {
        toast.error("Transaction cancelled.");
      } else {
        toast.error(msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
      }
    } finally {
      if (!activated) setActivating(false);
    }
  };

  // Determine current step
  const currentStep = activated ? 3 : isValidAmount ? 2 : 1;

  const steps = [
    { num: 1, label: "Account Created", done: true },
    { num: 2, label: "Choose Amount", done: isValidAmount },
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
          <p className="mb-2 text-xs text-[#8A837C]">
            Fully self-custodial. You control this account.
          </p>
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

        {/* Deposit Amount Card */}
        <div
          className={cn(
            "rounded-xl border p-5 transition-all",
            isValidAmount
              ? "border-[#059669]/20 bg-[#059669]/[0.03]"
              : "border-[#E84142]/20 bg-white",
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                isValidAmount ? "bg-[#059669]/10" : "bg-[#E84142]/10",
              )}
            >
              {isValidAmount ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
              ) : (
                <Wallet className="h-3.5 w-3.5 text-[#E84142]" />
              )}
            </div>
            <span className="text-sm font-medium text-[#1A1715]">
              Deposit Amount
            </span>
          </div>
          <p className="text-xs text-[#8A837C] mb-3">
            Choose how much USDC to deposit. It will be transferred from your wallet automatically when you activate.
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-[#F5F0EB] px-3 py-2.5">
            <span className="text-sm font-medium text-[#5C5550]">$</span>
            <input
              type="number"
              min="1"
              max={eoaBalanceNum}
              step="0.01"
              placeholder="Enter amount"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              disabled={activating}
              className="flex-1 bg-transparent font-mono text-base text-[#1A1715] outline-none placeholder:text-[#C4BEB8] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-xs font-medium text-[#8A837C]">USDC</span>
            {eoaBalanceNum > 0 && (
              <button
                onClick={() => setDepositAmount(eoaBalanceNum.toFixed(2))}
                disabled={activating}
                className="rounded-md bg-[#E84142]/10 px-2 py-0.5 text-[10px] font-semibold text-[#E84142] hover:bg-[#E84142]/20 transition-colors disabled:opacity-50"
              >
                MAX
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[#8A837C]">
            <span>Wallet balance: ${eoaBalanceNum.toFixed(2)} USDC</span>
            {parsedAmount > eoaBalanceNum && (
              <span className="text-[#DC2626]">Exceeds balance</span>
            )}
            {!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < 1 && (
              <span className="text-[#DC2626]">Min $1.00</span>
            )}
          </div>
        </div>

        {/* Activation Card — Giza-style with phase progress */}
        <AnimatePresence mode="wait">
        {isValidAmount && !activated && (
          <motion.div
            key="activate"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl border border-[#E84142]/20 bg-white p-6"
          >
            {activating ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm font-medium text-[#1A1715]">
                  <Loader2 className="h-5 w-5 animate-spin text-[#E84142]" />
                  Launching your agent…
                </div>

                {/* Phase progress indicators */}
                <div className="space-y-2.5 rounded-lg bg-[#F5F0EB] p-4">
                  {(["transferring-usdc", "creating-client", "granting-session-key", "registering-backend", "deploying-funds"] as const).map((phase) => {
                    const allPhases = ["transferring-usdc", "creating-client", "granting-session-key", "registering-backend", "deploying-funds"] as const;
                    const phaseIndex = allPhases.indexOf(phase);
                    const currentIndex = allPhases.indexOf(activationPhase as typeof allPhases[number]);
                    const isDone = currentIndex > phaseIndex || activationPhase === "done";
                    const isCurrent = activationPhase === phase;

                    const icons: Record<string, typeof Shield> = {
                      "transferring-usdc": Wallet,
                      "creating-client": Zap,
                      "granting-session-key": Shield,
                      "registering-backend": ArrowRight,
                      "deploying-funds": Wallet,
                    };
                    const Icon = icons[phase];

                    return (
                      <div key={phase} className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all",
                          isDone ? "bg-[#059669] text-white" :
                          isCurrent ? "bg-[#E84142] text-white" :
                          "bg-[#E8E2DA] text-[#8A837C]"
                        )}>
                          {isDone ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : isCurrent ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Icon className="h-3 w-3" />
                          )}
                        </div>
                        <span className={cn(
                          "text-xs",
                          isDone ? "text-[#059669]" :
                          isCurrent ? "font-medium text-[#1A1715]" :
                          "text-[#8A837C]"
                        )}>
                          {PHASE_LABELS[phase]}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <p className="text-center text-xs text-[#8A837C]">
                  This may require a wallet signature. Do not close this page.
                </p>
              </div>
            ) : activationPhase === "error" ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-sm font-medium text-[#DC2626]">Activation failed</p>
                <p className="text-xs text-[#5C5550]">You can retry — your funds are safe in your smart account.</p>
                <button
                  onClick={handleActivate}
                  disabled={!wallet}
                  className="flex items-center gap-2 rounded-xl bg-[#E84142] px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                >
                  Retry Activation
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="text-center">
                  <p className="text-sm font-medium text-[#1A1715]">Ready to activate</p>
                  <p className="mt-1 text-xs text-[#5C5550]">
                    ${parsedAmount.toFixed(2)} USDC will be transferred from your wallet and deployed to earn yield.
                    Gas fees are covered. You can deactivate anytime.
                  </p>
                </div>
                <button
                  onClick={handleActivate}
                  disabled={!wallet || !isValidAmount}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                >
                  <Zap className="h-4 w-4" />
                  Deposit ${parsedAmount.toFixed(2)} &amp; Activate Agent
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Activated state — Giza "Agent has landed" */}
        {activated && (
          <motion.div
            key="activated"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3 rounded-xl bg-[#059669]/[0.05] border border-[#059669]/20 p-8 text-center"
          >
            <CheckCircle2 className="h-10 w-10 text-[#059669]" />
            <p className="text-base font-semibold text-[#1A1715]">
              Agent Activated
            </p>
            <p className="text-sm text-[#5C5550]">
              Your agent is now optimizing yield across Avalanche protocols.
              It will watch rates and rebalance automatically.
            </p>
            <p className="text-xs text-[#8A837C]">
              Redirecting to dashboard…
            </p>
          </motion.div>
        )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
