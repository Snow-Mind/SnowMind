"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, useEffect } from "react";
import { PrivyProvider, usePrivy, getIdentityToken } from "@privy-io/react-auth";
import { privyConfig, PRIVY_APP_ID } from "@/lib/privy";
import { setPrivyTokenGetter } from "@/lib/api-client";

/** Registers the Privy access-token getter so api-client can attach it. */
function PrivyTokenBridge({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = usePrivy();

  const isLikelyJwt = (token: string | null | undefined): token is string => {
    if (!token) return false;
    return token.split(".").length === 3;
  };

  const parseJwtPayload = (token: string): Record<string, unknown> | null => {
    try {
      const [, payloadB64] = token.split(".");
      if (!payloadB64) return null;
      const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const json = atob(padded);
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const audMatchesAppId = (aud: unknown): boolean => {
    if (!PRIVY_APP_ID) return false;
    if (typeof aud === "string") return aud === PRIVY_APP_ID;
    if (Array.isArray(aud)) return aud.some((v) => v === PRIVY_APP_ID);
    return false;
  };

  useEffect(() => {
    setPrivyTokenGetter(async () => {
      const accessToken = await getAccessToken().catch(() => null);
      const identityToken = await getIdentityToken().catch(() => null);

      const candidates = [accessToken, identityToken].filter(isLikelyJwt);
      for (const candidate of candidates) {
        const payload = parseJwtPayload(candidate);
        if (payload && audMatchesAppId(payload.aud)) {
          return candidate;
        }
      }

      // If audience could not be parsed/matched, prefer access token, then identity token.
      if (isLikelyJwt(accessToken)) return accessToken;
      if (isLikelyJwt(identityToken)) return identityToken;
      return null;
    });
  }, [getAccessToken]);
  return <>{children}</>;
}

function MaybePrivy({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <PrivyTokenBridge>{children}</PrivyTokenBridge>
    </PrivyProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      forcedTheme="light"
      disableTransitionOnChange
    >
      <MaybePrivy>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MaybePrivy>
    </ThemeProvider>
  );
}
