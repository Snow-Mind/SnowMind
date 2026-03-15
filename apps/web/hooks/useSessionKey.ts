"use client";

import { useQuery } from "@tanstack/react-query";
import { api, APIError } from "@/lib/api-client";

export function useSessionKey(smartAccountAddress: string | undefined) {
  return useQuery({
    queryKey: ["account-detail", smartAccountAddress],
    queryFn: () => api.getAccountDetail(smartAccountAddress!),
    enabled: !!smartAccountAddress,
    staleTime: 60_000,
    select: (data) => data.sessionKey,
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
