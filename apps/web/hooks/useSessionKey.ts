"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useSessionKey(smartAccountAddress: string | undefined) {
  return useQuery({
    queryKey: ["account-detail", smartAccountAddress],
    queryFn: () => api.getAccountDetail(smartAccountAddress!),
    enabled: !!smartAccountAddress,
    staleTime: 60_000,
    select: (data) => data.sessionKey,
  });
}
