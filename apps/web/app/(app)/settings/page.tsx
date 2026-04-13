"use client";

import { Wallet, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { EXPLORER, CHAIN } from "@/lib/constants";
import { openExternalUrl } from "@/lib/utils";
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
  const { eoaAddress, activeWallet } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const eoaExplorerAddress = eoaAddress ?? "";
  const smartExplorerAddress = smartAccount.address ?? "";

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
                  href={EXPLORER.address(eoaExplorerAddress)}
                  target="_blank"
                  rel="noopener noreferrer external"
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(EXPLORER.address(eoaExplorerAddress));
                  }}
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
                  href={EXPLORER.address(smartExplorerAddress)}
                  target="_blank"
                  rel="noopener noreferrer external"
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(EXPLORER.address(smartExplorerAddress));
                  }}
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

      {/* Emergency Withdrawal */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={2}
      >
        <EmergencyPanel />
      </motion.div>

    </div>
  );
}
