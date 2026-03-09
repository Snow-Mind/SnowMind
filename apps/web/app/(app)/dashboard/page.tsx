"use client";

import { useState } from "react";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import AllocationChart from "@/components/dashboard/AllocationChart";
import RebalanceHistory from "@/components/dashboard/RebalanceHistory";
import LiveRates from "@/components/dashboard/LiveRates";
import OptimizerPreview from "@/components/dashboard/OptimizerPreview";
import EmergencyPanel from "@/components/dashboard/EmergencyPanel";
import RebalanceCountdown from "@/components/dashboard/RebalanceCountdown";
import LiveTxFeed from "@/components/dashboard/LiveTxFeed";
import DepositPanel from "@/components/dashboard/DepositPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { formatUsd, formatPct } from "@/lib/format";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useRebalanceStatus, useRebalanceHistory } from "@/hooks/useRebalanceHistory";
import { useRealtimePortfolio } from "@/hooks/useRealtimePortfolio";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";
import { EXPLORER } from "@/lib/constants";
import type { Portfolio } from "@snowmind/shared-types";

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
  onOptimized,
}: {
  smartAccountAddress: string | null;
  rebalanceStatus: string | undefined;
  protocolCount: number;
  onOptimized: () => void;
}) {
  const [running, setRunning] = useState(false);

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
    } catch {
      toast.error("Optimizer run failed. Try again later.");
    } finally {
      setRunning(false);
    }
  }

  const statusLabel =
    rebalanceStatus === "idle"
      ? "Idle — monitoring rates"
      : rebalanceStatus ?? "Loading…";

  return (
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
    data: rebalanceData,
    isLoading: rebalanceLoading,
  } = useRebalanceStatus(address);

  const {
    data: historyData,
  } = useRebalanceHistory(address);

  // Subscribe to realtime rebalance events
  useRealtimePortfolio(address);

  const isLoading = portfolioLoading || rebalanceLoading;
  const stats = portfolio ? deriveOverviewStats(portfolio) : null;

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
          value: formatPct(stats.blendedApy),
          change: null as string | null,
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
                  <ArrowUpRight className="h-2.5 w-2.5 text-mint" />
                  <span className="text-[11px] font-medium text-mint">
                    {stat.change}
                  </span>
                  <span className="text-[11px] text-slate-500">24h</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Deposit + Quick Actions row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ErrorBoundary name="deposit-panel">
            <DepositPanel />
          </ErrorBoundary>
        </div>
        <div className="lg:col-span-2">
          <QuickActions
            smartAccountAddress={smartAccountAddress}
            rebalanceStatus={rebalanceData?.status}
            protocolCount={portfolio?.allocations.length ?? 0}
            onOptimized={() => refetchPortfolio()}
          />
        </div>
      </div>

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

      {/* Rebalance History */}
      <RebalanceHistory
        history={historyData?.logs ?? []}
        total={historyData?.total ?? 0}
      />

      {/* Live Rates + Optimizer Preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ErrorBoundary name="live-rates">
          <LiveRates />
        </ErrorBoundary>
        <OptimizerPreview />
      </div>

      {/* Emergency Withdrawal — MOST IMPORTANT, must never crash */}
      <ErrorBoundary name="emergency-panel">
        <EmergencyPanel />
      </ErrorBoundary>
    </div>
  );
}
