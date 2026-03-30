"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, useEffect, useRef } from "react";
import { PrivyProvider, usePrivy, getIdentityToken } from "@privy-io/react-auth";
import { privyConfig, PRIVY_APP_ID } from "@/lib/privy";
import { markAuthRateLimited, setPrivyTokenGetter } from "@/lib/api-client";

const MIN_TOKEN_CACHE_MS = 5_000;
const MAX_TOKEN_CACHE_MS = 60_000;
const DEFAULT_TOKEN_CACHE_MS = 20_000;
const TOKEN_EXP_SAFETY_MS = 5_000;

/** Registers the Privy access-token getter so api-client can attach it. */
function PrivyTokenBridge({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = usePrivy();
  const tokenCacheRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const inFlightRef = useRef<Promise<string | null> | null>(null);

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

  const isLikelyRateLimitError = (err: unknown): boolean => {
    if (!err) return false;
    const msg = err instanceof Error ? err.message : String(err);
    const lowerMsg = msg.toLowerCase();
    if (msg.includes("429") || lowerMsg.includes("rate limit") || lowerMsg.includes("too many requests")) {
      return true;
    }

    if (typeof err === "object" && err !== null) {
      const record = err as Record<string, unknown>;
      if (record.status === 429 || record.code === 429) {
        return true;
      }
    }

    return false;
  };

  const audMatchesAppId = (aud: unknown): boolean => {
    if (!PRIVY_APP_ID) return false;
    if (typeof aud === "string") return aud === PRIVY_APP_ID;
    if (Array.isArray(aud)) return aud.some((v) => v === PRIVY_APP_ID);
    return false;
  };

  useEffect(() => {
    tokenCacheRef.current = null;
    inFlightRef.current = null;

    const setCachedToken = (token: string): void => {
      const payload = parseJwtPayload(token);
      const exp = payload?.exp;
      let ttlMs = DEFAULT_TOKEN_CACHE_MS;
      if (typeof exp === "number" && Number.isFinite(exp)) {
        const expMs = exp * 1000;
        const ttl = expMs - Date.now() - TOKEN_EXP_SAFETY_MS;
        ttlMs = Math.min(MAX_TOKEN_CACHE_MS, Math.max(MIN_TOKEN_CACHE_MS, ttl));
      }

      tokenCacheRef.current = {
        token,
        expiresAt: Date.now() + ttlMs,
      };
    };

    setPrivyTokenGetter(async () => {
      const cached = tokenCacheRef.current;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.token;
      }

      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      const loadToken = async (): Promise<string | null> => {
        let accessToken: string | null = null;
        try {
          accessToken = await getAccessToken();
        } catch (err) {
          if (isLikelyRateLimitError(err)) {
            markAuthRateLimited();
          }
          return null;
        }

        let identityToken: string | null = null;
        try {
          identityToken = await getIdentityToken();
        } catch (err) {
          if (isLikelyRateLimitError(err)) {
            markAuthRateLimited();
          }
        }

        const candidates = [accessToken, identityToken].filter(isLikelyJwt);
        for (const candidate of candidates) {
          const payload = parseJwtPayload(candidate);
          if (payload && audMatchesAppId(payload.aud)) {
            setCachedToken(candidate);
            return candidate;
          }
        }

        // If audience could not be parsed/matched, prefer access token, then identity token.
        if (isLikelyJwt(accessToken)) {
          setCachedToken(accessToken);
          return accessToken;
        }
        if (isLikelyJwt(identityToken)) {
          setCachedToken(identityToken);
          return identityToken;
        }

        // No valid token available: short cooldown to avoid tight auth loops.
        markAuthRateLimited(5_000);
        return null;
      };

      inFlightRef.current = loadToken().finally(() => {
        inFlightRef.current = null;
      });

      return inFlightRef.current;
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
