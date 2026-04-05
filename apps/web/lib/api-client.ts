import { BACKEND_URL } from "./constants";
import type {
  GetPortfolioResponse,
  RunOptimizerResponse,
  RebalanceStatusResponse,
  RebalanceHistoryResponse,
  RebalanceTriggerResponse,
  HealthResponse,
  RegisterAccountRequest,
  RegisterAccountResponse,
  ProtocolRateResponse,
  RiskExplanationResponse,
  Protocol30DayApyResponse,
  OptimizerPreviewResponse,
  AccountDetailResponse,
  DiversificationPreference,
  DiversificationPreferenceResponse,
  AllowedProtocolsUpdateResponse,
  AllocationCapsUpdateResponse,
  ApyTimeseriesPoint,
  PlatformTvlResponse,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantFeedbackRequest,
  AssistantFeedbackResponse,
  AssistantSessionListResponse,
  AssistantSessionResponse,
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

/**
 * Token getter set by the Privy provider — returns a fresh access token.
 */
let _getAccessToken: (() => Promise<string | null>) | null = null;

function isLikelyJwt(token: string | null | undefined): token is string {
  if (!token) return false;
  return token.split(".").length === 3;
}

function isPublicPath(path: string): boolean {
  return (
    path === "/api/v1/health"
    || path.startsWith("/api/v1/optimizer/rates")
    || path.startsWith("/api/v1/optimizer/risk/explanations")
    || path === "/api/v1/platform/tvl"
  );
}

export function setPrivyTokenGetter(getter: () => Promise<string | null>) {
  _getAccessToken = getter;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const AUTH_COOLDOWN_MS = 15_000;
const AUTH_PROVIDER_RATE_LIMIT_COOLDOWN_MS = 30_000;
const AUTH_MISSING_TOKEN_COOLDOWN_MS = 5_000;
let _authRejectedUntil = 0;

function setAuthCooldown(ms: number): void {
  const until = Date.now() + ms;
  if (until > _authRejectedUntil) {
    _authRejectedUntil = until;
  }
}

export function markAuthRateLimited(cooldownMs = AUTH_PROVIDER_RATE_LIMIT_COOLDOWN_MS): void {
  setAuthCooldown(cooldownMs);
}

function parseApiErrorMessage(rawBody: string): string {
  const text = rawBody.trim();
  if (!text) {
    return "Unknown error";
  }

  const extractFromObject = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || null;
    }
    if (!value || typeof value !== "object") {
      return null;
    }

    const obj = value as Record<string, unknown>;
    const detail = obj.detail;
    const message = obj.message;
    const error = obj.error;

    for (const candidate of [detail, message, error]) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (candidate && typeof candidate === "object") {
        const nested = candidate as Record<string, unknown>;
        if (typeof nested.message === "string" && nested.message.trim()) {
          return nested.message.trim();
        }
        if (typeof nested.detail === "string" && nested.detail.trim()) {
          return nested.detail.trim();
        }
      }
    }
    return null;
  };

  // Handle normal JSON, and double-encoded JSON strings.
  let parsed: unknown = text;
  for (let i = 0; i < 2; i++) {
    if (typeof parsed !== "string") {
      break;
    }
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }

  const structured = extractFromObject(parsed);
  if (structured) {
    return structured;
  }

  // Handle non-JSON Python-dict style bodies: {'detail': '...'}
  const detailMatch = text.match(/["']detail["']\s*:\s*["'](.+?)["']/i);
  if (detailMatch?.[1]) {
    return detailMatch[1];
  }

  return text;
}

async function request<T>(path: string, options?: RequestInit & { retryable?: boolean }): Promise<T> {
  const requiresAuth = !isPublicPath(path);

  if (requiresAuth && Date.now() < _authRejectedUntil) {
    throw new APIError(
      401,
      "AUTH_COOLDOWN",
      "Authentication is being refreshed. Please re-authenticate.",
    );
  }

  let rawToken: string | null = null;
  if (requiresAuth && _getAccessToken) {
    try {
      rawToken = await _getAccessToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
        setAuthCooldown(AUTH_PROVIDER_RATE_LIMIT_COOLDOWN_MS);
        throw new APIError(
          429,
          "AUTH_PROVIDER_RATE_LIMIT",
          "Authentication provider is rate-limited. Please retry shortly.",
        );
      }
      throw new APIError(
        401,
        "AUTH_TOKEN_FETCH_FAILED",
        "Failed to obtain authentication token. Please re-authenticate.",
      );
    }
  }

  const token = isLikelyJwt(rawToken) ? rawToken : null;

  // Fail closed for protected endpoints before hitting the backend.
  if (requiresAuth && !token) {
    setAuthCooldown(AUTH_MISSING_TOKEN_COOLDOWN_MS);
    throw new APIError(
      401,
      "AUTH_REQUIRED",
      "Missing or invalid authentication token. Please re-authenticate.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(requiresAuth && token && { Authorization: `Bearer ${token}` }),
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
      if (res.status === 401) {
        setAuthCooldown(AUTH_COOLDOWN_MS);
      }
      if (res.status === 429) {
        setAuthCooldown(AUTH_PROVIDER_RATE_LIMIT_COOLDOWN_MS);
      }
      if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
        continue;
      }
      const text = await res.text().catch(() => "Unknown error");
      const message = parseApiErrorMessage(text);
      throw new APIError(res.status, `HTTP_${res.status}`, message);
    }

    if (requiresAuth) {
      _authRejectedUntil = 0;
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

  get30DayAverageApy: () =>
    request<Protocol30DayApyResponse[]>("/api/v1/optimizer/rates/30day-avg"),

  getProtocolRiskExplanation: (protocolId: string) =>
    request<RiskExplanationResponse>(
      `/api/v1/optimizer/risk/explanations/${encodeURIComponent(protocolId)}`,
    ),

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

  getRebalanceHistory: (
    address: string,
    page = 0,
    limit = 20,
    transactionsOnly = false,
  ) =>
    request<RebalanceHistoryResponse>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/history?limit=${limit}&offset=${page * limit}&transactionsOnly=${transactionsOnly}`,
    ),

  triggerRebalance: (address: string) =>
    request<RebalanceTriggerResponse>(
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
      allocationCaps?: Record<string, number>;
      initialAllocation?: Record<string, string>;
      force?: boolean;
      ownerAddress?: string;
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

  updateAllowedProtocols: (
    address: string,
    allowedProtocols: string[],
  ) =>
    request<AllowedProtocolsUpdateResponse>(
      `/api/v1/accounts/${encodeURIComponent(address)}/allowed-protocols`,
      {
        method: "PUT",
        body: JSON.stringify({ allowedProtocols }),
      },
    ),

  updateAllocationCaps: (
    address: string,
    allocationCaps: Record<string, number>,
  ) =>
    request<AllocationCapsUpdateResponse>(
      `/api/v1/accounts/${encodeURIComponent(address)}/allocation-caps`,
      {
        method: "PUT",
        body: JSON.stringify({ allocationCaps }),
      },
    ),

  // Assistant
  chatAssistant: (data: AssistantChatRequest) =>
    request<AssistantChatResponse>("/api/v1/assistant/chat", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  submitAssistantFeedback: (data: AssistantFeedbackRequest) =>
    request<AssistantFeedbackResponse>("/api/v1/assistant/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getAssistantSession: (sessionId: string) =>
    request<AssistantSessionResponse>(
      `/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}`,
    ),

  getAssistantSessions: (limit = 20) =>
    request<AssistantSessionListResponse>(
      `/api/v1/assistant/sessions?limit=${Math.max(1, Math.min(limit, 50))}`,
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
    ownerSignature: string;
    signatureMessage: string;
    signatureTimestamp: number;
  }) =>
    request<{
      status: string;
      txHash: string | null;
      agentFee: string;
      userReceives: string;
      accountDeactivated: boolean;
      message: string;
    }>("/api/v1/withdrawals/execute", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Public endpoints (no auth) for landing page
  getApyTimeseries: () =>
    request<ApyTimeseriesPoint[]>("/api/v1/optimizer/rates/timeseries"),

  getPlatformTvl: () =>
    request<PlatformTvlResponse>("/api/v1/platform/tvl"),

};
