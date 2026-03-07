"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useProtocolRates() {
  return useQuery({
    queryKey: ["protocol-rates"],
    queryFn: () => api.getCurrentRates(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
