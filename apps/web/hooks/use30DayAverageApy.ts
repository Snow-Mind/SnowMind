"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Protocol30DayApyResponse } from "@snowmind/shared-types";

export function use30DayAverageApy() {
  return useQuery<Protocol30DayApyResponse[]>({
    queryKey: ["30day-average-apy"],
    queryFn: () => api.get30DayAverageApy(),
    refetchInterval: 300_000, // Refresh every 5 minutes (less frequent than live rates)
    staleTime: 120_000, // Consider stale after 2 minutes
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}
