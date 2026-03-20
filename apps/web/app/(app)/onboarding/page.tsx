"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Wallet,
  Zap,
  Shield,
  ArrowRight,
  LayoutGrid,
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
import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api-client";
import { EXPLORER, CONTRACTS, AVALANCHE_RPC_URL, PROTOCOL_CONFIG, CHAIN, ACTIVE_PROTOCOLS, type ProtocolId } from "@/lib/constants";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import Image from "next/image";
import {
  createSmartAccount,
  approveAllProtocols,
  grantAndSerializeSessionKey,
  deployInitialToProtocol,
} from "@/lib/zerodev";
import { cn } from "@/lib/utils";
import type { DiversificationPreference } from "@snowmind/shared-types";

const DIVERSIFICATION_OPTIONS: {
  value: DiversificationPreference;
  label: string;
  description: string;
}[] = [
  {
    value: "max_yield",
    label: "Max Yield",
    description: "100% in the single best protocol. Maximum return, no splitting.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Split across up to 2 protocols, max 60% each. Good default.",
  },
  {
    value: "diversified",
    label: "Diversified",
    description: "Spread across up to 4 protocols, max 40% each. Maximum safety.",
  },
];

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
  | "approving-protocols"
  | "granting-session-key"
  | "registering-backend"
  | "done"
  | "error";

const PHASE_LABELS: Record<ActivationPhase, string> = {
  idle: "",
  "transferring-usdc": "Transferring USDC to smart account…",
  "creating-client": "Connecting to your smart account…",
  "approving-protocols": "Deploying smart account & setting approvals…",
  "granting-session-key": "Granting agent permissions…",
  "registering-backend": "Registering with optimizer…",
  done: "Agent activated — optimizer will deploy funds shortly!",
  error: "Activation failed",
};

// Multi-step form: 1) Account  2) Strategy  3) Deposit  4) Activate
type FormStep = "account" | "strategy" | "deposit" | "activate";

function normalizeProtocolId(protocolId: string): ProtocolId | null {
  if (protocolId === "aave") return "aave_v3";
  if (ACTIVE_PROTOCOLS.includes(protocolId as ProtocolId)) return protocolId as ProtocolId;
  return null;
}

// Ordered markets shown in onboarding strategy step.
const MARKET_PROTOCOL_IDS: ProtocolId[] = [
  "aave_v3",
  "benqi",
  "euler_v2",
  "spark",
  "silo_savusd_usdc",
  "silo_susdp_usdc",
];

const MARKET_PROTOCOLS = MARKET_PROTOCOL_IDS
  .map((id) => PROTOCOL_CONFIG[id])
  .filter(Boolean);

