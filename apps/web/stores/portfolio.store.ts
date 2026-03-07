import { create } from "zustand";
import type { ProtocolAllocation } from "@snowmind/shared-types";

interface PortfolioState {
  smartAccountAddress: string | null;
  allocations: ProtocolAllocation[];
  totalDeposited: string;
  totalYield: string;
  setSmartAccountAddress: (address: string) => void;
  setAllocations: (allocations: ProtocolAllocation[]) => void;
  setTotals: (deposited: string, yield_: string) => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  smartAccountAddress: null,
  allocations: [],
  totalDeposited: "0",
  totalYield: "0",
  setSmartAccountAddress: (address) => set({ smartAccountAddress: address }),
  setAllocations: (allocations) => set({ allocations }),
  setTotals: (deposited, yield_) =>
    set({ totalDeposited: deposited, totalYield: yield_ }),
}));
