"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BACKEND_URL } from "@/lib/constants";

interface TimeseriesPoint {
  date: string;
  snowmindApy: number;
  aaveApy: number;
}

interface ChartData {
  date: string;
  label: string;
  snowmind: number;
  aave: number;
}

export default function ApyGrowthChart() {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTimeseries() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/v1/optimizer/rates/timeseries`);
        if (!res.ok) throw new Error("Failed to fetch");
        const raw: TimeseriesPoint[] = await res.json();

        const mapped: ChartData[] = raw.map((p) => {
          const d = new Date(p.date);
          return {
            date: p.date,
            label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            snowmind: Number((p.snowmindApy * 100).toFixed(2)),
            aave: Number((p.aaveApy * 100).toFixed(2)),
          };
        });
        setData(mapped);
      } catch {
        // Silently fail — chart just won't show data
      } finally {
        setLoading(false);
      }
    }
    fetchTimeseries();
  }, []);

  const latest = data.length > 0 ? data[data.length - 1] : null;

  if (loading) {
    return (
      <section className="bg-[#F5F0EB] px-6 pb-6 md:pb-10">
        <div className="mx-auto max-w-[1100px] overflow-hidden rounded-2xl border border-[#E8E2DA] bg-[#1A1715] p-8">
          <div className="h-[300px] animate-pulse rounded-lg bg-white/5" />
        </div>
      </section>
    );
  }

  if (data.length < 2) return null;

  return (
    <section className="bg-[#F5F0EB] px-6 pb-6 md:pb-10">
      <div className="mx-auto max-w-[1100px] overflow-hidden rounded-2xl border border-[#E8E2DA] bg-[#1A1715] p-6 md:p-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A837C]">
              30-Day APY Performance
            </p>
            <h3 className="mt-1 font-sans text-[22px] font-bold text-[#FAFAF8] md:text-[28px]">
              SnowMind vs Aave
            </h3>
          </div>
          {latest && (
            <div className="flex gap-6">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-[#8A837C]">
                  SnowMind
                </p>
                <p className="font-mono text-lg font-bold text-[#E84142]">
                  {latest.snowmind.toFixed(2)}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-[#8A837C]">
                  Aave V3
                </p>
                <p className="font-mono text-lg font-bold text-[#6B7280]">
                  {latest.aave.toFixed(2)}%
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="h-[280px] md:h-[320px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={280}>
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="snowmindGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E84142" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#E84142" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="aaveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6B7280" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#6B7280" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#8A837C", fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#8A837C", fontSize: 11 }}
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, "auto"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#2A2520",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#FAFAF8",
                }}
                labelStyle={{ color: "#8A837C", marginBottom: 4 }}
                formatter={(value: number | string | undefined, name: string | undefined) => [
                  `${Number(value ?? 0).toFixed(2)}%`,
                  name === "snowmind" ? "SnowMind" : "Aave V3",
                ]}
              />
              <Area
                type="monotone"
                dataKey="aave"
                stroke="#6B7280"
                strokeWidth={1.5}
                fill="url(#aaveGrad)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="snowmind"
                stroke="#E84142"
                strokeWidth={2}
                fill="url(#snowmindGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
