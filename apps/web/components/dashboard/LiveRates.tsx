"use client";

import Image from "next/image";
import { Activity, RefreshCw, TrendingUp, Clock, Loader2 } from "lucide-react";
import { PROTOCOL_CONFIG } from "@/lib/constants";
import { formatPct } from "@/lib/format";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { useQueryClient } from "@tanstack/react-query";

interface LiveRatesProps {
  activeProtocolIds?: string[];
}

export default function LiveRates({ activeProtocolIds = [] }: LiveRatesProps) {
  const { data: rates, isLoading, dataUpdatedAt, isFetching } = useProtocolRates();
  const queryClient = useQueryClient();

  function handleManualRefresh() {
    queryClient.invalidateQueries({ queryKey: ["protocol-rates"] });
  }

  const lastRefresh = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  // Sort: active protocols first, highest APY, then coming soon
  const sorted = [...(rates ?? [])].sort((a, b) => {
    if (a.isComingSoon && !b.isComingSoon) return 1;
    if (!a.isComingSoon && b.isComingSoon) return -1;
    return b.currentApy - a.currentApy;
  });

  return (
    <div className="crystal-card p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
            <Activity className="h-4 w-4 text-glacier" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-arctic">
              Protocol Rates
            </h2>
            <p className="text-xs text-muted-foreground">
              APY comparison across protocols
            </p>
          </div>
        </div>
        <button
          onClick={handleManualRefresh}
          disabled={isFetching}
          className="flex items-center gap-1 rounded-lg bg-void-2/50 px-2.5 py-1.5 text-[10px] text-muted-foreground transition-colors hover:text-arctic"
        >
          <RefreshCw
            className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Rate cards */}
      <div className="mt-5 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-glacier" />
          </div>
        ) : (
          sorted.map((r) => {
            const meta =
              PROTOCOL_CONFIG[r.protocolId as keyof typeof PROTOCOL_CONFIG];
            if (!meta) return null;

            return (
              <div
                key={r.protocolId}
                className={`rounded-xl border p-4 transition-colors ${
                  r.isComingSoon
                    ? "border-border/20 bg-void-2/10 opacity-50"
                    : activeProtocolIds.includes(r.protocolId)
                      ? "border-[#E84142] bg-[#E84142]/[0.06]"
                      : "border-border/50 bg-void-2/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Image
                      src={meta.logoPath}
                      alt={meta.name}
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                    <span className="text-sm font-medium text-arctic">
                      {r.name}
                    </span>
                    {r.isComingSoon && (
                      <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[10px] text-amber">
                        Coming Soon
                      </span>
                    )}
                  </div>
                  {!r.isComingSoon && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono text-lg font-bold text-glacier">
                        {formatPct(r.currentApy * 100)}
                      </span>
                      <span className="text-xs text-muted-foreground">APY</span>
                    </div>
                  )}
                </div>


              </div>
            );
          })
        )}
      </div>

      {/* Refresh note */}
      <div className="mt-4 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        Auto-refreshes every 60s
        {lastRefresh && (
          <>
            {" · Last: "}
            {lastRefresh.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </>
        )}
      </div>
    </div>
  );
}
