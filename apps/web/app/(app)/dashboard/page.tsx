"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  RefreshCw,
  BarChart3,
  SlidersHorizontal,
  ScrollText,
  Sparkles,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import LiveRates from "@/components/dashboard/LiveRates";
import LiveTxFeed from "@/components/dashboard/LiveTxFeed";
import PortfolioChart from "@/components/dashboard/PortfolioChart";
import AgentManager from "@/components/dashboard/AgentManager";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { formatUsd, formatPct } from "@/lib/format";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useRebalanceStatus, useRebalanceHistory } from "@/hooks/useRebalanceHistory";
import { useRealtimePortfolio } from "@/hooks/useRealtimePortfolio";
import { useAccountDetail } from "@/hooks/useAccountDetail";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api, APIError } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import type { Portfolio } from "@snowmind/shared-types";

function deriveOverviewStats(p: Portfolio) {
  const totalDep = Number(p.totalDepositedUsd);
  const rawTotalYld = Number(p.totalYieldUsd);
  const totalYld = Math.abs(rawTotalYld) <= 0.00001 ? 0 : rawTotalYld;
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

type DashboardTab = "markets" | "agent-manager" | "agent-log";

const TABS: { id: DashboardTab; label: string; icon: typeof BarChart3 }[] = [
  { id: "markets", label: "Markets", icon: BarChart3 },
  { id: "agent-manager", label: "Agent Manager", icon: SlidersHorizontal },
  { id: "agent-log", label: "Agent Log", icon: ScrollText },
];

const HISTORY_PAGE_SIZE = 10;

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { authenticated, ready } = useAuth();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const address = ready && authenticated ? (smartAccountAddress || undefined) : undefined;
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: DashboardTab = tabParam === "agent-log"
    ? "agent-log"
    : tabParam === "agent-manager"
      ? "agent-manager"
      : "markets";
  const activatedFromOnboarding = searchParams.get("activated") === "1";
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const [transactionPageByAddress, setTransactionPageByAddress] = useState<Record<string, number>>({});
  const [logPageByAddress, setLogPageByAddress] = useState<Record<string, number>>({});
  const deploymentKickRef = useRef<string | null>(null);
  const deploymentLastTriggerAtRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastDashboardRefreshAtRef = useRef(0);

  const transactionPage = address ? (transactionPageByAddress[address] ?? 0) : 0;
  const logPage = address ? (logPageByAddress[address] ?? 0) : 0;
  const historyAddress = activeTab === "agent-log" ? address : undefined;

  const setTransactionPage = useCallback((page: number) => {
    if (!address) return;
    setTransactionPageByAddress((prev) => {
      if (prev[address] === page) return prev;
      return { ...prev, [address]: page };
    });
  }, [address]);

  const setLogPage = useCallback((page: number) => {
    if (!address) return;
    setLogPageByAddress((prev) => {
      if (prev[address] === page) return prev;
      return { ...prev, [address]: page };
    });
  }, [address]);

  const {
    data: portfolio,
    isLoading: portfolioLoading,
    error: portfolioError,
    refetch: refetchPortfolio,
  } = usePortfolio(address);

  const {
    data: rebalanceStatus,
    isLoading: rebalanceLoading,
    error: rebalanceStatusError,
  } = useRebalanceStatus(
    address,
    portfolio ? Number(portfolio.totalDepositedUsd) : 0,
  );

  const {
    data: transactionHistoryData,
    error: transactionHistoryError,
  } = useRebalanceHistory(
    historyAddress,
    transactionPage,
    HISTORY_PAGE_SIZE,
    true,
    portfolio ? Number(portfolio.totalDepositedUsd) : 0,
  );

  const {
    data: historyData,
    error: rebalanceHistoryError,
  } = useRebalanceHistory(
    historyAddress,
    logPage,
    HISTORY_PAGE_SIZE,
    false,
    portfolio ? Number(portfolio.totalDepositedUsd) : 0,
  );

  // Fetch account detail to get allowedProtocols (selected markets during onboarding)
  const {
    data: accountDetail,
    isLoading: accountLoading,
    error: accountDetailError,
  } = useAccountDetail(address);

  const hasAuthFault = [
    portfolioError,
    accountDetailError,
    rebalanceStatusError,
    transactionHistoryError,
    rebalanceHistoryError,
  ].some((err) => err instanceof APIError && (err.status === 401 || err.status === 429));

  const refreshDashboardQueries = useCallback(async (force = false) => {
    if (!address) return;

    const now = Date.now();
    if (!force && now - lastDashboardRefreshAtRef.current < 1200) {
      return;
    }

    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }

    lastDashboardRefreshAtRef.current = now;

    const refreshTask = Promise.allSettled([
      refetchPortfolio(),
      queryClient.refetchQueries({ queryKey: ["rebalance-status", address], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["account-detail", address], type: "active" }),
      ...(activeTab === "agent-log"
        ? [queryClient.refetchQueries({ queryKey: ["rebalance-history", address], type: "active" })]
        : []),
    ]).then(() => undefined)
      .finally(() => {
        lastDashboardRefreshAtRef.current = Date.now();
        refreshInFlightRef.current = null;
      });

    refreshInFlightRef.current = refreshTask;
    await refreshTask;
  }, [address, queryClient, refetchPortfolio, activeTab]);

  useRealtimePortfolio(address, accountDetail?.id || null);
  const isLoading = portfolioLoading || rebalanceLoading || accountLoading;
  const stats = portfolio ? deriveOverviewStats(portfolio) : null;
  const accountIsActive = accountDetail?.isActive ?? true;
  const hasActiveSessionKey = accountDetail?.sessionKey?.isActive ?? false;
  const idleAllocationAmount = Number(
    portfolio?.allocations.find((a) => a.protocolId === "idle")?.amountUsdc ?? "0",
  );
  const hasIdleAllocation = idleAllocationAmount > 0.01;
  const hasDeployableIdleBalance = idleAllocationAmount >= 1;

  const requiresRegrant = (() => {
    if (!isLoading && accountIsActive && !hasActiveSessionKey) return true;
    if (hasActiveSessionKey) return false;
    if (!rebalanceStatus) return false;
    const code = rebalanceStatus.reasonCode;
    const detail = (rebalanceStatus.reasonDetail ?? "").toLowerCase();

    if (code === "NO_ACTIVE_SESSION_KEY") return true;
    if (code === "SESSION_KEY_INVALID") return true;
    if (code === "SESSION_KEY_NOT_APPROVED") return true;
    if (code === "NO_PERMITTED_PROTOCOLS") return true;

    return (
      detail.includes("permission_recovery_needed") ||
      detail.includes("user must re-grant") ||
      detail.includes("must regrant") ||
      detail.includes("no active session key") ||
      detail.includes("session key invalid")
    );
  })();

  const deployStatus = String(rebalanceStatus?.status ?? "").toLowerCase();
  const hasDeployInFlightStatus = ["pending", "executing"].includes(deployStatus);
  const shouldAutoDeployIdle = !isLoading
    && accountIsActive
    && hasActiveSessionKey
    && !requiresRegrant
    && hasDeployableIdleBalance
    && !hasDeployInFlightStatus;
  const isIdleOnlyDeployment = !isLoading && accountIsActive && !!stats && stats.activeProtocols === 0 && hasIdleAllocation && !requiresRegrant;
  const deploySkipReason = rebalanceStatus?.reasonDetail
    ?? rebalanceStatus?.lastLog?.skipReason
    ?? null;
  const showDeployRetry = isIdleOnlyDeployment
    && hasActiveSessionKey
    && ["skipped", "failed", "halted"].includes(deployStatus);

  const triggerIdleDeployment = useCallback(async (force = false, allowWhenAuthFault = false) => {
    if (!address || !shouldAutoDeployIdle || (hasAuthFault && !allowWhenAuthFault)) return;

    const now = Date.now();
    if (!force && now - deploymentLastTriggerAtRef.current < 30_000) {
      return;
    }
    deploymentLastTriggerAtRef.current = now;

    try {
      const trigger = await api.triggerRebalance(address);
      const triggerStatus = String(trigger.status ?? "").toLowerCase();
      const detail = trigger.detail;
      const detailObject = detail && typeof detail === "object"
        ? detail as Record<string, unknown>
        : null;
      const skipReason = String(
        detailObject?.skip_reason
        ?? detailObject?.skipReason
        ?? detailObject?.reason
        ?? "",
      );

      if (process.env.NODE_ENV !== "production") {
        console.debug("[Dashboard] triggerRebalance:", triggerStatus, skipReason);
      }

      if (triggerStatus === "executed" || triggerStatus === "executing" || triggerStatus === "pending") {
        void refreshDashboardQueries();
        return;
      }

      if (triggerStatus === "skipped" && skipReason.toLowerCase().includes("no active session key")) {
        void refreshDashboardQueries();
      }
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== "production") {
        const msg = err instanceof Error ? err.message : String(err);
        console.debug("[Dashboard] triggerRebalance bootstrap failed:", msg);
      }
    }
  }, [address, shouldAutoDeployIdle, hasAuthFault, refreshDashboardQueries]);

  // Mobile wallets often background the page during confirmation. Force a refresh
  // when the app regains focus/visibility so dashboard state updates without manual reload.
  useEffect(() => {
    if (!address || hasAuthFault) return;

    const refresh = () => {
      void refreshDashboardQueries();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [address, hasAuthFault, refreshDashboardQueries]);

  // If funds are idle and session key is active, kick a best-effort immediate
  // rebalance so users do not wait for the next scheduler tick.
  useEffect(() => {
    if (!address || !shouldAutoDeployIdle || hasAuthFault) return;

    const idleKey = `${address}:${idleAllocationAmount.toFixed(2)}:${stats?.activeProtocols ?? 0}`;
    if (deploymentKickRef.current === idleKey) return;
    deploymentKickRef.current = idleKey;

    void triggerIdleDeployment(true);
  }, [address, shouldAutoDeployIdle, idleAllocationAmount, stats?.activeProtocols, hasAuthFault, triggerIdleDeployment]);

  // Continue nudging deployment while idle funds remain so transient in-flight
  // skips or session-key propagation delays do not leave funds stranded.
  useEffect(() => {
    if (!address || !shouldAutoDeployIdle || hasAuthFault) return;

    const interval = window.setInterval(() => {
      void triggerIdleDeployment();
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [address, shouldAutoDeployIdle, hasAuthFault, triggerIdleDeployment]);

  useEffect(() => {
    if (shouldAutoDeployIdle) return;
    deploymentKickRef.current = null;
    deploymentLastTriggerAtRef.current = 0;
  }, [shouldAutoDeployIdle]);

  // Aggressively poll for a short window so the "deploying" state clears
  // quickly without requiring a manual refresh (mobile and desktop).
  useEffect(() => {
    if (!address || !shouldAutoDeployIdle || hasAuthFault) return;

    let attempts = 0;
    const intervalMs = activatedFromOnboarding ? 2500 : 4000;
    const maxAttempts = activatedFromOnboarding ? 48 : 45; // ~2-3 minutes

    const tick = async () => {
      attempts += 1;
      await refreshDashboardQueries(true);
    };

    void tick();
    const interval = window.setInterval(() => {
      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
        return;
      }
      void tick();
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [address, activatedFromOnboarding, shouldAutoDeployIdle, hasAuthFault, refreshDashboardQueries]);

  // When execution succeeds but allocations are still rendering as idle,
  // briefly burst-refresh portfolio so the deployed market appears quickly.
  useEffect(() => {
    if (!address || !shouldAutoDeployIdle || hasAuthFault) return;
    if (rebalanceStatus?.status !== "executed") return;

    let attempts = 0;
    let inFlight = false;
    const maxAttempts = 6;

    const burstTick = async () => {
      if (inFlight) return;
      inFlight = true;
      attempts += 1;
      try {
        await refetchPortfolio();
      } finally {
        inFlight = false;
      }
    };

    void burstTick();

    const burst = window.setInterval(() => {
      if (attempts >= maxAttempts) {
        window.clearInterval(burst);
        return;
      }
      void burstTick();
    }, 1500);

    return () => {
      window.clearInterval(burst);
    };
  }, [address, shouldAutoDeployIdle, hasAuthFault, rebalanceStatus?.status, refetchPortfolio]);

  const regrantReason = rebalanceStatus?.reasonDetail
    ?? "Your session key needs to be granted again before automated rebalancing can continue.";

  // Active protocol IDs = user's selected protocols during onboarding (allowedProtocols in session key)
  // NOT based on current portfolio allocations, so it shows what user chose, not just current holdings
  const activeProtocolIds = accountDetail?.sessionKey?.allowedProtocols ?? [];

  // Protocols with current allocations > 0 (actively receiving yield)
  const activeAllocationIds = portfolio?.allocations
    ?.filter((a) => Number(a.amountUsdc) > 0)
    .map((a) => a.protocolId)
    ?? [];

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

      {/* Session key regrant banner */}
      {!isLoading && requiresRegrant && (
        <motion.div
          className="flex items-start gap-3 rounded-lg border border-[#E84142]/25 bg-[#E84142]/8 px-4 py-3"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 text-[#E84142]" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-arctic">Session key action required</p>
            <p className="mt-0.5 text-[11px] text-[#6E6761]">
              {regrantReason}
            </p>
          </div>
          <Link
            href="/settings"
            className="shrink-0 rounded-md border border-[#E84142]/30 bg-white px-3 py-1.5 text-[11px] font-medium text-[#E84142] hover:bg-[#FFF6F6]"
          >
            Re-grant in Settings
          </Link>
        </motion.div>
      )}

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
              <p className="mt-1 font-display text-3xl font-bold text-[#E84142]">{formatUsd(stats.totalDeposited + stats.totalYield)}</p>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[#E8E2DA] pt-4 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] text-[#8A837C]">Net deposited</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">{formatUsd(stats.totalDeposited)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#8A837C]">Net earned</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">
                    {formatUsd(stats.totalYield, { maxFractionDigits: 6 })}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[#8A837C]">APR</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">
                    {stats.activeProtocols > 0 && stats.blendedApy > 0
                      ? formatPct(stats.blendedApy)
                      : "0.00%"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[#8A837C]">Active markets</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-arctic">
                    {stats.activeProtocols > 0
                      ? stats.activeProtocols
                      : isIdleOnlyDeployment
                        ? (
                          <span className="inline-flex items-center gap-1 text-glacier">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Deploying
                          </span>
                        )
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

      {/* Deploying funds banner — shown when all funds are idle after activation */}
      {isIdleOnlyDeployment && (
        <motion.div
          className="rounded-lg border border-glacier/20 bg-glacier/[0.06] px-4 py-3"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-glacier" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-arctic">Agent is deploying your funds</p>
              <p className="text-[11px] text-[#8A837C]">
                The optimizer is moving your idle USDC on-chain. This usually finishes in 1-3 minutes.
              </p>
              {showDeployRetry && deploySkipReason && (
                <p className="mt-1 text-[11px] text-[#7A736D]">
                  Latest check: {deploySkipReason}
                </p>
              )}
            </div>
            {showDeployRetry && (
              <button
                type="button"
                onClick={() => {
                  void triggerIdleDeployment(true, true);
                  void refreshDashboardQueries(true);
                }}
                className="shrink-0 rounded-md border border-glacier/30 bg-white px-3 py-1.5 text-[11px] font-medium text-glacier hover:bg-glacier/[0.08]"
              >
                Retry now
              </button>
            )}
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
            <LiveRates 
              activeProtocolIds={activeProtocolIds}
              activeAllocationIds={activeAllocationIds}
              totalDepositedUsd={stats?.totalDeposited ?? 0}
            />
          </ErrorBoundary>
        </div>
      )}

      {activeTab === "agent-manager" && (
        <ErrorBoundary name="agent-manager">
          <AgentManager
            address={address}
            hasActiveSessionKey={hasActiveSessionKey}
            allowedProtocols={activeProtocolIds}
            allocationCaps={accountDetail?.allocationCaps ?? null}
          />
        </ErrorBoundary>
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
          <LiveTxFeed
            history={historyData?.logs ?? []}
            historyTotal={historyData?.total ?? 0}
            historyPage={logPage}
            onHistoryPageChange={setLogPage}
            transactionHistory={transactionHistoryData?.logs ?? []}
            transactionTotal={transactionHistoryData?.total ?? 0}
            transactionPage={transactionPage}
            onTransactionPageChange={setTransactionPage}
            pageSize={HISTORY_PAGE_SIZE}
          />
        </div>
      )}
    </div>
  );
}
