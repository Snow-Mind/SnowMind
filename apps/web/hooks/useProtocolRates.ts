"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function useProtocolRates() {
  return useQuery({
    queryKey: ["protocol-rates"],
    queryFn: async () => {
      const rows = await api.getCurrentRates();
      return rows.map((row) => ({
        ...row,
        currentApy: toFiniteNumber(row.currentApy, 0),
        tvlUsd: toFiniteNumber(row.tvlUsd, 0),
        riskScore: toFiniteNumber(row.riskScore, 0),
        riskScoreMax: Math.max(1, Math.round(toFiniteNumber(row.riskScoreMax, 9))),
        utilizationRate:
          row.utilizationRate == null ? null : toFiniteNumber(row.utilizationRate, 0),
        lastUpdated: toFiniteNumber(row.lastUpdated, Date.now() / 1000),
      }));
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}
