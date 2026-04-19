"use client";

import Image from "next/image";
import { Activity, RefreshCw, TrendingUp, Clock, Loader2, ExternalLink } from "lucide-react";
import { PROTOCOL_CONFIG } from "@/lib/constants";
import { formatPct } from "@/lib/format";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { useQueryClient } from "@tanstack/react-query";
import { getRebalanceCadence } from "@/lib/rebalanceCadence";
import {
  riskBandFromScore,
  riskBandLabel,
  RISK_BAND_TOOLTIP,
  toNinePointRiskScore,
} from "@/lib/risk-level";

function canonicalProtocolId(rawProtocolId: string): string {
  const normalized = (rawProtocolId || "").trim().toLowerCase();
  return normalized === "aave" ? "aave_v3" : normalized;
}

interface LiveRatesProps {
  activeProtocolIds?: string[]; // Selected protocols from onboarding
  activeAllocationIds?: string[]; // Protocols with current allocations > 0
  totalDepositedUsd?: number;
}

export default function LiveRates({ 
  activeProtocolIds = [],
  activeAllocationIds = [],
  totalDepositedUsd = 0,
}: LiveRatesProps) {
  const { data: rates, isLoading, dataUpdatedAt, isFetching } = useProtocolRates();
  const queryClient = useQueryClient();

  function handleManualRefresh() {
    queryClient.invalidateQueries({ queryKey: ["protocol-rates"] });
  }

  const lastRefresh = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const rebalanceIntervalLabel = getRebalanceCadence(totalDepositedUsd).label;

  // Sort: active protocols first, highest APY, then coming soon
  const sorted = [...(rates ?? [])].sort((a, b) => {
    if (a.isComingSoon && !b.isComingSoon) return 1;
    if (!a.isComingSoon && b.isComingSoon) return -1;
    return b.currentApy - a.currentApy;
  });

  // Split into Selected (user has funds) vs Available (no funds / not selected)
  const selectedMarkets = sorted.filter(
    (r) => !r.isComingSoon && activeProtocolIds.includes(r.protocolId),
  );
  const availableMarkets = sorted.filter(
    (r) => r.isComingSoon || !activeProtocolIds.includes(r.protocolId),
  );

  const renderCard = (r: (typeof sorted)[number]) => {
    const canonicalId = canonicalProtocolId(r.protocolId);
    const meta =
      PROTOCOL_CONFIG[canonicalId as keyof typeof PROTOCOL_CONFIG];
    if (!meta) return null;

    const riskBand = riskBandFromScore(
      toNinePointRiskScore(
        Number(r.riskScore),
        Number(r.riskScoreMax),
        meta.riskScore,
      ),
    );

    const isSelected = activeProtocolIds.includes(canonicalId);
    const hasAllocation = activeAllocationIds.includes(canonicalId);
    const isActive = isSelected && hasAllocation; // Actively depositing

    return (
      <div
        key={r.protocolId}
        className={`rounded-xl border p-4 transition-colors ${
          r.isComingSoon
            ? "border-border/20 bg-void-2/10 opacity-50"
            : isActive
              ? "border-[#E84142] bg-[#E84142]/[0.06]" // RED: Actively depositing
              : isSelected
                ? "border-[#E8E2DA] bg-[#FAFAF8]" // Neutral: Selected but not deployed yet
                : "border-border/50 bg-void-2/30" // GRAY: Not selected
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
            <span className="text-sm font-medium text-arctic">{r.name}</span>
            {r.isComingSoon && (
              <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[10px] text-amber">
                Coming Soon
              </span>
            )}
            {!r.isComingSoon && (
              <span
                className="rounded-full bg-void-2 px-2 py-0.5 text-[10px] text-muted-foreground"
                title={RISK_BAND_TOOLTIP}
              >
                {riskBandLabel(riskBand)}
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

        {!r.isComingSoon && meta.vaultUrl && (
          <div className="mt-2 pl-8 text-[10px] text-muted-foreground">
            <a
              href={meta.vaultUrl}
              target="_blank"
              rel="noopener noreferrer external"
              className="inline-flex items-center gap-1 hover:text-glacier"
            >
              View protocol page
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    );
  };

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
              Live on-chain APY comparison across protocols
            </p>
            <p className="text-[10px] text-muted-foreground">
              Optimizer and auto-rebalance decisions use TWAP-smoothed rates for safety.
            </p>
            <p className="text-[10px] text-muted-foreground">
              Rebalance cadence for current deposit size: every {rebalanceIntervalLabel}
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
          <>
            {/* Selected Markets */}
            {selectedMarkets.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-glacier/70">
                  Selected Markets
                </h3>
                <div className="space-y-2">
                  {selectedMarkets.map(renderCard)}
                </div>
              </div>
            )}

            {/* Available Markets */}
            {availableMarkets.length > 0 && (
              <div className={selectedMarkets.length > 0 ? "mt-4" : ""}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Available Markets
                </h3>
                <div className="space-y-2">
                  {availableMarkets.map(renderCard)}
                </div>
              </div>
            )}
          </>
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

      <p className="mt-2 text-[10px] text-muted-foreground">
        Risk score is out of 9 (higher score means lower risk). Scores reflect SnowMind&apos;s independent assessment based on publicly available on-chain data and documentation. They are not endorsements or financial advice. Users should conduct their own research before making decisions.
      </p>
    </div>
  );
}
