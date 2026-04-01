"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { LayoutGrid, Loader2, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PROTOCOL_CONFIG } from "@/lib/constants";
import { useProtocolRates } from "@/hooks/useProtocolRates";

const CANONICAL_PROTOCOL_IDS = [
  "aave_v3",
  "benqi",
  "spark",
  "euler_v2",
  "silo_savusd_usdc",
  "silo_susdp_usdc",
] as const;

type CanonicalProtocolId = (typeof CANONICAL_PROTOCOL_IDS)[number];

const MANAGED_PROTOCOLS = CANONICAL_PROTOCOL_IDS
  .map((id) => PROTOCOL_CONFIG[id])
  .filter(Boolean);

interface AgentManagerProps {
  address?: string;
  hasActiveSessionKey: boolean;
  allowedProtocols: string[];
}

function normalizeAllowedProtocols(protocols: string[] | undefined): CanonicalProtocolId[] {
  if (!protocols || protocols.length === 0) {
    return [];
  }

  const allowedSet = new Set<CanonicalProtocolId>(CANONICAL_PROTOCOL_IDS);
  const normalized: CanonicalProtocolId[] = [];
  for (const raw of protocols) {
    const maybe = (raw ?? "").toLowerCase().trim();
    const canonical = maybe === "aave" ? "aave_v3" : maybe;
    if (!allowedSet.has(canonical as CanonicalProtocolId)) continue;
    if (normalized.includes(canonical as CanonicalProtocolId)) continue;
    normalized.push(canonical as CanonicalProtocolId);
  }
  return normalized;
}

function formatTvl(tvl: number | undefined): string {
  if (!tvl || tvl <= 0) return "-";
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(1)}B`;
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(1)}M`;
  if (tvl >= 1e3) return `$${(tvl / 1e3).toFixed(0)}K`;
  return `$${tvl.toFixed(0)}`;
}

