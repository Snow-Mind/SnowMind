"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { APIError } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

export function usePortfolio(address: string | undefined) {
  const { authenticated, ready } = useAuth();

  return useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => api.getPortfolio(address!),
    enabled: !!address && ready && authenticated,
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err instanceof APIError && (err.status === 401 || err.status === 429)) return false;
      return 30_000;
    },
    staleTime: 15_000,
    retry: (failureCount, error) => {
      // Never retry auth/not-found failures.
      if (error instanceof APIError && (error.status === 401 || error.status === 404 || error.status === 429)) return false;
      return failureCount < 2;
    },
  });
}
