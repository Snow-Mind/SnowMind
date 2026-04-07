"use client";

import { useState, useEffect } from "react";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { PROTOCOL_CONFIG, type ProtocolId } from "@/lib/constants";
import { formatPct } from "@/lib/format";

function canonicalProtocolId(rawProtocolId: string): string {
  const normalized = (rawProtocolId || "").trim().toLowerCase();
  if (normalized === "aave") return "aave_v3";
  if (normalized === "folks_finance_xchain" || normalized === "folks_finance") return "folks";
  return normalized;
}

export default function LiveRateTicker() {
  const { data: rates, dataUpdatedAt } = useProtocolRates();

  const [ago, setAgo] = useState<string | null>(null);
  const [prevUpdatedAt, setPrevUpdatedAt] = useState<number | undefined>(undefined);
  if (dataUpdatedAt !== prevUpdatedAt) {
    setPrevUpdatedAt(dataUpdatedAt);
    if (!dataUpdatedAt) setAgo(null);
  }
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const tick = () => setAgo(`${Math.round((Date.now() - dataUpdatedAt) / 1000)}s ago`);
    const init = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(init); clearInterval(id); };
  }, [dataUpdatedAt]);

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
      </span>

      {rates?.map((r) => {
        const canonicalId = canonicalProtocolId(r.protocolId);
        const cfg = PROTOCOL_CONFIG[canonicalId as ProtocolId];
        if (!cfg || !r.isActive) return null;
        return (
          <span key={canonicalId} className="flex items-center gap-1">
            <span style={{ color: cfg.color }}>{cfg.shortName}</span>
            <span className="font-mono text-arctic">
              {formatPct(r.currentApy * 100)}
            </span>
          </span>
        );
      })}

      {ago && (
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          Updated {ago}
        </span>
      )}
    </div>
  );
}
