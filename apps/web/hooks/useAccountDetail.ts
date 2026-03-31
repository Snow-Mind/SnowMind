"use client";

import { useQuery } from "@tanstack/react-query";

import { api, APIError } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

export function useAccountDetail(smartAccountAddress: string | undefined) {
  const { authenticated, ready } = useAuth();

  return useQuery({
    queryKey: ["account-detail", smartAccountAddress],
    queryFn: () => api.getAccountDetail(smartAccountAddress!),
    enabled: !!smartAccountAddress && ready && authenticated,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && (err.status === 401 || err.status === 429)) return false;
      return 15_000;
    },
    retry: (failureCount, error) => {
      if (error instanceof APIError && (error.status === 401 || error.status === 404 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}
