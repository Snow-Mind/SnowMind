import type { Portfolio, ProtocolAllocation, ProtocolId } from "./portfolio";

// --- Requests ---

export interface RegisterAccountRequest {
  ownerAddress: string;
  smartAccountAddress: string;
}

// --- Responses ---

export interface RegisterAccountResponse {
  success: boolean;
  smartAccountAddress: string;
}

export interface GetPortfolioResponse extends Portfolio {}

export interface RunOptimizerResponse {
  smartAccountAddress: string;
  proposedAllocations: ProtocolAllocation[];
  expectedApy: string;
  rebalanceNeeded: boolean;
}

export interface ProtocolRateResponse {
  protocolId: ProtocolId;
  name: string;
  isActive: boolean;
  isComingSoon: boolean;
  currentApy: number;
  tvlUsd: number;
  riskScore: number;
  lastUpdated: string;
}

export interface OptimizerPreviewResponse {
  smartAccountAddress: string;
  proposedAllocations: {
    protocolId: ProtocolId;
    currentPct: number;
    proposedPct: number;
    proposedAmountUsd: string;
    apy: number;
  }[];
  expectedApy: number;
  currentApy: number;
  rebalanceNeeded: boolean;
  riskScore: number;
  solveTimeMs: number;
}

export interface RebalanceLogEntry {
  id: string;
  timestamp: string;
  fromAllocations: ProtocolAllocation[];
  toAllocations: ProtocolAllocation[];
  gasCostUsd: number;
  status: string;
  txHash: string | null;
  aprImprovement: number | null;
}

export interface RebalanceStatusResponse {
  smartAccountAddress: string;
  lastRebalance: string | null;
  status: "idle" | "pending" | "executing" | "completed" | "failed";
  history: RebalanceLogEntry[];
  total: number;
}

export interface HealthResponse {
  status: string;
  service: string;
}

export interface SessionKeyStatusResponse {
  keyAddress: string;
  isActive: boolean;
  expiresAt: string;
  allowedProtocols: string[];
  maxAmountPerTx: string;
  createdAt: string;
}

export interface AccountDetailResponse {
  id: string;
  address: string;
  ownerAddress: string;
  isActive: boolean;
  createdAt: string;
  sessionKey: SessionKeyStatusResponse | null;
}

export interface RiskProfileResponse {
  riskTolerance: "conservative" | "moderate" | "aggressive";
  lambdaValue: number;
}
