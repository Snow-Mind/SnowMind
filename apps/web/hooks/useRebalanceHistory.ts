"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";
import { isValidEvmAddress } from "@/lib/address";
import { useAuth } from "@/hooks/useAuth";

function isNonRetryableClientError(error: unknown): boolean {
  return error instanceof APIError && error.status >= 400 && error.status < 500;
}

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
      if (isNonRetryableClientError(err)) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (isNonRetryableClientError(error)) return false;
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
      if (isNonRetryableClientError(err)) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (isNonRetryableClientError(error)) return false;
      return failureCount < 2;
    },
  });
}
