import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProtocolAllocation } from "@snowmind/shared-types";
import { normalizeEvmAddress } from "@/lib/address";

interface PortfolioState {
  smartAccountAddress: string | null;
  allocations: ProtocolAllocation[];
  totalDepositedUsd: string;
  totalYieldUsd: string;
  isAgentActivated: boolean;
  isOnboardingInProgress: boolean;
  setSmartAccountAddress: (address: string | null | undefined) => void;
  setAllocations: (allocations: ProtocolAllocation[]) => void;
  setTotals: (deposited: string, yield_: string) => void;
  setAgentActivated: (activated: boolean) => void;
  setOnboardingInProgress: (inProgress: boolean) => void;
  clearSmartAccount: () => void;
}

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set) => ({
      smartAccountAddress: null,
      allocations: [],
      totalDepositedUsd: "0",
      totalYieldUsd: "0",
      isAgentActivated: false,
      isOnboardingInProgress: false,
      setSmartAccountAddress: (address) =>
        set((state) => {
          const normalized = normalizeEvmAddress(address);
          return {
            smartAccountAddress: normalized,
            isAgentActivated: normalized ? state.isAgentActivated : false,
          };
        }),
      setAllocations: (allocations) => set({ allocations }),
      setTotals: (deposited, yield_) =>
        set({ totalDepositedUsd: deposited, totalYieldUsd: yield_ }),
      setAgentActivated: (activated) => set({ isAgentActivated: activated }),
      setOnboardingInProgress: (inProgress) => set({ isOnboardingInProgress: inProgress }),
      clearSmartAccount: () =>
        set({ smartAccountAddress: null, allocations: [], totalDepositedUsd: "0", totalYieldUsd: "0", isAgentActivated: false, isOnboardingInProgress: false }),
    }),
    {
      name: "snowmind-portfolio",
      version: 2,
      migrate: (persistedState) => {
        const state = (persistedState as Partial<PortfolioState> | undefined) ?? {};
        const normalizedAddress = normalizeEvmAddress(state.smartAccountAddress ?? null);
        return {
          ...state,
          smartAccountAddress: normalizedAddress,
          isAgentActivated: normalizedAddress ? Boolean(state.isAgentActivated) : false,
        } as PortfolioState;
      },
      partialize: (state) => ({ smartAccountAddress: state.smartAccountAddress, isAgentActivated: state.isAgentActivated }),
    },
  ),
);
