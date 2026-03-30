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
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof APIError && (error.status === 401 || error.status === 404 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}
