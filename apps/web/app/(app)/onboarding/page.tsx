"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Shield,
  Zap,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Sparkles,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";
import { EXPLORER } from "@/lib/constants";

// ── Component ───────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);

  const [isActivating, setIsActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [copied, setCopied] = useState(false);
  const activatedRef = useRef(false);

  // Auto-activate with moderate risk on mount
  useEffect(() => {
    if (!smartAccountAddress || activatedRef.current) return;
    activatedRef.current = true;

    (async () => {
      setIsActivating(true);
      try {
        await api.saveRiskProfile(smartAccountAddress, "moderate");
        setActivated(true);
      } catch {
        // Non-critical — agent still works with default settings
        setActivated(true);
      } finally {
        setIsActivating(false);
      }
    })();
  }, [smartAccountAddress]);

  const handleCopyAddress = () => {
    if (!smartAccountAddress) return;
    navigator.clipboard.writeText(smartAccountAddress);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGoToDashboard = () => {
    router.push("/dashboard");
  };

  // ── Render ────────────────────────────────────────────────

  if (isActivating) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#E84142]" />
        <p className="mt-4 text-sm text-[#5C5550]">Activating your AI agent…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#059669]/10">
            {activated ? (
              <CheckCircle2 className="h-6 w-6 text-[#059669]" />
            ) : (
              <Sparkles className="h-6 w-6 text-[#E84142]" />
            )}
          </div>
          <h1 className="font-display text-2xl font-semibold text-[#1A1715]">
            {activated ? "Agent Activated" : "Activate Your AI Agent"}
          </h1>
          <p className="mt-2 text-sm text-[#5C5550]">
            Fund your smart account with USDC to start earning optimized yield.
          </p>
        </div>

        {/* Smart account address card */}
        <div className="mb-6 rounded-xl border border-[#E84142]/20 bg-[#E84142]/[0.04] p-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#8A837C]">
            Your Smart Account
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate font-mono text-sm text-[#1A1715]">
              {smartAccountAddress}
            </code>
            <button
              onClick={handleCopyAddress}
              className="rounded-lg p-2 text-[#8A837C] transition-colors hover:bg-[#EDE8E3] hover:text-[#1A1715]"
            >
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-[#059669]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
            {smartAccountAddress && (
              <a
                href={EXPLORER.address(smartAccountAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-2 text-[#8A837C] transition-colors hover:bg-[#EDE8E3] hover:text-[#1A1715]"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        {/* Fund instructions */}
        <div className="mb-6 rounded-xl border border-[#E8E2DA] bg-[#FAFAF8] p-5">
          <p className="text-sm font-medium text-[#1A1715]">Fund your account</p>
          <p className="mt-1 text-[12px] text-[#5C5550]">
            Send USDC to your smart account address above. Once received, deploy it to Benqi from the dashboard to start earning yield.
          </p>
        </div>

        {/* Features */}
        <div className="mb-8 grid grid-cols-3 gap-3">
          {[
            { icon: Lock, label: "Non-custodial", desc: "You own your wallet" },
            { icon: Zap, label: "Gas sponsored", desc: "No gas fees for you" },
            { icon: Shield, label: "Audited protocols", desc: "Battle-tested only" },
          ].map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="rounded-lg border border-[#E8E2DA] bg-[#FAFAF8] p-3 text-center"
            >
              <Icon className="mx-auto h-4 w-4 text-[#E84142]" />
              <div className="mt-1.5 text-[11px] font-medium text-[#1A1715]">{label}</div>
              <div className="text-[10px] text-[#5C5550]">{desc}</div>
            </div>
          ))}
        </div>

        {/* Go to dashboard */}
        <button
          onClick={handleGoToDashboard}
          className="glacier-btn flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all"
        >
          Go to Dashboard
          <ArrowRight className="h-4 w-4" />
        </button>
      </motion.div>
    </div>
  );
}
