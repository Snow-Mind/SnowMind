"use client";

import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from "@tanstack/react-table";
import { RefreshCw, Check, X, SkipForward, ExternalLink } from "lucide-react";
import { PROTOCOL_CONFIG, EXPLORER } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import type { RebalanceLogEntry } from "@snowmind/shared-types";

type HistoryRow = RebalanceLogEntry;

const STATUS_BADGE: Record<string, { icon: typeof Check; label: string; cls: string }> = {
  completed: { icon: Check, label: "Executed", cls: "border-mint/30 bg-mint/10 text-mint" },
  skipped:   { icon: SkipForward, label: "Skipped", cls: "border-amber/30 bg-amber/10 text-amber" },
  failed:    { icon: X, label: "Failed", cls: "border-crimson/30 bg-crimson/10 text-crimson" },
};

function protocolName(id: string) {
  return PROTOCOL_CONFIG[id as keyof typeof PROTOCOL_CONFIG]?.name ?? id;
}

function describeMove(row: HistoryRow): string {
  const from = row.fromAllocations;
  const to = row.toAllocations;
  const changes: string[] = [];
  for (const ta of to) {
    const fa = from.find((f) => f.protocolId === ta.protocolId);
    if (!fa) continue;
    const diff = ta.percentage - fa.percentage;
    if (Math.abs(diff) < 0.5) continue;
    const dir = diff > 0 ? "+" : "";
    changes.push(`${protocolName(ta.protocolId)} ${dir}${diff.toFixed(1)}%`);
  }
  return changes.join(", ") || "No change";
}

const columnHelper = createColumnHelper<HistoryRow>();

function buildColumns(): ColumnDef<HistoryRow, unknown>[] {
  return [
    columnHelper.accessor("timestamp", {
      header: "Date",
      cell: (info) => {
        const d = new Date(info.getValue());
        return (
          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
            {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
            {d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </span>
        );
      },
    }) as ColumnDef<HistoryRow, unknown>,
    columnHelper.display({
      id: "move",
      header: "Rebalance",
      cell: ({ row }) => (
        <span className="text-sm text-arctic">{describeMove(row.original)}</span>
      ),
    }),
    columnHelper.accessor("gasCostUsd", {
      header: "Gas",
      cell: (info) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatUsd(info.getValue())}
        </span>
      ),
    }) as ColumnDef<HistoryRow, unknown>,
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const val = info.getValue();
        const badge = STATUS_BADGE[val] ?? STATUS_BADGE.completed;
        const Icon = badge.icon;
        return (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}
          >
            <Icon className="h-3 w-3" />
            {badge.label}
          </span>
        );
      },
    }) as ColumnDef<HistoryRow, unknown>,
    columnHelper.accessor("txHash", {
      header: "Tx",
      cell: (info) => {
        const hash = info.getValue();
        if (!hash) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <a
            href={EXPLORER.tx(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-glacier hover:underline"
          >
            {hash.slice(0, 6)}…
            <ExternalLink className="h-3 w-3" />
          </a>
        );
      },
    }) as ColumnDef<HistoryRow, unknown>,
  ];
}

interface RebalanceHistoryProps {
  history: HistoryRow[];
  total: number;
}

export default function RebalanceHistory({ history, total }: RebalanceHistoryProps) {
  const columns = useMemo(buildColumns, []);
  const table = useReactTable({
    data: history,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="crystal-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
        <h2 className="text-sm font-medium text-arctic">Rebalance History</h2>
        <RefreshCw className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border/20">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border/20">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="transition-colors hover:bg-accent/30"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap px-6 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
