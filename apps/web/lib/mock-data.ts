/**
 * Mock data for dashboard UI during development.
 * TODO: Replace all consumers with real API calls via usePortfolio / useRebalanceHistory hooks.
 */
import type {
  Portfolio,
  RebalanceStatusResponse,
  RebalanceHistoryResponse,
} from "@snowmind/shared-types";
import { PROTOCOL_CONFIG } from "./constants";

// ── Portfolio snapshot ─────────────────────────────────────
export const MOCK_PORTFOLIO: Portfolio = {
  totalDepositedUsd: "25000",
  totalYieldUsd: "312.48",
  allocations: [
    {
      protocolId: "benqi",
      name: "Benqi",
      amountUsdc: "13750",
      allocationPct: 0.55,
      currentApy: 0.0492,
    },
    {
      protocolId: "aave_v3",
      name: "Aave V3",
      amountUsdc: "11250",
      allocationPct: 0.45,
      currentApy: 0.0468,
    },
  ],
  lastRebalanceAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
};

// ── Overview stats (derived) ───────────────────────────────
export function deriveOverviewStats(p: Portfolio) {
  const totalDep = Number(p.totalDepositedUsd);
  const totalYld = Number(p.totalYieldUsd);
  const blendedApy =
    p.allocations.reduce((s, a) => s + a.currentApy * a.allocationPct, 0) * 100;

  const hoursAgo = p.lastRebalanceAt
    ? Math.floor(
        (Date.now() - new Date(p.lastRebalanceAt).getTime()) / (1000 * 60 * 60)
      )
    : null;

  return {
    totalDeposited: totalDep,
    totalYield: totalYld,
    blendedApy,
    lastRebalanceLabel: hoursAgo !== null ? `${hoursAgo}h ago` : "Never",
    dailyYieldChange: 8.21, // TODO: compute from historical
    apyChange: 0.14,
  };
}

// ── Rebalance history ──────────────────────────────────────
export const MOCK_REBALANCE_STATUS: RebalanceStatusResponse = {
  smartAccountAddress: "0xABCDef0123456789AbCdEf0123456789AbCdEf01",
  lastRebalance: MOCK_PORTFOLIO.lastRebalanceAt,
  status: "idle",
  lastLog: null,
};

export const MOCK_REBALANCE_HISTORY: RebalanceHistoryResponse = {
  total: 5,
  logs: [
    {
      id: "reb-001",
      status: "executed",
      proposedAllocations: { aave_v3: "11250", benqi: "13750" },
      executedAllocations: { aave_v3: "11250", benqi: "13750" },
      gasCostUsd: 0.12,
      txHash: "0xabc123",
      aprImprovement: 0.24,
      createdAt: "2024-01-15T14:32:00Z",
    },
    {
      id: "reb-002",
      status: "executed",
      proposedAllocations: { aave_v3: "13000", benqi: "12000" },
      executedAllocations: { aave_v3: "13000", benqi: "12000" },
      gasCostUsd: 0.1,
      txHash: "0xdef456",
      aprImprovement: 0.18,
      createdAt: "2024-01-15T08:15:00Z",
    },
    {
      id: "reb-003",
      status: "executed",
      proposedAllocations: { aave_v3: "12200", benqi: "12800" },
      executedAllocations: { aave_v3: "12200", benqi: "12800" },
      gasCostUsd: 0.15,
      txHash: "0x789ghi",
      aprImprovement: 0.31,
      createdAt: "2024-01-14T22:48:00Z",
    },
    {
      id: "reb-004",
      status: "skipped",
      proposedAllocations: { aave_v3: "14500", benqi: "10500" },
      executedAllocations: null,
      gasCostUsd: 0.11,
      txHash: null,
      aprImprovement: null,
      createdAt: "2024-01-14T16:10:00Z",
    },
    {
      id: "reb-005",
      status: "executed",
      proposedAllocations: { aave_v3: "12500", benqi: "12500" },
      executedAllocations: { aave_v3: "12500", benqi: "12500" },
      gasCostUsd: 0.09,
      txHash: "0xjkl012",
      aprImprovement: 0.15,
      createdAt: "2024-01-14T10:05:00Z",
    },
  ],
};

// ── Yield history for charts ───────────────────────────────
export interface YieldDataPoint {
  date: string;
  deposited: number;
  value: number;
  apy: number;
}

export const MOCK_YIELD_HISTORY_7D: YieldDataPoint[] = [
  { date: "Jan 09", deposited: 25000, value: 25140, apy: 4.65 },
  { date: "Jan 10", deposited: 25000, value: 25172, apy: 4.71 },
  { date: "Jan 11", deposited: 25000, value: 25198, apy: 4.74 },
  { date: "Jan 12", deposited: 25000, value: 25230, apy: 4.78 },
  { date: "Jan 13", deposited: 25000, value: 25261, apy: 4.8 },
  { date: "Jan 14", deposited: 25000, value: 25289, apy: 4.81 },
  { date: "Jan 15", deposited: 25000, value: 25312, apy: 4.82 },
];

export const MOCK_YIELD_HISTORY_30D: YieldDataPoint[] = Array.from(
  { length: 30 },
  (_, i) => {
    const d = new Date(2024, 0, 16 - (29 - i));
    const base = 25000;
    const growth = base * (1 + 0.048 / 365) ** (i + 1);
    return {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      deposited: base,
      value: Math.round(growth * 100) / 100,
      apy: 4.6 + Math.sin(i / 5) * 0.3,
    };
  }
);

// ── Protocol APY comparison ────────────────────────────────
export interface ProtocolApyPoint {
  date: string;
  benqi: number;
  aave_v3: number;
}

export const MOCK_APY_COMPARISON: ProtocolApyPoint[] = [
  { date: "Jan 09", benqi: 4.85, aave_v3: 4.52 },
  { date: "Jan 10", benqi: 4.91, aave_v3: 4.58 },
  { date: "Jan 11", benqi: 4.88, aave_v3: 4.65 },
  { date: "Jan 12", benqi: 4.94, aave_v3: 4.61 },
  { date: "Jan 13", benqi: 4.90, aave_v3: 4.70 },
  { date: "Jan 14", benqi: 4.93, aave_v3: 4.66 },
  { date: "Jan 15", benqi: 4.92, aave_v3: 4.68 },
];

// ── Helper: protocol metadata lookup ───────────────────────
export function getProtocolMeta(id: string) {
  return PROTOCOL_CONFIG[id as keyof typeof PROTOCOL_CONFIG] ?? null;
}

// ── Formatter helpers ──────────────────────────────────────
export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatPct(value: number, fractionDigits = 2): string {
  return `${value.toFixed(fractionDigits)}%`;
}
