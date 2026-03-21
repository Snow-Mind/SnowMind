"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { APIError } from "@/lib/api-client";

export function usePortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => api.getPortfolio(address!),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: (failureCount, error) => {
      // Never retry 404 — account just isn't registered yet
      if (error instanceof APIError && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
