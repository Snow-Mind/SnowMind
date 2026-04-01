"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ExternalLink,
  Activity,
  AlertTriangle,
  Lightbulb,
  Eye,
  FileText,
} from "lucide-react";
import { PROTOCOL_CONFIG, EXPLORER, type ProtocolId } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import type { RebalanceLogEntry } from "@snowmind/shared-types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type ActionType = "deposit" | "withdraw" | "rebalance" | "monitoring";

type AgentSection = "transactions" | "log";

type ExtendedLogEntry = RebalanceLogEntry & {
  fromProtocol?: string | null;
  toProtocol?: string | null;
  amountMoved?: string | null;
};

interface TransactionItem {
  entry: ExtendedLogEntry;
  action: Exclude<ActionType, "monitoring">;
  protocol: string;
  amountValue: number;
  amountLabel: string;
  allocations: Record<string, number>;
  reasoning: string;
}

function parseAllocations(entry: RebalanceLogEntry): Record<string, number> {
  const source = entry.executedAllocations ?? entry.proposedAllocations;
  if (!source || typeof source !== "object") return {};

  const parsed: Record<string, number> = {};
  for (const [protocol, value] of Object.entries(source)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      parsed[protocol] = numeric;
    }
  }
  return parsed;
}

function allocationTotal(allocations: Record<string, number>): number {
  return Object.values(allocations).reduce((sum, value) => sum + value, 0);
}

function protocolLabel(protocolId: string | null | undefined): string {
  if (!protocolId) return "Monitoring";
  const key = protocolId as ProtocolId;
  const cfg = PROTOCOL_CONFIG[key];
  return cfg?.name ?? protocolId;
}

function topProtocol(allocations: Record<string, number>): string {
  const allocs = Object.entries(allocations);
  if (allocs.length === 0) return "Monitoring";

  const [protocolId] = allocs.sort((a, b) => b[1] - a[1])[0];
  return protocolLabel(protocolId);
}

function formatAmountLabel(amount: number): string {
  if (Number.isFinite(amount) && amount > 0) {
    return `${formatUsd(amount)} USDC`;
  }
  return "USDC";
}

function formatTransactionDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function allocationSummary(allocations: Record<string, number>): string {
  const sorted = Object.entries(allocations).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return "-";

  const total = allocationTotal(allocations);
  if (!Number.isFinite(total) || total <= 0) return "-";

  const [topId, topAmount] = sorted[0];
  const topPct = (topAmount / total) * 100;
  if (sorted.length === 1) {
    return `${protocolLabel(topId)} ${topPct.toFixed(0)}%`;
  }

  const [secondId, secondAmount] = sorted[1];
  const secondPct = (secondAmount / total) * 100;
  return `${protocolLabel(topId)} ${topPct.toFixed(0)}% · ${protocolLabel(secondId)} ${secondPct.toFixed(0)}%`;
}

function inferAction(entry: RebalanceLogEntry): ActionType {
  if (entry.status === "skipped") return "monitoring";
  if ((entry as ExtendedLogEntry).fromProtocol === "user_wallet") return "deposit";
  if ((entry as ExtendedLogEntry).fromProtocol === "withdrawal") return "withdraw";

  const allocations = parseAllocations(entry);
  if (allocationTotal(allocations) > 0) {
    return "rebalance";
  }
  return "monitoring";
}

const ACTION_CONFIG: Record<ActionType, { icon: typeof ArrowDownToLine; label: string; iconClass: string }> = {
  deposit:    { icon: ArrowDownToLine, label: "Deposit",    iconClass: "text-mint" },
  withdraw:   { icon: ArrowUpFromLine, label: "Withdraw",   iconClass: "text-crimson" },
  rebalance:  { icon: RefreshCw,       label: "Rebalance",  iconClass: "text-glacier" },
  monitoring: { icon: Eye,             label: "Monitoring",  iconClass: "text-muted-foreground" },
};

function isIdleOnlyTransaction(tx: TransactionItem): boolean {
  const topProtocol = tx.protocol.trim().toLowerCase();
  const toProtocol = (tx.entry.toProtocol ?? "").trim().toLowerCase();
  if (topProtocol === "idle" || toProtocol === "idle") {
    return true;
  }

  const allocationKeys = Object.keys(tx.allocations);
  return allocationKeys.length > 0
    && allocationKeys.every((protocolId) => protocolId.trim().toLowerCase() === "idle");
}

