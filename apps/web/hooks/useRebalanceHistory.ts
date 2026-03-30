"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

/** Latest status (single last log). */
export function useRebalanceStatus(address: string | undefined) {
  const { authenticated, ready } = useAuth();

  return useQuery({
    queryKey: ["rebalance-status", address],
    queryFn: () => api.getRebalanceStatus(address!),
    enabled: !!address && ready && authenticated,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && err.status === 401) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.status === 401) return false;
      return failureCount < 2;
    },
  });
}

/** Paginated history logs. */
export function useRebalanceHistory(
  address: string | undefined,
  page = 0,
) {
  const { authenticated, ready } = useAuth();

  return useQuery({
    queryKey: ["rebalance-history", address, page],
    queryFn: () => api.getRebalanceHistory(address!, page),
    enabled: !!address && ready && authenticated,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && err.status === 401) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.status === 401) return false;
      return failureCount < 2;
    },
  });
}
