"use client";

import { useState } from "react";
import {
  TrendingUp,
  AlertCircle,
  RefreshCw,
  BarChart3,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import LiveRates from "@/components/dashboard/LiveRates";
import LiveTxFeed from "@/components/dashboard/LiveTxFeed";
import PortfolioChart from "@/components/dashboard/PortfolioChart";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { formatUsd, formatPct } from "@/lib/format";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { useRebalanceStatus, useRebalanceHistory } from "@/hooks/useRebalanceHistory";
import { useRealtimePortfolio } from "@/hooks/useRealtimePortfolio";
import { usePortfolioStore } from "@/stores/portfolio.store";
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

type DashboardTab = "markets" | "agent-log";

const TABS: { id: DashboardTab; label: string; icon: typeof BarChart3 }[] = [
  { id: "markets", label: "Markets", icon: BarChart3 },
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

  // Active protocol IDs for highlighting in LiveRates
  const activeProtocolIds = portfolio
    ? portfolio.allocations
        .filter((a) => a.protocolId !== "idle" && Number(a.amountUsdc) > 0)
        .map((a) => a.protocolId)
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
      <div>
        <h1 className="font-display text-xl font-bold text-arctic">
          Dashboard
        </h1>
      </div>

      {/* Overview stats */}
      {isLoading || !stats ? (
        <StatsSkeleton />
      ) : (
        <motion.div
          className="crystal-card p-6"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Current value</p>
              <p className="mt-1 font-display text-3xl font-bold text-[#E84142]">{formatUsd(stats.totalDeposited)}</p>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[#E8E2DA] pt-4 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] text-[#8A837C]">Net deposited</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">{formatUsd(stats.totalDeposited)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#8A837C]">Net earned</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">{formatUsd(stats.totalYield)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#8A837C]">APR</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">
                    {stats.blendedApy > 0 ? formatPct(stats.blendedApy) : projectedApy > 0 ? `~${formatPct(projectedApy)}` : "0.00%"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[#8A837C]">Active markets</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">
                    {stats.activeProtocols > 0
                      ? stats.activeProtocols
                      : portfolio?.allocations.some((a) => a.protocolId === "idle")
                        ? "Pending"
                        : "0"}
                  </p>
                </div>
              </div>
            </div>
            <div className="mx-auto lg:mx-0">
              <PortfolioChart portfolio={portfolio ?? null} compact />
            </div>
          </div>
        </motion.div>
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
          {/* Live protocol rates */}
          <ErrorBoundary name="live-rates">
            <LiveRates activeProtocolIds={activeProtocolIds} />
          </ErrorBoundary>
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
