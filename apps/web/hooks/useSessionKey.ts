"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { APIError } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

export function useSessionKey(smartAccountAddress: string | undefined) {
  const { authenticated, ready } = useAuth();

  return useQuery({
    queryKey: ["account-detail", smartAccountAddress],
    queryFn: () => api.getAccountDetail(smartAccountAddress!),
    enabled: !!smartAccountAddress && ready && authenticated,
    staleTime: 60_000,
    select: (data) => data.sessionKey,
    retry: (failureCount, error) => {
      if (error instanceof APIError && (error.status === 401 || error.status === 404)) return false;
      return failureCount < 2;
    },
  });
}
