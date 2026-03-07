"use client";

import { useState } from "react";
import { Bell, Sliders, Wallet, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { EXPLORER, CHAIN } from "@/lib/constants";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import SessionKeyStatus from "@/components/dashboard/SessionKeyStatus";
import EmergencyPanel from "@/components/dashboard/EmergencyPanel";
import { usePortfolioStore } from "@/stores/portfolio.store";

type RiskTolerance = "conservative" | "moderate" | "aggressive";

const RISK_PROFILES = [
  {
    id: "conservative" as RiskTolerance,
    label: "Conservative",
    description:
      "Lower returns, maximum safety. Prefers established protocols with longest track record.",
    lambda: "High risk aversion (λ = 0.8)",
  },
  {
    id: "moderate" as RiskTolerance,
    label: "Moderate",
    description:
      "Balanced approach. Optimizes for risk-adjusted yield across diversified positions.",
    lambda: "Balanced (λ = 0.5)",
  },
  {
    id: "aggressive" as RiskTolerance,
    label: "Aggressive",
    description:
      "Maximizes raw yield. Accepts higher concentration in top-yielding protocols.",
    lambda: "Low risk aversion (λ = 0.2)",
  },
] as const;

function truncateAddress(addr: string | null | undefined): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: [0.4, 0, 0.2, 1] as const },
  }),
};

export default function SettingsPage() {
  const { eoaAddress, activeWallet } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const [activeRisk, setActiveRisk] = useState<RiskTolerance>("moderate");
  const [savingRisk, setSavingRisk] = useState(false);

  async function handleRiskChange(profile: RiskTolerance) {
    if (profile === activeRisk || !smartAccountAddress) return;
    setSavingRisk(true);
    try {
      await api.saveRiskProfile(smartAccountAddress, profile);
      setActiveRisk(profile);
      toast.success(`Risk profile updated to ${profile}`);
    } catch {
      toast.error("Failed to update risk profile");
    } finally {
      setSavingRisk(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-arctic">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Configure your optimization strategy and account preferences.
        </p>
      </div>

      {/* Risk Strategy */}
      <motion.div
        className="crystal-card p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.04] bg-void-2">
            <Sliders className="h-3.5 w-3.5 text-glacier" />
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-arctic">
              Risk Strategy
            </h2>
            <p className="text-[11px] text-slate-500">
              Controls the risk aversion parameter (λ) in the MILP optimizer.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {RISK_PROFILES.map((profile) => (
            <button
              key={profile.id}
              onClick={() => handleRiskChange(profile.id)}
              disabled={savingRisk}
              className={`rounded-xl border p-4 text-left transition-all disabled:opacity-60 ${
                activeRisk === profile.id
                  ? "border-glacier/30 bg-glacier/[0.06] shadow-glow-sm"
                  : "border-white/[0.04] bg-void-2/30 hover:border-white/[0.08] hover:bg-void-2/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-medium text-arctic">
                  {profile.label}
                </h3>
                {activeRisk === profile.id && (
                  <span className="inline-block h-2 w-2 rounded-full bg-glacier" />
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {profile.description}
              </p>
              <p className="mt-2.5 font-mono text-[11px] text-glacier/60">
                {profile.lambda}
              </p>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Session Key */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={1}
      >
        <SessionKeyStatus />
      </motion.div>

      {/* Notifications */}
      <motion.div
        className="crystal-card p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={2}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.04] bg-void-2">
            <Bell className="h-3.5 w-3.5 text-glacier" />
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-arctic">
              Notifications
            </h2>
            <p className="text-[11px] text-slate-500">
              Get notified about rebalances and anomalies.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {[
            { label: "Rebalance completed", enabled: true },
            { label: "Rate anomaly detected", enabled: true },
            { label: "Session key expiring", enabled: true },
            { label: "Weekly yield summary", enabled: false },
          ].map((notif) => (
            <div
              key={notif.label}
              className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-void-2/30 px-4 py-2.5"
            >
              <p className="text-[13px] text-arctic">{notif.label}</p>
              <div
                className={`h-5 w-9 rounded-full transition-colors ${notif.enabled ? "bg-glacier" : "bg-muted"}`}
              >
                <div
                  className={`h-5 w-5 rounded-full border-2 bg-white transition-transform ${
                    notif.enabled
                      ? "translate-x-4 border-glacier"
                      : "translate-x-0 border-muted"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Wallet */}
      <motion.div
        className="crystal-card p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={3}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.04] bg-void-2">
            <Wallet className="h-3.5 w-3.5 text-glacier" />
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-arctic">Wallet</h2>
            <p className="text-[11px] text-slate-500">
              Your connected wallet and smart account details.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-void-2/30 px-4 py-2.5">
            <p className="text-[13px] text-slate-500">EOA Wallet</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-arctic">
                {truncateAddress(eoaAddress)}
              </p>
              {eoaAddress && (
                <a
                  href={EXPLORER.address(eoaAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-glacier"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-void-2/30 px-4 py-2.5">
            <p className="text-[13px] text-slate-500">Smart Account</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-arctic">
                {truncateAddress(smartAccount.address)}
              </p>
              {smartAccount.address && (
                <a
                  href={EXPLORER.address(smartAccount.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-glacier"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-void-2/30 px-4 py-2.5">
            <p className="text-[13px] text-slate-500">Network</p>
            <p className="text-[11px] text-arctic">{CHAIN.name}</p>
          </div>
        </div>
      </motion.div>

      {/* Emergency Withdrawal */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={4}
      >
        <EmergencyPanel />
      </motion.div>
    </div>
  );
}
