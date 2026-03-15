"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  UserPlus,
  RefreshCw,
  ExternalLink,
  Users,
  BarChart3,
  DollarSign,
  Loader2,
} from "lucide-react";
import { createPublicClient, http, formatUnits, type Log } from "viem";
import { CHAIN, CONTRACTS, EXPLORER, AVALANCHE_RPC_URL } from "@/lib/constants";
import { formatUsd } from "@/lib/format";

// ABI event fragments for SnowMindRegistry
const registryEvents = [
  {
    type: "event" as const,
    name: "AccountRegistered",
    inputs: [
      { name: "owner", type: "address" as const, indexed: true },
      { name: "smartAccount", type: "address" as const, indexed: true },
      { name: "timestamp", type: "uint256" as const, indexed: false },
    ],
  },
  {
    type: "event" as const,
    name: "OptimizerRebalance",
    inputs: [
      { name: "smartAccount", type: "address" as const, indexed: true },
      { name: "fromProtocol", type: "string" as const, indexed: false },
      { name: "toProtocol", type: "string" as const, indexed: false },
      { name: "amountUsd", type: "uint256" as const, indexed: false },
      { name: "timestamp", type: "uint256" as const, indexed: false },
    ],
  },
] as const;

interface RegistryEvent {
  type: "register" | "rebalance";
  txHash: string;
  blockNumber: bigint;
  timestamp: number;
  // register fields
  owner?: string;
  smartAccount?: string;
  // rebalance fields
  fromProtocol?: string;
  toProtocol?: string;
  amountUsd?: number;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4 },
  }),
};

export default function ActivityPage() {
  const [events, setEvents] = useState<RegistryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      if (!CONTRACTS.REGISTRY) {
        setError("Registry contract address not configured");
        setLoading(false);
        return;
      }

      try {
        const client = createPublicClient({
          chain: CHAIN,
          transport: http(AVALANCHE_RPC_URL),
        });

        const currentBlock = await client.getBlockNumber();
        const fromBlock = currentBlock > BigInt(1000) ? currentBlock - BigInt(1000) : BigInt(0);

        const logs = await client.getLogs({
          address: CONTRACTS.REGISTRY,
          events: registryEvents,
          fromBlock,
          toBlock: "latest",
        });

        if (cancelled) return;

        const parsed: RegistryEvent[] = logs.map((log) => {
          const args = (log as Log & { args: Record<string, unknown>; eventName: string }).args;
          const eventName = (log as Log & { eventName: string }).eventName;

          if (eventName === "AccountRegistered") {
            return {
              type: "register" as const,
              txHash: log.transactionHash ?? "",
              blockNumber: log.blockNumber ?? BigInt(0),
              timestamp: Number(args.timestamp ?? 0),
              owner: args.owner as string,
              smartAccount: args.smartAccount as string,
            };
          }

          return {
            type: "rebalance" as const,
            txHash: log.transactionHash ?? "",
            blockNumber: log.blockNumber ?? BigInt(0),
            timestamp: Number(args.timestamp ?? 0),
            smartAccount: (log as Log & { topics: string[] }).topics?.[1]
              ? `0x${(log as Log & { topics: string[] }).topics[1]?.slice(26)}`
              : undefined,
            fromProtocol: args.fromProtocol as string,
            toProtocol: args.toProtocol as string,
            amountUsd: Number(formatUnits(BigInt(String(args.amountUsd ?? 0)), 6)),
          };
        });

        parsed.sort((a, b) => Number(b.blockNumber - a.blockNumber));
        setEvents(parsed);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch events");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvents();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const accounts = new Set(
      events.filter((e) => e.type === "register").map((e) => e.smartAccount)
    );
    const rebalances = events.filter((e) => e.type === "rebalance");
    const totalOptimized = rebalances.reduce(
      (s, e) => s + (e.amountUsd ?? 0),
      0
    );
    return {
      accountCount: accounts.size,
      rebalanceCount: rebalances.length,
      totalOptimized,
    };
  }, [events]);

  return (
    <main className="bg-void py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-glacier/20 bg-glacier/5">
            <Activity className="h-6 w-6 text-glacier" />
          </div>
          <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">
            Live SnowMind Activity
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Real-time on-chain events from the SnowMind Registry on Avalanche
          </p>
        </div>

        {/* Stats */}
        <div className="mt-12 grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.02]">
          {[
            {
              icon: Users,
              label: "Accounts Managed",
              value: stats.accountCount.toString(),
            },
            {
              icon: BarChart3,
              label: "Rebalances Performed",
              value: stats.rebalanceCount.toString(),
            },
            {
              icon: DollarSign,
              label: "Total Optimized",
              value: formatUsd(stats.totalOptimized),
            },
          ].map((s) => (
            <div key={s.label} className="px-6 py-6 text-center">
              <s.icon className="mx-auto h-5 w-5 text-glacier" />
              <p className="mt-2 font-mono text-xl font-bold text-white">
                {s.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Event Feed */}
        <div className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <h2 className="text-sm font-medium text-white">Recent Events</h2>
            <span className="text-[10px] text-slate-500">
              Last 1000 blocks
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-glacier" />
              <span className="ml-2 text-sm text-slate-400">
                Reading on-chain events…
              </span>
            </div>
          ) : error ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-crimson">{error}</p>
              <p className="mt-2 text-xs text-slate-500">
                Make sure the registry contract is deployed on Avalanche.
              </p>
            </div>
          ) : events.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Activity className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-2 text-sm text-slate-400">
                No events found in the last 1000 blocks.
              </p>
              <p className="text-xs text-slate-500">
                Register an account or trigger a rebalance to see activity here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {events.map((evt, i) => (
                <motion.div
                  key={`${evt.txHash}-${i}`}
                  className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/[0.02]"
                  variants={fadeUp}
                  initial="hidden"
                  animate="visible"
                  custom={i}
                >
                  {/* Icon */}
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                      evt.type === "register"
                        ? "border-mint/30 bg-mint/10"
                        : "border-glacier/30 bg-glacier/10"
                    }`}
                  >
                    {evt.type === "register" ? (
                      <UserPlus className="h-4 w-4 text-mint" />
                    ) : (
                      <RefreshCw className="h-4 w-4 text-glacier" />
                    )}
                  </div>

                  {/* Description */}
                  <div className="min-w-0 flex-1">
                    {evt.type === "register" ? (
                      <>
                        <p className="text-sm text-white">New user joined</p>
                        <p className="truncate font-mono text-[10px] text-slate-500">
                          {evt.smartAccount}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-white">
                          Rebalance: {evt.amountUsd ? formatUsd(evt.amountUsd) : ""}{" "}
                          from {evt.fromProtocol} to {evt.toProtocol}
                        </p>
                        <p className="truncate font-mono text-[10px] text-slate-500">
                          {evt.smartAccount}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Time + link */}
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] text-slate-500">
                      {evt.timestamp ? timeAgo(evt.timestamp) : `Block ${evt.blockNumber}`}
                    </p>
                    {evt.txHash && (
                      <a
                        href={EXPLORER.tx(evt.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-[10px] text-glacier hover:underline"
                      >
                        Snowtrace
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Contract link */}
        {CONTRACTS.REGISTRY && (
          <div className="mt-6 text-center">
            <a
              href={EXPLORER.contract(CONTRACTS.REGISTRY)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-glacier/10 px-4 py-2 text-xs font-medium text-glacier transition-colors hover:bg-glacier/20"
            >
              View SnowMindRegistry contract on Snowtrace
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
