"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useRebalanceHistory(
  address: string | undefined,
  page = 0,
) {
  return useQuery({
    queryKey: ["rebalance-history", address, page],
    queryFn: () => api.getRebalanceStatus(address!, page),
    enabled: !!address,
    refetchInterval: 30_000,
  });
}
