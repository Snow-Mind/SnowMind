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
  kernelClient: any;
  txHashes: SetupTxHashes;
}

export function useSmartAccount(wallet: ConnectedWallet | null) {
  const [state, setState] = useState<SmartAccountState>({
    address: null,
    isDeployed: false,
    setupStep: "idle",
    error: null,
    kernelClient: null,
    txHashes: {},
  });

  const initializingRef = useRef(false);
  const setSmartAccountAddress = usePortfolioStore((s) => s.setSmartAccountAddress);

  const initializeAccount = useCallback(async () => {
    if (!wallet || initializingRef.current) return;
    initializingRef.current = true;

    setState((prev) => ({ ...prev, setupStep: "creating", error: null, txHashes: {} }));

    try {
      const walletClient = await toViemAccount({ wallet });
      const { kernelAccount, kernelClient, smartAccountAddress } = await createSmartAccount(walletClient);

      const hashes: SetupTxHashes = { deployment: null };

      // Grant session key and serialize (best-effort — don't block account creation)
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
        });
        // We don't get a tx hash from the backend registration API directly,
        // but the backend emits the on-chain registration tx.
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

  // Auto-initialize when wallet is available
  useEffect(() => {
    if (wallet && state.setupStep === "idle") {
      initializeAccount();
    }
  }, [wallet, state.setupStep, initializeAccount]);

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

  return {
    ...state,
    initializeAccount,
    retry,
    isLoading: state.setupStep === "creating",
    hasAccount: state.setupStep === "ready" && !!state.address,
  };
}
