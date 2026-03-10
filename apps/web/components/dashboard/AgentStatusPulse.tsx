"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Activity,
  Shield,
  Clock,
  Eye,
} from "lucide-react";
import { ACTIVE_PROTOCOLS, PROTOCOL_CONFIG } from "@/lib/constants";

interface AgentStatusPulseProps {
  lastRebalance: string | null;
  isActive: boolean;
  activeProtocols: number;
}

const REBALANCE_INTERVAL_MS = 30 * 60 * 1000;

export default function AgentStatusPulse({
  lastRebalance,
  isActive,
  activeProtocols,
}: AgentStatusPulseProps) {
  const [countdown, setCountdown] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!lastRebalance) return;
    function tick() {
      const next = new Date(lastRebalance!).getTime() + REBALANCE_INTERVAL_MS;
      const diff = Math.max(0, next - Date.now());
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setCountdown(`${mins}m ${String(secs).padStart(2, "0")}s`);
      setProgress(1 - diff / REBALANCE_INTERVAL_MS);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastRebalance]);

  const monitoredProtocols = ACTIVE_PROTOCOLS.map(
    (id) => PROTOCOL_CONFIG[id].shortName,
  );

  return (
    <div className="crystal-card overflow-hidden">
      {/* Status header */}
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
              <Brain className="h-4 w-4 text-glacier" />
            </div>
            {isActive && (
              <motion.span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-mint"
                animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>
          <div>
            <h2 className="text-sm font-medium text-arctic">
              Agent {isActive ? "Active" : "Inactive"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {isActive
                ? "Continuously monitoring markets"
                : "Activate your agent to start optimizing"}
            </p>
          </div>
        </div>
        {isActive && (
          <div className="flex items-center gap-1.5 rounded-full bg-mint/10 px-2.5 py-1 text-[10px] font-medium text-mint">
            <Activity className="h-3 w-3" />
            Live
          </div>
        )}
      </div>

      {isActive && (
        <div className="space-y-4 px-6 py-4">
          {/* Monitoring stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Eye className="h-3.5 w-3.5 text-glacier" />
              <div>
                <p className="font-mono text-sm font-semibold text-arctic">
                  {monitoredProtocols.length}
                </p>
                <p className="text-[9px] text-muted-foreground">Protocols Watched</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Shield className="h-3.5 w-3.5 text-glacier" />
              <div>
                <p className="font-mono text-sm font-semibold text-arctic">5</p>
                <p className="text-[9px] text-muted-foreground">Safety Checks</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Activity className="h-3.5 w-3.5 text-glacier" />
              <div>
                <p className="font-mono text-sm font-semibold text-arctic">
                  {activeProtocols}
                </p>
                <p className="text-[9px] text-muted-foreground">Active Markets</p>
              </div>
            </div>
          </div>

          {/* Next check countdown */}
          <div className="rounded-lg bg-void-2/30 px-4 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {countdown ? "Next rate check" : "Waiting for first check…"}
              </span>
              {countdown && (
                <span className="font-mono text-sm font-medium text-arctic">
                  {countdown}
                </span>
              )}
            </div>
            {countdown && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/30">
                <motion.div
                  className="h-full rounded-full bg-glacier"
                  style={{ width: `${Math.min(progress * 100, 100)}%` }}
                  transition={{ duration: 0.5, ease: "linear" }}
                />
              </div>
            )}
          </div>

          {/* Monitoring targets */}
          <div className="flex flex-wrap gap-1.5">
            {monitoredProtocols.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-border/30 bg-void-2/20 px-2.5 py-1 text-[10px] text-muted-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-glacier" />
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
