/**
 * Mock data for dashboard UI during development.
 * TODO: Replace all consumers with real API calls via usePortfolio / useRebalanceHistory hooks.
 */
import type {
  Portfolio,
  RebalanceStatusResponse,
} from "@snowmind/shared-types";
import { PROTOCOL_CONFIG } from "./constants";

// ── Portfolio snapshot ─────────────────────────────────────
export const MOCK_PORTFOLIO: Portfolio = {
  smartAccountAddress: "0xABCDef0123456789AbCdEf0123456789AbCdEf01",
  totalDeposited: "25000000000", // 25,000 USDC (6 decimals)
  totalYield: "312480000", // $312.48
  allocations: [
    {
      protocolId: "benqi",
      amountUsd: "13750000000",
      percentage: 55,
      apy: 0.0492,
    },
    {
      protocolId: "aave_v3",
      amountUsd: "11250000000",
      percentage: 45,
      apy: 0.0468,
    },
  ],
  lastRebalance: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
};

// ── Overview stats (derived) ───────────────────────────────
export function deriveOverviewStats(p: Portfolio) {
  const totalDep = Number(p.totalDeposited) / 1e6;
  const totalYld = Number(p.totalYield) / 1e6;
  const blendedApy =
    p.allocations.reduce((s, a) => s + a.apy * (a.percentage / 100), 0) * 100;

  const hoursAgo = p.lastRebalance
    ? Math.floor(
        (Date.now() - new Date(p.lastRebalance).getTime()) / (1000 * 60 * 60)
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
  smartAccountAddress: MOCK_PORTFOLIO.smartAccountAddress,
  lastRebalance: MOCK_PORTFOLIO.lastRebalance,
  status: "idle",
  total: 5,
  history: [
    {
      id: "reb-001",
      timestamp: "2024-01-15T14:32:00Z",
      fromAllocations: [
        { protocolId: "aave_v3", amountUsd: "13000000000", percentage: 52, apy: 0.046 },
        { protocolId: "benqi", amountUsd: "12000000000", percentage: 48, apy: 0.048 },
      ],
      toAllocations: [
        { protocolId: "aave_v3", amountUsd: "11250000000", percentage: 45, apy: 0.0468 },
        { protocolId: "benqi", amountUsd: "13750000000", percentage: 55, apy: 0.0492 },
      ],
      gasCostUsd: 0.12,
      status: "completed",
      txHash: "0xabc123",
      aprImprovement: 0.24,
    },
    {
      id: "reb-002",
      timestamp: "2024-01-15T08:15:00Z",
      fromAllocations: [
        { protocolId: "aave_v3", amountUsd: "12200000000", percentage: 48.8, apy: 0.047 },
        { protocolId: "benqi", amountUsd: "12800000000", percentage: 51.2, apy: 0.045 },
      ],
      toAllocations: [
        { protocolId: "aave_v3", amountUsd: "13000000000", percentage: 52, apy: 0.046 },
        { protocolId: "benqi", amountUsd: "12000000000", percentage: 48, apy: 0.048 },
      ],
      gasCostUsd: 0.1,
      status: "completed",
      txHash: "0xdef456",
      aprImprovement: 0.18,
    },
    {
      id: "reb-003",
      timestamp: "2024-01-14T22:48:00Z",
      fromAllocations: [
        { protocolId: "aave_v3", amountUsd: "14500000000", percentage: 58, apy: 0.044 },
        { protocolId: "benqi", amountUsd: "10500000000", percentage: 42, apy: 0.049 },
      ],
      toAllocations: [
        { protocolId: "aave_v3", amountUsd: "12200000000", percentage: 48.8, apy: 0.047 },
        { protocolId: "benqi", amountUsd: "12800000000", percentage: 51.2, apy: 0.045 },
      ],
      gasCostUsd: 0.15,
      status: "completed",
      txHash: "0x789ghi",
      aprImprovement: 0.31,
    },
    {
      id: "reb-004",
      timestamp: "2024-01-14T16:10:00Z",
      fromAllocations: [
        { protocolId: "aave_v3", amountUsd: "12500000000", percentage: 50, apy: 0.043 },
        { protocolId: "benqi", amountUsd: "12500000000", percentage: 50, apy: 0.05 },
      ],
      toAllocations: [
        { protocolId: "aave_v3", amountUsd: "14500000000", percentage: 58, apy: 0.044 },
        { protocolId: "benqi", amountUsd: "10500000000", percentage: 42, apy: 0.049 },
      ],
      gasCostUsd: 0.11,
      status: "skipped",
      txHash: null,
      aprImprovement: null,
    },
    {
      id: "reb-005",
      timestamp: "2024-01-14T10:05:00Z",
      fromAllocations: [
        { protocolId: "aave_v3", amountUsd: "13000000000", percentage: 52, apy: 0.042 },
        { protocolId: "benqi", amountUsd: "12000000000", percentage: 48, apy: 0.051 },
      ],
      toAllocations: [
        { protocolId: "aave_v3", amountUsd: "12500000000", percentage: 50, apy: 0.043 },
        { protocolId: "benqi", amountUsd: "12500000000", percentage: 50, apy: 0.05 },
      ],
      gasCostUsd: 0.09,
      status: "completed",
      txHash: "0xjkl012",
      aprImprovement: 0.15,
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
