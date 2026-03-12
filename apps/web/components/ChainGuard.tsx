"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { AlertCircle } from "lucide-react";
import { CHAIN, CHAIN_ID } from "@/lib/constants";

interface ChainGuardProps {
  children: React.ReactNode;
}

export function ChainGuard({ children }: ChainGuardProps) {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    // Only show alert if wallet is connected and on wrong chain
    if (isConnected && chainId && chainId !== CHAIN_ID) {
      setShowAlert(true);
    } else {
      setShowAlert(false);
    }
  }, [isConnected, chainId]);

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
            Your wallet is connected to the wrong network. Please switch to Avalanche Fuji testnet.
          </p>
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            disabled={isPending}
            className="mt-3 bg-[#E84142] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#D63031] disabled:opacity-50 transition-colors"
          >
            {isPending ? "Switching..." : "Switch to Avalanche Fuji"}
          </button>
        </div>
      </div>
      
      {/* Dimmed content */}
      <div className="opacity-50 pointer-events-none">
        {children}
      </div>
    </div>
  );
}
