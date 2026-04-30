import type { Portfolio, ProtocolAllocation, ProtocolId } from "./portfolio";

// --- Diversification preference ---

export type DiversificationPreference = "max_yield" | "balanced" | "diversified";

// --- Requests ---

export interface RegisterAccountRequest {
  ownerAddress: string;
  smartAccountAddress: string;
  diversificationPreference?: DiversificationPreference;
  fundingTxHash?: string;
  fundingAmountUsdc?: string;
  fundingSource?: string;
  sessionKeyData?: {
    serializedPermission: string;
    sessionPrivateKey: string;
    sessionKeyAddress: string;
    expiresAt: number;
    allowedProtocols?: string[];
    allocationCaps?: Record<string, number>;
  };
  initialAllocation?: Record<string, string>;
}

export interface ProtocolSelectionDepositRequest {
  allowedProtocols: string[];
  fundingTxHash: string;
  fundingAmountUsdc: string;
  fundingSource?: string;
  allocationCaps?: Record<string, number>;
  triggerRebalance?: boolean;
}

// --- Responses ---

export interface RegisterAccountResponse {
  id: string;
  address: string;
  ownerAddress: string;
  isActive: boolean;
  createdAt: string;
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
  riskScoreMax: number;
  riskBreakdown?: {
    oracle: number;
    liquidity: number;
    collateral: number;
    yieldProfile: number;
    architecture: number;
  } | null;
  utilizationRate: number | null;
  lastUpdated: number;
}

export interface RiskExplanationResponse {
  protocolId: string;
  protocolName: string;
  riskScore: number;
  riskScoreMax: number;
  riskBreakdown?: {
    oracle: number;
    liquidity: number;
    collateral: number;
    yieldProfile: number;
    architecture: number;
  } | null;
  explanationNotes: string[];
  frameworkContext: string;
  protocolContext: string;
  reportSource?: string | null;
  reportUpdatedAt?: string | null;
}

export interface Protocol30DayApyResponse {
  protocolId: ProtocolId;
  name: string;
  avgApy30d: number;
  adjustedApy30d: number;
  currentApy: number;
  apyChange: number;
  dataPoints: number;
  utilizationRate: number | null;
  avgTvlUsd30d: number | null;
  isActive: boolean;
}

export interface ApyTimeseriesPoint {
  date: string;
  snowmindApy: number;
  aaveApy: number;
}

export interface PlatformTvlResponse {
  tvlUsd: string;
  accountsWithDeposits: number;
  timestamp: string;
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
  status: string;
  skipReason: string | null;
  fromProtocol?: string | null;
  toProtocol?: string | null;
  amountMoved?: string | null;
  proposedAllocations: Record<string, unknown> | null;
  executedAllocations: Record<string, unknown> | null;
  aprImprovement: number | null;
  gasCostUsd: number | null;
  txHash: string | null;
  createdAt: string;
}

export interface RebalanceStatusResponse {
  smartAccountAddress: string;
  lastRebalance: string | null;
  status: "idle" | "pending" | "executing" | "completed" | "failed" | "executed" | "skipped" | "halted";
  lastLog: RebalanceLogEntry | null;
  reasonCode?:
    | "HEALTHY"
    | "ACCOUNT_INACTIVE"
    | "NO_ACTIVE_SESSION_KEY"
    | "NO_DEPOSITED_BALANCE"
    | "NO_PERMITTED_PROTOCOLS"
    | "SESSION_KEY_INVALID"
    | "SESSION_KEY_NOT_APPROVED"
    | "USEROP_VALIDATE_REVERT"
    | "EXECUTION_FAILED"
    | "REBALANCE_NOT_WORTH_IT"
    | "MIN_INTERVAL_NOT_MET"
    | "IDLE_FUNDS_PENDING_DEPLOYMENT"
    | "SKIPPED"
    | "UNKNOWN";
  reasonDetail?: string;
}

export interface RebalanceHistoryResponse {
  logs: RebalanceLogEntry[];
  total: number;
}

export interface RebalanceTriggerResponse {
  smartAccountAddress: string;
  status: string;
  detail: Record<string, unknown> | null;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
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
  diversificationPreference: DiversificationPreference;
  sessionKey: SessionKeyStatusResponse | null;
  allocationCaps: Record<string, number> | null;
}

export interface DiversificationPreferenceResponse {
  diversificationPreference: DiversificationPreference;
}

export interface AllowedProtocolsUpdateResponse {
  allowedProtocols: string[];
  updatedRows: number;
}

export interface AllocationCapsUpdateResponse {
  allocationCaps: Record<string, number> | null;
  updatedRows: number;
}

export interface ProtocolSelectionDepositResponse {
  allowedProtocols: string[];
  allocationCaps: Record<string, number> | null;
  effectiveCapTotalPct: number;
  idleRemainderPossible: boolean;
  updatedRows: number;
  fundingTxHash: string;
  fundingAmountUsdc: string;
  fundingRecorded: boolean;
  rebalanceQueued: boolean;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AssistantChatRequest {
  sessionId?: string;
  message: string;
}

export interface AssistantChatResponse {
  sessionId: string;
  reply: string;
  messages: AssistantMessage[];
  model: string;
  contextSources: string[];
}

export type AssistantFeedbackValue = "up" | "down";

export interface AssistantFeedbackRequest {
  sessionId: string;
  messageCreatedAt: string;
  messageContent: string;
  feedback: AssistantFeedbackValue;
  note?: string;
}

export interface AssistantFeedbackResponse {
  sessionId: string;
  messageCreatedAt: string;
  feedback: AssistantFeedbackValue;
  note: string | null;
  savedAt: string;
}

export interface AssistantSessionResponse {
  sessionId: string;
  messages: AssistantMessage[];
}

export interface AssistantSessionSummary {
  sessionId: string;
  title: string;
  lastMessageAt: string;
}

export interface AssistantSessionListResponse {
  sessions: AssistantSessionSummary[];
}

export interface AssistantSessionRenameRequest {
  title: string;
}

export interface AssistantSessionRenameResponse {
  sessionId: string;
  title: string;
}

export interface AssistantSessionDeleteResponse {
  sessionId: string;
  deleted: boolean;
}
