"use client";

import { ArrowUpRight, History, AlertCircle, RefreshCw, Layers } from "lucide-react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatUsd, formatPct } from "@/lib/format";
import { PROTOCOL_CONFIG } from "@/lib/constants";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import type { ProtocolAllocation } from "@snowmind/shared-types";

function derivePositions(allocations: ProtocolAllocation[]) {
  return allocations.map((a) => {
    const meta = PROTOCOL_CONFIG[a.protocolId as keyof typeof PROTOCOL_CONFIG];
    const deposited = Number(a.amountUsdc);
    const yieldEarned = deposited * a.currentApy * (15 / 365); // estimated ~15 days
    return {
      protocol: a.name || meta?.name || a.protocolId,
      token: a.protocolId === "benqi" ? "qiUSDC" : "aUSDC",
      deposited,
      currentValue: deposited + yieldEarned,
      yield: yieldEarned,
      apy: a.currentApy * 100,
      allocation: a.allocationPct * 100,
      color: meta?.color ?? "#8899AA",
    };
  });
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] as const },
  }),
};

export default function PortfolioPage() {
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const address = smartAccountAddress || undefined;

  const {
    data: portfolio,
    isLoading,
    error,
    refetch,
  } = usePortfolio(address);

  const { data: ratesData } = useProtocolRates();

  const allocations = portfolio?.allocations ?? [];
  const positions = derivePositions(allocations);
  const totalDeposited = portfolio ? Number(portfolio.totalDepositedUsd) : 0;
  const totalYield = portfolio ? Number(portfolio.totalYieldUsd) : 0;
  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);

  const blendedApy =
    allocations.reduce((s, a) => s + a.currentApy * a.allocationPct, 0) * 100;

  // Build APY comparison from live rates
  const apyComparison = ratesData
    ? [
        {
          date: "Live",
          ...Object.fromEntries(
            ratesData
              .filter((r) => r.isActive)
              .map((r) => [r.protocolId, Number((r.currentApy * 100).toFixed(2))]),
          ),
        },
      ]
    : [];

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-arctic">Portfolio</h1>
        </div>
        <div className="crystal-card flex flex-col items-center gap-3 p-10 text-center">
          <AlertCircle className="h-8 w-8 text-crimson/70" />
          <p className="text-[13px] text-arctic">Failed to load portfolio data</p>
          <p className="max-w-md text-[11px] text-slate-500">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 rounded-lg bg-glacier/10 px-4 py-2 text-[13px] text-glacier hover:bg-glacier/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-arctic">Portfolio</h1>
          <p className="mt-1 text-[13px] text-slate-500">Loading your positions…</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="crystal-card p-4">
              <div className="h-3 w-24 animate-pulse rounded bg-[#E8E2DA]" />
              <div className="mt-3 h-6 w-32 animate-pulse rounded bg-[#E8E2DA]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!portfolio || allocations.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-arctic">Portfolio</h1>
          <p className="mt-1 text-[13px] text-slate-500">Detailed view of your positions and yield history.</p>
        </div>
        <div className="crystal-card flex flex-col items-center gap-3 p-10 text-center">
          <Layers className="h-8 w-8 text-slate-600" />
          <p className="text-[13px] font-medium text-arctic">No positions yet</p>
          <p className="max-w-md text-[11px] text-slate-500">
            Deposit USDC to your smart account to start earning optimized yield across protocols.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-arctic">
          Portfolio
        </h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Detailed view of your positions and yield history.
        </p>
      </div>

      {/* Summary row */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Total Value",
            value: formatUsd(totalValue || totalDeposited),
            sub: (
              <div className="mt-1 flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3 text-mint" />
                <span className="text-xs font-medium text-mint">
                  +{formatUsd(totalYield)}
                </span>
                <span className="text-xs text-muted-foreground">all time</span>
              </div>
            ),
          },
          {
            label: "Blended APY",
            value: formatPct(blendedApy),
            sub: (
              <p className="mt-1 text-xs text-muted-foreground">
                Weighted across all positions
              </p>
            ),
          },
          {
            label: "Active Protocols",
            value: String(allocations.length),
            sub: (
              <p className="mt-1 text-xs text-muted-foreground">
                {positions.map((p) => p.protocol).join(" · ")}
              </p>
            ),
          },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            className="crystal-card p-4"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={i}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {card.label}
            </p>
            <p className="metric-value mt-2 text-xl">{card.value}</p>
            {card.sub}
          </motion.div>
        ))}
      </div>

      {/* Positions table */}
      <div className="crystal-card overflow-hidden">
        <div className="border-b border-border/30 px-6 py-4">
          <h2 className="text-sm font-medium text-arctic">Positions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/20 text-left">
                {["Protocol", "Token", "Deposited", "Current", "Yield", "APY", "Allocation"].map(
                  (h) => (
                    <th
                      key={h}
                      className={`px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground ${
                        ["Deposited", "Current", "Yield", "APY", "Allocation"].includes(h)
                          ? "text-right"
                          : ""
                      }`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {positions.map((pos) => (
                <tr
                  key={pos.protocol}
                  className="transition-colors hover:bg-accent/30"
                >
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: pos.color }}
                      />
                      <span className="text-sm font-medium text-arctic">
                        {pos.protocol}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-muted-foreground">
                    {pos.token}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right font-mono text-sm text-muted-foreground">
                    {formatUsd(pos.deposited)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right font-mono text-sm text-arctic">
                    {formatUsd(pos.currentValue)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <ArrowUpRight className="h-3 w-3 text-mint" />
                      <span className="font-mono text-sm text-mint">
                        {formatUsd(pos.yield)}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <span className="metric-value text-sm">
                      {formatPct(pos.apy)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-void">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pos.allocation}%`,
                            backgroundColor: pos.color,
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {pos.allocation}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* APY comparison from live rates */}
      {apyComparison.length > 0 && (
        <div className="crystal-card p-5">
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-slate-500" />
            <h2 className="text-[13px] font-medium text-arctic">
              Live APY Comparison
            </h2>
          </div>
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={apyComparison}
                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
              >
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
                  tick={{ fill: "#8899AA", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                  width={44}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border border-border bg-void-2 px-3 py-2 shadow-lg">
                        <p className="mb-1 text-xs font-medium text-arctic">
                          {label}
                        </p>
                        {payload.map((p) => (
                          <p
                            key={p.dataKey}
                            className="font-mono text-xs"
                            style={{ color: p.color }}
                          >
                            {p.name}: {typeof p.value === "number" ? formatPct(p.value) : p.value}
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: "#8899AA" }}
                />
                <Bar
                  dataKey="benqi"
                  name="Benqi"
                  fill={PROTOCOL_CONFIG.benqi.color}
                  radius={[4, 4, 0, 0]}
                  barSize={16}
                />
                <Bar
                  dataKey="aave_v3"
                  name="Aave V3"
                  fill={PROTOCOL_CONFIG.aave_v3.color}
                  radius={[4, 4, 0, 0]}
                  barSize={16}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
