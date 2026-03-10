"use client";

import { useState } from "react";
import {
  TrendingUp,
  Layers,
  Clock,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  BarChart3,
  LineChart,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import AllocationChart from "@/components/dashboard/AllocationChart";
import RebalanceHistory from "@/components/dashboard/RebalanceHistory";
import LiveRates from "@/components/dashboard/LiveRates";
import LiveTxFeed from "@/components/dashboard/LiveTxFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { formatUsd, formatPct } from "@/lib/format";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { useRebalanceStatus, useRebalanceHistory } from "@/hooks/useRebalanceHistory";
import { useRealtimePortfolio } from "@/hooks/useRealtimePortfolio";
import { usePortfolioStore } from "@/stores/portfolio.store";
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

  const activeProtocols = p.allocations.filter(
    (a) => a.protocolId !== "idle" && Number(a.amountUsdc) > 0,
  ).length;

  return {
    totalDeposited: totalDep,
    totalYield: totalYld,
    blendedApy,
    activeProtocols,
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

type DashboardTab = "markets" | "performance" | "agent-log";

const TABS: { id: DashboardTab; label: string; icon: typeof BarChart3 }[] = [
  { id: "markets", label: "Markets", icon: BarChart3 },
  { id: "performance", label: "Performance", icon: LineChart },
  { id: "agent-log", label: "Agent Log", icon: ScrollText },
];

export default function DashboardPage() {
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const address = smartAccountAddress || undefined;
  const [activeTab, setActiveTab] = useState<DashboardTab>("markets");

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

  useRealtimePortfolio(address);

  const { data: rates } = useProtocolRates();

  const isLoading = portfolioLoading || rebalanceLoading;
  const stats = portfolio ? deriveOverviewStats(portfolio) : null;

  // Best available APY across active protocols (shown when blended APY is 0)
  const bestRate = rates
    ?.filter((r) => r.isActive && !r.isComingSoon && r.currentApy > 0)
    .sort((a, b) => b.currentApy - a.currentApy)[0];
  const projectedApy = bestRate ? bestRate.currentApy * 100 : 0;

  const OVERVIEW_CARDS = stats
    ? [
        {
          label: "Current Value",
          value: formatUsd(stats.totalDeposited + stats.totalYield),
          sub: null as string | null,
          icon: Layers,
        },
        {
          label: "Net Deposited",
          value: formatUsd(stats.totalDeposited),
          sub: null as string | null,
          icon: Layers,
        },
        {
          label: "Net Earned",
          value: formatUsd(stats.totalYield),
          sub: null as string | null,
          icon: TrendingUp,
        },
        {
          label: "APR",
          value: stats.blendedApy > 0 ? formatPct(stats.blendedApy) : projectedApy > 0 ? `~${formatPct(projectedApy)}` : "0.00%",
          sub: stats.blendedApy === 0 && projectedApy > 0 ? "Projected" : null,
          icon: TrendingUp,
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
              Monitor your agent and track performance.
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
        {stats && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            <span>Last rebalance: {stats.lastRebalanceLabel}</span>
            {stats.activeProtocols > 0 && (
              <>
                <span className="text-[#D4CEC7]">·</span>
                <span>{stats.activeProtocols} active market{stats.activeProtocols !== 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Static overview metrics */}
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
              {stat.sub && (
                <div className="mt-1 flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5 text-glacier" />
                  <span className="text-[11px] font-medium text-glacier">{stat.sub}</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[#EDE8E3] p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-all ${
                isActive
                  ? "bg-white text-[#1A1715] shadow-sm"
                  : "text-[#8A837C] hover:text-[#5C5550]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "markets" && (
        <div className="space-y-4">
          {/* Best Opportunity banner — inspired by ZYF.AI */}
          {bestRate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between rounded-xl border border-glacier/20 bg-glacier/[0.04] px-5 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-glacier/10">
                  <Sparkles className="h-4 w-4 text-glacier" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-glacier/70">
                    Best Opportunity
                  </p>
                  <p className="text-sm font-medium text-arctic">
                    {bestRate.name}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-bold text-glacier">
                  {formatPct(bestRate.currentApy * 100)}
                </p>
                <p className="text-[10px] text-muted-foreground">APY</p>
              </div>
            </motion.div>
          )}

          {/* Allocation chart */}
          <ErrorBoundary name="allocation-chart">
            <AllocationChart
              allocations={portfolio?.allocations ?? []}
              totalDeposited={portfolio ? Number(portfolio.totalDepositedUsd) : 0}
            />
          </ErrorBoundary>

          {/* Live protocol rates */}
          <ErrorBoundary name="live-rates">
            <LiveRates />
          </ErrorBoundary>
        </div>
      )}

      {activeTab === "performance" && (
        <div className="space-y-4">
          {/* Rebalance History — only protocol moves */}
          {(() => {
            const protocolMoves = (historyData?.logs ?? []).filter(
              (log) => (log.status === "executed" || log.status === "completed") && log.txHash,
            );
            return protocolMoves.length > 0 ? (
              <RebalanceHistory history={protocolMoves} total={protocolMoves.length} />
            ) : (
              <div className="crystal-card flex flex-col items-center justify-center py-12 text-center">
                <LineChart className="h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm font-medium text-arctic">No performance data yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Rebalance history will appear here once the agent starts optimizing.
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {activeTab === "agent-log" && (
        <div className="space-y-4">
          {/* Decision reasoning header */}
          <div className="flex items-center gap-2 rounded-lg bg-glacier/[0.04] px-4 py-2.5 border border-glacier/10">
            <Sparkles className="h-3.5 w-3.5 text-glacier" />
            <p className="text-[11px] text-muted-foreground">
              Every agent action is verifiable on-chain. View reasoning and transaction proofs below.
            </p>
          </div>
          <LiveTxFeed history={historyData?.logs ?? []} />
        </div>
      )}
    </div>
  );
}
