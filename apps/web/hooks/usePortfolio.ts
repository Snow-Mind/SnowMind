"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { APIError } from "@/lib/api-client";
import { isValidEvmAddress } from "@/lib/address";
import { useAuth } from "@/hooks/useAuth";

export function usePortfolio(address: string | undefined) {
  const { authenticated, ready } = useAuth();
  const safeAddress = isValidEvmAddress(address) ? address : undefined;

  return useQuery({
    queryKey: ["portfolio", safeAddress],
    queryFn: () => api.getPortfolio(safeAddress!),
    enabled: !!safeAddress && ready && authenticated,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && (err.status === 401 || err.status === 429)) return false;
      return 10_000;
    },
    staleTime: 5_000,
    retry: (failureCount, error) => {
      // Never retry auth/not-found failures.
      if (error instanceof APIError && (error.status === 401 || error.status === 404 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}
