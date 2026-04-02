"use client";

import { usePrivy, useLogout, useWallets } from "@privy-io/react-auth";

export function useAuth() {
  const { ready, authenticated, user, login } = usePrivy();
  const { wallets } = useWallets();
  const { logout } = useLogout();

  const primaryUserWalletAddress = (
    (user as { wallet?: { address?: string | null } } | null)?.wallet?.address ?? ""
  ).toLowerCase();

  const walletFromUserProfile = primaryUserWalletAddress
    ? wallets.find((w) => w.address.toLowerCase() === primaryUserWalletAddress)
    : undefined;

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const externalWallet = wallets.find((w) => w.walletClientType !== "privy");
  const activeWallet = walletFromUserProfile ?? externalWallet ?? embeddedWallet ?? wallets[0] ?? null;

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
