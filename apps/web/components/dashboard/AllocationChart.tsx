"use client";

import Image from "next/image";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import { PROTOCOL_CONFIG, IDLE_CONFIG, RISK_SCORE_MAX } from "@/lib/constants";
import { formatUsd, formatPct } from "@/lib/format";
import SafeResponsiveContainer from "@/components/ui/safe-responsive-container";
import type { ProtocolAllocation } from "@snowmind/shared-types";

interface AllocationChartProps {
  allocations: ProtocolAllocation[];
  totalDeposited: number;
  riskByProtocol?: Record<string, { riskScore: number; riskScoreMax: number }>;
}

function canonicalProtocolId(rawProtocolId: string): string {
  const normalized = (rawProtocolId || "").trim().toLowerCase();
  return normalized === "aave" ? "aave_v3" : normalized;
}

export default function AllocationChart({
  allocations,
  totalDeposited,
  riskByProtocol,
}: AllocationChartProps) {
  const data = allocations.map((a) => {
    const isIdle = a.protocolId === "idle";
    const canonicalId = canonicalProtocolId(a.protocolId);
    const meta = isIdle
      ? IDLE_CONFIG
      : PROTOCOL_CONFIG[canonicalId as keyof typeof PROTOCOL_CONFIG];
    const dynamicRisk = isIdle ? null : riskByProtocol?.[canonicalId] ?? riskByProtocol?.[a.protocolId];
    const dynamicRiskScore = Number(dynamicRisk?.riskScore);
    const dynamicRiskScoreMax = Number(dynamicRisk?.riskScoreMax);
    return {
      name: a.name || meta?.name || a.protocolId,
      value: a.allocationPct * 100,
      amountUsd: Number(a.amountUsdc),
      apy: a.currentApy * 100,
      color: meta?.color ?? "#8899AA",
      riskScore: Number.isFinite(dynamicRiskScore) ? dynamicRiskScore : (meta?.riskScore ?? 0),
      riskScoreMax: Number.isFinite(dynamicRiskScoreMax)
        ? Math.max(1, Math.round(dynamicRiskScoreMax))
        : RISK_SCORE_MAX,
      logoPath: !isIdle && 'logoPath' in (meta ?? {}) ? (meta as typeof PROTOCOL_CONFIG[keyof typeof PROTOCOL_CONFIG]).logoPath : null,
    };
  });

  const isEmpty = data.length === 0 || totalDeposited === 0;

  return (
    <div className="crystal-card p-6">
      <h2 className="text-sm font-medium text-arctic">Current Allocation</h2>

      {isEmpty ? (
        <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-void-2/50">
            <PieChartIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-arctic">No allocations yet</p>
          <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
            Deposit USDC to see your allocation split across protocols.
          </p>
        </div>
      ) : (
        <>
          {/* Donut chart */}
          <div className="mt-4 flex items-center gap-6">
            <div className="relative h-44 min-h-44 w-44 min-w-44 shrink-0">
              <SafeResponsiveContainer minWidth={176} minHeight={176}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {data.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload as (typeof data)[number];
                      return (
                        <div className="rounded-lg border border-border bg-void-2 px-3 py-2 shadow-lg">
                          <p className="text-xs font-medium text-arctic">
                            {d.name}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {formatUsd(d.amountUsd)} · {formatPct(d.apy)} APY
                          </p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </SafeResponsiveContainer>
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-lg font-bold text-glacier">
                  {formatUsd(totalDeposited)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Total Deposited
                </span>
              </div>
            </div>

            {/* Legend */}
            <div className="flex-1 space-y-3">
              {data.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {d.logoPath ? (
                      <Image
                        src={d.logoPath}
                        alt={d.name}
                        width={18}
                        height={18}
                        className="rounded-full"
                      />
                    ) : (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                    )}
                    <span className="text-sm text-arctic">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatUsd(d.amountUsd)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatPct(d.value)}
                    </span>
                    <span className="metric-value text-xs">
                      {formatPct(d.apy)} APY
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Risk dots */}
          <div className="mt-5 flex items-center gap-2 border-t border-border/30 pt-4">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Risk
            </span>
            {data.map((d) => (
              <div key={d.name} className="flex items-center gap-1">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {d.name}: {d.riskScore}/{d.riskScoreMax}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
