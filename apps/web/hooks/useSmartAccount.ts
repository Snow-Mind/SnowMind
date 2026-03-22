"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { toViemAccount } from "@privy-io/react-auth";
import { createSmartAccount } from "@/lib/zerodev";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";
import type { Address } from "viem";
import type { SetupTxHashes } from "@/components/wallet/SmartAccountSetup";

type SetupStep = "idle" | "creating" | "ready" | "error";

interface SmartAccountState {
  address: Address | null;
  isDeployed: boolean;
  setupStep: SetupStep;
  error: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: Record<string, any> | null;
  txHashes: SetupTxHashes;
}

/**
 * Giza pattern: createAgent(eoa) only creates the deterministic smart account.
 * Session key granting + protocol approvals happen ONLY during activation
 * (in the onboarding page's handleActivate).
 * This prevents race conditions and duplicate bundler calls.
 *
 * CRITICAL: We wait for Zustand hydration before auto-initializing to prevent
 * re-creating the smart account on page refresh (which would trigger MetaMask).
 */
export function useSmartAccount(wallet: ConnectedWallet | null) {
  const storedAddress = usePortfolioStore((s) => s.smartAccountAddress) as Address | null;
  const hasHydrated = usePortfolioStore((s) => s._hasHydrated);
  const setSmartAccountAddress = usePortfolioStore((s) => s.setSmartAccountAddress);
  const clearSmartAccount = usePortfolioStore((s) => s.clearSmartAccount);

  const [state, setState] = useState<SmartAccountState>({
    address: storedAddress,
    isDeployed: !!storedAddress,
    setupStep: storedAddress ? "ready" : "idle",
    error: null,
    kernelClient: null,
    txHashes: {},
  });

  const initializingRef = useRef(false);

  const initializeAccount = useCallback(async () => {
    if (!wallet || initializingRef.current) return;
    initializingRef.current = true;

    setState((prev) => ({ ...prev, setupStep: "creating", error: null, txHashes: {} }));

    try {
      const walletClient = await toViemAccount({ wallet });
      const { kernelClient, smartAccountAddress } = await createSmartAccount(walletClient);

      // Register address with backend (no session key yet — that happens at activation)
      try {
        await api.registerAccount({
          ownerAddress: wallet.address as string,
          smartAccountAddress,
        });
      } catch {
        // Non-critical — will register during activation
      }

      setState({
        address: smartAccountAddress,
        isDeployed: true,
        setupStep: "ready",
        error: null,
        kernelClient,
        txHashes: {},
      });
      setSmartAccountAddress(smartAccountAddress);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create smart account";
      setState((prev) => ({
        ...prev,
        setupStep: "error",
        error: message,
      }));
    } finally {
      initializingRef.current = false;
    }
  }, [wallet, setSmartAccountAddress]);

  // Auto-initialize ONLY after Zustand hydration confirms no stored address.
  // This prevents re-creating the smart account (and triggering MetaMask) on
  // page refresh when the address is in localStorage but hasn't loaded yet.
  useEffect(() => {
    if (!hasHydrated || !wallet || state.setupStep !== "idle") return;
    // Hydration complete — if store has no address, this is a genuinely new user
    const currentStored = usePortfolioStore.getState().smartAccountAddress;
    if (!currentStored) {
      initializeAccount();
    }
  }, [hasHydrated, wallet, state.setupStep, initializeAccount]);

  // Sync state when storedAddress becomes available after Zustand hydration
  useEffect(() => {
    if (storedAddress && !state.address && (state.setupStep === "idle" || state.setupStep === "creating")) {
      setState((prev) => ({
        ...prev,
        address: storedAddress as Address,
        isDeployed: true,
        setupStep: "ready",
      }));
      initializingRef.current = false;
    }
  }, [storedAddress, state.address, state.setupStep]);

  const retry = useCallback(() => {
    setState({
      address: null,
      isDeployed: false,
      setupStep: "idle",
      error: null,
      kernelClient: null,
      txHashes: {},
    });
  }, []);

  const resetAccount = useCallback(() => {
    clearSmartAccount();
    setState({
      address: null,
      isDeployed: false,
      setupStep: "idle",
      error: null,
      kernelClient: null,
      txHashes: {},
    });
  }, [clearSmartAccount]);

  return {
    ...state,
    initializeAccount,
    retry,
    resetAccount,
    isLoading: state.setupStep === "creating",
    hasAccount: state.setupStep === "ready" && !!state.address,
  };
}
