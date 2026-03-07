"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Check,
  X,
  Clock,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  PROTOCOL_CONFIG,
  SESSION_KEY_SELECTORS,
  ACTIVE_PROTOCOLS,
} from "@/lib/constants";
import { api } from "@/lib/api-client";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useSessionKey } from "@/hooks/useSessionKey";
import { toast } from "sonner";

function daysUntil(isoDate: string): number {
  return Math.max(
    0,
    Math.floor(
      (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )
  );
}

interface AuthorizedAction {
  protocol: string;
  action: string;
  selector: string;
  color: string;
}

function getAuthorizedActions(): AuthorizedAction[] {
  const actions: AuthorizedAction[] = [];
  for (const pid of ACTIVE_PROTOCOLS) {
    const meta = PROTOCOL_CONFIG[pid];
    const sels = SESSION_KEY_SELECTORS[pid];
    for (const [name, selector] of Object.entries(sels)) {
      actions.push({
        protocol: meta.shortName,
        action: name,
        selector,
        color: meta.color,
      });
    }
  }
  return actions;
}

export default function SessionKeyStatus() {
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { data: sk, isLoading, refetch } = useSessionKey(smartAccountAddress ?? undefined);
  const authorized = getAuthorizedActions();

  const isActive = sk?.isActive ?? false;
  const daysLeft = sk?.expiresAt ? daysUntil(sk.expiresAt) : 0;
  const isExpiringSoon = daysLeft <= 5;

  async function handleRevoke() {
    if (!smartAccountAddress) return;
    setRevoking(true);
    try {
      await api.revokeSessionKey(smartAccountAddress);
      toast.success("Session key revoked");
      setShowRevokeConfirm(false);
      refetch();
    } catch {
      toast.error("Failed to revoke session key");
    } finally {
      setRevoking(false);
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="crystal-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
            <Shield className="h-4 w-4 text-glacier" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-medium text-arctic">Session Key</h2>
            <p className="text-xs text-muted-foreground">Loading…</p>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-ice-20" />
          ))}
        </div>
      </div>
    );
  }

  // No session key granted yet
  if (!sk) {
    return (
      <div className="crystal-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
            <Shield className="h-4 w-4 text-glacier" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-medium text-arctic">Session Key</h2>
            <p className="text-xs text-muted-foreground">
              No session key granted yet. Set up your smart account to enable autonomous optimization.
            </p>
          </div>
          <span className="rounded-full border border-crimson/30 bg-crimson/10 px-2 py-0.5 text-xs text-crimson">
            Not Granted
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="crystal-card p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
          <Shield className="h-4 w-4 text-glacier" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-medium text-arctic">Session Key</h2>
          <p className="text-xs text-muted-foreground">
            Controls what SnowMind can do with your smart account.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            isActive
              ? "border-mint/30 bg-mint/10 text-mint"
              : "border-crimson/30 bg-crimson/10 text-crimson"
          }`}
        >
          {isActive ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Authorized actions list */}
      <div className="mt-5">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Authorized Actions
        </h3>
        <div className="mt-2 space-y-1.5">
          {authorized.map((a) => (
            <div
              key={`${a.protocol}-${a.action}`}
              className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2"
            >
              <Check className="h-3 w-3 text-mint" />
              <span
                className="text-xs font-medium"
                style={{ color: a.color }}
              >
                {a.protocol}
              </span>
              <span className="text-xs text-arctic">{a.action}()</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {a.selector}
              </span>
            </div>
          ))}
        </div>

        {/* Explicitly denied */}
        <div className="mt-3 space-y-1.5">
          {["transfer()", "approve()", "delegatecall()"].map((fn) => (
            <div
              key={fn}
              className="flex items-center gap-2 rounded-lg border border-crimson/10 bg-crimson/5 px-3 py-2"
            >
              <X className="h-3 w-3 text-crimson/60" />
              <span className="text-xs text-crimson/60">{fn}</span>
              <span className="ml-auto text-[10px] text-crimson/40">
                Blocked
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-arctic">Expires</span>
          </div>
          <span
            className={`font-mono text-xs ${isExpiringSoon ? "text-amber-400" : "text-muted-foreground"}`}
          >
            {isExpiringSoon && (
              <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-400" />
            )}
            {daysLeft} days left
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5">
          <span className="text-xs text-arctic">Max per Tx</span>
          <span className="font-mono text-xs text-muted-foreground">
            {sk.maxAmountPerTx}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex gap-2">
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-glacier/10 px-3 py-2 text-xs font-medium text-glacier transition-colors hover:bg-glacier/20">
          <RefreshCw className="h-3 w-3" />
          Renew Key
        </button>
        {!showRevokeConfirm ? (
          <button
            onClick={() => setShowRevokeConfirm(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-crimson/10 px-3 py-2 text-xs font-medium text-crimson transition-colors hover:bg-crimson/20"
          >
            <X className="h-3 w-3" />
            Revoke Key
          </button>
        ) : (
          <div className="flex flex-1 gap-1">
            <button
              onClick={() => setShowRevokeConfirm(false)}
              className="flex-1 rounded-lg border border-border/50 px-2 py-2 text-xs text-muted-foreground hover:text-arctic"
            >
              Cancel
            </button>
            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-crimson px-2 py-2 text-xs font-medium text-white hover:bg-crimson/90 disabled:opacity-50"
            >
              {revoking && <Loader2 className="h-3 w-3 animate-spin" />}
              {revoking ? "Revoking…" : "Confirm"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
