"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { formatUsd } from "@/lib/format";

export interface YieldDataPoint {
  date: string;
  deposited: number;
  value: number;
  apy: number;
}

interface YieldChartProps {
  data7d: YieldDataPoint[];
  data30d: YieldDataPoint[];
}

const TABS = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function YieldChart({ data7d, data30d }: YieldChartProps) {
  const [tab, setTab] = useState<TabKey>("7d");
  const data = tab === "7d" ? data7d : data30d;

  const minVal = Math.min(...data.map((d) => d.value));
  const maxVal = Math.max(...data.map((d) => d.value));
  const yMin = Math.floor(minVal / 10) * 10;
  const yMax = Math.ceil(maxVal / 10) * 10 + 10;

  return (
    <div className="crystal-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-arctic">
          Portfolio Value
        </h2>
        <div className="flex gap-1 rounded-lg bg-void-2 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-accent text-glacier"
                  : "text-muted-foreground hover:text-arctic"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-64 min-h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={256}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="glacierGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00C4FF" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00C4FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(0, 196, 255, 0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "#8899AA", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: "#8899AA", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
              width={52}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.[0]) return null;
                const val = payload[0].value as number;
                const dep = (payload[0].payload as YieldDataPoint).deposited;
                return (
                  <div className="rounded-lg border border-border bg-void-2 px-3 py-2 shadow-lg">
                    <p className="text-xs font-medium text-arctic">{label}</p>
                    <p className="font-mono text-xs text-glacier">
                      {formatUsd(val)}
                    </p>
                    <p className="font-mono text-[10px] text-mint">
                      +{formatUsd(val - dep)} yield
                    </p>
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={data[0]?.deposited}
              stroke="rgba(0, 196, 255, 0.2)"
              strokeDasharray="4 4"
              label={{
                value: "Deposited",
                position: "insideTopLeft",
                fill: "#8899AA",
                fontSize: 10,
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#00C4FF"
              strokeWidth={2}
              fill="url(#glacierGradient)"
              animationDuration={800}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
