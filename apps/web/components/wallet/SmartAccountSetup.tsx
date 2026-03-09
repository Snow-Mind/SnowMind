"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, Loader2, AlertCircle, Snowflake, Shield, Zap, ExternalLink, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import NeuralSnowflake from "@/components/snow/NeuralSnowflake";
import { EXPLORER } from "@/lib/constants";
import { useState, useCallback } from "react";
import { toast } from "sonner";

type SetupStep = "idle" | "creating" | "ready" | "error";

export interface SetupTxHashes {
  deployment?: string | null;
  sessionKey?: string | null;
  approval?: string | null;
  registry?: string | null;
}

interface SmartAccountSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: SetupStep;
  address: string | null;
  error: string | null;
  onRetry: () => void;
  txHashes?: SetupTxHashes;
}

function TxLink({ label, hash }: { label: string; hash: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  const copyHash = useCallback(() => {
    if (!hash) return;
    navigator.clipboard.writeText(hash);
    setCopied(true);
    toast.success("Transaction hash copied");
    setTimeout(() => setCopied(false), 2000);
  }, [hash]);

  if (!hash) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2">
        <Loader2 className="h-3 w-3 animate-spin text-[#8A837C]" />
        <span className="text-xs text-[#8A837C]">{label}: pending…</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#059669]/20 bg-[#059669]/5 px-3 py-2">
      <Check className="h-3 w-3 shrink-0 text-[#059669]" />
      <span className="text-xs text-[#5C5550]">{label}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <button
          onClick={copyHash}
          className="font-mono text-[10px] text-[#E84142] hover:underline"
          title="Copy hash"
        >
          {hash.slice(0, 6)}…{hash.slice(-4)}
        </button>
        <button onClick={copyHash} className="text-[#8A837C] hover:text-[#1A1715]">
          {copied ? (
            <Check className="h-2.5 w-2.5 text-[#059669]" />
          ) : (
            <Copy className="h-2.5 w-2.5" />
          )}
        </button>
        <a
          href={EXPLORER.tx(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#E84142] hover:text-[#D63031]"
          title="View on Snowtrace"
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </span>
    </div>
  );
}

const stepConfig = {
  idle: {
    icon: Snowflake,
    title: "Setting Up Your Smart Account",
    description: "Preparing your account on Avalanche...",
  },
  creating: {
    icon: Loader2,
    title: "Creating Smart Account",
    description: "Building your ZeroDev Kernel v3.1 smart account on Avalanche. This may take a moment...",
  },
  ready: {
    icon: CheckCircle,
    title: "Account Ready!",
    description: "Your smart account is live on Avalanche. SnowMind can now optimize your yield.",
  },
  error: {
    icon: AlertCircle,
    title: "Setup Failed",
    description: "Something went wrong creating your smart account.",
  },
};

export default function SmartAccountSetup({
  open,
  onOpenChange,
  step,
  address,
  error,
  onRetry,
  txHashes,
}: SmartAccountSetupProps) {
  const config = stepConfig[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={step === "ready" || step === "error"}
        className="app-light border-[#E8E2DA] bg-[#FAFAF8] sm:max-w-md"
      >
        <DialogHeader className="text-center">
          <DialogTitle className="sr-only">{config.title}</DialogTitle>
          <DialogDescription className="sr-only">{config.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-4">
          {/* Animated snowflake icon */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3 }}
              className="relative"
            >
              {step === "creating" ? (
                <div className="relative h-20 w-20">
                  <NeuralSnowflake className="h-20 w-20 text-[#E84142]" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-3 w-3 rounded-full bg-[#E84142] animate-pulse" />
                  </div>
                </div>
              ) : step === "ready" ? (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#059669]/10">
                  <CheckCircle className="h-8 w-8 text-[#059669]" />
                </div>
              ) : step === "error" ? (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#DC2626]/10">
                  <AlertCircle className="h-8 w-8 text-[#DC2626]" />
                </div>
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E84142]/10">
                  <Snowflake className="h-8 w-8 text-[#E84142]" />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Title & description */}
          <div className="space-y-2 text-center">
            <h3 className="font-display text-lg font-semibold text-[#1A1715]">
              {config.title}
            </h3>
            <p className="text-sm text-[#5C5550] max-w-xs">
              {step === "error" && error ? error : config.description}
            </p>
          </div>

          {/* Ready state: show account address and features */}
          {step === "ready" && address && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full space-y-4"
            >
              {/* Address */}
              <div className="rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/40 px-4 py-3 text-center">
                <p className="text-xs text-[#8A837C] mb-1">Smart Account</p>
                <a
                  href={EXPLORER.address(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-[#E84142] hover:underline"
                >
                  {address.slice(0, 6)}...{address.slice(-4)}
                </a>
                <p className="mt-1 text-[10px] text-[#8A837C]">
                  View on Snowtrace ↗
                </p>
              </div>

              {/* Transaction confirmations */}
              {txHashes && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">
                    Setup Transactions
                  </p>
                  {txHashes.deployment !== undefined && (
                    <TxLink label="Account deployment" hash={txHashes.deployment} />
                  )}
                  {(txHashes.sessionKey !== undefined || txHashes.approval !== undefined || txHashes.registry !== undefined) && (
                    <>
                      <TxLink label="Session key grant" hash={txHashes.sessionKey} />
                      <TxLink label="USDC approval" hash={txHashes.approval} />
                      <TxLink label="Registry registration" hash={txHashes.registry} />
                    </>
                  )}
                </div>
              )}

              {/* Features */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2.5">
                  <Shield className="h-4 w-4 text-[#E84142] shrink-0" />
                  <span className="text-xs text-[#5C5550]">Non-custodial</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2.5">
                  <Zap className="h-4 w-4 text-[#059669] shrink-0" />
                  <span className="text-xs text-[#5C5550]">Gas sponsored</span>
                </div>
              </div>

              <Button
                onClick={() => onOpenChange(false)}
                className="w-full bg-[#E84142] text-white hover:bg-[#D63031]"
              >
                Go to Dashboard
              </Button>
            </motion.div>
          )}

          {/* Error state: show retry */}
          {step === "error" && (
            <Button onClick={onRetry} variant="outline" className="border-[#E84142]/30 text-[#E84142] hover:bg-[#E84142]/5">
              Try Again
            </Button>
          )}

          {/* Loading indicator */}
          {step === "creating" && (
            <div className="flex items-center gap-2 text-xs text-[#8A837C]">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Creating on Avalanche...</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
