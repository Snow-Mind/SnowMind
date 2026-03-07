"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function usePortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => api.getPortfolio(address!),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
