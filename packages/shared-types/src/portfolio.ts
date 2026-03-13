export type ProtocolId = "benqi" | "aave_v3" | "euler_v2" | "spark" | "fluid" | "idle";

export interface ProtocolAllocation {
  protocolId: ProtocolId;
  name: string;
  /** Amount in USDC (decimal string) */
  amountUsdc: string;
  /** Percentage of total portfolio (0.0 - 1.0) */
  allocationPct: number;
  /** Current APY as a decimal (e.g. 0.045 = 4.5%) */
  currentApy: number;
}

export interface Portfolio {
  /** Total deposited in USD (decimal string) */
  totalDepositedUsd: string;
  /** Total yield earned in USD (decimal string) */
  totalYieldUsd: string;
  allocations: ProtocolAllocation[];
  /** ISO timestamp of last rebalance, or null */
  lastRebalanceAt: string | null;
}
