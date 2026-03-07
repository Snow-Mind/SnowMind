"use client";

import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

const REBALANCE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface RebalanceCountdownProps {
  lastRebalance: string | null;
}

export default function RebalanceCountdown({
  lastRebalance,
}: RebalanceCountdownProps) {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!lastRebalance) {
      setRemaining(null);
      return;
    }

    function tick() {
      const next =
        new Date(lastRebalance!).getTime() + REBALANCE_INTERVAL_MS;
      const diff = Math.max(0, next - Date.now());
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setRemaining(`${mins}m ${String(secs).padStart(2, "0")}s`);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastRebalance]);

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