function isSameOrderedScope(a: CanonicalProtocolId[], b: CanonicalProtocolId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default function AgentManager({
  address,
  hasActiveSessionKey,
  allowedProtocols,
}: AgentManagerProps) {
  const queryClient = useQueryClient();
  const { data: protocolRates } = useProtocolRates();

  const currentScope = useMemo(() => {
    const normalized = normalizeAllowedProtocols(allowedProtocols);
    return normalized.length > 0 ? normalized : [...CANONICAL_PROTOCOL_IDS];
  }, [allowedProtocols]);

  const [selectedProtocols, setSelectedProtocols] = useState<Set<CanonicalProtocolId>>(
    () => new Set(currentScope),
  );
  const [saving, setSaving] = useState(false);

  const currentScopeKey = currentScope.join("|");
  useEffect(() => {
    setSelectedProtocols(new Set(currentScope));
  }, [currentScopeKey, currentScope]);

  const selectedOrdered = CANONICAL_PROTOCOL_IDS.filter((id) => selectedProtocols.has(id));
  const canSave = selectedOrdered.length > 0 && !isSameOrderedScope(selectedOrdered, currentScope);

  const toggleProtocol = (protocolId: CanonicalProtocolId, isEnabled: boolean) => {
    if (!isEnabled) return;
    setSelectedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(protocolId)) {
        next.delete(protocolId);
      } else {
        next.add(protocolId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!address) {
      toast.error("Smart account not found. Refresh and retry.");
      return;
    }
    if (!hasActiveSessionKey) {
      toast.error("Session key is not active. Re-grant first in Settings.");
      return;
    }
    if (selectedOrdered.length === 0) {
      toast.error("Select at least one market.");
      return;
    }

    setSaving(true);
    try {
      await api.updateAllowedProtocols(address, selectedOrdered);
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["account-detail", address] }),
        queryClient.invalidateQueries({ queryKey: ["rebalance-status", address] }),
        queryClient.invalidateQueries({ queryKey: ["rebalance-history", address] }),
      ]);

      toast.success("Agent market scope updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update market scope";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
            <LayoutGrid className="h-3.5 w-3.5 text-[#E84142]" />
          </div>
          <span className="text-sm font-medium text-[#1A1715]">Agent Manager</span>
        </div>

        <p className="text-xs text-[#8A837C]">
          Control which markets your optimizer is allowed to use after onboarding.
          Changes sync to your active session-key scope in backend.
        </p>

        {!hasActiveSessionKey && (
          <div className="rounded-lg border border-[#F59E0B]/20 bg-[#FEF3C7] px-3 py-2.5">
            <p className="text-[11px] text-[#92400E]">
              Session key is inactive. Re-grant first, then update market scope.
            </p>
            <Link
              href="/settings"
              className="mt-2 inline-flex text-[11px] font-medium text-[#B45309] underline"
            >
              Go to Settings to Re-grant
            </Link>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-[#E8E2DA]">
          <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 bg-[#F5F0EB] px-3 py-2 md:grid">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Protocol</span>
            <span className="w-14 text-center text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Risk</span>
            <span className="w-16 text-right text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">APY</span>
            <span className="w-20 text-right text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">TVL</span>
            <span className="w-12 text-center text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Active</span>
          </div>

          {MANAGED_PROTOCOLS.map((protocol, idx) => {
            const isSelected = selectedProtocols.has(protocol.id as CanonicalProtocolId);
            const rateData = protocolRates?.find((r) => r.protocolId === protocol.id);
            const isEnabled = protocol.isActive;
            const apyLabel = rateData && rateData.currentApy > 0
              ? `${(rateData.currentApy * 100).toFixed(2)}%`
              : "-";
            const tvlLabel = formatTvl(rateData?.tvlUsd);
            const riskToneClass = protocol.riskScore >= 9
              ? "bg-[#059669]/10 text-[#059669]"
              : protocol.riskScore >= 7
                ? "bg-[#D97706]/10 text-[#D97706]"
                : "bg-[#DC2626]/10 text-[#DC2626]";

            return (
              <div
                key={protocol.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-3 transition-all cursor-pointer md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] md:items-center",
                  idx > 0 && "border-t border-[#E8E2DA]",
                  !isEnabled && "cursor-not-allowed opacity-55",
                  isSelected ? "bg-[#E84142]/[0.03]" : "bg-white opacity-60",
                )}
                onClick={() => toggleProtocol(protocol.id as CanonicalProtocolId, isEnabled)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Image
                    src={protocol.logoPath}
                    alt={protocol.name}
                    width={32}
                    height={32}
                    className="rounded-full shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium leading-tight text-[#1A1715]">
                        <span className="sm:hidden">{protocol.shortName}</span>
                        <span className="hidden sm:inline">{protocol.name}</span>
                      </p>
                      {!isEnabled && (
                        <span className="rounded bg-[#E8E2DA] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[#8A837C]">
                          Soon
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 hidden text-[10px] text-[#8A837C] sm:block">
                      {protocol.category}, {protocol.asset}
                    </p>
                  </div>
                </div>

                <div className="flex justify-center md:w-12">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProtocol(protocol.id as CanonicalProtocolId, isEnabled);
                    }}
                    className={cn(
                      "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                      !isEnabled && "opacity-40",
                      isSelected ? "bg-[#E84142]" : "bg-[#E8E2DA]",
                    )}
                    disabled={!isEnabled}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        isSelected ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>

                <div className="hidden justify-center md:flex md:w-14">
                  <span className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                    riskToneClass,
                  )}>
                    {protocol.riskScore}/10
                  </span>
                </div>

                <span className="hidden w-16 text-right font-mono text-[11px] font-semibold text-[#059669] md:block">
                  {apyLabel}
                </span>

                <span className="hidden w-20 text-right font-mono text-[11px] text-[#5C5550] md:block">
                  {tvlLabel}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-lg bg-[#F5F0EB] px-3 py-2.5">
          <span className="text-xs text-[#8A837C]">Selected markets</span>
          <span className="font-mono text-sm font-semibold text-[#1A1715]">{selectedOrdered.length}</span>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !hasActiveSessionKey || !canSave}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#E84142] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#D63031] disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving Market Scope...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Market Scope
            </>
          )}
        </button>
      </div>
    </div>
  );
}
