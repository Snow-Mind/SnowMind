"use client";

import { useState } from "react";
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
  CONTRACTS,
} from "@/lib/constants";
import { api } from "@/lib/api-client";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useSessionKey } from "@/hooks/useSessionKey";
import { useWallets } from "@privy-io/react-auth";
import { createSmartAccount, grantAndSerializeSessionKey } from "@/lib/zerodev";
import { toast } from "sonner";

function hoursUntil(isoDate: string): number {
  return Math.max(
    0,
    Math.floor((new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60))
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
    for (const [name, selector] of Object.entries(sels as Record<string, string>)) {
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
  const [granting, setGranting] = useState(false);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { data: sk, isLoading, refetch } = useSessionKey(smartAccountAddress ?? undefined);
  const { wallets } = useWallets();
  const authorized = getAuthorizedActions();

  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;
  const isActive = sk?.isActive ?? false;
  const hoursLeft = sk?.expiresAt ? hoursUntil(sk.expiresAt) : 0;
  const daysLeft = Math.floor(hoursLeft / 24);
  const isExpiringSoon = hoursLeft <= 48;

  async function handleGrantSessionKey() {
    if (!wallet || !smartAccountAddress) return;
    setGranting(true);
    try {
      const { kernelAccount, kernelClient } = await createSmartAccount(wallet);

      const { serializedPermission, sessionPrivateKey, sessionKeyAddress, expiresAt } =
        await grantAndSerializeSessionKey(
          kernelAccount,
          kernelClient,
          {
            AAVE_POOL: CONTRACTS.AAVE_POOL,
            BENQI_POOL: CONTRACTS.BENQI_POOL,
            SPARK_VAULT: CONTRACTS.SPARK_VAULT,
            EULER_VAULT: CONTRACTS.EULER_VAULT,
            SILO_SAVUSD_VAULT: CONTRACTS.SILO_SAVUSD_VAULT,
            SILO_SUSDP_VAULT: CONTRACTS.SILO_SUSDP_VAULT,
            USDC: CONTRACTS.USDC,
            TREASURY: CONTRACTS.TREASURY,
            PERMIT2: CONTRACTS.PERMIT2,
          },
          {
            maxAmountUSDC: 10000,
            durationDays: 30,
            maxOpsPerDay: 20,
            userEOA: wallet.address as `0x${string}`,
          },
        );

      await api.storeSessionKey(smartAccountAddress, {
        serializedPermission,
        sessionPrivateKey,
        sessionKeyAddress,
        expiresAt,
        allowedProtocols: ACTIVE_PROTOCOLS as unknown as string[],
        force: true,
      });

      toast.success("Session key granted — agent activated");
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to grant session key";
      toast.error(message);
    } finally {
      setGranting(false);
    }
  }

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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]">
            <Shield className="h-4 w-4 text-[#E84142]" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-medium text-[#1A1715]">Session Key</h2>
            <p className="text-xs text-[#8A837C]">Loading…</p>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-[#EDE8E3]" />
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]">
            <Shield className="h-4 w-4 text-[#E84142]" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-medium text-[#1A1715]">Session Key</h2>
            <p className="text-xs text-[#8A837C]">
              No active session key. Grant one to enable autonomous optimization.
            </p>
          </div>
          <span className="rounded-full border border-[#DC2626]/30 bg-[#DC2626]/10 px-2 py-0.5 text-xs text-[#DC2626]">
            Not Granted
          </span>
        </div>
        <div className="mt-4">
          <button
            onClick={handleGrantSessionKey}
            disabled={granting || !wallet}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#E84142] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#E84142]/90 disabled:opacity-50"
          >
            {granting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Granting Session Key…
              </>
            ) : (
              <>
                <Shield className="h-4 w-4" />
                Activate Agent
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="crystal-card p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]">
          <Shield className="h-4 w-4 text-[#E84142]" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-medium text-[#1A1715]">Session Key</h2>
          <p className="text-xs text-[#8A837C]">
            Controls what SnowMind can do with your smart account.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            isActive
              ? "border-[#059669]/30 bg-[#059669]/10 text-[#059669]"
              : "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]"
          }`}
        >
          {isActive ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Authorized actions list */}
      <div className="mt-5">
        <h3 className="text-[10px] uppercase tracking-wider text-[#8A837C]">
          Authorized Actions
        </h3>
        <div className="mt-2 space-y-1.5">
          {authorized.map((a) => (
            <div
              key={`${a.protocol}-${a.action}`}
              className="flex items-center gap-2 rounded-lg border border-[#E8E2DA]/60 bg-[#EDE8E3]/30 px-3 py-2"
            >
              <Check className="h-3 w-3 text-[#059669]" />
              <span
                className="text-xs font-medium"
                style={{ color: a.color }}
              >
                {a.protocol}
              </span>
              <span className="text-xs text-[#1A1715]">{a.action}()</span>
              <span className="ml-auto font-mono text-[10px] text-[#8A837C]">
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
              className="flex items-center gap-2 rounded-lg border border-[#DC2626]/10 bg-[#DC2626]/5 px-3 py-2"
            >
              <X className="h-3 w-3 text-[#DC2626]/60" />
              <span className="text-xs text-[#DC2626]/60">{fn}</span>
              <span className="ml-auto text-[10px] text-[#DC2626]/40">
                Blocked
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-[#E8E2DA]/60 bg-[#EDE8E3]/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-[#8A837C]" />
            <span className="text-xs text-[#1A1715]">Expires</span>
          </div>
          <span className="font-mono text-xs text-[#059669]">
            Never (infinite)
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-[#E8E2DA]/60 bg-[#EDE8E3]/30 px-3 py-2.5">
          <span className="text-xs text-[#1A1715]">Max per Tx</span>
          <span className="font-mono text-xs text-[#8A837C]">
            {sk.maxAmountPerTx}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex gap-2">
        <button
          onClick={handleGrantSessionKey}
          disabled={granting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#E84142]/10 px-3 py-2 text-xs font-medium text-[#E84142] transition-colors hover:bg-[#E84142]/20 disabled:opacity-50"
        >
          {granting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {granting ? "Granting…" : "Re-grant Key"}
        </button>
        {!showRevokeConfirm ? (
          <button
            onClick={() => setShowRevokeConfirm(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#DC2626]/10 px-3 py-2 text-xs font-medium text-[#DC2626] transition-colors hover:bg-[#DC2626]/20"
          >
            <X className="h-3 w-3" />
            Revoke Key
          </button>
        ) : (
          <div className="flex flex-1 gap-1">
            <button
              onClick={() => setShowRevokeConfirm(false)}
              className="flex-1 rounded-lg border border-[#E8E2DA] px-2 py-2 text-xs text-[#8A837C] hover:text-[#1A1715]"
            >
              Cancel
            </button>
            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#DC2626] px-2 py-2 text-xs font-medium text-white hover:bg-[#DC2626]/90 disabled:opacity-50"
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
