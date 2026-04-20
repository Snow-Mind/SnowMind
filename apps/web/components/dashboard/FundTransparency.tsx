"use client";

import Image from "next/image";
import {
  ExternalLink,
  Shield,
  Eye,
  Lock,
  Wallet,
  ArrowUpRight,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { EXPLORER, PROTOCOL_CONFIG, CONTRACTS, type ProtocolId } from "@/lib/constants";
import { formatPct, formatUsd, formatUsdExact } from "@/lib/format";
import { toast } from "sonner";
import type { Portfolio } from "@snowmind/shared-types";
import type { SessionKeyStatusResponse } from "@snowmind/shared-types";

interface FundTransparencyProps {
  portfolio: Portfolio | null;
  smartAccountAddress: string | null;
  eoaAddress: string | null;
  sessionKey: SessionKeyStatusResponse | null;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("Copied to clipboard");
}

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function AddressRow({
  label,
  address,
  showExplorer = true,
}: {
  label: string;
  address: string;
  showExplorer?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-[#8A837C]">{label}</span>
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs text-[#1A1715]">
          {truncateAddr(address)}
        </code>
        <button
          onClick={() => copyToClipboard(address)}
          className="text-[#8A837C] hover:text-[#1A1715] transition-colors"
          title="Copy address"
        >
          <Copy className="h-3 w-3" />
        </button>
        {showExplorer && (
          <a
            href={EXPLORER.address(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8A837C] hover:text-[#E84142] transition-colors"
            title="View on Snowtrace"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function FundTransparency({
  portfolio,
  smartAccountAddress,
  eoaAddress,
  sessionKey,
}: FundTransparencyProps) {
  const totalValue = portfolio
    ? Number(portfolio.totalDepositedUsd) + Number(portfolio.totalYieldUsd)
    : 0;
  const totalYield = portfolio ? Number(portfolio.totalYieldUsd) : 0;
  const allocations = portfolio?.allocations ?? [];
  const totalAllocatedUsdc = allocations.reduce(
    (sum, allocation) => sum + Number(allocation.amountUsdc),
    0,
  );

  const formatAllocationPct = (amountUsdc: number) => {
    if (totalAllocatedUsdc <= 0) return "0.0%";
    const pct = (amountUsdc / totalAllocatedUsdc) * 100;
    if (pct >= 10) return formatPct(pct, 1);
    if (pct >= 1) return formatPct(pct, 2);
    return formatPct(pct, 3);
  };

  // Protocol breakdown with on-chain links
  const protocolAllocations = allocations.filter(
    (a) => a.protocolId !== "idle" && Number(a.amountUsdc) > 0,
  );
  const idleBalance = allocations.find((a) => a.protocolId === "idle");

  // Session key expiry
  const expiresAt = sessionKey?.expiresAt
    ? new Date(sessionKey.expiresAt)
    : null;
  const isSessionActive = sessionKey?.isActive ?? false;

  return (
    <div className="space-y-4">
      {/* Fund Safety Status */}
      <div className="rounded-xl border border-[#059669]/20 bg-[#059669]/[0.04] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#059669]/10">
              <Shield className="h-4 w-4 text-[#059669]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#1A1715]">
                Funds Secure
              </p>
              <p className="text-[10px] text-[#8A837C]">
                All assets are on-chain and verifiable
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-[#059669]" />
            <span className="text-xs font-medium text-[#059669]">
              Non-custodial
            </span>
          </div>
        </div>
      </div>

      {/* Your Accounts */}
      <div className="rounded-xl border border-[#E8E2DA] bg-white p-4">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#8A837C]">
          <Wallet className="h-3.5 w-3.5" />
          Your Accounts
        </h3>
        <div className="mt-3 divide-y divide-[#E8E2DA]">
          {smartAccountAddress && (
            <AddressRow
              label="Smart Account (your vault)"
              address={smartAccountAddress}
            />
          )}
          {eoaAddress && (
            <AddressRow label="Owner Wallet (EOA)" address={eoaAddress} />
          )}
        </div>
      </div>

      {/* Where Your Funds Are */}
      <div className="rounded-xl border border-[#E8E2DA] bg-white p-4">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#8A837C]">
          <Eye className="h-3.5 w-3.5" />
          Where Your Funds Are
        </h3>
        <div className="mt-3 space-y-2">
          {protocolAllocations.length > 0 ? (
            protocolAllocations.map((alloc) => {
              const cfg =
                PROTOCOL_CONFIG[alloc.protocolId as ProtocolId];
              const amount = Number(alloc.amountUsdc);
              const allocationPct = formatAllocationPct(amount);
              return (
                <div
                  key={alloc.protocolId}
                  className="flex items-center justify-between rounded-lg border border-[#E8E2DA] bg-[#F5F0EB]/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    {cfg ? (
                      <Image
                        src={cfg.logoPath}
                        alt={cfg.name}
                        width={18}
                        height={18}
                        className="rounded-full"
                      />
                    ) : (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full bg-[#8899AA]"
                      />
                    )}
                    <span className="text-xs font-medium text-[#1A1715]">
                      {alloc.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-medium text-[#1A1715]">
                      {formatUsd(amount)} ({allocationPct})
                    </span>
                    {cfg && (
                      <a
                        href={EXPLORER.address(cfg.contractAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-0.5 rounded border border-[#E8E2DA] px-1.5 py-0.5 text-[10px] text-[#8A837C] transition-colors hover:border-[#E84142]/30 hover:text-[#E84142]"
                        title={`Verify on Snowtrace: ${cfg.contractAddress}`}
                      >
                        Verify
                        <ArrowUpRight className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-[#8A837C]">
              No protocol deployments yet.
            </p>
          )}

          {idleBalance && Number(idleBalance.amountUsdc) > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-[#E8E2DA] bg-[#F5F0EB]/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#64748B]" />
                <span className="text-xs font-medium text-[#1A1715]">
                  Idle USDC (in wallet)
                </span>
              </div>
              <span className="font-mono text-xs font-medium text-[#1A1715]">
                {formatUsd(Number(idleBalance.amountUsdc))} ({formatAllocationPct(Number(idleBalance.amountUsdc))})
              </span>
            </div>
          )}

          {/* Total */}
          {totalValue > 0 && (
            <div className="flex items-center justify-between border-t border-[#E8E2DA] pt-2">
              <span className="text-xs font-medium text-[#1A1715]">
                Total Value
              </span>
              <div className="text-right">
                <span className="font-mono text-sm font-bold text-[#1A1715]">
                  {formatUsd(totalValue)}
                </span>
                {totalYield > 0 && (
                  <span className="ml-2 text-[10px] font-medium text-[#059669]">
                    +{formatUsdExact(totalYield, { maxFractionDigits: 12 })} earned
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Protocol Contracts (for verification) */}
      <div className="rounded-xl border border-[#E8E2DA] bg-white p-4">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#8A837C]">
          <Lock className="h-3.5 w-3.5" />
          Protocol Contracts
        </h3>
        <p className="mt-1 text-[10px] text-[#B8B0A8]">
          Verify the smart contracts your funds interact with.
        </p>
        <div className="mt-3 divide-y divide-[#E8E2DA]">
          {Object.values(PROTOCOL_CONFIG).map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2">
                <Image
                  src={cfg.logoPath}
                  alt={cfg.name}
                  width={16}
                  height={16}
                  className="rounded-full"
                />
                <span className="text-xs text-[#5C5550]">{cfg.name}</span>
                <span className="rounded border border-[#E8E2DA] px-1 py-0.5 text-[9px] text-[#8A837C]">
                  {cfg.auditBadge}
                </span>
              </div>
              <a
                href={EXPLORER.contract(cfg.contractAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-[10px] text-[#8A837C] transition-colors hover:text-[#E84142]"
              >
                {truncateAddr(cfg.contractAddress)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          ))}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[#E84142]" />
              <span className="text-xs text-[#5C5550]">USDC Token</span>
            </div>
            <a
              href={EXPLORER.contract(CONTRACTS.USDC)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono text-[10px] text-[#8A837C] transition-colors hover:text-[#E84142]"
            >
              {truncateAddr(CONTRACTS.USDC)}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Agent Permission Status */}
      {isSessionActive && expiresAt && (
        <div className="rounded-xl border border-[#E8E2DA] bg-white p-4">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#8A837C]">
            <Lock className="h-3.5 w-3.5" />
            Agent Session
          </h3>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#8A837C]">Status</span>
              <span className="flex items-center gap-1 font-medium text-[#059669]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#059669]" />
                Active
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8A837C]">Expires</span>
              <span className="font-mono text-[#5C5550]">
                {expiresAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8A837C]">Protocols</span>
              <span className="text-[#5C5550]">
                {sessionKey?.allowedProtocols?.join(", ") ?? "—"}
              </span>
            </div>
            {sessionKey?.keyAddress && (
              <div className="flex items-center justify-between">
                <span className="text-[#8A837C]">Key address</span>
                <a
                  href={EXPLORER.address(sessionKey.keyAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-mono text-[10px] text-[#8A837C] hover:text-[#E84142]"
                >
                  {truncateAddr(sessionKey.keyAddress)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
