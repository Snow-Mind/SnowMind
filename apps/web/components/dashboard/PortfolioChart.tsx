"use client";

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import type { Portfolio } from "@snowmind/shared-types";
import { PROTOCOL_CONFIG } from "@/lib/constants";
import { formatUsd } from "@/lib/format";

interface PortfolioChartProps {
  portfolio: Portfolio | null;
}

export default function PortfolioChart({ portfolio }: PortfolioChartProps) {
  if (!portfolio || portfolio.allocations.length === 0) {
    return null;
  }

  // Build pie data from allocations
  const chartData = portfolio.allocations
    .filter((a) => a.protocolId !== "idle" && Number(a.amountUsdc) > 0)
    .map((a) => {
      const protocolConfig = PROTOCOL_CONFIG[a.protocolId as keyof typeof PROTOCOL_CONFIG];
      return {
        name: protocolConfig?.name || a.protocolId,
        value: Number(a.amountUsdc),
        color: protocolConfig?.color || "#E8E2DA",
        protocolId: a.protocolId,
      };
    });

  if (chartData.length === 0) {
    return null;
  }

  const totalAllocated = chartData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="crystal-card p-6">
      <h3 className="text-sm font-semibold text-arctic mb-4">Portfolio Allocation</h3>
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
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
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value?: number) => value ? formatUsd(value) : "—"}
              contentStyle={{
                backgroundColor: "#050A14",
                border: "1px solid #E8E2DA",
                borderRadius: "8px",
                color: "#E8F4FF",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
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
