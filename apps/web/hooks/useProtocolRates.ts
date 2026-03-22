"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useProtocolRates() {
  return useQuery({
    queryKey: ["protocol-rates"],
    queryFn: () => api.getCurrentRates(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}
