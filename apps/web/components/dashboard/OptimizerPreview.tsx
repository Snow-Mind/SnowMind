"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Loader2, Info } from "lucide-react";
import { PROTOCOL_CONFIG, ACTIVE_PROTOCOLS } from "@/lib/constants";
import { formatPct } from "@/lib/format";
import { usePreviewOptimization } from "@/hooks/usePreviewOptimization";
import { usePortfolioStore } from "@/stores/portfolio.store";

export default function OptimizerPreview() {
  const [amount, setAmount] = useState("");
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const preview = usePreviewOptimization();

  async function handlePreview() {
    const val = parseFloat(amount);
    if (!val || val < 500 || !smartAccountAddress) return;
    preview.mutate({ address: smartAccountAddress });
  }

  const result = preview.data?.proposedAllocations ?? null;
  const weightedApy = result
    ? result.reduce((s, r) => s + r.apy * 100 * (r.proposedPct / 100), 0)
    : 0;

  return (
    <div className="crystal-card p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
          <Brain className="h-4 w-4 text-glacier" />
        </div>
        <div>
          <h2 className="text-sm font-medium text-arctic">
            Optimizer Preview
          </h2>
          <p className="text-xs text-muted-foreground">
            See how Snow Optimizer would allocate your deposit.
          </p>
        </div>
      </div>

      {/* Amount input */}
      <div className="mt-5">
        <label className="text-xs text-muted-foreground">
          Deposit Amount (USDC)
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            type="number"
            min={500}
            step={100}
            placeholder="e.g. 10000"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              preview.reset();
            }}
            className="flex-1 rounded-lg border border-border/50 bg-void-2/30 px-3 py-2 font-mono text-sm text-arctic placeholder:text-muted-foreground focus:border-glacier/40 focus:outline-none"
          />
          <button
            onClick={handlePreview}
            disabled={preview.isPending || !amount || parseFloat(amount) < 500 || !smartAccountAddress}
            className="rounded-lg bg-glacier/10 px-4 py-2 text-xs font-medium text-glacier transition-colors hover:bg-glacier/20 disabled:opacity-40"
          >
            {preview.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Preview"
            )}
          </button>
        </div>
        {amount && parseFloat(amount) < 5000 && parseFloat(amount) >= 500 && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-400">
            <Info className="h-3 w-3" />
            Minimum recommended: $5,000 for diversification
          </p>
        )}
        {preview.isError && (
          <p className="mt-1.5 text-[10px] text-crimson">
            {preview.error instanceof Error ? preview.error.message : "Preview failed"}
          </p>
        )}
      </div>

      {/* Results */}
      <AnimatePresence mode="wait">
        {result && result.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-5 space-y-3 overflow-hidden"
          >
            {/* Allocation bars */}
            {result.map((r) => {
              const meta =
                PROTOCOL_CONFIG[
                  r.protocolId as keyof typeof PROTOCOL_CONFIG
                ];
              return (
                <div key={r.protocolId}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-arctic">{meta?.name ?? r.protocolId}</span>
                    <span className="font-mono text-muted-foreground">
                      {r.proposedPct.toFixed(1)}% · {formatPct(r.apy * 100)} APY
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-void-2/50">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: meta?.color ?? "#8899AA" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${r.proposedPct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Summary row */}
            <div className="flex items-center justify-between border-t border-border/30 pt-3">
              <span className="text-xs text-muted-foreground">
                Weighted APY
              </span>
              <span className="font-mono text-sm font-bold text-mint">
                {formatPct(weightedApy)}
              </span>
            </div>

            {preview.data?.solveTimeMs != null && (
              <p className="text-[10px] text-muted-foreground">
                Solved in {preview.data.solveTimeMs}ms · 15% TVL cap per protocol ·{" "}
                {ACTIVE_PROTOCOLS.length} active protocols
              </p>
            )}
          </motion.div>
        )}

        {result && result.length === 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-xs text-muted-foreground"
          >
            Amount too low for diversified allocation. Minimum $5,000 recommended.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
