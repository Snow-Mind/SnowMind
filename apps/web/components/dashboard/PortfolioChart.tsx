"use client";

import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import type { Portfolio } from "@snowmind/shared-types";
import { PROTOCOL_CONFIG } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import SafeResponsiveContainer from "@/components/ui/safe-responsive-container";

interface PortfolioChartProps {
  portfolio: Portfolio | null;
  compact?: boolean;
}

export default function PortfolioChart({ portfolio, compact = false }: PortfolioChartProps) {
  // Build pie data from allocations — include idle USDC so users see their funds
  // Use $0.01 minimum to avoid showing dust amounts that display as "$0.00"
  const chartData = useMemo(
    () => (portfolio?.allocations ?? [])
      .filter((a) => Number(a.amountUsdc) >= 0.01)
      .map((a) => {
        if (a.protocolId === "idle") {
          return {
            name: "Idle USDC",
            value: Number(a.amountUsdc),
            color: "#C4BDB6", // warm gray for undeployed funds
            protocolId: a.protocolId,
          };
        }
        const protocolConfig = PROTOCOL_CONFIG[a.protocolId as keyof typeof PROTOCOL_CONFIG];
        return {
          name: protocolConfig?.name || a.protocolId,
          value: Number(a.amountUsdc),
          color: protocolConfig?.color || "#E8E2DA",
          protocolId: a.protocolId,
        };
      }),
    [portfolio?.allocations],
  );

  const [selectedProtocolId, setSelectedProtocolId] = useState<string | null>(null);

  const totalAllocated = useMemo(
    () => chartData.reduce((sum, item) => sum + item.value, 0),
    [chartData],
  );
  const topAllocation = useMemo(
    () => [...chartData].sort((a, b) => b.value - a.value)[0] ?? null,
    [chartData],
  );

  const selectedAllocation = useMemo(
    () => chartData.find((item) => item.protocolId === selectedProtocolId)
      ?? topAllocation
      ?? chartData[0]
      ?? null,
    [chartData, selectedProtocolId, topAllocation],
  );

  if (!portfolio || chartData.length === 0 || !selectedAllocation) {
    return null;
  }

  const selectedAllocationPct = totalAllocated > 0
    ? ((selectedAllocation.value / totalAllocated) * 100).toFixed(1)
    : "0.0";

  const selectedIndex = chartData.findIndex((item) => item.protocolId === selectedAllocation.protocolId);

  const handleSliceSelect = (_entry: unknown, index: number) => {
    if (index < 0 || index >= chartData.length) {
      return;
    }
    setSelectedProtocolId(chartData[index].protocolId);
  };

  if (compact) {
    return (
      <div className="w-[220px]">
        <div className="h-[180px] min-h-[180px]">
          <SafeResponsiveContainer minWidth={220} minHeight={180}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={44}
                outerRadius={70}
                paddingAngle={2}
                labelLine={false}
                dataKey="value"
                onMouseEnter={handleSliceSelect}
                onClick={handleSliceSelect}
                onTouchStart={handleSliceSelect}
              >
                {chartData.map((entry, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <Cell
                      key={`compact-cell-${index}`}
                      fill={entry.color}
                      stroke={isSelected ? "#FFFFFF" : "#F1ECE6"}
                      strokeWidth={isSelected ? 3 : 1}
                      fillOpacity={isSelected ? 1 : 0.92}
                    />
                  );
                })}
              </Pie>
              <Tooltip
                formatter={(value?: number) => value ? formatUsd(value) : "—"}
                contentStyle={{
                  backgroundColor: "#050A14",
                  border: "1px solid #E8E2DA",
                  borderRadius: "8px",
                  color: "#E8F4FF",
                }}
                itemStyle={{ color: "#E8F4FF" }}
                labelStyle={{ color: "#E8F4FF" }}
              />
            </PieChart>
          </SafeResponsiveContainer>
        </div>
        <div className="-mt-2 text-center">
          <p className="text-[11px] font-medium text-[#5C5550]">
            {selectedAllocation.name} {selectedAllocationPct}%
          </p>
          <p className="text-[11px] font-mono text-[#8A837C]">{formatUsd(selectedAllocation.value)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="crystal-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-arctic">Portfolio Allocation</h3>
      <div className="h-64 min-h-64 w-full min-w-[280px]">
        <SafeResponsiveContainer minWidth={280} minHeight={256}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, value }) => `${name} ${((value / totalAllocated) * 100).toFixed(1)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
              onMouseEnter={handleSliceSelect}
              onClick={handleSliceSelect}
            >
              {chartData.map((entry, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    stroke={isSelected ? "#FFFFFF" : "#F1ECE6"}
                    strokeWidth={isSelected ? 3 : 1}
                    fillOpacity={isSelected ? 1 : 0.92}
                  />
                );
              })}
            </Pie>
            <Tooltip
              formatter={(value?: number) => value ? formatUsd(value) : "—"}
              contentStyle={{
                backgroundColor: "#050A14",
                border: "1px solid #E8E2DA",
                borderRadius: "8px",
                color: "#E8F4FF",
              }}
              itemStyle={{ color: "#E8F4FF" }}
              labelStyle={{ color: "#E8F4FF" }}
            />
          </PieChart>
        </SafeResponsiveContainer>
      </div>

      {/* Legend with amounts */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {chartData.map((item) => (
          <div key={item.protocolId} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[#8A837C]">{item.name}</span>
            </div>
            <span className="font-mono text-arctic">{formatUsd(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
