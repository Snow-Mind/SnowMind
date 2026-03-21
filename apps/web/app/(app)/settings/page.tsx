"use client";

import { useState, useEffect } from "react";
import { Bell, Wallet, ExternalLink, RefreshCw, BarChart3, Trash2, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { EXPLORER, CHAIN } from "@/lib/constants";
import SessionKeyStatus from "@/components/dashboard/SessionKeyStatus";
import EmergencyPanel from "@/components/dashboard/EmergencyPanel";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";
import type { DiversificationPreference } from "@snowmind/shared-types";
import { cn } from "@/lib/utils";

const DIVERSIFICATION_OPTIONS: {
  value: DiversificationPreference;
  label: string;
  desc: string;
}[] = [
  { value: "max_yield", label: "Max Yield", desc: "No per-protocol cap, highest APY wins" },
  { value: "balanced", label: "Balanced", desc: "Max 60% per protocol, waterfall fill" },
  { value: "diversified", label: "Diversified", desc: "Max 40% per protocol, broadest spread" },
];

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
  const router = useRouter();

  // Diversification preference state
  const [divPref, setDivPref] = useState<DiversificationPreference>("balanced");
  const [savingPref, setSavingPref] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Fetch current preference from backend
  useEffect(() => {
    if (!smartAccountAddress) return;
    api.getAccountDetail(smartAccountAddress).then((detail) => {
      if (detail.diversificationPreference) {
        setDivPref(detail.diversificationPreference);
      }
    }).catch(() => { /* use default */ });
  }, [smartAccountAddress]);

  const handlePrefChange = async (pref: DiversificationPreference) => {
    if (!smartAccountAddress || pref === divPref) return;
    setDivPref(pref);
    setSavingPref(true);
    try {
      await api.saveDiversificationPreference(smartAccountAddress, pref);
      toast.success(`Allocation strategy updated to ${DIVERSIFICATION_OPTIONS.find((o) => o.value === pref)?.label}`);
    } catch {
      toast.error("Failed to update allocation strategy");
    } finally {
      setSavingPref(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-arctic">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Manage your account preferences and session key.
        </p>
      </div>

      {/* Session Key */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0}
      >
        <SessionKeyStatus />
      </motion.div>

      {/* Allocation Strategy */}
      <motion.div
        className="crystal-card p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={1}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E2DA] bg-void-2">
            <BarChart3 className="h-3.5 w-3.5 text-glacier" />
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-arctic">
              Allocation Strategy
            </h2>
            <p className="text-[11px] text-slate-500">
              Controls how the optimizer splits funds across protocols.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {DIVERSIFICATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handlePrefChange(opt.value)}
              disabled={savingPref}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-all",
                divPref === opt.value
                  ? "border-glacier bg-glacier/[0.06]"
                  : "border-[#E8E2DA] bg-void-2/30 hover:border-[#D4CEC7]",
              )}
            >
              <div>
                <p className={cn("text-[13px]", divPref === opt.value ? "font-medium text-arctic" : "text-arctic")}>{opt.label}</p>
                <p className="text-[11px] text-slate-500">{opt.desc}</p>
              </div>
              <div
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  divPref === opt.value
                    ? "border-glacier bg-glacier"
                    : "border-[#C4BEB8]",
                )}
              >
                {divPref === opt.value && (
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                )}
              </div>
            </button>
          ))}
        </div>
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E2DA] bg-void-2">
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
              className="flex items-center justify-between rounded-lg border border-[#E8E2DA] bg-void-2/30 px-4 py-2.5"
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E2DA] bg-void-2">
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
          <div className="flex items-center justify-between rounded-lg border border-[#E8E2DA] bg-void-2/30 px-4 py-2.5">
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
          <div className="flex items-center justify-between rounded-lg border border-[#E8E2DA] bg-void-2/30 px-4 py-2.5">
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
          <div className="flex items-center justify-between rounded-lg border border-[#E8E2DA] bg-void-2/30 px-4 py-2.5">
            <p className="text-[13px] text-slate-500">Network</p>
            <p className="text-[11px] text-arctic">{CHAIN.name}</p>
          </div>
        </div>
      </motion.div>

      {/* Re-setup Account */}
      <motion.div
        className="crystal-card p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={4}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E2DA] bg-void-2">
            <RefreshCw className="h-3.5 w-3.5 text-glacier" />
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-arctic">
              Re-setup Account
            </h2>
            <p className="text-[11px] text-slate-500">
              Re-grant session key and USDC approvals. Use this if the agent
              isn&apos;t auto-rebalancing your funds.
            </p>
          </div>
        </div>

        <button
          className="glacier-btn mt-4 flex items-center gap-2 px-4 py-2 text-[13px]"
          disabled={smartAccount.isLoading}
          onClick={() => {
            smartAccount.resetAccount();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {smartAccount.isLoading ? "Setting up…" : "Re-setup Smart Account"}
        </button>
        <p className="mt-2 text-[11px] text-slate-400">
          This will re-create your session key and re-approve USDC for all
          protocols. Your smart account address stays the same.
        </p>
      </motion.div>

      {/* Emergency Withdrawal */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={5}
      >
        <EmergencyPanel />
      </motion.div>

      {/* ─── Danger Zone: Delete Account ─── */}
      <motion.div
        className="crystal-card border-red-300/50 p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={6}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50">
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </div>
          <div>
            <h2 className="text-[13px] font-medium text-red-600">
              Delete Account
            </h2>
            <p className="text-[11px] text-slate-500">
              Permanently remove your account and all associated data.
            </p>
          </div>
        </div>

        {!showDeleteConfirm ? (
          <button
            className="mt-4 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-100"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Account
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="text-[12px] text-red-700">
                <p className="font-medium">This action is irreversible.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>You must withdraw ALL funds first</li>
                  <li>Your session key, allocation history, and rebalance logs will be deleted</li>
                  <li>Your smart account contract will still exist on-chain but SnowMind will stop managing it</li>
                </ul>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-500">
                Type <span className="font-mono font-medium text-red-600">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 font-mono text-[13px] text-red-600 placeholder:text-red-300 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div className="flex gap-2">
              <button
                disabled={deleteConfirmText !== "DELETE" || deleting}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={async () => {
                  if (!smartAccountAddress) return;
                  setDeleting(true);
                  try {
                    await api.deleteAccount(smartAccountAddress);
                    toast.success("Account deleted. Redirecting...");
                    usePortfolioStore.getState().clearSmartAccount();
                    setTimeout(() => router.push("/"), 2000);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes("409") || msg.toLowerCase().includes("still has")) {
                      toast.error("Please withdraw all funds before deleting your account.");
                    } else if (msg.includes("503")) {
                      toast.error("Could not verify balances. Please try again later.");
                    } else {
                      toast.error(msg.length > 120 ? msg.slice(0, 100) + "..." : msg);
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting..." : "Permanently Delete"}
              </button>
              <button
                className="rounded-lg border border-[#E8E2DA] px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <p className="mt-2 text-[11px] text-slate-400">
          This cannot be undone. Make sure you have withdrawn all your USDC first.
        </p>
      </motion.div>
    </div>
  );
}
