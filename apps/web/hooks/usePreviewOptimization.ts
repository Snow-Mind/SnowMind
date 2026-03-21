"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function usePreviewOptimization() {
  return useMutation({
    mutationFn: ({
      address,
    }: {
      address: string;
    }) => api.previewOptimization(address),
  });
}
