"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canonicalProtocolId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "aave") return "aave_v3";
    if (normalized === "folks_finance_xchain" || normalized === "folks_finance") return "folks";
    return normalized;
}

export function useProtocolRates() {
  return useQuery({
    queryKey: ["protocol-rates"],
    queryFn: async () => {
      const rows = await api.getCurrentRates();
      const byProtocol = new Map<string, (typeof rows)[number]>();

      for (const row of rows) {
        const normalizedProtocolId = canonicalProtocolId(row.protocolId);
        byProtocol.set(normalizedProtocolId, {
          ...row,
          protocolId: normalizedProtocolId as typeof row.protocolId,
          currentApy: toFiniteNumber(row.currentApy, 0),
          tvlUsd: toFiniteNumber(row.tvlUsd, 0),
          riskScore: toFiniteNumber(row.riskScore, Number.NaN),
          riskScoreMax: Math.max(1, Math.round(toFiniteNumber(row.riskScoreMax, 9))),
          utilizationRate:
            row.utilizationRate == null ? null : toFiniteNumber(row.utilizationRate, Number.NaN),
          lastUpdated: toFiniteNumber(row.lastUpdated, Date.now() / 1000),
        });
      }

      return Array.from(byProtocol.values());
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}
