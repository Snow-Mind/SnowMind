"use client";

import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { AlertCircle } from "lucide-react";
import { CHAIN_ID } from "@/lib/constants";

interface ChainGuardProps {
  children: React.ReactNode;
}

export function ChainGuard({ children }: ChainGuardProps) {
  const { wallets } = useWallets();
  const [showAlert, setShowAlert] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const activeWallet =
    wallets.find((w) => w.walletClientType !== "privy") ??
    wallets.find((w) => w.walletClientType === "privy") ??
    wallets[0] ??
    null;

  useEffect(() => {
    if (!activeWallet) {
      setShowAlert(false);
      return;
    }
    const walletChainId = parseInt(activeWallet.chainId.replace("eip155:", ""), 10);
    setShowAlert(walletChainId !== CHAIN_ID);
  }, [activeWallet, activeWallet?.chainId]);

  const handleSwitch = async () => {
    if (!activeWallet) return;
    setIsSwitching(true);
    try {
      await activeWallet.switchChain(CHAIN_ID);
    } catch {
      // user rejected or chain not added — silently ignore
    } finally {
      setIsSwitching(false);
    }
  };

  if (!showAlert) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-4">
      {/* Chain mismatch alert */}
      <div className="crystal-card border border-[#FF6B6B]/30 bg-[#FF6B6B]/[0.03] p-4 flex gap-3">
        <AlertCircle className="h-5 w-5 text-[#FF6B6B] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1A1715]">Wrong Network</p>
          <p className="text-xs text-[#8A837C] mt-1">
            Your wallet is connected to the wrong network. Please switch to
            Avalanche C-Chain.
          </p>
          <button
            onClick={handleSwitch}
            disabled={isSwitching}
            className="mt-3 bg-[#E84142] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#D63031] disabled:opacity-50 transition-colors"
          >
            {isSwitching ? "Switching..." : "Switch to Avalanche"}
          </button>
        </div>
      </div>

      {/* Dimmed content */}
      <div className="opacity-50 pointer-events-none">{children}</div>
    </div>
  );
}
