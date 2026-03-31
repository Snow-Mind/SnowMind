"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";
import { isValidEvmAddress } from "@/lib/address";
import { useAuth } from "@/hooks/useAuth";

/** Latest status (single last log). */
export function useRebalanceStatus(address: string | undefined) {
  const { authenticated, ready } = useAuth();
  const safeAddress = isValidEvmAddress(address) ? address : undefined;

  return useQuery({
    queryKey: ["rebalance-status", safeAddress],
    queryFn: () => api.getRebalanceStatus(safeAddress!),
    enabled: !!safeAddress && ready && authenticated,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && (err.status === 401 || err.status === 429)) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof APIError && (error.status === 401 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}

/** Paginated history logs. */
export function useRebalanceHistory(
  address: string | undefined,
  page = 0,
  limit = 20,
  transactionsOnly = false,
) {
  const { authenticated, ready } = useAuth();
  const safeAddress = isValidEvmAddress(address) ? address : undefined;

  return useQuery({
    queryKey: ["rebalance-history", safeAddress, page, limit, transactionsOnly],
    queryFn: () => api.getRebalanceHistory(safeAddress!, page, limit, transactionsOnly),
    enabled: !!safeAddress && ready && authenticated,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && (err.status === 401 || err.status === 429)) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof APIError && (error.status === 401 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}
