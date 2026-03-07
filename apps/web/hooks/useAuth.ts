"use client";

import { usePrivy, useLogout, useWallets } from "@privy-io/react-auth";
import { useCallback } from "react";
import { usePortfolioStore } from "@/stores/portfolio.store";

export function useAuth() {
  const { ready, authenticated, user, login } = usePrivy();
  const { wallets } = useWallets();
  const portfolioStore = usePortfolioStore();

  const { logout } = useLogout({
    onSuccess: () => {
      portfolioStore.setSmartAccountAddress("");
      portfolioStore.setAllocations([]);
      portfolioStore.setTotals("0", "0");
    },
  });

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const externalWallet = wallets.find((w) => w.walletClientType !== "privy");
  const activeWallet = externalWallet ?? embeddedWallet ?? wallets[0] ?? null;

  const eoaAddress = activeWallet?.address ?? null;

  return {
    ready,
    authenticated,
    user,
    login,
    logout,
    wallets,
    activeWallet,
    eoaAddress,
    isLoading: !ready,
  };
}
