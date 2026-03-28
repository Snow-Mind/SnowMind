"use client";

import { usePrivy, useLogout, useWallets } from "@privy-io/react-auth";

export function useAuth() {
  const { ready, authenticated, user, login } = usePrivy();
  const { wallets } = useWallets();
  const { logout } = useLogout();

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
