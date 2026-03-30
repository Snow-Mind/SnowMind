"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

/** Latest status (single last log). */
export function useRebalanceStatus(address: string | undefined) {
  const { authenticated, ready } = useAuth();

  return useQuery({
    queryKey: ["rebalance-status", address],
    queryFn: () => api.getRebalanceStatus(address!),
    enabled: !!address && ready && authenticated,
    refetchInterval: 30_000,
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
    refetchInterval: 30_000,
  });
}
