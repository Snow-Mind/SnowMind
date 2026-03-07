"use client";

import { useMemo } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ExternalLink,
  Activity,
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

type ActionType = "deposit" | "withdraw" | "rebalance";

function inferAction(entry: RebalanceLogEntry): ActionType {
  const fromTotal = entry.fromAllocations.reduce((s, a) => s + a.percentage, 0);
  const toTotal = entry.toAllocations.reduce((s, a) => s + a.percentage, 0);
  if (fromTotal === 0 && toTotal > 0) return "deposit";
  if (toTotal === 0 && fromTotal > 0) return "withdraw";
  return "rebalance";
}

function primaryProtocol(entry: RebalanceLogEntry): string {
  const allocs =
    entry.toAllocations.length > 0
      ? entry.toAllocations
      : entry.fromAllocations;
  if (allocs.length === 0) return "Unknown";
  const top = [...allocs].sort((a, b) => b.percentage - a.percentage)[0];
  const cfg = PROTOCOL_CONFIG[top.protocolId as ProtocolId];
  return cfg?.name ?? top.protocolId;
}

function estimateAmount(entry: RebalanceLogEntry): string {
  const allocs = entry.toAllocations.length > 0 ? entry.toAllocations : entry.fromAllocations;
  // Sum amounts from allocations (amountUsd is a string in the type)
  const total = allocs.reduce((s, a) => s + Number(a.amountUsd ?? 0), 0);
  if (total > 0) return `${formatUsd(total)} USDC`;
  return "USDC";
}

const ACTION_CONFIG: Record<ActionType, { icon: typeof ArrowDownToLine; label: string; iconClass: string }> = {
  deposit:   { icon: ArrowDownToLine, label: "Deposit",   iconClass: "text-mint" },
  withdraw:  { icon: ArrowUpFromLine, label: "Withdraw",  iconClass: "text-crimson" },
  rebalance: { icon: RefreshCw,       label: "Rebalance", iconClass: "text-glacier" },
};

interface LiveTxFeedProps {
  history: RebalanceLogEntry[];
}

export default function LiveTxFeed({ history }: LiveTxFeedProps) {
  const entries = useMemo(() => history.slice(0, 5), [history]);

  return (
    <div className="crystal-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-glacier" />
          <h2 className="text-sm font-medium text-arctic">Live Transactions</h2>
        </div>
        <span className="text-[10px] text-muted-foreground">Last 5</span>
      </div>

      {entries.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">
            No transactions yet. Deposit to get started.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {entries.map((entry) => {
            const action = inferAction(entry);
            const cfg = ACTION_CONFIG[action];
            const Icon = cfg.icon;
            const isConfirmed = entry.status === "completed";

            return (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-6 py-3.5 transition-colors hover:bg-accent/20"
              >
                {/* Action icon */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-void-2/30 ${cfg.iconClass}`}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-arctic">
                      {cfg.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · {primaryProtocol(entry)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {estimateAmount(entry)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · {timeAgo(entry.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`flex items-center gap-1 text-[10px] ${
                      isConfirmed ? "text-mint" : "text-amber-400"
                    }`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        isConfirmed ? "bg-mint" : "animate-pulse bg-amber-400"
                      }`}
                    />
                    {isConfirmed ? "Confirmed" : "Pending"}
                  </span>

                  {/* Snowtrace link */}
                  {entry.txHash && (
                    <a
                      href={EXPLORER.tx(entry.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 text-[10px] text-glacier hover:underline"
                      title="View on Snowtrace"
                    >
                      Snowtrace
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
