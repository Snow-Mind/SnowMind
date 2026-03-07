"use client";

import { useProtocolRates } from "@/hooks/useProtocolRates";
import { PROTOCOL_CONFIG, type ProtocolId } from "@/lib/constants";
import { formatPct } from "@/lib/format";

export default function LiveRateTicker() {
  const { data: rates, dataUpdatedAt } = useProtocolRates();

  const ago = dataUpdatedAt
    ? `${Math.round((Date.now() - dataUpdatedAt) / 1000)}s ago`
    : null;

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
      </span>

      {rates?.map((r) => {
        const cfg = PROTOCOL_CONFIG[r.protocolId as ProtocolId];
        if (!cfg || !r.isActive) return null;
        return (
          <span key={r.protocolId} className="flex items-center gap-1">
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
