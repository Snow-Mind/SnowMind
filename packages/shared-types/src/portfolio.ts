export type ProtocolId = "benqi" | "aave_v3" | "euler_v2" | "fluid";

export interface ProtocolAllocation {
  protocolId: ProtocolId;
  /** Amount in wei (as string to handle BigInt) */
  amountUsd: string;
  /** Percentage of total portfolio (0-100) */
  percentage: number;
  /** Current APY as a decimal (e.g. 0.045 = 4.5%) */
  apy: number;
}

export interface Portfolio {
  smartAccountAddress: string;
  /** Total deposited in wei (as string) */
  totalDeposited: string;
  /** Total yield earned in wei (as string) */
  totalYield: string;
  allocations: ProtocolAllocation[];
  /** ISO timestamp of last rebalance, or null */
  lastRebalance: string | null;
}
