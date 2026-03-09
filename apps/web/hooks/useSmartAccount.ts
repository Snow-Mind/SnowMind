"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { toViemAccount } from "@privy-io/react-auth";
import { createSmartAccount, grantAndSerializeSessionKey, approveAllProtocols } from "@/lib/zerodev";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { api } from "@/lib/api-client";
import { CONTRACTS } from "@/lib/constants";
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

export function useSmartAccount(wallet: ConnectedWallet | null) {
  const storedAddress = usePortfolioStore((s) => s.smartAccountAddress) as Address | null;
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
      const { kernelAccount, kernelClient, smartAccountAddress } = await createSmartAccount(walletClient);

      const hashes: SetupTxHashes = { deployment: null };

      // Grant session key and serialize (best-effort — don't block account creation)
      let sessionKeyData: {
        serializedPermission: string;
        sessionKeyAddress: string;
        expiresAt: number;
      } | null = null;
      try {
        const sessionKeyResult = await grantAndSerializeSessionKey(
          kernelAccount,
          kernelClient,
          {
            AAVE_POOL:   CONTRACTS.AAVE_POOL,
            BENQI_POOL:  CONTRACTS.BENQI_POOL,
            EULER_VAULT: CONTRACTS.EULER_VAULT,
            USDC:        CONTRACTS.USDC,
          },
          {
            maxAmountUSDC: 10000,
            durationDays:  30,
            maxOpsPerDay:  20,
          },
        );
        sessionKeyData = sessionKeyResult;
        hashes.sessionKey = sessionKeyResult.sessionKeyAddress;
        setState((prev) => ({ ...prev, txHashes: { ...prev.txHashes, sessionKey: sessionKeyResult.sessionKeyAddress } }));
      } catch {
        console.warn("Session key grant failed — will retry later");
      }

      // Approve all protocols (best-effort)
      try {
        const approvalResult = await approveAllProtocols(kernelClient, {
          USDC:        CONTRACTS.USDC,
          AAVE_POOL:   CONTRACTS.AAVE_POOL,
          BENQI_POOL:  CONTRACTS.BENQI_POOL,
          EULER_VAULT: CONTRACTS.EULER_VAULT,
        });
        hashes.approval = approvalResult.txHash;
        setState((prev) => ({ ...prev, txHashes: { ...prev.txHashes, approval: approvalResult.txHash } }));
      } catch {
        console.warn("USDC approval failed — will retry later");
      }

      // Register with backend (best-effort)
      try {
        await api.registerAccount({
          ownerAddress: wallet.address as string,
          smartAccountAddress,
          ...(sessionKeyData && {
            sessionKeyData: {
              serializedPermission: sessionKeyData.serializedPermission,
              sessionKeyAddress: sessionKeyData.sessionKeyAddress,
              expiresAt: sessionKeyData.expiresAt,
            },
          }),
        });
        hashes.registry = "backend-registered";
      } catch {
        console.warn("Backend registration failed — will retry on next load");
      }

      setState({
        address: smartAccountAddress,
        isDeployed: true,
        setupStep: "ready",
        error: null,
        kernelClient,
        txHashes: hashes,
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

  // Auto-initialize when wallet is available and no stored address
  useEffect(() => {
    if (wallet && !storedAddress && state.setupStep === "idle") {
      initializeAccount();
    }
  }, [wallet, storedAddress, state.setupStep, initializeAccount]);

  // If we have a stored address but no wallet yet, keep showing "ready"
  // Once wallet connects, re-register and ensure backend has a session key
  useEffect(() => {
    if (wallet && storedAddress && state.setupStep === "ready" && !state.kernelClient) {
      (async () => {
        try {
          // Check if backend already has an active session key
          const detail = await api.getAccountDetail(storedAddress);
          if (detail.sessionKey?.isActive) {
            // Backend has a valid session key — just re-register (idempotent)
            await api.registerAccount({
              ownerAddress: wallet.address as string,
              smartAccountAddress: storedAddress,
            });
            return;
          }

          // No session key — recreate kernel client and grant one
          const walletClient = await toViemAccount({ wallet });
          const { kernelAccount, kernelClient } = await createSmartAccount(walletClient);

          let sessionKeyData: {
            serializedPermission: string;
            sessionKeyAddress: string;
            expiresAt: number;
          } | null = null;
          try {
            sessionKeyData = await grantAndSerializeSessionKey(
              kernelAccount,
              kernelClient,
              {
                AAVE_POOL:   CONTRACTS.AAVE_POOL,
                BENQI_POOL:  CONTRACTS.BENQI_POOL,
                EULER_VAULT: CONTRACTS.EULER_VAULT,
                USDC:        CONTRACTS.USDC,
              },
              { maxAmountUSDC: 10000, durationDays: 30, maxOpsPerDay: 20 },
            );
          } catch {
            console.warn("Session key re-grant failed");
          }

          await api.registerAccount({
            ownerAddress: wallet.address as string,
            smartAccountAddress: storedAddress,
            ...(sessionKeyData && {
              sessionKeyData: {
                serializedPermission: sessionKeyData.serializedPermission,
                sessionKeyAddress: sessionKeyData.sessionKeyAddress,
                expiresAt: sessionKeyData.expiresAt,
              },
            }),
          });

          if (kernelClient) {
            setState((prev) => ({ ...prev, kernelClient }));
          }
        } catch {
          // Non-critical — backend registration is best-effort
        }
      })();
    }
  }, [wallet, storedAddress, state.setupStep, state.kernelClient]);

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
