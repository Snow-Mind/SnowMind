"use client";

import { useQuery } from "@tanstack/react-query";

import { api, APIError } from "@/lib/api-client";
import { isValidEvmAddress } from "@/lib/address";
import { useAuth } from "@/hooks/useAuth";

export function useAccountDetail(smartAccountAddress: string | undefined) {
  const { authenticated, ready } = useAuth();
  const safeAddress = isValidEvmAddress(smartAccountAddress) ? smartAccountAddress : undefined;

  return useQuery({
    queryKey: ["account-detail", safeAddress],
    queryFn: () => api.getAccountDetail(safeAddress!),
    enabled: !!safeAddress && ready && authenticated,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && (err.status === 401 || err.status === 429)) return false;
      return 30_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof APIError && (error.status === 401 || error.status === 404 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}
