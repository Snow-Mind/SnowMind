"use client";

import { useRouter } from "next/navigation";
import { Wallet, ExternalLink, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { EXPLORER, CHAIN } from "@/lib/constants";
import SessionKeyStatus from "@/components/dashboard/SessionKeyStatus";
import EmergencyPanel from "@/components/dashboard/EmergencyPanel";

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
  const router = useRouter();
  const { eoaAddress, activeWallet } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-arctic">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Manage your account and session key.
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

      {/* Wallet */}
      <motion.div
        className="crystal-card p-5"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={1}
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
        custom={2}
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
          disabled={smartAccount.setupStep === "creating"}
          onClick={() => {
            smartAccount.resetAccount();
            toast.info("Redirecting to re-setup your account…");
            router.push("/onboarding");
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
        custom={3}
      >
        <EmergencyPanel />
      </motion.div>

    </div>
  );
}
