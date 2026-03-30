"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Copy,
} from "lucide-react";
import { usePreviewOptimization } from "@/hooks/usePreviewOptimization";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { PROTOCOL_CONFIG, EXPLORER, CONTRACTS, type ProtocolId } from "@/lib/constants";
import { formatUsd, formatPct } from "@/lib/format";
import { toast } from "sonner";
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";

type Step = "input" | "preview" | "depositing" | "done";

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
}

const erc20TransferAbi = [
  {
    name: "transfer",
    type: "function" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ name: "", type: "bool" as const }],
    stateMutability: "nonpayable" as const,
  },
] as const;

export default function DepositModal({ open, onClose }: DepositModalProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const preview = usePreviewOptimization();

  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const copyTxHash = useCallback(() => {
    if (!depositTxHash) return;
    navigator.clipboard.writeText(depositTxHash);
    toast.success("Transaction hash copied");
  }, [depositTxHash]);

  const numAmount = parseFloat(amount) || 0;
  const isValid = numAmount >= 1;

  function handlePreview() {
    if (!smartAccountAddress || !isValid) return;
    preview.mutate(
      { address: smartAccountAddress },
      { onSuccess: () => setStep("preview") }
    );
  }

  async function handleDeposit() {
    if (!smartAccountAddress) return;
    setStep("depositing");
    setDepositError(null);

    try {
      // Real ERC-20 USDC transfer from EOA to the user's Smart Account
      const amountWei = parseUnits(amount, 6); // USDC has 6 decimals

      const txHash = await writeContractAsync({
        address: CONTRACTS.USDC,
        abi: erc20TransferAbi,
        functionName: "transfer",
        args: [smartAccountAddress as `0x${string}`, amountWei],
      });

      setDepositTxHash(txHash);
      setStep("done");
      toast.success("Deposit successful — funds sent to your smart account");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      setDepositError(message);
      setStep("preview"); // go back to preview so user can retry
      toast.error("Deposit failed: " + message);
    }
  }

  function handleClose() {
    setStep("input");
    setAmount("");
    setDepositTxHash(null);
    setDepositError(null);
    preview.reset();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="crystal-card relative w-full max-w-md p-6"
      >
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-arctic"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-semibold text-arctic">Deposit USDC</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Funds go to your smart account and are allocated by the optimizer.
        </p>

        <AnimatePresence mode="wait">
          {/* Step: Input */}
          {step === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 space-y-4"
            >
              <div>
                <label className="text-xs text-muted-foreground">
                  Amount (USDC)
                </label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  className="mt-1 w-full rounded-lg border border-border/50 bg-void-2/40 px-4 py-3 font-mono text-lg text-arctic outline-none focus:border-glacier/50"
                />
                {amount && !isValid && (
                  <p className="mt-1 text-[10px] text-crimson">
                    Minimum deposit is $1
                  </p>
                )}
              </div>

              {isValid && (
                <p className="text-xs text-muted-foreground">
                  Est. daily yield:{" "}
                  <span className="font-mono text-mint">
                    ~{formatUsd((numAmount * 0.04) / 365)}
                  </span>
                </p>
              )}

              <button
                onClick={handlePreview}
                disabled={!isValid || preview.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-glacier to-frost px-4 py-3 text-sm font-medium text-white transition-opacity disabled:opacity-50"
              >
                {preview.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running Optimizer…
                  </>
                ) : (
                  <>
                    Preview Allocation
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              {preview.isError && (
                <p className="flex items-center gap-1 text-xs text-crimson">
                  <AlertCircle className="h-3 w-3" />
                  Failed to compute allocation preview
                </p>
              )}
            </motion.div>
          )}

          {/* Step: Preview */}
          {step === "preview" && preview.data && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="mt-6 space-y-4"
            >
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Proposed Split
              </h3>
              <div className="space-y-2">
                {preview.data.proposedAllocations.map((a) => {
                  const cfg =
                    PROTOCOL_CONFIG[a.protocolId as ProtocolId];
                  return (
                    <div
                      key={a.protocolId}
                      className="flex items-center justify-between rounded-lg border border-border/30 bg-void-2/20 px-3 py-2.5"
                    >
                      <span
                        className="text-sm font-medium"
                        style={{ color: cfg?.color }}
                      >
                        {cfg?.shortName ?? a.protocolId}
                      </span>
                      <div className="text-right">
                        <span className="font-mono text-sm text-arctic">
                          {formatPct(a.proposedPct * 100)}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({formatUsd(Number(a.proposedAmountUsd))})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Expected APY</span>
                <span className="font-mono text-mint">
                  {formatPct(preview.data.expectedApy * 100)}
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("input")}
                  className="flex-1 rounded-lg border border-border/50 px-4 py-2.5 text-sm text-muted-foreground hover:text-arctic"
                >
                  Back
                </button>
                <button
                  onClick={handleDeposit}
                  disabled={isWriting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-glacier to-frost px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isWriting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing…
                    </>
                  ) : (
                    <>
                      Confirm Deposit
                      <Check className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>

              {depositError && (
                <p className="flex items-center gap-1 text-xs text-crimson">
                  <AlertCircle className="h-3 w-3" />
                  {depositError}
                </p>
              )}
            </motion.div>
          )}

          {/* Step: Depositing */}
          {step === "depositing" && (
            <motion.div
              key="depositing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 flex flex-col items-center gap-4 py-8"
            >
              <Loader2 className="h-8 w-8 animate-spin text-glacier" />
              <div className="text-center">
                <p className="text-sm font-medium text-arctic">
                  Processing Deposit
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approving USDC → Depositing → Allocating…
                </p>
              </div>
            </motion.div>
          )}

          {/* Step: Done */}
          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 space-y-4"
            >
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mint/20">
                  <Check className="h-6 w-6 text-mint" />
                </div>
                <p className="text-sm font-medium text-arctic">
                  Deposited to {preview.data?.proposedAllocations[0]
                    ? PROTOCOL_CONFIG[preview.data.proposedAllocations[0].protocolId as ProtocolId]?.name ?? "Protocol"
                    : "Protocol"}
                </p>
              </div>

              {/* Transaction details */}
              {depositTxHash && (
                <div className="rounded-lg border border-border/40 bg-void-2/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Transaction</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-glacier">
                        {depositTxHash.slice(0, 6)}…{depositTxHash.slice(-4)}
                      </span>
                      <button onClick={copyTxHash} className="text-muted-foreground hover:text-arctic">
                        <Copy className="h-3 w-3" />
                      </button>
                      <a
                        href={EXPLORER.tx(depositTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-xs text-glacier hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Deposit summary */}
              <div className="space-y-2 rounded-lg border border-border/40 bg-void-2/30 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Amount deposited</span>
                  <span className="font-mono text-arctic">{formatUsd(numAmount)} USDC</span>
                </div>
                {preview.data && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Current APY</span>
                      <span className="font-mono text-mint">{formatPct(preview.data.expectedApy * 100)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Est. daily earnings</span>
                      <span className="font-mono text-mint">
                        ~{formatUsd((numAmount * preview.data.expectedApy) / 365)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <p className="text-center text-[10px] text-muted-foreground">
                This transaction is publicly verifiable on Avalanche
              </p>

              <button
                onClick={handleClose}
                className="w-full rounded-lg bg-glacier/10 px-6 py-2.5 text-sm font-medium text-glacier hover:bg-glacier/20"
              >
                Done
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
