"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, useEffect } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { privyConfig, PRIVY_APP_ID } from "@/lib/privy";
import { setPrivyTokenGetter } from "@/lib/api-client";

/** Registers the Privy access-token getter so api-client can attach it. */
function PrivyTokenBridge({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = usePrivy();
  useEffect(() => {
    setPrivyTokenGetter(getAccessToken);
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
