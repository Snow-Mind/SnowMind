"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";

const noRetryOn404 = (failureCount: number, error: Error) => {
  if (error instanceof APIError && error.status === 404) return false;
  return failureCount < 2;
};

/** Latest status (single last log). */
export function useRebalanceStatus(address: string | undefined) {
  return useQuery({
    queryKey: ["rebalance-status", address],
    queryFn: () => api.getRebalanceStatus(address!),
    enabled: !!address,
    refetchInterval: 30_000,
    retry: noRetryOn404,
  });
}

/** Paginated history logs. */
export function useRebalanceHistory(
  address: string | undefined,
  page = 0,
) {
  return useQuery({
    queryKey: ["rebalance-history", address, page],
    queryFn: () => api.getRebalanceHistory(address!, page),
    enabled: !!address,
    refetchInterval: 30_000,
    retry: noRetryOn404,
  });
}
