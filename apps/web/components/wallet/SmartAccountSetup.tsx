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
      <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-void-2/20 px-3 py-2">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}: pending…</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-mint/20 bg-mint/5 px-3 py-2">
      <Check className="h-3 w-3 shrink-0 text-mint" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <button
          onClick={copyHash}
          className="font-mono text-[10px] text-glacier hover:underline"
          title="Copy hash"
        >
          {hash.slice(0, 6)}…{hash.slice(-4)}
        </button>
        <button onClick={copyHash} className="text-muted-foreground hover:text-arctic">
          {copied ? (
            <Check className="h-2.5 w-2.5 text-mint" />
          ) : (
            <Copy className="h-2.5 w-2.5" />
          )}
        </button>
        <a
          href={EXPLORER.tx(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-glacier hover:text-glacier/80"
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
        className="border-border-frost bg-void-2/95 backdrop-blur-2xl sm:max-w-md"
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
                  <NeuralSnowflake className="h-20 w-20 text-glacier" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-3 w-3 rounded-full bg-glacier animate-pulse" />
                  </div>
                </div>
              ) : step === "ready" ? (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-mint/10">
                  <CheckCircle className="h-8 w-8 text-mint" />
                </div>
              ) : step === "error" ? (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-crimson/10">
                  <AlertCircle className="h-8 w-8 text-crimson" />
                </div>
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-glacier/10">
                  <Snowflake className="h-8 w-8 text-glacier" />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Title & description */}
          <div className="space-y-2 text-center">
            <h3 className="font-display text-lg font-semibold text-arctic">
              {config.title}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs">
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
              <div className="rounded-lg border border-border-frost bg-ice-10 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Smart Account</p>
                <a
                  href={EXPLORER.address(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-glacier hover:underline"
                >
                  {address.slice(0, 6)}...{address.slice(-4)}
                </a>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  View on Snowtrace ↗
                </p>
              </div>

              {/* Transaction confirmations */}
              {txHashes && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-ice-20 px-3 py-2.5">
                  <Shield className="h-4 w-4 text-glacier shrink-0" />
                  <span className="text-xs text-muted-foreground">Non-custodial</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-ice-20 px-3 py-2.5">
                  <Zap className="h-4 w-4 text-mint shrink-0" />
                  <span className="text-xs text-muted-foreground">Gas sponsored</span>
                </div>
              </div>

              <Button
                onClick={() => onOpenChange(false)}
                className="w-full bg-gradient-to-r from-glacier to-frost text-white hover:opacity-90"
              >
                Go to Dashboard
              </Button>
            </motion.div>
          )}

          {/* Error state: show retry */}
          {step === "error" && (
            <Button onClick={onRetry} variant="outline" className="border-glacier/30">
              Try Again
            </Button>
          )}

          {/* Loading indicator */}
          {step === "creating" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Creating on Avalanche...</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
