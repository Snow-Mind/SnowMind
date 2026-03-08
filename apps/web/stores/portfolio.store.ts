import { create } from "zustand";
import type { ProtocolAllocation } from "@snowmind/shared-types";

interface PortfolioState {
  smartAccountAddress: string | null;
  allocations: ProtocolAllocation[];
  totalDepositedUsd: string;
  totalYieldUsd: string;
  setSmartAccountAddress: (address: string) => void;
  setAllocations: (allocations: ProtocolAllocation[]) => void;
  setTotals: (deposited: string, yield_: string) => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  smartAccountAddress: null,
  allocations: [],
  totalDepositedUsd: "0",
  totalYieldUsd: "0",
  setSmartAccountAddress: (address) => set({ smartAccountAddress: address }),
  setAllocations: (allocations) => set({ allocations }),
  setTotals: (deposited, yield_) =>
    set({ totalDepositedUsd: deposited, totalYieldUsd: yield_ }),
}));
