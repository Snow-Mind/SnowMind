"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function usePreviewOptimization() {
  return useMutation({
    mutationFn: ({
      address,
      riskTolerance,
    }: {
      address: string;
      riskTolerance?: "conservative" | "moderate" | "aggressive";
    }) => api.previewOptimization(address, riskTolerance),
  });
}
