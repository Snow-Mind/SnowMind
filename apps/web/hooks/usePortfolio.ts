"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";

export function usePortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => api.getPortfolio(address!),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: (failureCount, error) => {
      // Don't retry on 404s — account may not be registered yet
      if (error instanceof APIError && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
