import { BACKEND_URL } from "./constants";
import type {
  GetPortfolioResponse,
  RunOptimizerResponse,
  RebalanceStatusResponse,
  HealthResponse,
  RegisterAccountRequest,
  RegisterAccountResponse,
  ProtocolRateResponse,
  OptimizerPreviewResponse,
  AccountDetailResponse,
  RiskProfileResponse,
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(API_KEY && { "X-API-Key": API_KEY }),
    ...(options?.headers as Record<string, string>),
  };

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
  } catch {
    throw new NetworkError("Network request failed. Check your connection.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new APIError(res.status, `HTTP_${res.status}`, text);
  }

  return res.json() as Promise<T>;
}

// ── API client ─────────────────────────────────────────────

export const api = {
  // Health
  health: () => request<HealthResponse>("/health"),

  // Accounts
  registerAccount: (data: RegisterAccountRequest) =>
    request<RegisterAccountResponse>("/api/v1/accounts/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Portfolio
  getPortfolio: (address: string) =>
    request<GetPortfolioResponse>(`/api/v1/portfolio/${encodeURIComponent(address)}`),

  // Protocol Rates
  getCurrentRates: () =>
    request<ProtocolRateResponse[]>("/api/v1/rates"),

  // Optimizer
  runOptimizer: (address: string) =>
    request<RunOptimizerResponse>(`/api/v1/optimizer/${encodeURIComponent(address)}`, {
      method: "POST",
    }),

  previewOptimization: (
    address: string,
    riskTolerance: "conservative" | "moderate" | "aggressive" = "moderate",
  ) =>
    request<OptimizerPreviewResponse>(`/api/v1/optimizer/${encodeURIComponent(address)}/preview`, {
      method: "POST",
      body: JSON.stringify({ risk_tolerance: riskTolerance }),
    }),

  // Rebalance
  getRebalanceStatus: (address: string, page = 0, limit = 20) =>
    request<RebalanceStatusResponse>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/status?limit=${limit}&offset=${page * limit}`,
    ),

  triggerRebalance: (address: string) =>
    request<{ success: boolean; message: string }>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/trigger`,
      { method: "POST" },
    ),

  withdrawAll: (address: string) =>
    request<{ success: boolean; txHashes: string[] }>(
      `/api/v1/rebalance/${encodeURIComponent(address)}/withdraw-all`,
      { method: "POST" },
    ),

  // Session Key
  revokeSessionKey: (address: string) =>
    request<{ success: boolean }>(
      `/api/v1/accounts/${encodeURIComponent(address)}/session-key/revoke`,
      { method: "POST" },
    ),

  // Account detail (includes session key status)
  getAccountDetail: (address: string) =>
    request<AccountDetailResponse>(
      `/api/v1/accounts/${encodeURIComponent(address)}`,
    ),

  // Risk profile
  saveRiskProfile: (
    address: string,
    riskTolerance: "conservative" | "moderate" | "aggressive",
  ) =>
    request<RiskProfileResponse>(
      `/api/v1/accounts/${encodeURIComponent(address)}/risk-profile`,
      {
        method: "PUT",
        body: JSON.stringify({ risk_tolerance: riskTolerance }),
      },
    ),
};