function TransactionDetailsPanel({ tx, className = "" }: { tx: TransactionItem; className?: string }) {
  return (
    <div className={`border-t border-border/20 bg-glacier/[0.03] ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-arctic">Transaction Details</h3>
        <span className="text-[10px] text-muted-foreground">
          {formatTransactionDate(tx.entry.createdAt)}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border/30 bg-white/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Action</p>
          <p className="mt-0.5 text-xs font-medium text-arctic">
            {ACTION_CONFIG[tx.action].label}
          </p>
        </div>
        <div className="rounded-md border border-border/30 bg-white/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount</p>
          <p className="mt-0.5 font-mono text-xs text-arctic">{tx.amountLabel}</p>
        </div>
        <div className="rounded-md border border-border/30 bg-white/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Protocol</p>
          <p className="mt-0.5 text-xs text-arctic">{tx.protocol}</p>
        </div>
        <div className="rounded-md border border-border/30 bg-white/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Date</p>
          <p className="mt-0.5 text-xs text-arctic">{formatTransactionDate(tx.entry.createdAt)}</p>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border/30 bg-white/40 px-3 py-2">
        <div className="flex items-start gap-1.5">
          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-glacier/70" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {tx.reasoning}
          </p>
        </div>
      </div>

      {tx.entry.txHash && (
        <a
          href={EXPLORER.tx(tx.entry.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-glacier hover:underline"
        >
          View transaction on Snowtrace
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/** Derive verifiable reasoning for each agent action — Giza-style "Verifiable Decision-Making" */
function deriveReasoning(entry: RebalanceLogEntry): string | null {
  if (entry.status === "skipped") {
    return entry.skipReason || "Monitoring complete — no action needed.";
  }
  if (entry.status === "failed") return "Transaction reverted. Funds remain safe — agent will retry next cycle.";
  if ((entry as ExtendedLogEntry).fromProtocol === "user_wallet") {
    return "USDC funded from your wallet into the smart account.";
  }
  if (entry.aprImprovement != null && entry.aprImprovement > 0) {
    return `APR improved by ${(entry.aprImprovement * 100).toFixed(2)}%${entry.gasCostUsd ? ` · Gas: $${entry.gasCostUsd.toFixed(4)}` : ""} — net positive after costs.`;
  }
  const action = inferAction(entry);
  if (action === "deposit") return "Initial fund deployment to start earning yield.";
  if (action === "withdraw") return "Funds withdrawn from protocol.";
  return "Rates confirmed via TWAP. Allocation optimized by waterfall allocator.";
}

interface LiveTxFeedProps {
  history: RebalanceLogEntry[];
  historyTotal: number;
  historyPage: number;
  onHistoryPageChange: (page: number) => void;
  transactionHistory: RebalanceLogEntry[];
  transactionTotal: number;
  transactionPage: number;
  onTransactionPageChange: (page: number) => void;
  pageSize: number;
}

interface PaginationControlsProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function PaginationControls({ page, total, pageSize, onPageChange }: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 0;
  const canNext = page + 1 < totalPages;

  return (
    <div className="flex items-center justify-between border-t border-border/20 px-4 py-3 text-[11px] sm:px-6">
      <span className="text-muted-foreground">
        Page {Math.min(page + 1, totalPages)} of {totalPages}
      </span>
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={!canPrev}
          className="rounded-md border border-border/40 px-2.5 py-1 text-arctic disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          className="rounded-md border border-border/40 px-2.5 py-1 text-arctic disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "executed") return "Confirmed";
  if (status === "failed") return "Failed";
  if (status === "halted") return "Halted";
  if (status === "skipped") return "Skipped";
  return "Pending";
}

function statusClasses(status: string): string {
  if (status === "executed") return "text-mint";
  if (status === "failed" || status === "halted") return "text-crimson";
  if (status === "skipped") return "text-muted-foreground";
  return "text-amber-400";
}

function statusDotClasses(status: string): string {
  if (status === "executed") return "bg-mint";
  if (status === "failed" || status === "halted") return "bg-crimson";
  if (status === "skipped") return "bg-muted-foreground";
  return "animate-pulse bg-amber-400";
}

function buildTransactions(history: RebalanceLogEntry[]): TransactionItem[] {
  const orderedAscending = [...history]
    .map((entry) => entry as ExtendedLogEntry)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let previousPortfolioTotal = 0;
  const transactions: TransactionItem[] = [];
  const seenTxHashes = new Set<string>();

  for (const entry of orderedAscending) {
    if (entry.status !== "executed") continue;

    if (entry.txHash) {
      const normalizedHash = entry.txHash.toLowerCase();
      if (seenTxHashes.has(normalizedHash)) {
        continue;
      }
      seenTxHashes.add(normalizedHash);
    }

    const allocations = parseAllocations(entry);
    const allocationSum = allocationTotal(allocations);
    const explicitDeposit = entry.fromProtocol === "user_wallet";
    const explicitWithdrawal = entry.fromProtocol === "withdrawal";

    if (explicitDeposit) {
      const depositedAmount = Number(entry.amountMoved ?? "0");
      const normalizedAmount = Number.isFinite(depositedAmount) && depositedAmount > 0
        ? depositedAmount
        : allocationSum;
      transactions.push({
        entry,
        action: "deposit",
        protocol: protocolLabel(entry.toProtocol || "idle"),
        amountValue: normalizedAmount,
        amountLabel: formatAmountLabel(normalizedAmount),
        allocations,
        reasoning: deriveReasoning(entry) ?? "USDC funded to smart account.",
      });
      if (normalizedAmount > 0) {
        previousPortfolioTotal += normalizedAmount;
      }
      continue;
    }

    if (explicitWithdrawal) {
      const withdrawnAmount = Number(entry.amountMoved ?? "0");
      const normalizedAmount = Number.isFinite(withdrawnAmount) && withdrawnAmount > 0
        ? withdrawnAmount
        : 0;
      const reasoning = deriveReasoning(entry) ?? "Funds moved back to your wallet.";
      transactions.push({
        entry,
        action: "withdraw",
        protocol: protocolLabel(entry.toProtocol || "user_eoa"),
        amountValue: normalizedAmount,
        amountLabel: formatAmountLabel(normalizedAmount),
        allocations,
        reasoning,
      });
      previousPortfolioTotal = Math.max(previousPortfolioTotal - normalizedAmount, 0);
      continue;
    }

    if (!entry.txHash && allocationSum <= 0) {
      continue;
    }

    const isDeposit = previousPortfolioTotal <= 0.01 && allocationSum > 0.01;
    const action: Exclude<ActionType, "monitoring"> = isDeposit ? "deposit" : "rebalance";

    const amountValue = isDeposit
      ? allocationSum
      : Math.max(Math.abs(allocationSum - previousPortfolioTotal), allocationSum);

    transactions.push({
      entry,
      action,
      protocol: topProtocol(allocations),
      amountValue,
      amountLabel: formatAmountLabel(amountValue),
      allocations,
      reasoning: deriveReasoning(entry) ?? "Rebalance executed on-chain.",
    });

    if (allocationSum > 0) {
      previousPortfolioTotal = allocationSum;
    }
  }

  return transactions
    .filter((tx) => !isIdleOnlyTransaction(tx))
    .sort(
    (a, b) => new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime(),
    );
}

export default function LiveTxFeed({
  history,
  historyTotal,
  historyPage,
  onHistoryPageChange,
  transactionHistory,
  transactionTotal,
  transactionPage,
  onTransactionPageChange,
  pageSize,
}: LiveTxFeedProps) {
  const [section, setSection] = useState<AgentSection>("transactions");
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);

  const transactions = useMemo(() => {
    return buildTransactions(transactionHistory);
  }, [transactionHistory]);

  const logEntries = useMemo(() => {
    return [...history]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, pageSize);
  }, [history, pageSize]);

  return (
    <div className="crystal-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-glacier" />
          <h2 className="text-sm font-medium text-arctic">Agent Activity</h2>
        </div>

        <div className="inline-flex rounded-md bg-[#ECE8E3] p-1">
          <button
            type="button"
            onClick={() => setSection("transactions")}
            className={`rounded px-3 py-1 text-[11px] font-medium transition-colors ${
              section === "transactions"
                ? "bg-white text-arctic shadow-sm"
                : "text-[#7B746E] hover:text-[#544E48]"
            }`}
          >
            Transactions
          </button>
          <button
            type="button"
            onClick={() => setSection("log")}
            className={`rounded px-3 py-1 text-[11px] font-medium transition-colors ${
              section === "log"
                ? "bg-white text-arctic shadow-sm"
                : "text-[#7B746E] hover:text-[#544E48]"
            }`}
          >
            Log
          </button>
        </div>
      </div>

      {section === "transactions" ? (
        transactions.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              No past transactions yet. Deposit to start tracking activity.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden sm:block">
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_150px_70px] gap-3 border-b border-border/20 bg-[#F6F2EE] px-6 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#8A837C]">
                <span>Operation</span>
                <span>Amount</span>
                <span>Allocation</span>
                <span>Date</span>
                <span className="text-right">Details</span>
              </div>
              <div className="divide-y divide-border/20">
                {transactions.map((tx) => {
                  const cfg = ACTION_CONFIG[tx.action];
                  const Icon = cfg.icon;
                  const selected = tx.entry.id === selectedTransactionId;

                  return (
                    <div key={tx.entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedTransactionId((prev) => (prev === tx.entry.id ? null : tx.entry.id))}
                        className={`grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_150px_70px] items-center gap-3 px-6 py-3 text-left transition-colors ${
                          selected ? "bg-glacier/[0.06]" : "hover:bg-accent/20"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/40 bg-void-2/30 ${cfg.iconClass}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-arctic">
                              {cfg.label} · {tx.protocol}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">{tx.reasoning}</p>
                          </div>
                        </div>

                        <span className="font-mono text-xs text-arctic">{tx.amountLabel}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{allocationSummary(tx.allocations)}</span>
                        <span className="text-[11px] text-muted-foreground">{formatTransactionDate(tx.entry.createdAt)}</span>
                        <span className="text-right text-[11px] font-medium text-glacier">
                          {selected ? "Hide" : "View"}
                        </span>
                      </button>
                      {selected && (
                        <TransactionDetailsPanel tx={tx} className="px-6 py-4" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-border/20 sm:hidden">
              {transactions.map((tx) => {
                const cfg = ACTION_CONFIG[tx.action];
                const Icon = cfg.icon;
                const selected = tx.entry.id === selectedTransactionId;

                return (
                  <div key={tx.entry.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTransactionId((prev) => (prev === tx.entry.id ? null : tx.entry.id))}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        selected ? "bg-glacier/[0.06]" : "hover:bg-accent/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40 bg-void-2/30 ${cfg.iconClass}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <p className="truncate text-xs font-medium text-arctic">{cfg.label} · {tx.protocol}</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-arctic">{tx.amountLabel}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{formatTransactionDate(tx.entry.createdAt)}</span>
                        <span className="truncate">{allocationSummary(tx.allocations)}</span>
                      </div>
                    </button>
                    {selected && (
                      <TransactionDetailsPanel tx={tx} className="px-4 py-4" />
                    )}
                  </div>
                );
              })}
            </div>

            <PaginationControls
              page={transactionPage}
              total={transactionTotal}
              pageSize={pageSize}
              onPageChange={onTransactionPageChange}
            />
          </>
        )
      ) : logEntries.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">
            No monitoring logs yet.
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border/20">
            {logEntries.map((entry) => {
              const action = inferAction(entry);
              const cfg = ACTION_CONFIG[action];
              const Icon = entry.status === "failed" || entry.status === "halted"
                ? AlertTriangle
                : cfg.icon;
              const reason = deriveReasoning(entry) ?? "Monitoring cycle completed.";

              return (
                <div key={entry.id} className="px-4 py-3.5 sm:px-6">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-void-2/30 ${cfg.iconClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-xs font-medium text-arctic">
                          {entry.status === "skipped" ? "Monitoring" : "Agent Log"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(entry.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{reason}</p>
                    </div>

                    <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] ${statusClasses(entry.status)}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClasses(entry.status)}`} />
                      {statusLabel(entry.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <PaginationControls
            page={historyPage}
            total={historyTotal}
            pageSize={pageSize}
            onPageChange={onHistoryPageChange}
          />
        </>
      )}
    </div>
  );
}
