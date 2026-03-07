"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Zap,
  Wallet,
  Loader2,
} from "lucide-react";
import { CONTRACTS, EXPLORER, PROTOCOL_CONFIG } from "@/lib/constants";
import { api } from "@/lib/api-client";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { toast } from "sonner";

type WithdrawPath = "snowmind" | "direct" | null;

export default function EmergencyPanel() {
  const [expanded, setExpanded] = useState(false);
  const [activePath, setActivePath] = useState<WithdrawPath>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);

  async function handleWithdrawAll() {
    if (!smartAccountAddress) return;
    setWithdrawing(true);
    try {
      await api.withdrawAll(smartAccountAddress);
      toast.success("Withdrawal initiated — USDC returning to your smart account");
    } catch {
      toast.error("Withdrawal failed. Try the direct EOA path.");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="crystal-card border-crimson/20 p-6">
      {/* Header — click to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-crimson/30 bg-crimson/10">
            <ShieldAlert className="h-4 w-4 text-crimson" />
          </div>
          <div className="text-left">
            <h2 className="text-sm font-medium text-arctic">
              Emergency Withdrawal
            </h2>
            <p className="text-xs text-muted-foreground">
              Two independent paths to recover your funds.
            </p>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Warning */}
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200/80">
                Your funds are always in <strong>your</strong> smart account.
                SnowMind never has custody. These paths let you withdraw even if
                our backend is offline.
              </p>
            </div>

            {/* Two paths */}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {/* Path 1: SnowMind API */}
              <button
                onClick={() =>
                  setActivePath(activePath === "snowmind" ? null : "snowmind")
                }
                className={`rounded-xl border p-4 text-left transition-all ${
                  activePath === "snowmind"
                    ? "border-glacier/40 bg-glacier/5"
                    : "border-border/50 bg-void-2/30 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-glacier" />
                  <span className="text-sm font-medium text-arctic">
                    Via SnowMind
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  One-click withdrawal via our API. Redeems all protocol
                  positions back to USDC in your smart account.
                </p>
                <span className="mt-3 inline-block rounded-full border border-mint/30 bg-mint/10 px-2 py-0.5 text-[10px] text-mint">
                  Recommended
                </span>
              </button>

              {/* Path 2: Direct EOA */}
              <button
                onClick={() =>
                  setActivePath(activePath === "direct" ? null : "direct")
                }
                className={`rounded-xl border p-4 text-left transition-all ${
                  activePath === "direct"
                    ? "border-glacier/40 bg-glacier/5"
                    : "border-border/50 bg-void-2/30 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-frost" />
                  <span className="text-sm font-medium text-arctic">
                    Direct from EOA
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Call protocol contracts directly as the smart account owner.
                  Works even if SnowMind is fully down.
                </p>
                <span className="mt-3 inline-block rounded-full border border-frost/30 bg-frost/10 px-2 py-0.5 text-[10px] text-frost">
                  Self-sovereign
                </span>
              </button>
            </div>

            {/* Path details */}
            <AnimatePresence mode="wait">
              {activePath === "snowmind" && (
                <motion.div
                  key="snowmind"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 space-y-3 rounded-lg border border-border/50 bg-void-2/20 p-4"
                >
                  <h3 className="text-xs font-medium text-arctic">
                    How it works:
                  </h3>
                  <ol className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">1.</span>
                      Click &quot;Withdraw All&quot; below
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">2.</span>
                      SnowMind builds UserOperations to redeem all positions
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">3.</span>
                      USDC returns to your smart account
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">4.</span>
                      Transfer USDC from smart account to your EOA wallet
                    </li>
                  </ol>
                  <button
                    onClick={handleWithdrawAll}
                    disabled={withdrawing || !smartAccountAddress}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-crimson/80 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-crimson disabled:opacity-50"
                  >
                    {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {withdrawing ? "Withdrawing…" : "Withdraw All Funds"}
                  </button>
                </motion.div>
              )}

              {activePath === "direct" && (
                <motion.div
                  key="direct"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 space-y-3 rounded-lg border border-border/50 bg-void-2/20 p-4"
                >
                  <h3 className="text-xs font-medium text-arctic">
                    Manual withdrawal steps:
                  </h3>
                  <ol className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">1.</span>
                      Connect your EOA wallet to Snowtrace or a block explorer
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">2.</span>
                      <span>
                        Call <code className="text-arctic">redeem()</code> on
                        Benqi ({PROTOCOL_CONFIG.benqi.shortName})
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">3.</span>
                      <span>
                        Call <code className="text-arctic">withdraw()</code> on
                        Aave V3 Pool
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">4.</span>
                      Funds are returned to your smart account as USDC
                    </li>
                  </ol>

                  <div className="mt-3 space-y-2">
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Contract Links
                    </h4>
                    {[
                      { label: "Benqi Pool", addr: CONTRACTS.BENQI_POOL },
                      { label: "Aave V3 Pool", addr: CONTRACTS.AAVE_POOL },
                      { label: "USDC Token", addr: CONTRACTS.USDC },
                    ].map((c) => (
                      <a
                        key={c.label}
                        href={EXPLORER.contract(c.addr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-lg border border-border/30 bg-void-2/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-glacier/30 hover:text-arctic"
                      >
                        <span>{c.label}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px]">
                            {c.addr.slice(0, 6)}...{c.addr.slice(-4)}
                          </span>
                          <ExternalLink className="h-3 w-3" />
                        </div>
                      </a>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
