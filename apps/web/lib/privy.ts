"use client";

import type { PrivyClientConfig } from "@privy-io/react-auth";
import { CHAIN, PRIVY_APP_ID } from "./constants";

export const privyConfig: PrivyClientConfig = {
  appearance: {
    theme: "#050A14",
    accentColor: "#00C4FF",
    logo: undefined,
    showWalletLoginFirst: false,
  },
  loginMethods: ["wallet", "email", "google"],
  defaultChain: CHAIN,
  supportedChains: [CHAIN],
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
};

export { PRIVY_APP_ID };
