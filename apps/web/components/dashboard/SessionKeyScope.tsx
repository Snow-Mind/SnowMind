"use client";

import { useMemo, useState } from "react";
import {
  Lock,
  FileCode2,
  Shield,
  Timer,
  Zap,
  Ban,
  ExternalLink,
} from "lucide-react";
import { ACTIVE_PROTOCOLS, PROTOCOL_CONFIG, SESSION_KEY_SELECTORS, EXPLORER } from "@/lib/constants";
import type { SessionKeyStatusResponse } from "@snowmind/shared-types";

/**
 * Inspired by ZYF.AI's "You define the boundaries" and Giza's
 * "Verifiable by Design". Shows exactly what the session key
 * allows the agent to do — building user trust through transparency.
 */

interface SessionKeyScopeProps {
  sessionKey: SessionKeyStatusResponse | null;
  smartAccountAddress: string | null;
}

export default function SessionKeyScope({
  sessionKey,
  smartAccountAddress,
}: SessionKeyScopeProps) {
  const [nowMs] = useState(() => Date.now());

  const allowedProtocols = ACTIVE_PROTOCOLS.map((id) => ({
    id,
    name: PROTOCOL_CONFIG[id].name,
    color: PROTOCOL_CONFIG[id].color,
    functions: Object.keys(SESSION_KEY_SELECTORS[id]).map((fn) =>
      fn === "mint" || fn === "deposit"
        ? "Supply"
        : fn === "redeem" || fn === "withdraw"
          ? "Withdraw"
          : fn,
    ),
  }));

  const expiresLabel = useMemo(() => {
    if (!sessionKey) return "—";
    const d = new Date(sessionKey.expiresAt);
    const years = Math.floor(
      (d.getTime() - nowMs) / (365.25 * 24 * 60 * 60 * 1000),
    );
    if (years > 50) return "No expiration";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [sessionKey, nowMs]);

  return (
    <div className="crystal-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
            <Lock className="h-4 w-4 text-glacier" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-arctic">
              Agent Permissions
            </h2>
            <p className="text-xs text-muted-foreground">
              Your agent can only do what you allow
            </p>
          </div>
        </div>
        {smartAccountAddress && (
          <a
            href={EXPLORER.address(smartAccountAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-glacier hover:underline"
          >
            Verify on-chain
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Allowed protocols */}
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Allowed Protocols
          </p>
          <div className="space-y-2">
            {allowedProtocols.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-border/30 bg-void-2/20 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-xs font-medium text-arctic">
                    {p.name}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {p.functions.map((fn) => (
                    <span
                      key={fn}
                      className="rounded-md bg-glacier/10 px-2 py-0.5 text-[10px] font-medium text-glacier"
                    >
                      {fn}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Restrictions */}
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Hard Restrictions
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Shield className="h-3.5 w-3.5 text-mint" />
              <div>
                <p className="text-[10px] font-medium text-arctic">
                  Max 60% per protocol
                </p>
                <p className="text-[9px] text-muted-foreground">
                  Enforces diversification
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Timer className="h-3.5 w-3.5 text-mint" />
              <div>
                <p className="text-[10px] font-medium text-arctic">
                  {expiresLabel}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  Key expiration
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Zap className="h-3.5 w-3.5 text-mint" />
              <div>
                <p className="text-[10px] font-medium text-arctic">
                  20 ops/day
                </p>
                <p className="text-[9px] text-muted-foreground">
                  Rate limited
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
              <Ban className="h-3.5 w-3.5 text-crimson" />
              <div>
                <p className="text-[10px] font-medium text-arctic">
                  No transfers out
                </p>
                <p className="text-[9px] text-muted-foreground">
                  Cannot move your funds
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* What the agent CAN'T do */}
        <div className="rounded-lg border border-crimson/20 bg-crimson/[0.03] px-4 py-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-crimson">
            Agent Cannot
          </p>
          <ul className="space-y-1.5 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <Ban className="h-3 w-3 text-crimson/60" />
              Transfer your tokens to any external address
            </li>
            <li className="flex items-center gap-1.5">
              <Ban className="h-3 w-3 text-crimson/60" />
              Borrow against your collateral
            </li>
            <li className="flex items-center gap-1.5">
              <Ban className="h-3 w-3 text-crimson/60" />
              Interact with unapproved contracts
            </li>
            <li className="flex items-center gap-1.5">
              <Ban className="h-3 w-3 text-crimson/60" />
              Exceed maximum amount or rate limits
            </li>
          </ul>
        </div>

        {sessionKey && (
          <p className="text-center text-[10px] text-muted-foreground">
            <FileCode2 className="mr-1 inline h-3 w-3" />
            Session key permissions enforced on-chain by EVM validation — not just our backend.
          </p>
        )}
      </div>
    </div>
  );
}
