"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Zap,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  ChevronDown,
  Loader2,
  Sparkles,
  Lock,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import { api } from "@/lib/api-client";
import { formatPct } from "@/lib/format";
import { PROTOCOL_CONFIG, EXPLORER, type ProtocolId } from "@/lib/constants";

// ── Types ───────────────────────────────────────────────────

type OnboardingStep = "strategy" | "deposit" | "done";
type RiskLevel = "conservative" | "moderate" | "aggressive";

const RISK_META: Record<RiskLevel, { label: string; lambda: string; desc: string }> = {
  conservative: { label: "Conservative", lambda: "λ = 0.7", desc: "Prioritize safety over yield" },
  moderate:     { label: "Moderate",     lambda: "λ = 0.5", desc: "Balanced risk and reward" },
  aggressive:   { label: "Aggressive",   lambda: "λ = 0.3", desc: "Maximize yield, accept higher risk" },
};

// ── Component ───────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { data: rates } = useProtocolRates();

  const [step, setStep] = useState<OnboardingStep>("strategy");
  const [selectedProtocols, setSelectedProtocols] = useState<Set<ProtocolId>>(
    new Set(["aave_v3", "benqi"]),
  );
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("moderate");
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Map protocol rates by id
  const rateMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (rates) {
      for (const r of rates) {
        map[r.protocolId] = r.currentApy;
      }
    }
    return map;
  }, [rates]);

  const protocols = Object.values(PROTOCOL_CONFIG);

  const toggleProtocol = (id: ProtocolId) => {
    setSelectedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) {
          toast.error("You must select at least one protocol");
          return prev;
        }
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleActivate = async () => {
    if (!smartAccountAddress) {
      toast.error("Smart account not ready — please wait");
      return;
    }

    setIsSaving(true);
    try {
      await api.saveRiskProfile(smartAccountAddress, riskLevel);
      setStep("deposit");
    } catch {
      toast.error("Failed to save strategy — please try again");
    } finally {
      setIsSaving(false);
    }
  };

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

  return (
    <div className="mx-auto max-w-2xl py-6">
      {/* Progress dots */}
      <div className="mb-10 flex items-center justify-center gap-3">
        {(["strategy", "deposit", "done"] as OnboardingStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                step === s
                  ? "bg-glacier text-void shadow-[0_0_12px_rgba(0,196,255,0.4)]"
                  : i < (["strategy", "deposit", "done"] as OnboardingStep[]).indexOf(step)
                    ? "bg-glacier/20 text-glacier"
                    : "bg-white/5 text-slate-500"
              }`}
            >
              {i < (["strategy", "deposit", "done"] as OnboardingStep[]).indexOf(step) ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            {i < 2 && (
              <div
                className={`h-px w-10 ${
                  i < (["strategy", "deposit", "done"] as OnboardingStep[]).indexOf(step)
                    ? "bg-glacier/40"
                    : "bg-white/10"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Step 1: Strategy Selection ───────────────────── */}
        {step === "strategy" && (
          <motion.div
            key="strategy"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            <div className="mb-8 text-center">
              <h1 className="font-display text-2xl font-semibold text-arctic">
                Activate Your AI Agent
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Choose which protocols SnowMind will optimize across and set your risk preference.
              </p>
            </div>

            {/* Protocol cards */}
            <div className="mb-8 space-y-3">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Protocols
              </label>
              {protocols.map((p) => {
                const selected = selectedProtocols.has(p.id);
                const apy = rateMap[p.id];
                return (
                  <button
                    key={p.id}
                    onClick={() => !p.isComingSoon && toggleProtocol(p.id)}
                    disabled={p.isComingSoon}
                    className={`group relative flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all ${
                      p.isComingSoon
                        ? "cursor-not-allowed border-white/5 opacity-50"
                        : selected
                          ? "border-glacier/30 bg-glacier/[0.06]"
                          : "border-white/5 bg-white/[0.02] hover:border-white/10"
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                        selected
                          ? "border-glacier bg-glacier text-void"
                          : "border-white/20 bg-white/5"
                      }`}
                    >
                      {selected && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-arctic">{p.name}</span>
                        {p.isComingSoon && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">
                            Coming Soon
                          </span>
                        )}
                        <span
                          className="ml-auto rounded-full px-2 py-0.5 text-[10px]"
                          style={{ backgroundColor: p.bgColor, color: p.color }}
                        >
                          Risk {p.riskScore}/10
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{p.description}</p>
                    </div>

                    {/* Live APY */}
                    <div className="text-right">
                      <div className="text-sm font-semibold text-mint">
                        {apy !== undefined ? formatPct(apy * 100) : "—"}
                      </div>
                      <div className="text-[10px] text-slate-500">APY</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Risk tolerance */}
            <div className="mb-8">
              <label className="mb-3 block text-xs font-medium uppercase tracking-wider text-slate-500">
                Risk Preference
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(RISK_META) as [RiskLevel, typeof RISK_META[RiskLevel]][]).map(
                  ([key, meta]) => (
                    <button
                      key={key}
                      onClick={() => setRiskLevel(key)}
                      className={`rounded-lg border p-3 text-center transition-all ${
                        riskLevel === key
                          ? "border-glacier/30 bg-glacier/[0.06]"
                          : "border-white/5 bg-white/[0.02] hover:border-white/10"
                      }`}
                    >
                      <div className="text-xs font-semibold text-arctic">{meta.label}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-glacier">{meta.lambda}</div>
                      <div className="mt-1 text-[10px] text-slate-500">{meta.desc}</div>
                    </button>
                  ),
                )}
              </div>
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
                  className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center"
                >
                  <Icon className="mx-auto h-4 w-4 text-glacier" />
                  <div className="mt-1.5 text-[11px] font-medium text-arctic">{label}</div>
                  <div className="text-[10px] text-slate-500">{desc}</div>
                </div>
              ))}
            </div>

            {/* Activate CTA */}
            <button
              onClick={handleActivate}
              disabled={isSaving || selectedProtocols.size === 0}
              className="glacier-btn flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-void transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Activate Agent
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </motion.div>
        )}

        {/* ── Step 2: Deposit ──────────────────────────────── */}
        {step === "deposit" && (
          <motion.div
            key="deposit"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-mint/10">
                <CheckCircle2 className="h-6 w-6 text-mint" />
              </div>
              <h1 className="font-display text-2xl font-semibold text-arctic">
                Agent Activated
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Fund your smart account with USDC to start earning optimized yield.
              </p>
            </div>

            {/* Smart account address card */}
            <div className="mb-6 rounded-xl border border-glacier/20 bg-glacier/[0.04] p-5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Your Smart Account
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-sm text-arctic">
                  {smartAccountAddress}
                </code>
                <button
                  onClick={handleCopyAddress}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-arctic"
                >
                  {copied ? (
                    <CheckCircle2 className="h-4 w-4 text-mint" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                {smartAccountAddress && (
                  <a
                    href={EXPLORER.address(smartAccountAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-arctic"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>

            {/* How to deposit */}
            <div className="mb-6 rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
                How to Deposit
              </div>
              <ol className="space-y-3">
                {[
                  "Send USDC to your smart account address above",
                  "SnowMind's AI agent will automatically allocate your funds",
                  "Sit back and watch your yield compound 24/7",
                ].map((text, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-glacier/10 text-[10px] font-bold text-glacier">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-300">{text}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Selected strategy recap */}
            <div className="mb-8 rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
                Your Strategy
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-sm text-arctic">
                    {RISK_META[riskLevel].label} · {RISK_META[riskLevel].lambda}
                  </div>
                  <div className="text-xs text-slate-500">
                    {Array.from(selectedProtocols)
                      .map((id) => PROTOCOL_CONFIG[id].name)
                      .join(" + ")}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1 text-mint">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-sm font-semibold">
                    {(() => {
                      const apys = Array.from(selectedProtocols)
                        .map((id) => rateMap[id])
                        .filter((a): a is number => a !== undefined);
                      if (apys.length === 0) return "—";
                      const avg = apys.reduce((s, a) => s + a, 0) / apys.length;
                      return formatPct(avg * 100);
                    })()}
                  </span>
                  <span className="text-xs text-slate-500">avg APY</span>
                </div>
              </div>
            </div>

            {/* Go to dashboard */}
            <button
              onClick={handleGoToDashboard}
              className="glacier-btn flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-void transition-all"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              onClick={() => setStep("strategy")}
              className="mt-3 w-full rounded-xl border border-white/5 py-3 text-sm text-slate-400 transition-colors hover:border-white/10 hover:text-slate-300"
            >
              Back to Strategy
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