export default function OnboardingPage() {
  const router = useRouter();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const setAgentActivated = usePortfolioStore((s) => s.setAgentActivated);
  const setSmartAccountAddress = usePortfolioStore((s) => s.setSmartAccountAddress);
  const { activeWallet } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const wallet =
    wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  // Multi-step form state
  const isAccountReady = smartAccount.setupStep === "ready" && !!smartAccountAddress;
  const [formStep, setFormStep] = useState<FormStep>(isAccountReady ? "strategy" : "account");

  // Keep formStep in sync with account readiness
  useEffect(() => {
    if (isAccountReady && formStep === "account") {
      setFormStep("strategy");
    }
  }, [isAccountReady, formStep]);

  // Protocol selection for Strategy step — all selected by default
  const [selectedProtocols, setSelectedProtocols] = useState<Set<string>>(
    () => new Set(MARKET_PROTOCOLS.filter((p) => p.defaultEnabled).map((p) => p.id)),
  );
  // Diversification preference — defaults to balanced
  const [diversificationPref, setDiversificationPref] =
    useState<DiversificationPreference>("balanced");

  const toggleProtocol = (id: string, isEnabled: boolean) => {
    if (!isEnabled) return;
    setSelectedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return prev; // Must keep at least 1
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Get live protocol rates for APY display
  const { data: protocolRates } = useProtocolRates();

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
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 100 && parsedAmount <= eoaBalanceNum;

  // Best APY from selected protocols (for now, show Benqi APY as highest)
  const bestApy = (() => {
    if (!protocolRates) return 0;
    const selected = protocolRates.filter((r) => selectedProtocols.has(r.protocolId));
    const best = selected.reduce((max, r) => (r.currentApy > max ? r.currentApy : max), 0);
    return best * 100; // convert to percentage
  })();

  const selectedCount = selectedProtocols.size;
  const yearlyEarning = !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount * (bestApy / 100) : 0;

  // Determine top protocol for deployment — used in activate and review
  const normalizedRateRows = (protocolRates ?? [])
    .map((row) => {
      const normalizedProtocolId = normalizeProtocolId(row.protocolId);
      if (!normalizedProtocolId) return null;
      return {
        ...row,
        normalizedProtocolId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => ACTIVE_PROTOCOLS.includes(row.normalizedProtocolId));

  const activeRateRows = normalizedRateRows.filter((row) => row.isActive && !row.isComingSoon);
  const topProtocolByApy = activeRateRows
    .slice()
    .sort((a, b) => b.currentApy - a.currentApy)[0]?.normalizedProtocolId;

  const selectedMarketNames = MARKET_PROTOCOLS
    .filter((p) => selectedProtocols.has(p.id))
    .map((p) => p.name);

  const assistantHeadline =
    diversificationPref === "max_yield"
      ? "Go concentrated on top APY"
      : diversificationPref === "balanced"
        ? "Blend APY with resiliency"
        : "Diversify across multiple markets";

  const assistantSuggestion = (() => {
    if (!selectedMarketNames.length) {
      return "Select at least one active market to continue.";
    }
    if (diversificationPref === "max_yield") {
      return topProtocolByApy
        ? `Recommended: prioritize ${PROTOCOL_CONFIG[topProtocolByApy].name} for this cycle based on current APY.`
        : "Recommended: choose the single market with the strongest live APY.";
    }
    if (diversificationPref === "balanced") {
      return `Recommended: keep 2-3 markets active (${selectedMarketNames.slice(0, 3).join(", ")}) to reduce single-market risk.`;
    }
    return `Recommended: keep all high-quality markets active and let caps reduce concentration. Current: ${selectedMarketNames.join(", ")}.`;
  })();

  const assistantRiskNote =
    selectedProtocols.has("euler_v2")
      ? "Euler (9Summits) can show elevated APY during high utilization. SnowMind still applies utilization and health gates."
      : "Enable Euler (9Summits) if you want a higher-volatility APY option in your allowed market set.";

  // Poll USDC balance of user's EOA wallet
  useEffect(() => {
    if (!wallet) return;

    const publicClient = createPublicClient({
      chain: CHAIN,
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
    if (activateGuardRef.current) return;
    activateGuardRef.current = true;
    setActivating(true);

    const effectiveSelectedProtocols = selectedProtocols;

    const amountWei = parseUnits(parsedAmount.toFixed(6), 6);

    try {
      // Phase 0: Derive canonical smart account first to prevent stale-address drift.
      setActivationPhase("creating-client");
      const viemAccount = await toViemAccount({ wallet });
      const {
        kernelAccount,
        kernelClient,
        smartAccountAddress: derivedSmartAccountAddress,
      } = await createSmartAccount(viemAccount);

      if (derivedSmartAccountAddress.toLowerCase() !== smartAccountAddress.toLowerCase()) {
        setSmartAccountAddress(derivedSmartAccountAddress);
        setFormStep("activate");
      }

      // Phase 1: Transfer USDC from EOA wallet → canonical smart account
      setActivationPhase("transferring-usdc");
      const provider = await wallet.getEthereumProvider();

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
      const [eoaAddress] = await walletClient.getAddresses();

      const transferHash = await walletClient.sendTransaction({
        account: eoaAddress,
        to: CONTRACTS.USDC,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [derivedSmartAccountAddress as `0x${string}`, amountWei],
        }),
      });

      const publicClient = createPublicClient({
        chain: CHAIN,
        transport: http(AVALANCHE_RPC_URL),
      });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });
      toast.success("USDC transferred to smart account!");

      // Phase 2: Deploy smart account on-chain & approve USDC for all protocols
      // This is the first UserOp — it triggers Kernel deployment via the EntryPoint
      // and sets max USDC approvals so the optimizer can deposit into any protocol.
      setActivationPhase("approving-protocols");
      await approveAllProtocols(kernelClient, {
        USDC: CONTRACTS.USDC,
        AAVE_POOL: CONTRACTS.AAVE_POOL,
        BENQI_POOL: CONTRACTS.BENQI_POOL,
        SPARK_VAULT: CONTRACTS.SPARK_VAULT,
        EULER_VAULT: CONTRACTS.EULER_VAULT,
      });
      toast.success("Smart account deployed on-chain!");

      // Phase 2b: Immediate initial deployment via sudo path (guarantees non-idle start)
      // even if backend session-key automation takes time or fails validation.
      const liveRates = protocolRates ?? await api.getCurrentRates();
      const candidateProtocols = liveRates
        .filter((r) => {
          const normalizedProtocolId = normalizeProtocolId(r.protocolId);
          if (!normalizedProtocolId) return false;
          return effectiveSelectedProtocols.has(r.protocolId) || effectiveSelectedProtocols.has(normalizedProtocolId);
        })
        .filter((r) => r.isActive && !r.isComingSoon)
        .filter((r) => ["aave_v3", "benqi", "spark", "euler_v2"].includes(r.protocolId))
        .sort((a, b) => b.currentApy - a.currentApy)
        .map((r) => r.protocolId as "aave_v3" | "benqi" | "spark" | "euler_v2");

      const deploymentCandidates = candidateProtocols;

      if (!deploymentCandidates.length) {
        throw new Error("No active protocol available for initial deployment")
      }

      let deployedProtocol: string | null = null;
      let lastDeployError: string | null = null;
      for (const protocolId of deploymentCandidates) {
        try {
          await deployInitialToProtocol(
            kernelClient,
            derivedSmartAccountAddress,
            {
              AAVE_POOL: CONTRACTS.AAVE_POOL,
              BENQI_POOL: CONTRACTS.BENQI_POOL,
              SPARK_VAULT: CONTRACTS.SPARK_VAULT,
              EULER_VAULT: CONTRACTS.EULER_VAULT,
              USDC: CONTRACTS.USDC,
            },
            protocolId,
            parsedAmount,
          );
          deployedProtocol = protocolId;
          break;
        } catch (deployErr) {
          lastDeployError = deployErr instanceof Error ? deployErr.message : String(deployErr);
        }
      }

      if (!deployedProtocol) {
        throw new Error(lastDeployError || "Initial deployment failed on all candidate protocols")
      }
      toast.success(`Initial funds deployed to ${deployedProtocol}`);

      // Phase 3: Grant session key
      setActivationPhase("granting-session-key");
      const sessionKeyResult = await grantAndSerializeSessionKey(
        kernelAccount,
        kernelClient,
        {
          AAVE_POOL: CONTRACTS.AAVE_POOL,
          BENQI_POOL: CONTRACTS.BENQI_POOL,
          SPARK_VAULT: CONTRACTS.SPARK_VAULT,
          EULER_VAULT: CONTRACTS.EULER_VAULT,
          USDC: CONTRACTS.USDC,
          TREASURY: CONTRACTS.TREASURY,
        },
        {
          maxAmountUSDC: 10_000,
          durationDays: 7,
          maxOpsPerDay: 20,
          userEOA: wallet.address as `0x${string}`,
        },
      );

      // Phase 4: Register account with session key
      setActivationPhase("registering-backend");
      await api.registerAccount({
        smartAccountAddress: derivedSmartAccountAddress,
        ownerAddress: wallet.address,
        diversificationPreference: diversificationPref,
        sessionKeyData: {
          serializedPermission: sessionKeyResult.serializedPermission,
          sessionKeyAddress: sessionKeyResult.sessionKeyAddress,
          expiresAt: sessionKeyResult.expiresAt,
          allowedProtocols: Array.from(effectiveSelectedProtocols),
        },
      });

      // Phase 4: Done — optimizer will detect idle USDC and deploy optimally
      // (no hardcoded protocol deposit; rebalancer picks the best allocation)

      // Best-effort diversification preference save
      try {
        await api.saveDiversificationPreference(derivedSmartAccountAddress, diversificationPref);
      } catch { /* non-critical — default is balanced */ }

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
      activateGuardRef.current = false;
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

  // Step config for the progress bar
  const steps: { id: FormStep; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "strategy", label: "Strategy" },
    { id: "deposit", label: "Deposit" },
    { id: "activate", label: "Activate" },
  ];

  const stepIndex = steps.findIndex((s) => s.id === formStep);

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
            {activated ? "Agent Activated" : "Set Up Your Agent"}
          </h1>
          <p className="mt-2 text-sm text-[#5C5550]">
            {activated
              ? "Your agent is now optimizing yield."
              : "Complete each step to activate autonomous yield optimization."}
          </p>
        </div>

        {/* Step progress bar */}
        <div className="flex items-center justify-center">
          {steps.map((step, i) => {
            const isDone = i < stepIndex || activated;
            const isCurrent = i === stepIndex && !activated;
            return (
              <div key={step.id} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all",
                      isDone
                        ? "bg-[#059669] text-white"
                        : isCurrent
                          ? "bg-[#E84142] text-white"
                          : "bg-[#E8E2DA] text-[#8A837C]",
                    )}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      i + 1
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
                      isDone ? "bg-[#059669]" : "bg-[#E8E2DA]",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ─── Step 1: Account ─── */}
        <AnimatePresence mode="wait">
          {formStep === "account" && !activated && (
            <motion.div
              key="step-account"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                  <Shield className="h-3.5 w-3.5 text-[#E84142]" />
                </div>
                <span className="text-sm font-medium text-[#1A1715]">
                  Smart Account
                </span>
              </div>

              {smartAccount.setupStep === "creating" && (
                <div className="flex items-center gap-3 rounded-lg bg-[#F5F0EB] p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-[#E84142]" />
                  <div>
                    <p className="text-sm font-medium text-[#1A1715]">
                      Creating your smart account…
                    </p>
                    <p className="text-xs text-[#8A837C]">
                      Building your ZeroDev Kernel v3.1 account on Avalanche.
                    </p>
                  </div>
                </div>
              )}

              {smartAccount.setupStep === "error" && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/20 p-4">
                    <p className="text-sm font-medium text-[#DC2626]">Setup failed</p>
                    <p className="mt-1 text-xs text-[#5C5550]">
                      {smartAccount.error || "Something went wrong creating your account."}
                    </p>
                  </div>
                  <button
                    onClick={smartAccount.retry}
                    className="flex items-center gap-2 rounded-lg border border-[#E84142]/30 px-4 py-2 text-sm font-medium text-[#E84142] hover:bg-[#E84142]/5"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {isAccountReady && (
                <>
                  <p className="text-xs text-[#8A837C]">
                    Your self-custodial smart account is live on Avalanche.
                  </p>
                  <div className="flex items-center gap-2 rounded-lg bg-[#F5F0EB] px-3 py-2.5">
                    <code className="flex-1 truncate font-mono text-xs text-[#1A1715]">
                      {smartAccountAddress}
                    </code>
                    <button onClick={handleCopy} className="text-[#8A837C] hover:text-[#1A1715]">
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

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2.5">
                      <Shield className="h-4 w-4 text-[#E84142] shrink-0" />
                      <span className="text-xs text-[#5C5550]">Non-custodial</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2.5">
                      <Zap className="h-4 w-4 text-[#059669] shrink-0" />
                      <span className="text-xs text-[#5C5550]">Gas sponsored</span>
                    </div>
                  </div>

                  <button
                    onClick={() => setFormStep("strategy")}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031]"
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </motion.div>
          )}

          {/* ─── Step 2: Strategy ─── */}
          {formStep === "strategy" && !activated && (
            <motion.div
              key="step-strategy"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                  <LayoutGrid className="h-3.5 w-3.5 text-[#E84142]" />
                </div>
                <span className="text-sm font-medium text-[#1A1715]">
                  Choose Markets
                </span>
              </div>

              <p className="text-xs text-[#8A837C]">
                Select which markets your optimizer is allowed to use, then choose a diversification strategy.
              </p>

              <div className="rounded-lg border border-[#E8E2DA] bg-[#F5F0EB] px-3 py-2.5 text-[11px] text-[#5C5550]">
                Fee: Free (beta)
              </div>

              {/* Best APY summary */}
              <div className="flex items-center justify-between rounded-lg bg-[#F5F0EB] px-3 py-2.5">
                <span className="text-xs text-[#8A837C]">Best available APY</span>
                <span className="font-mono text-sm font-bold text-[#059669]">{bestApy.toFixed(2)}%</span>
              </div>

              {/* Protocol table */}
              <div className="overflow-hidden rounded-lg border border-[#E8E2DA]">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 bg-[#F5F0EB] px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Protocol</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C] text-center w-14">Risk</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C] text-right w-20">TVL</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C] text-center w-12">Active</span>
                </div>

                {/* Protocol rows */}
                {MARKET_PROTOCOLS.map((protocol, idx) => {
                  const isSelected = selectedProtocols.has(protocol.id);
                  const rateData = protocolRates?.find((r) => r.protocolId === protocol.id);
                  const tvl = rateData?.tvlUsd;
                  const isEnabled = protocol.isActive;
                  return (
                    <div
                      key={protocol.id}
                      className={cn(
                        "grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-3 transition-all cursor-pointer",
                        idx > 0 && "border-t border-[#E8E2DA]",
                        !isEnabled && "cursor-not-allowed opacity-55",
                        isSelected
                          ? "bg-[#E84142]/[0.03]"
                          : "bg-white opacity-60",
                      )}
                      onClick={() => toggleProtocol(protocol.id, isEnabled)}
                    >
                      {/* Protocol info */}
                      <div className="flex items-center gap-3 min-w-0">
                        <Image
                          src={protocol.logoPath}
                          alt={protocol.name}
                          width={32}
                          height={32}
                          className="rounded-full shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-[#1A1715] truncate">{protocol.name}</p>
                            {!isEnabled && (
                              <span className="rounded bg-[#E8E2DA] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[#8A837C]">
                                Soon
                              </span>
                            )}
                            {protocol.vaultUrl && (
                              <a
                                href={protocol.vaultUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[#8A837C] hover:text-[#E84142] transition-colors shrink-0"
                                title={`View ${protocol.name} vault`}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-[10px] text-[#8A837C] truncate">
                            {protocol.id === "silo_savusd_usdc" ? "savUSD/USDC" : protocol.id === "silo_susdp_usdc" ? "sUSDp/USDC" : `${protocol.shortName} · USDC`}
                          </p>
                        </div>
                      </div>

                      {/* Risk Score */}
                      <div className="flex justify-center w-14">
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                            protocol.riskScore >= 9
                              ? "bg-[#059669]/10 text-[#059669]"
                              : protocol.riskScore >= 7
                                ? "bg-[#D97706]/10 text-[#D97706]"
                                : "bg-[#DC2626]/10 text-[#DC2626]",
                          )}
                        >
                          {protocol.riskScore.toFixed(1)}
                        </span>
                      </div>

                      {/* TVL */}
                      <span className="font-mono text-[11px] text-[#5C5550] text-right w-20">
                        {tvl != null && tvl > 0
                          ? `$${tvl >= 1e9 ? `${(tvl / 1e9).toFixed(1)}B` : tvl >= 1e6 ? `${(tvl / 1e6).toFixed(1)}M` : `${(tvl / 1e3).toFixed(0)}K`}`
                          : "—"}
                      </span>

                      {/* Toggle */}
                      <div className="flex justify-center w-12">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleProtocol(protocol.id, isEnabled); }}
                          className={cn(
                            "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors shrink-0",
                            !isEnabled && "opacity-40",
                            isSelected ? "bg-[#E84142]" : "bg-[#E8E2DA]",
                          )}
                          disabled={!isEnabled}
                        >
                          <div
                            className={cn(
                              "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                              isSelected ? "translate-x-4" : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Diversification preference */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#5C5550]">Allocation Strategy</p>
                <div className="space-y-2">
                  {DIVERSIFICATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDiversificationPref(opt.value)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-all",
                        diversificationPref === opt.value
                          ? "border-[#E84142] bg-[#E84142]/[0.04]"
                          : "border-[#E8E2DA] bg-white hover:border-[#D4CEC7]",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          diversificationPref === opt.value
                            ? "border-[#E84142] bg-[#E84142]"
                            : "border-[#C4BEB8]",
                        )}
                      >
                        {diversificationPref === opt.value && (
                          <div className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1A1715]">{opt.label}</p>
                        <p className="text-[11px] text-[#8A837C]">{opt.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#E8E2DA] bg-[#F5F0EB] p-3">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#E84142]/10">
                    <MessageCircle className="h-3.5 w-3.5 text-[#E84142]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-[#1A1715]">Market Assistant: {assistantHeadline}</p>
                    <p className="text-[11px] text-[#5C5550]">{assistantSuggestion}</p>
                    <p className="text-[11px] text-[#8A837C]">{assistantRiskNote}</p>
                  </div>
                </div>
              </div>



              <div className="flex gap-3">
                <button
                  onClick={() => setFormStep("account")}
                  className="flex items-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-3 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7]"
                >
                  Back
                </button>
                <button
                  onClick={() => setFormStep("deposit")}
                  disabled={selectedCount === 0}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── Step 3: Deposit ─── */}
          {formStep === "deposit" && !activated && (
            <motion.div
              key="step-deposit"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                  <Wallet className="h-3.5 w-3.5 text-[#E84142]" />
                </div>
                <span className="text-sm font-medium text-[#1A1715]">
                  Choose Deposit Amount
                </span>
              </div>

              <p className="text-xs text-[#8A837C]">
                Choose how much USDC to deposit. It will be transferred from your wallet
                and deployed to earn yield automatically.
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
                  className="flex-1 bg-transparent font-mono text-base text-[#1A1715] outline-none placeholder:text-[#C4BEB8] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-xs font-medium text-[#8A837C]">USDC</span>
                {eoaBalanceNum > 0 && (
                  <button
                    onClick={() => setDepositAmount(eoaBalanceNum.toFixed(2))}
                    className="rounded-md bg-[#E84142]/10 px-2 py-0.5 text-[10px] font-semibold text-[#E84142] hover:bg-[#E84142]/20 transition-colors"
                  >
                    MAX
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-[#8A837C]">
                <span>Wallet balance: ${eoaBalanceNum.toFixed(2)} USDC</span>
                {parsedAmount > eoaBalanceNum && (
                  <span className="text-[#DC2626]">Exceeds balance</span>
                )}
                {!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < 100 && (
                  <span className="text-[#DC2626]">Min $100.00</span>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setFormStep("strategy")}
                  className="flex items-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-3 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7]"
                >
                  Back
                </button>
                <button
                  onClick={() => setFormStep("activate")}
                  disabled={!isValidAmount}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── Step 4: Activate ─── */}
          {formStep === "activate" && !activated && (
            <motion.div
              key="step-activate"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E84142]/20 bg-white p-6 space-y-5"
            >
              {activating ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-[#1A1715]">
                    <Loader2 className="h-5 w-5 animate-spin text-[#E84142]" />
                    Launching your agent…
                  </div>

                  <div className="space-y-2.5 rounded-lg bg-[#F5F0EB] p-4">
                    {(["transferring-usdc", "creating-client", "approving-protocols", "granting-session-key", "registering-backend"] as const).map((phase) => {
                      const allPhases = ["transferring-usdc", "creating-client", "approving-protocols", "granting-session-key", "registering-backend"] as const;
                      const phaseIndex = allPhases.indexOf(phase);
                      const currentIndex = allPhases.indexOf(activationPhase as typeof allPhases[number]);
                      const isDone = currentIndex > phaseIndex || activationPhase === "done";
                      const isCurrent = activationPhase === phase;

                      const icons: Record<string, typeof Shield> = {
                        "transferring-usdc": Wallet,
                        "creating-client": Zap,
                        "approving-protocols": CheckCircle2,
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
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                      <Zap className="h-3.5 w-3.5 text-[#E84142]" />
                    </div>
                    <span className="text-sm font-medium text-[#1A1715]">
                      Review &amp; Activate
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#F5F0EB] p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] text-[#8A837C]">Deposit</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#1A1715]">${parsedAmount.toFixed(2)} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">APY</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#1A1715]">{bestApy.toFixed(2)}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">Fee</p>
                        <p className="mt-0.5 text-xs font-semibold text-[#059669]">Free (beta)</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">You&apos;ll earn /per year</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#059669]">${yearlyEarning.toFixed(2)} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">Markets</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#1A1715]">{selectedCount} {selectedCount === 1 ? 'market' : 'markets'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setFormStep("deposit")}
                      className="flex items-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-3 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7]"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleActivate}
                      disabled={!wallet || !isValidAmount}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                    >
                      <Zap className="h-4 w-4" />
                      Deposit &amp; Activate Agent
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── Activated success ─── */}
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
                It will deploy your funds to the best protocol(s) and rebalance automatically.
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
