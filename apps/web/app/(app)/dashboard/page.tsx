"use client";

import { useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Layers,
  Clock,
  ArrowUpRight,
  Zap,
  Activity,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Loader2,
  ArrowDown,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { parseUnits, encodeFunctionData } from "viem";
import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import AllocationChart from "@/components/dashboard/AllocationChart";
import RebalanceHistory from "@/components/dashboard/RebalanceHistory";
import LiveRates from "@/components/dashboard/LiveRates";
import EmergencyPanel from "@/components/dashboard/EmergencyPanel";
import RebalanceCountdown from "@/components/dashboard/RebalanceCountdown";
import LiveTxFeed from "@/components/dashboard/LiveTxFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { formatUsd, formatPct } from "@/lib/format";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSessionKey } from "@/hooks/useSessionKey";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { useRebalanceStatus, useRebalanceHistory } from "@/hooks/useRebalanceHistory";
import { useRealtimePortfolio } from "@/hooks/useRealtimePortfolio";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api, APIError } from "@/lib/api-client";
import { EXPLORER, CONTRACTS } from "@/lib/constants";
import { createSmartAccount, BENQI_ABI } from "@/lib/zerodev";
import type { Portfolio } from "@snowmind/shared-types";

const ERC20_APPROVE_ABI = [
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function deriveOverviewStats(p: Portfolio) {
  const totalDep = Number(p.totalDepositedUsd);
  const totalYld = Number(p.totalYieldUsd);
  const blendedApy =
    p.allocations.reduce((s, a) => s + a.currentApy * a.allocationPct, 0) * 100;

  const hoursAgo = p.lastRebalanceAt
    ? Math.floor(
        (Date.now() - new Date(p.lastRebalanceAt).getTime()) / (1000 * 60 * 60),
      )
    : null;

  return {
    totalDeposited: totalDep,
    totalYield: totalYld,
    blendedApy,
    lastRebalanceLabel: hoursAgo !== null ? `${hoursAgo}h ago` : "Never",
  };
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] as const },
  }),
};

function StatsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="crystal-card p-4">
          <div className="h-2.5 w-20 animate-pulse rounded bg-[#E8E2DA]" />
          <div className="mt-3 h-6 w-28 animate-pulse rounded bg-[#E8E2DA]" />
        </div>
      ))}
    </div>
  );
}

