"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, LayoutGrid, Loader2, Minus, Pencil, Plus, Save, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PROTOCOL_CONFIG, RISK_SCORE_MAX } from "@/lib/constants";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import type { ProtocolRateResponse } from "@snowmind/shared-types";

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
  allocationCaps: Record<string, number> | null;
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

function defaultAllocationCaps(): Record<CanonicalProtocolId, number> {
  return Object.fromEntries(
    CANONICAL_PROTOCOL_IDS.map((pid) => [pid, 100]),
  ) as Record<CanonicalProtocolId, number>;
}

function normalizeAllocationCaps(
  rawCaps: Record<string, number> | null | undefined,
): Record<CanonicalProtocolId, number> {
  const normalized = defaultAllocationCaps();
  if (!rawCaps) {
    return normalized;
  }

  for (const [rawPid, rawValue] of Object.entries(rawCaps)) {
    const maybe = rawPid.toLowerCase().trim();
    const canonical = maybe === "aave" ? "aave_v3" : maybe;
    if (!CANONICAL_PROTOCOL_IDS.includes(canonical as CanonicalProtocolId)) continue;

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) continue;
    normalized[canonical as CanonicalProtocolId] = Math.max(0, Math.min(100, Math.round(parsed)));
  }

  return normalized;
}

function areCapsEqual(
  a: Record<CanonicalProtocolId, number>,
  b: Record<CanonicalProtocolId, number>,
): boolean {
  return CANONICAL_PROTOCOL_IDS.every((pid) => a[pid] === b[pid]);
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

function canonicalRateProtocolId(rawProtocolId: string): CanonicalProtocolId {
  const normalized = (rawProtocolId || "").trim().toLowerCase();
  const canonical = normalized === "aave" ? "aave_v3" : normalized;
  return canonical as CanonicalProtocolId;
}

export default function AgentManager({
  address,
  hasActiveSessionKey,
  allowedProtocols,
  allocationCaps,
}: AgentManagerProps) {
  const queryClient = useQueryClient();
  const { data: protocolRates } = useProtocolRates();
  const rateByProtocol = useMemo(() => {
    const map = new Map<CanonicalProtocolId, ProtocolRateResponse>();
    for (const row of protocolRates ?? []) {
      map.set(canonicalRateProtocolId(row.protocolId), row);
    }
    return map;
  }, [protocolRates]);

  const currentScope = useMemo(() => {
    const normalized = normalizeAllowedProtocols(allowedProtocols);
    return normalized.length > 0 ? normalized : [...CANONICAL_PROTOCOL_IDS];
  }, [allowedProtocols]);

  const currentCaps = useMemo(
    () => normalizeAllocationCaps(allocationCaps),
    [allocationCaps],
  );

  const [selectedProtocols, setSelectedProtocols] = useState<Set<CanonicalProtocolId>>(
    () => new Set(currentScope),
  );
  const [protocolCaps, setProtocolCaps] = useState<Record<CanonicalProtocolId, number>>(
    () => currentCaps,
  );
  const [editingCapProtocol, setEditingCapProtocol] = useState<CanonicalProtocolId | null>(null);
  const [pendingCapPct, setPendingCapPct] = useState<number>(100);
  const [saving, setSaving] = useState(false);

  const currentScopeKey = currentScope.join("|");
  const currentCapsKey = CANONICAL_PROTOCOL_IDS.map((pid) => currentCaps[pid]).join("|");

  useEffect(() => {
    setSelectedProtocols(new Set(currentScope));
    setProtocolCaps(currentCaps);
    setEditingCapProtocol(null);
  }, [currentScopeKey, currentScope, currentCapsKey, currentCaps]);

  const selectedOrdered = CANONICAL_PROTOCOL_IDS.filter((id) => selectedProtocols.has(id));
  const selectedCapTotal = selectedOrdered.reduce(
    (sum, pid) => sum + (protocolCaps[pid] ?? 100),
    0,
  );
  const selectedCoveragePct = Math.min(selectedCapTotal, 100);
  const hasDeployableSelectedMarket = selectedOrdered.some(
    (pid) => (protocolCaps[pid] ?? 100) > 0,
  );
  const scopeChanged = selectedOrdered.length > 0 && !isSameOrderedScope(selectedOrdered, currentScope);
  const capsChanged = !areCapsEqual(protocolCaps, currentCaps);
  const canSave = selectedOrdered.length > 0 && hasDeployableSelectedMarket && (scopeChanged || capsChanged);

  const toggleProtocol = (protocolId: CanonicalProtocolId, isEnabled: boolean) => {
    if (!isEnabled) return;
    setSelectedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(protocolId)) {
        if (next.size <= 1) return prev;
        next.delete(protocolId);
      } else {
        next.add(protocolId);
      }
      return next;
    });

    if (editingCapProtocol === protocolId && selectedProtocols.has(protocolId)) {
      setEditingCapProtocol(null);
    }
  };

  const openCapEditor = (protocolId: CanonicalProtocolId) => {
    if (!selectedProtocols.has(protocolId)) return;
    if (editingCapProtocol && editingCapProtocol !== protocolId) return;
    setEditingCapProtocol(protocolId);
    setPendingCapPct(protocolCaps[protocolId] ?? 100);
  };

  const cancelCapEdit = () => {
    setEditingCapProtocol(null);
  };

  const confirmCapEdit = () => {
    if (!editingCapProtocol) return;
    setProtocolCaps((prev) => ({
      ...prev,
      [editingCapProtocol]: pendingCapPct,
    }));
    setEditingCapProtocol(null);
  };

  const adjustPendingCap = (delta: number) => {
    setPendingCapPct((prev) => {
      const next = prev + (delta * 10);
      return Math.max(10, Math.min(100, next));
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
    if (!hasDeployableSelectedMarket) {
      toast.error("At least one selected market must have a cap above 0%.");
      return;
    }

    setSaving(true);
    try {
      if (scopeChanged) {
        await api.updateAllowedProtocols(address, selectedOrdered);
      }
      if (capsChanged) {
        await api.updateAllocationCaps(address, protocolCaps as Record<string, number>);
      }

      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["account-detail", address] }),
        queryClient.invalidateQueries({ queryKey: ["rebalance-status", address] }),
        queryClient.invalidateQueries({ queryKey: ["rebalance-history", address] }),
      ]);

      if (scopeChanged && capsChanged) {
        toast.success("Agent markets and max caps updated.");
      } else if (scopeChanged) {
        toast.success("Agent market scope updated.");
      } else {
        toast.success("Allocation caps updated.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update agent preferences";
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
          Control which markets your optimizer is allowed to use and set per-market max exposure caps.
          Changes sync to your active session-key scope in backend.
          To change on-chain signed permissions, re-grant session key from Settings.
          Risk score is out of 9 (higher is safer).
          Scores reflect SnowMind&apos;s independent assessment based on publicly available on-chain data and documentation.
          They are not endorsements or financial advice. Users should conduct their own research before making decisions.
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
            <span className="w-28 text-center text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Max Exposure</span>
            <span className="w-16 text-right text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">APY</span>
            <span className="w-20 text-right text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">TVL</span>
            <span className="w-20 text-center text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Active</span>
          </div>

          {MANAGED_PROTOCOLS.map((protocol, idx) => {
            const protocolId = protocol.id as CanonicalProtocolId;
            const isSelected = selectedProtocols.has(protocolId);
            const rateData = rateByProtocol.get(protocolId);
            const isEnabled = protocol.isActive;
            const apyLabel = rateData && rateData.currentApy > 0
              ? `${(rateData.currentApy * 100).toFixed(2)}%`
              : "-";
            const tvlLabel = formatTvl(rateData?.tvlUsd);
            const displayRiskScore = rateData && Number.isFinite(rateData.riskScore)
              ? Math.round(rateData.riskScore)
              : protocol.riskScore;
            const displayRiskScoreMax = rateData && Number.isFinite(rateData.riskScoreMax)
              ? Math.max(1, Math.round(rateData.riskScoreMax))
              : RISK_SCORE_MAX;
            const displayCap = protocolCaps[protocolId] ?? 100;
            const isEditingRow = editingCapProtocol === protocolId;

            return (
              <div
                key={protocol.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-3 transition-all cursor-pointer md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] md:items-center",
                  idx > 0 && "border-t border-[#E8E2DA]",
                  !isEnabled && "cursor-not-allowed opacity-55",
                  isSelected ? "bg-[#E84142]/[0.03]" : "bg-white opacity-60",
                  isEditingRow && "bg-[#FFF4F3] shadow-[inset_0_0_0_1px_rgba(232,65,66,0.35)]",
                  editingCapProtocol && !isEditingRow && "opacity-55",
                )}
                onClick={() => {
                  if (editingCapProtocol) return;
                  toggleProtocol(protocolId, isEnabled);
                }}
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
                      <span
                        className="rounded bg-[#111111]/5 px-1.5 py-0.5 text-[9px] font-mono text-[#5C5550]"
                        title="Risk score is out of 9. Higher is safer."
                      >
                        Risk {displayRiskScore}/{displayRiskScoreMax}
                      </span>
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

                <div className="hidden justify-center md:flex md:w-28">
                  {isEditingRow ? (
                    <div className="flex items-center gap-2 rounded-full border border-[#E84142]/25 bg-white px-2 py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          adjustPendingCap(-1);
                        }}
                        className="rounded-full p-1 text-[#5C5550] transition-colors hover:bg-[#E84142]/10 hover:text-[#E84142] disabled:opacity-40"
                        disabled={pendingCapPct <= 10}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-10 text-center font-mono text-xs font-semibold text-[#E84142]">
                        {pendingCapPct}%
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          adjustPendingCap(1);
                        }}
                        className="rounded-full p-1 text-[#5C5550] transition-colors hover:bg-[#E84142]/10 hover:text-[#E84142] disabled:opacity-40"
                        disabled={pendingCapPct >= 100}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-[#1A1715]">{displayCap}%</span>
                      {isSelected && isEnabled && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openCapEditor(protocolId);
                          }}
                          className="rounded-full p-1 text-[#8A837C] transition-colors hover:bg-[#1A1715]/5 hover:text-[#1A1715]"
                          title="Edit max exposure"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <span className="hidden w-16 text-right font-mono text-[11px] font-semibold text-[#059669] md:block">
                  {apyLabel}
                </span>

                <span className="hidden w-20 text-right font-mono text-[11px] text-[#5C5550] md:block">
                  {tvlLabel}
                </span>

                <div className="flex justify-center gap-1.5 md:w-20">
                  {isEditingRow ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelCapEdit();
                        }}
                        className="rounded-full bg-[#FEE2E2] p-1 text-[#B91C1C] transition-colors hover:bg-[#FECACA]"
                        title="Cancel"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmCapEdit();
                        }}
                        className="rounded-full bg-[#E84142] p-1 text-white transition-colors hover:bg-[#D63031]"
                        title="Apply"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleProtocol(protocolId, isEnabled);
                      }}
                      className={cn(
                        "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                        !isEnabled && "opacity-40",
                        isSelected ? "bg-[#E84142]" : "bg-[#E8E2DA]",
                      )}
                      disabled={!isEnabled || (editingCapProtocol !== null && !isEditingRow)}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          isSelected ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                  )}
                </div>

                <div className="col-span-2 flex items-center justify-between rounded-md bg-[#F8F4EF] px-2.5 py-2 md:hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-[#8A837C]">Max Exposure</span>
                    {isEditingRow ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            adjustPendingCap(-1);
                          }}
                          className="rounded-full bg-[#1A1715]/10 p-1 text-[#1A1715] disabled:opacity-40"
                          disabled={pendingCapPct <= 10}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="font-mono text-xs font-semibold text-[#E84142]">{pendingCapPct}%</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            adjustPendingCap(1);
                          }}
                          className="rounded-full bg-[#1A1715]/10 p-1 text-[#1A1715] disabled:opacity-40"
                          disabled={pendingCapPct >= 100}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono text-xs font-semibold text-[#1A1715]">{displayCap}%</span>
                    )}
                  </div>
                  {isEditingRow ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelCapEdit();
                        }}
                        className="rounded-full bg-[#FEE2E2] p-1 text-[#B91C1C]"
                        title="Cancel"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmCapEdit();
                        }}
                        className="rounded-full bg-[#E84142] p-1 text-white"
                        title="Apply"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : isSelected && isEnabled ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openCapEditor(protocolId);
                      }}
                      className="rounded-full p-1 text-[#8A837C] hover:bg-[#1A1715]/5"
                      disabled={editingCapProtocol !== null && !isEditingRow}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-lg bg-[#F5F0EB] px-3 py-2.5">
          <span className="text-xs text-[#8A837C]">Selected markets</span>
          <span className="font-mono text-sm font-semibold text-[#1A1715]">{selectedOrdered.length}</span>
        </div>

        <div className="rounded-lg border border-[#E8E2DA] bg-[#F8F4EF] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#8A837C]">Combined max-cap coverage</span>
            <span className="font-mono text-sm font-semibold text-[#1A1715]">{selectedCoveragePct}%</span>
          </div>
          {selectedCapTotal < 100 && (
            <p className="mt-1 text-[11px] text-[#B45309]">
              Combined caps across selected markets are below 100%; up to {100 - selectedCapTotal}% can remain idle.
            </p>
          )}
          {selectedCapTotal > 100 && (
            <p className="mt-1 text-[11px] text-[#8A837C]">
              Totals above 100% are expected because caps are per-market maximums, not fixed portfolio weights.
            </p>
          )}
          {!hasDeployableSelectedMarket && (
            <p className="mt-1 text-[11px] text-[#B91C1C]">
              All selected market caps are 0%. Increase at least one cap to allow deployment.
            </p>
          )}
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
              Saving Preferences...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Agent Preferences
            </>
          )}
        </button>
      </div>
    </div>
  );
}
