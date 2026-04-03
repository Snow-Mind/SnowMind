"use client";

import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { getRebalanceCadence } from "@/lib/rebalanceCadence";

interface RebalanceCountdownProps {
  lastRebalance: string | null;
  totalDepositedUsd?: number;
}

export default function RebalanceCountdown({
  lastRebalance,
  totalDepositedUsd = 0,
}: RebalanceCountdownProps) {
  const [remaining, setRemaining] = useState<string | null>(null);
  const rebalanceIntervalMs = getRebalanceCadence(totalDepositedUsd).intervalMs;

  useEffect(() => {
    if (!lastRebalance) return;

    function tick() {
      const next =
        new Date(lastRebalance!).getTime() + rebalanceIntervalMs;
      const diff = Math.max(0, next - Date.now());
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setRemaining(`${mins}m ${String(secs).padStart(2, "0")}s`);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastRebalance, rebalanceIntervalMs]);

  if (!remaining) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        No rebalance yet
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="h-3 w-3" />
      Next check in{" "}
      <span className="font-mono text-arctic">{remaining}</span>
    </span>
  );
}
