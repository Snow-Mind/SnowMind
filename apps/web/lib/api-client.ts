import { BACKEND_URL } from "./constants";
import type {
  GetPortfolioResponse,
  RunOptimizerResponse,
  RebalanceStatusResponse,
  RebalanceHistoryResponse,
  HealthResponse,
  RegisterAccountRequest,
  RegisterAccountResponse,
  ProtocolRateResponse,
  OptimizerPreviewResponse,
  AccountDetailResponse,
  DiversificationPreference,
  DiversificationPreferenceResponse,
} from "@snowmind/shared-types";

// ── Error types ────────────────────────────────────────────

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

// ── Core request helper ────────────────────────────────────

const API_KEY = process.env.NEXT_PUBLIC_BACKEND_API_KEY ?? "";

/**
 * Token getter set by the Privy provider — returns a fresh access token.
 * Falls back to API-key-only auth if not configured.
 */
let _getAccessToken: (() => Promise<string | null>) | null = null;

export function setPrivyTokenGetter(getter: () => Promise<string | null>) {
  _getAccessToken = getter;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

async function request<T>(path: string, options?: RequestInit & { retryable?: boolean }): Promise<T> {
  const token = _getAccessToken ? await _getAccessToken() : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(API_KEY && { "X-API-Key": API_KEY }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options?.headers as Record<string, string>),
  };

  const method = options?.method?.toUpperCase() ?? "GET";
  const isIdempotent = method === "GET" || method === "HEAD";
  const canRetry = isIdempotent || options?.retryable === true;
  const maxAttempts = canRetry ? MAX_RETRIES + 1 : 1;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }

    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    } catch {
      lastError = new NetworkError("Network request failed. Check your connection.");
      if (!canRetry) throw lastError;
      continue;
    }

    if (!res.ok) {
      if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
        continue;
      }
      const text = await res.text().catch(() => "Unknown error");
      throw new APIError(res.status, `HTTP_${res.status}`, text);
    }

    return res.json() as Promise<T>;
  }

  throw lastError ?? new NetworkError("Request failed after retries.");
}

// ── API client ─────────────────────────────────────────────

export const api = {
  // Health
  health: () => request<HealthResponse>("/api/v1/health"),

  // Accounts — uses DB upsert, safe to retry on 502/503/504
  registerAccount: (data: RegisterAccountRequest) =>
    request<RegisterAccountResponse>("/api/v1/accounts/register", {
      method: "POST",
      body: JSON.stringify(data),
      retryable: true,
    }),

  // Portfolio
  getPortfolio: (address: string) =>
    request<GetPortfolioResponse>(`/api/v1/portfolio/${encodeURIComponent(address)}`),

  // Protocol Rates
  getCurrentRates: () =>
    request<ProtocolRateResponse[]>("/api/v1/optimizer/rates"),

  // Optimizer
  runOptimizer: (address: string) =>
    request<RunOptimizerResponse>("/api/v1/optimizer/run", {
      method: "POST",
      body: JSON.stringify({ account_address: address }),
    }),

  previewOptimization: (address: string) =>
    request<OptimizerPreviewResponse>(`/api/v1/optimizer/${encodeURIComponent(address)}/preview`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Rebalance
  getRebalanceStatus: (address: string, page = 0, limit = 20) =>
    request<RebalanceStatusResponse>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/status?limit=${limit}&offset=${page * limit}`,
    ),

  getRebalanceHistory: (address: string, page = 0, limit = 20) =>
    request<RebalanceHistoryResponse>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/history?limit=${limit}&offset=${page * limit}`,
    ),

  triggerRebalance: (address: string) =>
    request<{ success: boolean; message: string }>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/trigger`,
      { method: "POST" },
    ),

  withdrawAll: (address: string) =>
    request<{ status: string; txHash: string | null }>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/withdraw-all`,
      { method: "POST" },
    ),

  // Session Key
  revokeSessionKey: (address: string) =>
    request<{ success: boolean }>(
      `/api/v1/accounts/${encodeURIComponent(address)}/session-key/revoke`,
      { method: "POST" },
    ),

  storeSessionKey: (
    address: string,
    data: {
      serializedPermission: string;
      sessionPrivateKey: string;
      sessionKeyAddress: string;
      expiresAt: number;
      allowedProtocols?: string[];
      initialAllocation?: Record<string, string>;
      force?: boolean;
    },
  ) =>
    request<{ success: boolean; keyId: string }>(
      `/api/v1/accounts/${encodeURIComponent(address)}/session-key`,
      {
        method: "POST",
        body: JSON.stringify(data),
        retryable: true,
      },
    ),

  // Account detail (includes session key status)
  getAccountDetail: (address: string) =>
    request<AccountDetailResponse>(
      `/api/v1/accounts/${encodeURIComponent(address)}`,
    ),

  // Diversification preference
  saveDiversificationPreference: (
    address: string,
    preference: DiversificationPreference,
  ) =>
    request<DiversificationPreferenceResponse>(
      `/api/v1/accounts/${encodeURIComponent(address)}/diversification-preference`,
      {
        method: "PUT",
        body: JSON.stringify({ diversificationPreference: preference }),
      },
    ),

  // Withdrawals
  previewWithdrawal: (data: {
    smartAccountAddress: string;
    withdrawAmount: string;
    isFullWithdrawal: boolean;
  }) =>
    request<{
      withdrawAmount: string;
      currentBalance: string;
      netPrincipal: string;
      accruedProfit: string;
      attributableProfit: string;
      agentFee: string;
      userReceives: string;
      feeRate: string;
      feeExempt: boolean;
    }>("/api/v1/withdrawals/preview", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  executeWithdrawal: (data: {
    smartAccountAddress: string;
    withdrawAmount: string;
    isFullWithdrawal: boolean;
  }) =>
    request<{
      status: string;
      txHash: string | null;
      agentFee: string;
      userReceives: string;
      message: string;
    }>("/api/v1/withdrawals/execute", {
      method: "POST",
      body: JSON.stringify(data),
    }),

};
