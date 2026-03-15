import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProtocolAllocation } from "@snowmind/shared-types";

interface PortfolioState {
  smartAccountAddress: string | null;
  allocations: ProtocolAllocation[];
  totalDepositedUsd: string;
  totalYieldUsd: string;
  isAgentActivated: boolean;
  isBackendRegistered: boolean;
  setSmartAccountAddress: (address: string) => void;
  setAllocations: (allocations: ProtocolAllocation[]) => void;
  setTotals: (deposited: string, yield_: string) => void;
  setAgentActivated: (activated: boolean) => void;
  setBackendRegistered: (registered: boolean) => void;
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
      isBackendRegistered: false,
      setSmartAccountAddress: (address) => set({ smartAccountAddress: address }),
      setAllocations: (allocations) => set({ allocations }),
      setTotals: (deposited, yield_) =>
        set({ totalDepositedUsd: deposited, totalYieldUsd: yield_ }),
      setAgentActivated: (activated) => set({ isAgentActivated: activated }),
      setBackendRegistered: (registered) => set({ isBackendRegistered: registered }),
      clearSmartAccount: () =>
        set({ smartAccountAddress: null, allocations: [], totalDepositedUsd: "0", totalYieldUsd: "0", isAgentActivated: false, isBackendRegistered: false }),
    }),
    {
      name: "snowmind-portfolio",
      partialize: (state) => ({ smartAccountAddress: state.smartAccountAddress, isAgentActivated: state.isAgentActivated, isBackendRegistered: state.isBackendRegistered }),
    },
  ),
);