function QuickActions({
  smartAccountAddress,
  rebalanceStatus,
  protocolCount,
  idleUsdc,
  onOptimized,
}: {
  smartAccountAddress: string | null;
  rebalanceStatus: string | undefined;
  protocolCount: number;
  idleUsdc: number;
  onOptimized: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployTxHash, setDeployTxHash] = useState<string | null>(null);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  async function handleRunOptimizer() {
    if (!smartAccountAddress) {
      toast.error("No smart account connected");
      return;
    }
    setRunning(true);
    try {
      const result = await api.runOptimizer(smartAccountAddress);
      if (result.rebalanceNeeded) {
        toast.success(
          `Optimizer found a better allocation (expected APY: ${result.expectedApy}). Rebalancing…`,
        );
      } else {
        toast.info("Current allocation is already optimal — no rebalance needed.");
      }
      onOptimized();
    } catch (err) {
      if (err instanceof APIError && err.status === 400) {
        toast.error("No funds deployed yet. Deposit and deploy funds first to run the optimizer.");
      } else {
        toast.error("Optimizer run failed. Try again later.");
      }
    } finally {
      setRunning(false);
    }
  }

  async function handleDeployToBenqi() {
    if (!wallet || !smartAccountAddress || idleUsdc < 0.01) return;
    setDeploying(true);
    setDeployTxHash(null);
    try {
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      const amountWei = parseUnits(idleUsdc.toFixed(6), 6);

      const txHash = await kernelClient.sendTransaction({
        calls: [
          {
            to: CONTRACTS.USDC,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_APPROVE_ABI,
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

      setDeployTxHash(txHash);
      toast.success("Deposited to Benqi! Now earning yield.");

      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-status"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-history"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User denied") || msg.includes("User rejected")) {
        toast.error("Transaction cancelled.");
      } else if (msg.length > 120) {
        toast.error(msg.slice(0, 100) + "…");
      } else {
        toast.error(msg);
      }
    } finally {
      setDeploying(false);
    }
  }

  const statusLabel =
    rebalanceStatus === "idle"
      ? "Idle — monitoring rates"
      : rebalanceStatus ?? "Loading…";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          onClick={handleRunOptimizer}
          disabled={running || !smartAccountAddress}
          className="crystal-card flex items-center gap-3 p-4 text-left transition-all hover:border-glacier/20 disabled:opacity-50"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-glacier/[0.06]">
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-glacier" />
            ) : (
              <Zap className="h-3.5 w-3.5 text-glacier" />
            )}
          </div>
          <div>
            <p className="text-[13px] font-medium text-arctic">
              {running ? "Running…" : "Run Optimizer"}
            </p>
            <p className="text-[11px] text-slate-500">
              Solve MILP for current rates
            </p>
          </div>
        </button>
        <div className="crystal-card flex items-center gap-3 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mint/[0.06]">
            <Activity className="h-3.5 w-3.5 text-mint" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-arctic">Status</p>
            <p className="text-[11px] text-slate-500">{statusLabel}</p>
          </div>
        </div>
        <div className="crystal-card flex items-center gap-3 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-frost/[0.06]">
            <Layers className="h-3.5 w-3.5 text-frost" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-arctic">Protocols</p>
            <p className="text-[11px] text-slate-500">
              {protocolCount} active
            </p>
          </div>
        </div>
      </div>

      {/* Deploy idle USDC to Benqi */}
      {idleUsdc >= 0.01 && (
        <div className="crystal-card flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E84142]/[0.06]">
              {deploying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E84142]" />
              ) : deployTxHash ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-mint" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5 text-[#E84142]" />
              )}
            </div>
            <div>
              <p className="text-[13px] font-medium text-arctic">
                {formatUsd(idleUsdc)} USDC idle in wallet
              </p>
              <p className="text-[11px] text-slate-500">
                Deploy to Benqi to start earning yield
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {deployTxHash && (
              <a
                href={EXPLORER.tx(deployTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-mint underline"
              >
                View
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            <button
              onClick={handleDeployToBenqi}
              disabled={deploying || !wallet || !smartAccountAddress}
              className="rounded-lg bg-[#E84142] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-[#E84142]/90 disabled:opacity-50"
            >
              {deploying ? "Deploying…" : "Deploy to Benqi"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const address = smartAccountAddress || undefined;

  const {
    data: portfolio,
    isLoading: portfolioLoading,
    error: portfolioError,
    refetch: refetchPortfolio,
  } = usePortfolio(address);

  const {
    data: sessionKey,
  } = useSessionKey(address);

  const {
    data: rebalanceData,
    isLoading: rebalanceLoading,
  } = useRebalanceStatus(address);

  const {
    data: historyData,
  } = useRebalanceHistory(address);

  // Subscribe to realtime rebalance events
  useRealtimePortfolio(address);

  // Live protocol rates for projected APY when funds are idle
  const { data: rates } = useProtocolRates();

  const isLoading = portfolioLoading || rebalanceLoading;
  const stats = portfolio ? deriveOverviewStats(portfolio) : null;
  const hasActiveSessionKey = sessionKey?.isActive ?? false;
  const needsActivation = stats && stats.totalDeposited === 0 && !hasActiveSessionKey;

  // Best available APY across active protocols (shown when blended APY is 0)
  const bestRate = rates
    ?.filter((r) => r.isActive && !r.isComingSoon && r.currentApy > 0)
    .sort((a, b) => b.currentApy - a.currentApy)[0];
  const projectedApy = bestRate ? bestRate.currentApy * 100 : 0;

  const OVERVIEW_CARDS = stats
    ? [
        {
          label: "Total Deposited",
          value: formatUsd(stats.totalDeposited),
          change: null as string | null,
          icon: Layers,
        },
        {
          label: "Blended APY",
          value: stats.blendedApy > 0 ? formatPct(stats.blendedApy) : projectedApy > 0 ? `~${formatPct(projectedApy)}` : "0.00%",
          change: stats.blendedApy === 0 && projectedApy > 0 ? "Projected" : null as string | null,
          icon: TrendingUp,
        },
        {
          label: "Yield Earned",
          value: formatUsd(stats.totalYield),
          change: null as string | null,
          icon: TrendingUp,
        },
        {
          label: "Last Rebalance",
          value: stats.lastRebalanceLabel,
          change: null as string | null,
          icon: Clock,
        },
      ]
    : [];

  // Error state
  if (portfolioError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold text-arctic">Dashboard</h1>
        </div>
        <div className="crystal-card flex flex-col items-center gap-3 p-10 text-center">
          <AlertCircle className="h-8 w-8 text-crimson/70" />
          <p className="text-[13px] font-medium text-arctic">Failed to load portfolio</p>
          <p className="max-w-sm text-[11px] text-slate-500">
            {portfolioError instanceof Error ? portfolioError.message : "Unknown error"}
          </p>
          <button
            onClick={() => refetchPortfolio()}
            className="flex items-center gap-1.5 rounded-lg bg-glacier/[0.06] px-3 py-1.5 text-[12px] text-glacier hover:bg-glacier/[0.12]"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-arctic">
            Dashboard
          </h1>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="text-[13px] text-slate-500">
              Portfolio overview and optimization activity.
            </p>
            {smartAccountAddress && (
              <a
                href={EXPLORER.address(smartAccountAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-md bg-glacier/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-glacier/70 hover:bg-glacier/[0.10] transition-colors"
                title="View smart account on Snowtrace"
              >
                {smartAccountAddress.slice(0, 6)}…{smartAccountAddress.slice(-4)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
        {portfolio?.lastRebalanceAt && (
          <RebalanceCountdown lastRebalance={portfolio.lastRebalanceAt} />
        )}
      </div>

      {/* Activation Banner */}
      {needsActivation && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-xl border-2 border-[#E84142] bg-gradient-to-br from-[#E84142]/[0.08] via-[#E84142]/[0.04] to-transparent p-6"
        >
          <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-[#E84142]/10 blur-3xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#E84142] text-white">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#1A1715]">
                  Activate Your AI Agent
                </h3>
                <p className="mt-1 max-w-xl text-sm text-[#5C5550]">
                  Your smart account is ready. Deposit USDC and activate the agent to start earning optimized yield across Avalanche protocols — 24/7, fully autonomous.
                </p>
              </div>
            </div>
            <Link
              href="/onboarding"
              className="flex shrink-0 items-center gap-2 rounded-lg bg-[#E84142] px-5 py-3 font-semibold text-white transition-all hover:bg-[#E84142]/90 hover:scale-105"
            >
              <Sparkles className="h-4 w-4" />
              Activate Agent
            </Link>
          </div>
        </motion.div>
      )}

      {/* Stats grid */}
      {isLoading || !stats ? (
        <StatsSkeleton />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {OVERVIEW_CARDS.map((stat, i) => (
            <motion.div
              key={stat.label}
              className="crystal-card p-4"
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              custom={i}
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {stat.label}
                </p>
                <stat.icon className="h-3.5 w-3.5 text-slate-600" />
              </div>
              <p className="metric-value mt-2 text-xl">{stat.value}</p>
              {stat.change && (
                <div className="mt-1 flex items-center gap-1">
                  {stat.change === "Projected" ? (
                    <TrendingUp className="h-2.5 w-2.5 text-glacier" />
                  ) : (
                    <ArrowUpRight className="h-2.5 w-2.5 text-mint" />
                  )}
                  <span className={`text-[11px] font-medium ${stat.change === "Projected" ? "text-glacier" : "text-mint"}`}>
                    {stat.change}
                  </span>
                  <span className="text-[11px] text-slate-500">24h</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <QuickActions
        smartAccountAddress={smartAccountAddress}
        rebalanceStatus={rebalanceData?.status}
        protocolCount={portfolio?.allocations.filter(a => a.protocolId !== "idle").length ?? 0}
        idleUsdc={Number(portfolio?.allocations.find(a => a.protocolId === "idle")?.amountUsdc ?? "0")}
        onOptimized={() => refetchPortfolio()}
      />

      {/* Live Tx Feed + Allocation */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <LiveTxFeed history={historyData?.logs ?? []} />
        </div>
        <div className="lg:col-span-3">
          <ErrorBoundary name="allocation-chart">
            <AllocationChart
              allocations={portfolio?.allocations ?? []}
              totalDeposited={portfolio ? Number(portfolio.totalDepositedUsd) : 0}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Rebalance History — only show actual protocol moves */}
      {(() => {
        const protocolMoves = (historyData?.logs ?? []).filter(
          (log) => (log.status === "executed" || log.status === "completed") && log.txHash
        );
        return protocolMoves.length > 0 ? (
          <RebalanceHistory history={protocolMoves} total={protocolMoves.length} />
        ) : null;
      })()}

      {/* Live Rates */}
      <ErrorBoundary name="live-rates">
        <LiveRates />
      </ErrorBoundary>

      {/* Emergency Withdrawal — MOST IMPORTANT, must never crash */}
      <ErrorBoundary name="emergency-panel">
        <EmergencyPanel />
      </ErrorBoundary>
    </div>
  );
}
