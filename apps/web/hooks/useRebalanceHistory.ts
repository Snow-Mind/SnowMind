"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";
import { isValidEvmAddress } from "@/lib/address";
import { useAuth } from "@/hooks/useAuth";
import { getRebalancePollingIntervalMs } from "@/lib/rebalanceCadence";

function isNonRetryableClientError(error: unknown): boolean {
  return error instanceof APIError && error.status >= 400 && error.status < 500;
}

/** Latest status (single last log). */
export function useRebalanceStatus(address: string | undefined, totalDepositedUsd = 0) {
  const { authenticated, ready } = useAuth();
  const safeAddress = isValidEvmAddress(address) ? address : undefined;
  const pollIntervalMs = getRebalancePollingIntervalMs(totalDepositedUsd);

  return useQuery({
    queryKey: ["rebalance-status", safeAddress],
    queryFn: () => api.getRebalanceStatus(safeAddress!),
    enabled: !!safeAddress && ready && authenticated,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (isNonRetryableClientError(err)) return false;
      return pollIntervalMs;
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
  totalDepositedUsd = 0,
) {
  const { authenticated, ready } = useAuth();
  const safeAddress = isValidEvmAddress(address) ? address : undefined;
  const pollIntervalMs = getRebalancePollingIntervalMs(totalDepositedUsd);

  return useQuery({
    queryKey: ["rebalance-history", safeAddress, page, limit, transactionsOnly],
    queryFn: () => api.getRebalanceHistory(safeAddress!, page, limit, transactionsOnly),
    enabled: !!safeAddress && ready && authenticated,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (isNonRetryableClientError(err)) return false;
      return pollIntervalMs;
    },
    retry: (failureCount, error) => {
      if (isNonRetryableClientError(error)) return false;
      return failureCount < 2;
    },
  });
}
