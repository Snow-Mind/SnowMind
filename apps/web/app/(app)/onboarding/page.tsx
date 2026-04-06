"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Wallet,
  X,
  Zap,
  Shield,
  ArrowRight,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  encodeFunctionData,
  formatUnits,
} from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useAuth } from "@/hooks/useAuth";
import { useAccountDetail } from "@/hooks/useAccountDetail";
import { usePortfolio } from "@/hooks/usePortfolio";
import { api, APIError } from "@/lib/api-client";
import {
  EXPLORER,
  CONTRACTS,
  AVALANCHE_RPC_URL,
  AVALANCHE_RPC_URLS,
  PROTOCOL_CONFIG,
  RISK_SCORE_MAX,
  CHAIN,
  type ProtocolId,
} from "@/lib/constants";
import { useProtocolRates } from "@/hooks/useProtocolRates";
import Image from "next/image";
import {
  createSmartAccount,
  grantAndSerializeSessionKey,
  withRetry,
} from "@/lib/zerodev";
import { cn } from "@/lib/utils";
import type { DiversificationPreference, ProtocolRateResponse } from "@snowmind/shared-types";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Activation sub-steps (Giza-style progress)
type ActivationPhase =
  | "idle"
  | "transferring-usdc"
  | "granting-session-key"
  | "registering-backend"
  | "done"
  | "error";

const PHASE_LABELS: Record<ActivationPhase, string> = {
  idle: "",
  "transferring-usdc": "Transferring USDC to smart account…",
  "granting-session-key": "Granting agent permissions…",
  "registering-backend": "Registering & deploying funds…",
  done: "Agent activated — your funds are earning yield!",
  error: "Activation failed",
};

// Deployment sub-steps (Account step)
type DeployPhase = "idle" | "deploying" | "deployed" | "error";

// Multi-step form: 1) Account  2) Strategy  3) Deposit  4) Activate
type FormStep = "account" | "strategy" | "deposit" | "activate";

// Ordered markets shown in onboarding strategy step (risk desc, then alphabetical).
const MARKET_PROTOCOL_IDS: ProtocolId[] = [
  "aave_v3",
  "benqi",
  "spark",
  "silo_savusd_usdc",
  "euler_v2",
  "silo_susdp_usdc",
];

const MARKET_PROTOCOLS = MARKET_PROTOCOL_IDS
  .map((id) => PROTOCOL_CONFIG[id])
  .filter(Boolean);

function defaultAllocationCaps(): Record<ProtocolId, number> {
  return Object.fromEntries(
    MARKET_PROTOCOL_IDS.map((pid) => [pid, 100]),
  ) as Record<ProtocolId, number>;
}

function normalizeIncomingAllocationCaps(
  rawCaps: Record<string, number> | null | undefined,
): Record<ProtocolId, number> {
  const caps = defaultAllocationCaps();
  if (!rawCaps) return caps;

  for (const [rawPid, rawValue] of Object.entries(rawCaps)) {
    const maybe = rawPid.toLowerCase().trim();
    const canonical = maybe === "aave" ? "aave_v3" : maybe;
    if (!MARKET_PROTOCOL_IDS.includes(canonical as ProtocolId)) continue;

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) continue;
    caps[canonical as ProtocolId] = Math.max(0, Math.min(100, Math.round(parsed)));
  }

  return caps;
}

function canonicalRateProtocolId(rawProtocolId: string): ProtocolId {
  const normalized = (rawProtocolId || "").trim().toLowerCase();
  const canonical = normalized === "aave" ? "aave_v3" : normalized;
  return canonical as ProtocolId;
}

const RECEIPT_CONFIRMATION_TIMEOUT_MS = 180_000;
const RECEIPT_POLL_INTERVAL_MS = 3_000;
const MIN_FUNDED_BALANCE_USDC = 0.01;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function portfolioHasFunds(
  portfolio:
    | {
      totalDepositedUsd: string;
      allocations: Array<{ amountUsdc: string }>;
    }
    | null
    | undefined,
): boolean {
  const totalDeposited = Number(portfolio?.totalDepositedUsd ?? "0");
  if (Number.isFinite(totalDeposited) && totalDeposited > MIN_FUNDED_BALANCE_USDC) {
    return true;
  }
  return portfolio?.allocations?.some((allocation) => Number(allocation.amountUsdc) > MIN_FUNDED_BALANCE_USDC) ?? false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorToMessage(err: unknown): string {
  if (!err) return "Unknown RPC error";
  if (err instanceof Error) return err.message;
  return String(err);
}

function isLikelyPendingReceiptError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("transaction")
    && normalized.includes("not found")
  ) || normalized.includes("could not be found");
}

function isRpcTransportFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("http request failed")
    || normalized.includes("failed to fetch")
    || normalized.includes("network request failed")
    || normalized.includes("socket hang up")
    || normalized.includes("request body")
    || normalized.includes("eth_gettransactionbyhash")
    || normalized.includes("eth_gettransactionreceipt")
  );
}

function sanitizeActivationErrorMessage(message: string): string {
  if (isRpcTransportFailure(message)) {
    return "Avalanche RPC providers are temporarily unstable while confirming your activation transaction. "
      + "Your funds are safe in your smart account. Please retry activation in a few seconds.";
  }
  return message.length > 200 ? `${message.slice(0, 180)}...` : message;
}

async function withRpcFallback<T>(
  label: string,
  execute: (client: ReturnType<typeof createPublicClient>, rpcUrl: string) => Promise<T>,
): Promise<T> {
  let lastRpcError = "";

  for (const rpcUrl of AVALANCHE_RPC_URLS) {
    const client = createPublicClient({ chain: CHAIN, transport: http(rpcUrl) });
    try {
      return await execute(client, rpcUrl);
    } catch (rpcErr: unknown) {
      const rpcMsg = errorToMessage(rpcErr);
      lastRpcError = isRpcTransportFailure(rpcMsg)
        ? `${rpcUrl}: transport error`
        : `${rpcUrl}: ${rpcMsg.slice(0, 140)}`;
    }
  }

  const suffix = lastRpcError ? ` Last provider error: ${lastRpcError}.` : "";
  throw new Error(`RPC request failed for ${label} across all providers.${suffix}`);
}

async function waitForTransferConfirmationWithFallback(params: {
  transferHash: `0x${string}`;
  recipient: `0x${string}`;
  minRecipientBalance: bigint;
  walletProvider?: Eip1193Provider;
}): Promise<void> {
  const { transferHash, recipient, minRecipientBalance, walletProvider } = params;
  const clients = AVALANCHE_RPC_URLS.map((rpcUrl) => ({
    rpcUrl,
    client: createPublicClient({ chain: CHAIN, transport: http(rpcUrl) }),
  }));

  const deadline = Date.now() + RECEIPT_CONFIRMATION_TIMEOUT_MS;
  let lastRpcError = "";

  while (Date.now() < deadline) {
    if (walletProvider) {
      try {
        const providerReceipt = await walletProvider.request({
          method: "eth_getTransactionReceipt",
          params: [transferHash],
        }) as { status?: string | null } | null;

        if (providerReceipt) {
          const statusHex = (providerReceipt.status ?? "").toLowerCase();
          if (statusHex === "0x0" || statusHex === "0") {
            throw new Error("USDC transfer reverted on-chain.");
          }
          if (statusHex === "0x1" || statusHex === "1" || statusHex === "") {
            return;
          }
        }
      } catch (providerErr: unknown) {
        const providerMsg = errorToMessage(providerErr);
        lastRpcError = isRpcTransportFailure(providerMsg)
          ? "wallet_provider: transport error"
          : `wallet_provider: ${providerMsg.slice(0, 140)}`;
      }
    }

    for (const { rpcUrl, client } of clients) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: transferHash });
        if (receipt.status === "reverted") {
          throw new Error("USDC transfer reverted on-chain.");
        }
        return;
      } catch (receiptErr: unknown) {
        const receiptMsg = errorToMessage(receiptErr);
        if (isLikelyPendingReceiptError(receiptMsg)) {
          continue;
        }
        lastRpcError = isRpcTransportFailure(receiptMsg)
          ? `${rpcUrl}: transport error`
          : `${rpcUrl}: ${receiptMsg.slice(0, 140)}`;
      }
    }

    for (const { client } of clients) {
      try {
        const recipientBalance = await client.readContract({
          address: CONTRACTS.USDC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [recipient],
        }) as bigint;

        if (recipientBalance >= minRecipientBalance) {
          return;
        }
      } catch {
        // Ignore fallback balance-read errors.
      }
    }

    await sleep(RECEIPT_POLL_INTERVAL_MS);
  }

  const suffix = lastRpcError ? ` Last provider error: ${lastRpcError}.` : "";
  throw new Error(
    "USDC transfer broadcasted but confirmation could not be verified due RPC instability."
    + suffix
    + " Please retry in a few seconds."
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const setAgentActivated = usePortfolioStore((s) => s.setAgentActivated);
  const setSmartAccountAddress = usePortfolioStore((s) => s.setSmartAccountAddress);
  const { activeWallet, login, logout, authenticated, ready } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const { data: accountDetail, error: accountDetailError } = useAccountDetail(smartAccountAddress ?? undefined);
  const { data: onboardingPortfolio, isLoading: onboardingPortfolioLoading } = usePortfolio(smartAccountAddress ?? undefined);
  const hasPortfolioFunds = portfolioHasFunds(onboardingPortfolio);
  const hasRecoverableFunds = hasPortfolioFunds;
  const queryClient = useQueryClient();
  const wallet = activeWallet;

  // Multi-step form state
  const isAccountReady = smartAccount.setupStep === "ready" && !!smartAccountAddress;
  const [formStep, setFormStep] = useState<FormStep>(isAccountReady ? "strategy" : "account");

  // Account deployment state (Sig 1: deploy + approve) — declared before useEffect that references it
  const [deployPhase, setDeployPhase] = useState<DeployPhase>("idle");
  const [deployError, setDeployError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kernelAccountRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kernelClientRef = useRef<any>(null);
  const derivedAddressRef = useRef<string | null>(null);
  const deployGuardRef = useRef(false);

  // Keep formStep in sync with account readiness — skip deploy if account is
  // already set up (e.g. returning user redirected to onboarding after deactivation,
  // or edge case where user arrives with existing smart account).
  useEffect(() => {
    if (isAccountReady && formStep === "account") {
      // Account already exists (from localStorage or just deployed) — skip to strategy
      if (deployPhase === "deployed" || deployPhase === "idle") {
        setDeployPhase("deployed");
        deployGuardRef.current = true;
        setFormStep("strategy");
      }
    }
  }, [isAccountReady, deployPhase, formStep]);

  // If funds already exist in the smart account but the session key is not
  // active, route to re-grant mode (no new EOA deposit required).
  useEffect(() => {
    if (!smartAccountAddress || !accountDetail || onboardingPortfolioLoading) return;

    const accountIsActive = Boolean(accountDetail.isActive);
    const hasActiveSessionKey = Boolean(accountDetail.sessionKey?.isActive);
    const needsRegrant = accountIsActive && hasRecoverableFunds && !hasActiveSessionKey;

    if (!needsRegrant) {
      setRegrantOnlyMode(false);
      return;
    }

    setRegrantOnlyMode(true);
    setDepositAmount("0");
    if (formStep === "strategy" || formStep === "deposit") {
      setFormStep("activate");
    }
  }, [smartAccountAddress, accountDetail, formStep, onboardingPortfolioLoading, hasRecoverableFunds]);

  // Returning activated users should not be forced through onboarding.
  useEffect(() => {
    if (!smartAccountAddress || onboardingPortfolioLoading || !accountDetail) return;
    if (accountDetailError instanceof APIError && accountDetailError.status === 401) return;

    const isFullyActive = Boolean(accountDetail.isActive && accountDetail.sessionKey?.isActive && hasPortfolioFunds);
    if (isFullyActive) {
      setAgentActivated(true);
      router.replace("/dashboard");
    }
  }, [
    smartAccountAddress,
    onboardingPortfolioLoading,
    accountDetail,
    accountDetailError,
    hasPortfolioFunds,
    router,
    setAgentActivated,
  ]);

  // Protocol selection for Strategy step — all selected by default
  const [selectedProtocols, setSelectedProtocols] = useState<Set<string>>(
    () => new Set(MARKET_PROTOCOLS.filter((p) => p.defaultEnabled).map((p) => p.id)),
  );
  const [allocationCaps, setAllocationCaps] = useState<Record<ProtocolId, number>>(
    () => defaultAllocationCaps(),
  );
  const [editingCapProtocolId, setEditingCapProtocolId] = useState<ProtocolId | null>(null);
  const [pendingCapPct, setPendingCapPct] = useState<number>(100);
  // Diversification preference — hardcoded to balanced (allocation strategy UI removed)
  const diversificationPref: DiversificationPreference = "balanced";

  const toggleProtocol = (id: string, isEnabled: boolean) => {
    if (!isEnabled) return;
    setSelectedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return prev; // Must keep at least 1
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

    if (editingCapProtocolId === id && selectedProtocols.has(id)) {
      setEditingCapProtocolId(null);
    }
  };

  const openCapEditor = (protocolId: ProtocolId) => {
    if (!selectedProtocols.has(protocolId)) return;
    if (editingCapProtocolId && editingCapProtocolId !== protocolId) return;
    setEditingCapProtocolId(protocolId);
    setPendingCapPct(allocationCaps[protocolId] ?? 100);
  };

  const cancelCapEdit = () => {
    setEditingCapProtocolId(null);
  };

  const confirmCapEdit = () => {
    if (!editingCapProtocolId) return;
    setAllocationCaps((prev) => ({
      ...prev,
      [editingCapProtocolId]: pendingCapPct,
    }));
    setEditingCapProtocolId(null);
  };

  const adjustPendingCap = (delta: number) => {
    setPendingCapPct((prev) => {
      const next = prev + (delta * 10);
      return Math.max(10, Math.min(100, next));
    });
  };

  // Get live protocol rates for APY display
  const { data: protocolRates } = useProtocolRates();
  const rateByProtocol = useMemo(() => {
    const map = new Map<ProtocolId, ProtocolRateResponse>();
    for (const row of protocolRates ?? []) {
      map.set(canonicalRateProtocolId(row.protocolId), row);
    }
    return map;
  }, [protocolRates]);

  const [copied, setCopied] = useState(false);
  const [eoaBalance, setEoaBalance] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [activationPhase, setActivationPhase] = useState<ActivationPhase>("idle");
  const [activationError, setActivationError] = useState<string | null>(null);
  const [regrantOnlyMode, setRegrantOnlyMode] = useState(false);
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [repairStage, setRepairStage] = useState<"idle" | "await-login">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activateGuardRef = useRef(false);
  const repairLoginAttemptedRef = useRef(false);

  const eoaBalanceNum = parseFloat(eoaBalance);
  const parsedAmount = parseFloat(depositAmount);
  const effectiveDepositAmount = !isNaN(parsedAmount) ? parsedAmount : 0;
  const isValidAmount = regrantOnlyMode || (effectiveDepositAmount >= 1 && effectiveDepositAmount <= eoaBalanceNum);

  // Best APY from selected protocols (for now, show Benqi APY as highest)
  const bestApy = (() => {
    if (!protocolRates) return 0;
    const selected = protocolRates.filter((r) => selectedProtocols.has(canonicalRateProtocolId(r.protocolId)));
    const best = selected.reduce((max, r) => (r.currentApy > max ? r.currentApy : max), 0);
    return best * 100; // convert to percentage
  })();

  const selectedCount = selectedProtocols.size;
  const hasDeployableSelectedProtocol = MARKET_PROTOCOL_IDS.some(
    (pid) => selectedProtocols.has(pid) && (allocationCaps[pid] ?? 100) > 0,
  );
  const yearlyEarning = effectiveDepositAmount >= 1 ? effectiveDepositAmount * (bestApy / 100) : 0;

  const hasAuthError = accountDetailError instanceof APIError && accountDetailError.status === 401;

  useEffect(() => {
    if (!accountDetail?.allocationCaps) return;
    setAllocationCaps(normalizeIncomingAllocationCaps(accountDetail.allocationCaps));
  }, [accountDetail?.allocationCaps]);

  // Poll USDC balance of user's EOA wallet
  useEffect(() => {
    if (!wallet) return;

    const checkBalance = async () => {
      try {
        const balance = await withRpcFallback(
          "wallet USDC balance",
          (client) => client.readContract({
            address: CONTRACTS.USDC,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [wallet.address as `0x${string}`],
          }) as Promise<bigint>,
        );
        setEoaBalance(formatUnits(balance, 6));
      } catch {
        /* ignore polling errors */
      }
    };

    checkBalance();
    pollRef.current = setInterval(checkBalance, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [wallet]);

  const handleCopy = () => {
    if (!smartAccountAddress) return;
    navigator.clipboard.writeText(smartAccountAddress);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegrantRecovery = async () => {
    if (isReauthenticating) return;

    setIsReauthenticating(true);
    repairLoginAttemptedRef.current = false;
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("snowmind_auth_repair", "1");
      }

      // Avoid calling login() while still authenticated.
      if (authenticated) {
        await logout();
        await sleep(150);
      }
      setRepairStage("await-login");
    } catch {
      setRepairStage("idle");
      toast.error("Could not reset your session. Please try again.");
    } finally {
      setIsReauthenticating(false);
    }
  };

  useEffect(() => {
    if (repairStage !== "await-login" || !ready) return;

    if (authenticated) {
      setRepairStage("idle");
      repairLoginAttemptedRef.current = false;
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("snowmind_auth_repair");
      }

      setRegrantOnlyMode(true);
      setDepositAmount("0");
      setFormStep("activate");
      toast.success("Session refreshed. Continue to re-grant session key.");
      return;
    }

    if (!repairLoginAttemptedRef.current) {
      repairLoginAttemptedRef.current = true;
      login();
    }
  }, [repairStage, ready, authenticated, login]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("snowmind_auth_repair");
    }
  }, [ready, authenticated]);

  // Hydration guard — Zustand persist loads from localStorage as a microtask.
  // By the time this useEffect fires, the store has the correct persisted values.
  // This prevents false-positive "new user" detection during SSR→client hydration.
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);

  const setOnboardingInProgress = usePortfolioStore((s) => s.setOnboardingInProgress);

  // Clear onboarding flag on unmount (safety net)
  useEffect(() => {
    return () => { setOnboardingInProgress(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-trigger deployment ONLY for genuinely new users (no stored smart account).
  // MUST wait for clientReady to avoid firing before Zustand hydration completes
  // — otherwise returning users get a MetaMask popup on every app launch.
  // For returning users (store cleared on logout), derive the address and check
  // the backend before triggering MetaMask popups.
  useEffect(() => {
    if (!clientReady || !wallet || deployGuardRef.current || deployPhase !== "idle" || formStep !== "account") return;
    // After hydration, check the actual persisted store value
    const storedAddr = usePortfolioStore.getState().smartAccountAddress;
    if (storedAddr) {
      // Returning user — skip deploy, jump to strategy
      setDeployPhase("deployed");
      deployGuardRef.current = true;
      setFormStep("strategy");
    } else {
      // Derive address locally (no MetaMask signature), then check backend
      deriveAccountAddress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientReady, wallet, deployPhase, formStep]);

  // Derive the smart account address locally (no wallet popup).
  // Check backend to see if this is a returning user.
  // Account deployment is deferred to the single activation UserOp.
  const deriveAccountAddress = async () => {
    if (!wallet) return;
    try {
      const { kernelAccount, kernelClient, smartAccountAddress: derivedAddr } = await createSmartAccount(wallet);
      kernelAccountRef.current = kernelAccount;
      kernelClientRef.current = kernelClient;
      derivedAddressRef.current = derivedAddr;
      setSmartAccountAddress(derivedAddr);

      // Query backend for returning user
      if (ready && authenticated) {
        try {
          const derivedAccountDetail = await api.getAccountDetail(derivedAddr);
          const derivedPortfolio = await api.getPortfolio(derivedAddr).catch(() => null);
          const hasDerivedFunds = portfolioHasFunds(derivedPortfolio);
          if (derivedAccountDetail?.address && derivedAccountDetail.sessionKey?.isActive && hasDerivedFunds) {
            setAgentActivated(true);
            router.replace("/dashboard");
            return;
          }
          if (derivedAccountDetail?.isActive && !derivedAccountDetail?.sessionKey?.isActive && hasDerivedFunds) {
            setRegrantOnlyMode(true);
            setDepositAmount("0");
          }
        } catch {
          // Backend doesn't know this account — new user, that's fine
        }
      }

      setDeployPhase("deployed");
      deployGuardRef.current = true;
      setFormStep("strategy");
    } catch (err) {
      setDeployPhase("error");
      setDeployError(err instanceof Error ? err.message : String(err));
    }
  };

  const finalizeActivationSuccess = async (
    address: string,
    recoveredFromError = false,
    expectedFundsHint = false,
  ) => {
    setActivationPhase("done");
    setOnboardingInProgress(false);

    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["portfolio", address] }),
      queryClient.invalidateQueries({ queryKey: ["rebalance-status", address] }),
      queryClient.invalidateQueries({ queryKey: ["rebalance-history", address] }),
      queryClient.invalidateQueries({ queryKey: ["account-detail", address] }),
    ]);

    const [latestAccountDetailResult, latestPortfolioResult] = await Promise.allSettled([
      api.getAccountDetail(address),
      api.getPortfolio(address),
    ]);

    const latestAccountDetail = latestAccountDetailResult.status === "fulfilled"
      ? latestAccountDetailResult.value
      : null;
    const latestPortfolio = latestPortfolioResult.status === "fulfilled"
      ? latestPortfolioResult.value
      : null;

    const hasLiveSessionKey = Boolean(latestAccountDetail?.isActive && latestAccountDetail?.sessionKey?.isActive);
    const hasLiveFunds = portfolioHasFunds(latestPortfolio) || expectedFundsHint;
    const canEnterDashboard = hasLiveSessionKey && hasLiveFunds;

    setAgentActivated(canEnterDashboard);
    setActivated(canEnterDashboard);

    if (canEnterDashboard) {
      toast.success(
        recoveredFromError
          ? "Activation confirmed. Redirecting to dashboard…"
          : "Agent activated! Redirecting to dashboard…"
      );
      setTimeout(() => router.push("/dashboard?tab=agent-log&activated=1"), 1500);
      return;
    }

    // Zero-balance accounts should stay on onboarding and require a fresh deposit.
    setActivationPhase("idle");
    setFormStep("deposit");
    setDepositAmount("");
    setRegrantOnlyMode(false);
    toast.success("Session key granted. Deposit USDC to finish onboarding.");
  };

  const hasConfirmedActivation = async (address: string): Promise<boolean> => {
    try {
      const accountDetail = await api.getAccountDetail(address);
      return Boolean(accountDetail?.isActive && accountDetail?.sessionKey?.isActive);
    } catch {
      return false;
    }
  };

  // handleAccountDeploy removed — deployment is now part of the single
  // activation UserOp (deployInitialToProtocol). This eliminates one
  // wallet popup and reduces activation to: USDC transfer + session key
  // sign + ONE UserOp (deploy + approve + deposit).

  // Giza-style activation: ERC-20 transfer + session key + register (Signature 2)
  const handleActivate = async () => {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;
    if (regrantOnlyMode && !onboardingPortfolioLoading && !hasRecoverableFunds) {
      setRegrantOnlyMode(false);
      setActivationPhase("idle");
      setFormStep("deposit");
      setDepositAmount("");
      toast.error("No deposited funds found. Please deposit USDC to continue onboarding.");
      return;
    }
    if (!ready || !authenticated || hasAuthError) {
      setActivationPhase("error");
      setActivationError("Authentication expired. Reconnect and re-grant your session key, then retry activation.");
      toast.error("Reconnect and re-grant your session key first.");
      return;
    }
    if (activateGuardRef.current) return;
    activateGuardRef.current = true;
    setActivating(true);
    setOnboardingInProgress(true);

    const effectiveSelectedProtocols = selectedProtocols;
    const requestedAmount = regrantOnlyMode ? "0" : depositAmount;
    const amountWei = parseUnits(requestedAmount || "0", 6);
    let transferRequirementSatisfied = amountWei <= 0n;
    let transferConfirmationUncertain = false;
    let minExpectedSmartAccountBalance = 0n;
    let activationAddress = smartAccountAddress;
    let fundingTransferHash: string | null = null;
    let fundingTransferAmountUsdc: string | null = null;

    try {
      // Preflight auth check before any on-chain action.
      // Prevents transferring/signing when the backend session is already invalid.
      await api.getAccountDetail(smartAccountAddress);

      // Re-derive kernel account/client if refs are stale (e.g. page refresh)
      let kernelAccount = kernelAccountRef.current;
      let kernelClient = kernelClientRef.current;
      let derivedAddr = derivedAddressRef.current ?? smartAccountAddress;

      if (!kernelAccount || !kernelClient) {
        const result = await createSmartAccount(wallet);
        kernelAccount = result.kernelAccount;
        kernelClient = result.kernelClient;
        derivedAddr = result.smartAccountAddress;
        activationAddress = derivedAddr;

        if (derivedAddr.toLowerCase() !== smartAccountAddress.toLowerCase()) {
          setSmartAccountAddress(derivedAddr);
        }
      }

      // Phase 1: Transfer USDC from EOA wallet → smart account
      // Check existing balance and only transfer the shortfall to prevent double-deposits.
      setActivationPhase("transferring-usdc");

      const existingBalance = await withRetry(
        () => withRpcFallback(
          "smart-account USDC balance precheck",
          (client) => client.readContract({
            address: CONTRACTS.USDC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [derivedAddr as `0x${string}`],
          }) as Promise<bigint>,
        ),
        { label: "USDC balanceOf" },
      );

      const shortfall = amountWei > existingBalance ? amountWei - existingBalance : 0n;
      minExpectedSmartAccountBalance = existingBalance + shortfall;
      if (shortfall <= 0n) {
        transferRequirementSatisfied = true;
      }

      if (shortfall > 0n) {
        const provider = await wallet.getEthereumProvider();

        const hexChainId = `0x${CHAIN.id.toString(16)}` as const;
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexChainId }],
          });
        } catch (switchErr: unknown) {
          const code = typeof switchErr === 'object' && switchErr !== null && 'code' in switchErr ? (switchErr as { code: number }).code : 0;
          if (code === 4902 || code === -32603) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: hexChainId,
                chainName: CHAIN.name,
                nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
                rpcUrls: [AVALANCHE_RPC_URL],
                blockExplorerUrls: [EXPLORER.base],
              }],
            });
          } else {
            throw new Error(
              "Failed to switch to Avalanche network. Please manually switch your wallet to Avalanche C-Chain and try again."
            );
          }
        }

        const walletClient = createWalletClient({
          chain: CHAIN,
          transport: custom(provider),
        });
        const [eoaAddress] = await walletClient.getAddresses();

        // Pre-flight check: verify EOA has enough USDC
        const eoaUsdcBalance = await withRpcFallback(
          "EOA USDC balance precheck",
          (client) => client.readContract({
            address: CONTRACTS.USDC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [eoaAddress],
          }) as Promise<bigint>,
        );
        if (eoaUsdcBalance < shortfall) {
          throw new Error(
            `Insufficient USDC balance. You need ${formatUnits(shortfall, 6)} USDC but only have ${formatUnits(eoaUsdcBalance, 6)} USDC in your wallet. ` +
            `Please add more USDC to your wallet and try again.`
          );
        }

        // Transfer USDC. Some mobile wallets reject viem's transaction path
        // with -32602 invalid params; fall back to raw eth_sendTransaction.
        const transferData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [derivedAddr as `0x${string}`, shortfall],
        });

        const toHex = (value: bigint) => `0x${value.toString(16)}`;

        let transferHash: `0x${string}` | undefined;
        try {
          transferHash = await walletClient.sendTransaction({
            account: eoaAddress as `0x${string}`,
            to: CONTRACTS.USDC,
            data: transferData,
            value: 0n,
          });
        } catch (transferErr: unknown) {
          const transferMsg = transferErr instanceof Error ? transferErr.message : String(transferErr);

          // Re-throw user rejection as-is
          if (transferMsg.includes("User denied") || transferMsg.includes("User rejected")) {
            throw transferErr;
          }

          const isInvalidParams =
            transferMsg.includes("Missing or invalid parameters") ||
            transferMsg.includes("invalid params") ||
            transferMsg.includes("-32602");

          if (isInvalidParams) {
            try {
              const estimatedGas = await withRpcFallback(
                "USDC transfer gas estimate",
                (client) => client.estimateGas({
                  account: eoaAddress,
                  to: CONTRACTS.USDC,
                  data: transferData,
                  value: 0n,
                }),
              ).catch(() => 120000n);
              const gasLimit = estimatedGas + (estimatedGas / 5n);

              const fees = await withRpcFallback(
                "USDC transfer fee estimate",
                (client) => client.estimateFeesPerGas(),
              ).catch(() => null);
              const pendingNonce = await withRpcFallback(
                "EOA pending nonce",
                (client) => client.getTransactionCount({ address: eoaAddress, blockTag: "pending" }),
              ).catch(() => null);
              const walletChainId = await provider
                .request({ method: "eth_chainId" })
                .catch(() => hexChainId) as string;

              const feeFields: Record<string, string> = {};
              if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
                feeFields.maxFeePerGas = toHex(fees.maxFeePerGas);
                feeFields.maxPriorityFeePerGas = toHex(fees.maxPriorityFeePerGas);
              } else if (fees?.gasPrice) {
                feeFields.gasPrice = toHex(fees.gasPrice);
              }

              const baseTx: Record<string, string> = {
                from: eoaAddress,
                to: CONTRACTS.USDC,
                value: "0x0",
              };

              const fullTxFields: Record<string, string> = {
                chainId: walletChainId,
                gas: toHex(gasLimit),
                ...(pendingNonce !== null ? { nonce: toHex(BigInt(pendingNonce)) } : {}),
                ...feeFields,
              };

              const fallbackVariants: Record<string, string>[] = [
                { ...baseTx, data: transferData },
                { ...baseTx, input: transferData },
                { ...baseTx, data: transferData, ...fullTxFields },
                { ...baseTx, input: transferData, ...fullTxFields },
              ];

              const fallbackErrors: string[] = [];
              for (const txParams of fallbackVariants) {
                try {
                  const fallbackHash = await provider.request({
                    method: "eth_sendTransaction",
                    params: [txParams],
                  }) as `0x${string}`;
                  if (fallbackHash) {
                    transferHash = fallbackHash;
                    break;
                  }
                } catch (fallbackVariantErr: unknown) {
                  const fallbackVariantMsg = fallbackVariantErr instanceof Error
                    ? fallbackVariantErr.message
                    : String(fallbackVariantErr);
                  fallbackErrors.push(fallbackVariantMsg.slice(0, 160));
                }
              }

              if (!transferHash) {
                throw new Error(
                  `No wallet-compatible transaction shape accepted. Attempts: ${fallbackErrors.join(" | ")}`
                );
              }
            } catch (fallbackErr: unknown) {
              const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
              throw new Error(
                "USDC transfer failed — wallet rejected transaction parameters in both standard and mobile-compatible modes. " +
                `Primary error: ${transferMsg.slice(0, 140)}. ` +
                `Fallback error: ${fallbackMsg.slice(0, 140)}. ` +
                "Please ensure Avalanche C-Chain is selected and your wallet app is up to date."
              );
            }
          } else if (transferMsg.includes("insufficient funds") || transferMsg.includes("gas required exceeds")) {
            throw new Error(
              "USDC transfer failed in your wallet. Please confirm Avalanche C-Chain is selected and retry the transfer."
            );
          } else {
            throw new Error(`USDC transfer failed: ${transferMsg.slice(0, 200)}`);
          }
        }

        if (!transferHash) {
          throw new Error("USDC transfer failed: no transaction hash returned by wallet.");
        }

        fundingTransferHash = transferHash;
        fundingTransferAmountUsdc = formatUnits(shortfall, 6);

        try {
          await waitForTransferConfirmationWithFallback({
            transferHash,
            recipient: derivedAddr as `0x${string}`,
            minRecipientBalance: minExpectedSmartAccountBalance,
            walletProvider: provider as Eip1193Provider,
          });
          transferRequirementSatisfied = true;
          toast.success("USDC transferred to smart account!");
        } catch (confirmErr: unknown) {
          const confirmMsg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr);
          const confirmationUncertain =
            confirmMsg.includes("confirmation could not be verified due RPC instability")
            || isRpcTransportFailure(confirmMsg);

          if (!confirmationUncertain) {
            throw confirmErr;
          }

          transferConfirmationUncertain = true;
          toast.info(
            "Transfer submitted. Confirmation is delayed by RPC instability; continuing activation without sending a duplicate transfer.",
          );
        }
      } else {
        transferRequirementSatisfied = true;
        if (amountWei > 0n) {
          toast.success("Smart account already funded — skipping transfer.");
        } else {
          toast.success("Re-grant mode detected — no new deposit transfer required.");
        }
      }

      // Phase 1b: account deployment is handled automatically by the first
      // UserOp below (deployInitialToProtocol). ERC-4337 counterfactual
      // deployment means the bundler deploys the account as part of the
      // first UserOp — no separate step needed.

      // Phase 2: Grant session key
      setActivationPhase("granting-session-key");
      const sessionKeyResult = await withRetry(
        () => grantAndSerializeSessionKey(
          kernelAccount,
          kernelClient,
          {
            AAVE_POOL: CONTRACTS.AAVE_POOL,
            BENQI_POOL: CONTRACTS.BENQI_POOL,
            SPARK_VAULT: CONTRACTS.SPARK_VAULT,
            EULER_VAULT: CONTRACTS.EULER_VAULT,
            SILO_SAVUSD_VAULT: CONTRACTS.SILO_SAVUSD_VAULT,
            SILO_SUSDP_VAULT: CONTRACTS.SILO_SUSDP_VAULT,
            USDC: CONTRACTS.USDC,
            TREASURY: CONTRACTS.TREASURY,
            PERMIT2: CONTRACTS.PERMIT2,
            REGISTRY: CONTRACTS.REGISTRY,
          },
          {
            maxAmountUSDC: Math.max(effectiveDepositAmount * 2, 50_000),
            durationDays: 30,
            maxOpsPerDay: 20,
            userEOA: wallet.address as `0x${string}`,
          },
        ),
        { maxRetries: 2, label: "grantAndSerializeSessionKey" },
      );

      // Phase 3: Skip frontend deployment — backend handles it reliably.
      // Previously deployInitialViaPermissionAccount() sent a UserOp here,
      // but the ZeroDev bundler rejects re-onboarding enable-mode UserOps
      // with "duplicate permissionHash" (bundler mempool deduplication).
      // The enable signature from Phase 2 is preserved in the serialized
      // permission blob; the execution service piggybacks it on the first
      // rebalance UserOp via _trigger_initial_rebalance.
      console.log("[Onboarding] Skipping frontend deploy — backend handles deployment via session key.");

      // Phase 4: Register account with backend — optimizer handles future rebalances
      setActivationPhase("registering-backend");
      await api.registerAccount({
        smartAccountAddress: derivedAddr,
        ownerAddress: wallet.address,
        diversificationPreference: diversificationPref,
        fundingTxHash: fundingTransferHash ?? undefined,
        fundingAmountUsdc: fundingTransferAmountUsdc ?? undefined,
        fundingSource: fundingTransferHash ? "onboarding_wallet_transfer" : undefined,
        sessionKeyData: {
          serializedPermission: sessionKeyResult.serializedPermission,
          sessionPrivateKey: sessionKeyResult.sessionPrivateKey,
          sessionKeyAddress: sessionKeyResult.sessionKeyAddress,
          expiresAt: sessionKeyResult.expiresAt,
          allowedProtocols: Array.from(effectiveSelectedProtocols),
          allocationCaps: allocationCaps,
        },
      });

      // Backup store only when register path did not leave an active key.
      // Avoid unnecessary double key writes, which can race with the initial
      // rebalance trigger and temporarily flip key activity mid-flight.
      let registerPersistedSessionKey = false;
      try {
        const postRegisterDetail = await api.getAccountDetail(derivedAddr);
        registerPersistedSessionKey = Boolean(
          postRegisterDetail?.isActive && postRegisterDetail?.sessionKey?.isActive,
        );
      } catch {
        registerPersistedSessionKey = false;
      }

      if (!registerPersistedSessionKey) {
        try {
          await api.storeSessionKey(derivedAddr, {
            serializedPermission: sessionKeyResult.serializedPermission,
            sessionPrivateKey: sessionKeyResult.sessionPrivateKey,
            sessionKeyAddress: sessionKeyResult.sessionKeyAddress,
            expiresAt: sessionKeyResult.expiresAt,
            allowedProtocols: Array.from(effectiveSelectedProtocols),
            allocationCaps: allocationCaps,
            force: true,
          });
        } catch {
          // Non-critical — user can always re-grant from settings.
        }
      }

      // Best-effort diversification preference save
      try {
        await api.saveDiversificationPreference(derivedAddr, diversificationPref);
      } catch { /* non-critical — default is balanced */ }

      if (
        !transferRequirementSatisfied
        && transferConfirmationUncertain
        && !hasRecoverableFunds
      ) {
        try {
          const postTransferBalance = await withRetry(
            () => withRpcFallback(
              "smart-account USDC balance post-transfer verify",
              (client) => client.readContract({
                address: CONTRACTS.USDC as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [derivedAddr as `0x${string}`],
              }) as Promise<bigint>,
            ),
            { label: "post-transfer balance verify", maxRetries: 2 },
          );
          if (postTransferBalance >= minExpectedSmartAccountBalance) {
            transferRequirementSatisfied = true;
          }
        } catch {
          // Non-fatal: if verification still fails, finalizeActivationSuccess
          // will keep the user on onboarding until funds are actually visible.
        }
      }

      const expectedFundsAfterActivation = hasRecoverableFunds || transferRequirementSatisfied;
      await finalizeActivationSuccess(derivedAddr, false, expectedFundsAfterActivation);
    } catch (err) {
      activateGuardRef.current = false;
      setOnboardingInProgress(false);

      if (err instanceof APIError && err.status === 401) {
        setActivationPhase("error");
        setActivationError(
          "Authentication expired while activating. Reconnect and re-grant your session key, then retry. "
          + "Your funds remain safe in your smart account."
        );
        toast.error("Session expired. Reconnect and re-grant, then retry activation.");
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);

      if (activationAddress && await hasConfirmedActivation(activationAddress)) {
        await finalizeActivationSuccess(activationAddress, true, hasPortfolioFunds);
        return;
      }

      if (msg.includes("User denied") || msg.includes("User rejected")) {
        // User cancelled — go back to review state, don't show error phase
        setActivationPhase("idle");
        toast.error("Transaction cancelled.");
      } else if (msg.includes("codepoint") || msg.includes("UNEXPECTED_CONTINUE")) {
        // Wallet can't handle bytes fields in EIP-712 typed data (e.g. Core wallet)
        setActivationPhase("error");
        setActivationError(
          "Your wallet cannot process the advanced signing request required for activation. " +
          "This is a known compatibility issue with some wallets (including Core wallet). " +
          "Please try connecting with MetaMask or another EVM-compatible wallet."
        );
        toast.error("Wallet compatibility issue — try MetaMask instead.");
      } else if (msg.includes("Insufficient USDC")) {
        setActivationPhase("error");
        setActivationError(msg);
        toast.error("Insufficient USDC balance.");
      } else if (msg.includes("confirmation could not be verified due RPC instability")) {
        // Do not show hard-failure UI for transient confirmation instability.
        // Retry starts from a smart-account balance precheck, so duplicate
        // transfer is prevented even if the first transfer confirmed late.
        setActivationPhase("idle");
        setActivationError(null);
        toast.info("Transfer submitted. Retry Activation in a few seconds; duplicate transfer is prevented.");
      } else if (isRpcTransportFailure(msg)) {
        setActivationPhase("error");
        setActivationError(sanitizeActivationErrorMessage(msg));
        toast.error("Avalanche RPC is unstable right now. Retry activation in a few seconds.");
      } else if (msg.includes("USDC transfer failed") || msg.includes("invalid parameters")) {
        setActivationPhase("error");
        setActivationError(sanitizeActivationErrorMessage(msg));
        toast.error("Transfer failed in wallet — please retry.");
      } else if (msg.includes("Failed to switch")) {
        setActivationPhase("error");
        setActivationError(msg);
        toast.error("Please switch to Avalanche network manually.");
      } else {
        setActivationPhase("error");
        setActivationError(sanitizeActivationErrorMessage(msg));
        toast.error("Activation failed. You can retry — your funds are safe.");
      }
    } finally {
      setActivating(false);
    }
  };

  // Step config for the progress bar
  const steps: { id: FormStep; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "strategy", label: "Strategy" },
    { id: "deposit", label: "Deposit" },
    { id: "activate", label: "Activate" },
  ];

  const stepIndex = steps.findIndex((s) => s.id === formStep);
  const isStrategyStep = formStep === "strategy";

  return (
    <div
      className={cn(
        "mx-auto w-full px-3 py-8 sm:px-0 sm:py-10",
        isStrategyStep ? "max-w-4xl" : "max-w-lg",
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-8"
      >
        {/* Header */}
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold text-[#1A1715]">
            {activated ? "Agent Activated" : "Set Up Your Agent"}
          </h1>
          <p className="mt-2 text-sm text-[#5C5550]">
            {activated
              ? "Your agent is now optimizing yield."
              : "Complete each step to activate autonomous yield optimization."}
          </p>
        </div>

        {hasAuthError && (
          <div className="rounded-xl border border-[#DC2626]/20 bg-[#DC2626]/5 p-4">
            <p className="text-sm font-medium text-[#DC2626]">
              Session expired or authentication mismatch.
            </p>
            <p className="mt-1 text-xs text-[#5C5550]">
              Refresh your login, then re-grant the session key to restore dashboard access.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  void handleRegrantRecovery();
                }}
                disabled={isReauthenticating}
                className="rounded-lg bg-[#E84142] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#D63031]"
              >
                {isReauthenticating ? "Preparing Re-grant..." : "Re-grant Session Key"}
              </button>
              <button
                onClick={() => router.replace("/")}
                className="rounded-lg border border-[#E8E2DA] px-3 py-1.5 text-xs font-medium text-[#5C5550] hover:border-[#D4CEC7]"
              >
                Go to Landing
              </button>
            </div>
          </div>
        )}

        {/* Step progress bar */}
        <div className="overflow-x-auto pb-1">
          <div className="mx-auto flex min-w-max items-center justify-center px-1">
            {steps.map((step, i) => {
              const isDone = i < stepIndex || activated;
              const isCurrent = i === stepIndex && !activated;
              return (
                <div key={step.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all sm:h-8 sm:w-8 sm:text-xs",
                        isDone
                          ? "bg-[#059669] text-white"
                          : isCurrent
                            ? "bg-[#E84142] text-white"
                            : "bg-[#E8E2DA] text-[#8A837C]",
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span className="mt-1.5 text-[10px] font-medium text-[#5C5550]">
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={cn(
                        "mx-2 mb-5 h-px w-10 sm:mx-3 sm:w-16",
                        isDone ? "bg-[#059669]" : "bg-[#E8E2DA]",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Step 1: Account ─── */}
        <AnimatePresence mode="wait">
          {formStep === "account" && !activated && (
            <motion.div
              key="step-account"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                  <Shield className="h-3.5 w-3.5 text-[#E84142]" />
                </div>
                <span className="text-sm font-medium text-[#1A1715]">
                  Smart Account
                </span>
              </div>

              {smartAccount.setupStep === "creating" && (
                <div className="flex items-center gap-3 rounded-lg bg-[#F5F0EB] p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-[#E84142]" />
                  <div>
                    <p className="text-sm font-medium text-[#1A1715]">
                      Creating your smart account…
                    </p>
                    <p className="text-xs text-[#8A837C]">
                      Building your ZeroDev Kernel v3.1 account on Avalanche.
                    </p>
                  </div>
                </div>
              )}

              {smartAccount.setupStep === "error" && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/20 p-4">
                    <p className="text-sm font-medium text-[#DC2626]">Setup failed</p>
                    <p className="mt-1 text-xs text-[#5C5550]">
                      {smartAccount.error || "Something went wrong creating your account."}
                    </p>
                  </div>
                  <button
                    onClick={smartAccount.retry}
                    className="flex items-center gap-2 rounded-lg border border-[#E84142]/30 px-4 py-2 text-sm font-medium text-[#E84142] hover:bg-[#E84142]/5"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {isAccountReady && (
                <>
                  <p className="text-xs text-[#8A837C]">
                    Your self-custodial smart account address on Avalanche.
                  </p>
                  <div className="flex items-center gap-2 rounded-lg bg-[#F5F0EB] px-3 py-2.5">
                    <code className="flex-1 truncate font-mono text-xs text-[#1A1715]">
                      {smartAccountAddress}
                    </code>
                    <button onClick={handleCopy} className="text-[#8A837C] hover:text-[#1A1715]">
                      {copied ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {smartAccountAddress && (
                      <a
                        href={EXPLORER.address(smartAccountAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#8A837C] hover:text-[#1A1715]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  {/* Deployment progress removed — deployment now happens in single activation UserOp */}

                  {deployPhase === "error" && (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/20 p-4">
                        <p className="text-sm font-medium text-[#DC2626]">Setup failed</p>
                        {deployError && (
                          <p className="mt-1 text-xs text-[#5C5550]">{deployError}</p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          deployGuardRef.current = false;
                          setDeployPhase("idle");
                          setDeployError(null);
                          deriveAccountAddress();
                        }}
                        className="flex items-center gap-2 rounded-lg border border-[#E84142]/30 px-4 py-2 text-sm font-medium text-[#E84142] hover:bg-[#E84142]/5"
                      >
                        Try Again
                      </button>
                    </div>
                  )}

                  {deployPhase === "deployed" && (
                    <div className="flex items-center gap-3 rounded-lg bg-[#059669]/5 border border-[#059669]/20 p-4">
                      <CheckCircle2 className="h-5 w-5 text-[#059669]" />
                      <div>
                        <p className="text-sm font-medium text-[#059669]">
                          Account ready
                        </p>
                        <p className="text-xs text-[#8A837C]">
                          Your smart account address is derived. It will be deployed on-chain during activation.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2.5">
                      <Shield className="h-4 w-4 text-[#E84142] shrink-0" />
                      <span className="text-xs text-[#5C5550]">Non-custodial</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-[#EDE8E3]/30 px-3 py-2.5">
                      <Zap className="h-4 w-4 text-[#059669] shrink-0" />
                      <span className="text-xs text-[#5C5550]">Gas sponsored</span>
                    </div>
                  </div>

                  {deployPhase === "deployed" && (
                    <button
                      onClick={() => setFormStep("strategy")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031]"
                    >
                      Continue
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ─── Step 2: Strategy ─── */}
          {formStep === "strategy" && !activated && (
            <motion.div
              key="step-strategy"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                  <LayoutGrid className="h-3.5 w-3.5 text-[#E84142]" />
                </div>
                <span className="text-sm font-medium text-[#1A1715]">
                  Choose Markets
                </span>
              </div>

              <p className="text-xs text-[#8A837C]">
                Select markets your optimizer can use and set per-market max exposure.
                Risk score is out of 9 (higher is safer).
              </p>

              {regrantOnlyMode && (
                <div className="rounded-lg border border-[#F59E0B]/20 bg-[#FEF3C7] p-3">
                  <p className="text-[11px] text-[#92400E]">
                    Existing account detected without an active session key. Re-granting is required.
                    No additional deposit is needed.
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-[#E8E2DA] bg-[#F5F0EB] px-3 py-2.5 text-[11px] text-[#5C5550]">
                Fee: Free (beta)
              </div>

              {/* Best APY summary */}
              <div className="flex items-center justify-between rounded-lg bg-[#F5F0EB] px-3 py-2.5">
                <span className="text-xs text-[#8A837C]">Best available APY</span>
                <span className="font-mono text-sm font-bold text-[#059669]">{bestApy.toFixed(2)}%</span>
              </div>

              {/* Protocol table */}
              <div className="overflow-hidden rounded-lg border border-[#E8E2DA]">
                {/* Mobile header */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-[#F5F0EB] px-3 py-2 md:hidden">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Protocol</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C] text-center">Active</span>
                </div>

                {/* Desktop table header */}
                <div className="hidden grid-cols-[minmax(0,1.6fr)_120px_80px_90px_90px] items-center gap-2 bg-[#F5F0EB] px-3 py-2 md:grid">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Protocol</span>
                  <span className="text-center text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Max Exposure</span>
                  <span className="text-right text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">APY</span>
                  <span className="text-right text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">TVL</span>
                  <span className="text-center text-[10px] font-medium uppercase tracking-wider text-[#8A837C]">Active</span>
                </div>

                {/* Protocol rows */}
                {MARKET_PROTOCOLS.map((protocol, idx) => {
                  const protocolId = protocol.id as ProtocolId;
                  const isSelected = selectedProtocols.has(protocolId);
                  const rateData = rateByProtocol.get(protocol.id as ProtocolId);
                  const tvl = rateData?.tvlUsd;
                  const apy = rateData?.currentApy;
                  const isEnabled = protocol.isActive;
                  const apyLabel = apy != null && apy > 0
                    ? `${(apy * 100).toFixed(2)}%`
                    : "-";
                  const tvlLabel = tvl != null && tvl > 0
                    ? `$${tvl >= 1e9 ? `${(tvl / 1e9).toFixed(1)}B` : tvl >= 1e6 ? `${(tvl / 1e6).toFixed(1)}M` : `${(tvl / 1e3).toFixed(0)}K`}`
                    : "-";
                  const displayCap = allocationCaps[protocolId] ?? 100;
                  const isEditingRow = editingCapProtocolId === protocolId;
                  const displayRiskScore = rateData && Number.isFinite(rateData.riskScore)
                    ? Math.round(rateData.riskScore)
                    : protocol.riskScore;
                  const displayRiskScoreMax = rateData && Number.isFinite(rateData.riskScoreMax)
                    ? Math.max(1, Math.round(rateData.riskScoreMax))
                    : RISK_SCORE_MAX;
                  const riskRatio = displayRiskScoreMax > 0
                    ? displayRiskScore / displayRiskScoreMax
                    : 0;
                  const riskToneClass = riskRatio >= 0.75
                    ? "bg-[#059669]/10 text-[#059669]"
                    : riskRatio >= 0.5
                      ? "bg-[#D97706]/10 text-[#D97706]"
                      : "bg-[#DC2626]/10 text-[#DC2626]";

                  return (
                    <div
                      key={protocol.id}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 transition-all cursor-pointer md:grid-cols-[minmax(0,1.6fr)_120px_80px_90px_90px] md:items-center",
                        idx > 0 && "border-t border-[#E8E2DA]",
                        !isEnabled && "cursor-not-allowed opacity-55",
                        isSelected ? "bg-[#E84142]/[0.03]" : "bg-white opacity-60",
                        isEditingRow && "bg-[#FFF4F3] shadow-[inset_0_0_0_1px_rgba(232,65,66,0.35)]",
                        editingCapProtocolId && !isEditingRow && "opacity-55",
                      )}
                      onClick={() => {
                        if (editingCapProtocolId) return;
                        toggleProtocol(protocolId, isEnabled);
                      }}
                    >
                      {/* Protocol info */}
                      <div className="flex min-w-0 items-start gap-3 md:order-1">
                        <Image
                          src={protocol.logoPath}
                          alt={protocol.name}
                          width={32}
                          height={32}
                          className="rounded-full shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-medium leading-tight text-[#1A1715]">
                              <span className="sm:hidden">{protocol.shortName}</span>
                              <span className="hidden sm:inline">{protocol.name}</span>
                            </p>
                            <span
                              className="rounded bg-[#111111]/5 px-1.5 py-0.5 text-[9px] font-mono text-[#5C5550]"
                              title="Risk score is out of 9. Higher is safer."
                            >
                              Risk {displayRiskScore}/{displayRiskScoreMax}
                            </span>
                            {!isEnabled && (
                              <span className="rounded bg-[#E8E2DA] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[#8A837C]">
                                Soon
                              </span>
                            )}
                            {protocol.vaultUrl && (
                              <a
                                href={protocol.vaultUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 text-[#8A837C] transition-colors hover:text-[#E84142]"
                                title={`View ${protocol.name} vault`}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <p className="mt-0.5 hidden text-[10px] text-[#8A837C] sm:block">
                            {protocol.category}, {protocol.asset}
                          </p>
                        </div>
                      </div>

                      {/* Max exposure (desktop) */}
                      <div className="hidden justify-center md:order-2 md:flex">
                        {isEditingRow ? (
                          <div className="flex items-center gap-2 rounded-full border border-[#E84142]/25 bg-white px-2 py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                adjustPendingCap(-1);
                              }}
                              className="rounded-full p-1 text-[#5C5550] transition-colors hover:bg-[#E84142]/10 hover:text-[#E84142] disabled:opacity-40"
                              disabled={pendingCapPct <= 10}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-10 text-center font-mono text-xs font-semibold text-[#E84142]">
                              {pendingCapPct}%
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                adjustPendingCap(1);
                              }}
                              className="rounded-full p-1 text-[#5C5550] transition-colors hover:bg-[#E84142]/10 hover:text-[#E84142] disabled:opacity-40"
                              disabled={pendingCapPct >= 100}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-[#1A1715]">{displayCap}%</span>
                            {isSelected && isEnabled && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCapEditor(protocolId);
                                }}
                                className="rounded-full p-1 text-[#8A837C] transition-colors hover:bg-[#1A1715]/5 hover:text-[#1A1715]"
                                title="Edit max exposure"
                                disabled={editingCapProtocolId !== null && !isEditingRow}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* APY (desktop) */}
                      <span className="hidden text-right font-mono text-[11px] font-semibold text-[#059669] md:order-3 md:block">
                        {apyLabel}
                      </span>

                      {/* TVL (desktop) */}
                      <span className="hidden text-right font-mono text-[11px] text-[#5C5550] md:order-4 md:block">
                        {tvlLabel}
                      </span>

                      {/* Toggle / row actions */}
                      <div className="flex items-center justify-center gap-1.5 self-center md:order-5">
                        {isEditingRow ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelCapEdit();
                              }}
                              className="rounded-full bg-[#FEE2E2] p-1 text-[#B91C1C] transition-colors hover:bg-[#FECACA]"
                              title="Cancel"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmCapEdit();
                              }}
                              className="rounded-full bg-[#E84142] p-1 text-white transition-colors hover:bg-[#D63031]"
                              title="Apply"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleProtocol(protocolId, isEnabled);
                            }}
                            className={cn(
                              "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                              !isEnabled && "opacity-40",
                              isSelected ? "bg-[#E84142]" : "bg-[#E8E2DA]",
                            )}
                            disabled={!isEnabled || (editingCapProtocolId !== null && !isEditingRow)}
                          >
                            <div
                              className={cn(
                                "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                isSelected ? "translate-x-4" : "translate-x-0",
                              )}
                            />
                          </button>
                        )}
                      </div>

                      {/* Compact mobile metrics */}
                      <div className="col-span-2 grid grid-cols-3 gap-2 rounded-md bg-[#F8F4EF] px-2.5 py-2 md:hidden">
                        <div>
                          <p className="text-[9px] uppercase tracking-wide text-[#8A837C]">Risk</p>
                          <span className={cn(
                            "mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                            riskToneClass,
                          )}>
                            {displayRiskScore}/{displayRiskScoreMax}
                          </span>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wide text-[#8A837C]">APY</p>
                          <p className="mt-1 font-mono text-[11px] font-semibold text-[#059669]">{apyLabel}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wide text-[#8A837C]">TVL</p>
                          <p className="mt-1 font-mono text-[11px] text-[#5C5550]">{tvlLabel}</p>
                        </div>
                      </div>

                      <div className="col-span-2 flex items-center justify-between rounded-md bg-[#F8F4EF] px-2.5 py-2 md:hidden">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-[#8A837C]">Max Exposure</span>
                          {isEditingRow ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  adjustPendingCap(-1);
                                }}
                                className="rounded-full bg-[#1A1715]/10 p-1 text-[#1A1715] disabled:opacity-40"
                                disabled={pendingCapPct <= 10}
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="font-mono text-xs font-semibold text-[#E84142]">{pendingCapPct}%</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  adjustPendingCap(1);
                                }}
                                className="rounded-full bg-[#1A1715]/10 p-1 text-[#1A1715] disabled:opacity-40"
                                disabled={pendingCapPct >= 100}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <span className="font-mono text-xs font-semibold text-[#1A1715]">{displayCap}%</span>
                          )}
                        </div>
                        {isEditingRow ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelCapEdit();
                              }}
                              className="rounded-full bg-[#FEE2E2] p-1 text-[#B91C1C]"
                              title="Cancel"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmCapEdit();
                              }}
                              className="rounded-full bg-[#E84142] p-1 text-white"
                              title="Apply"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          </div>
                        ) : isSelected && isEnabled ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openCapEditor(protocolId);
                            }}
                            className="rounded-full p-1 text-[#8A837C] hover:bg-[#1A1715]/5"
                            title="Edit max exposure"
                            disabled={editingCapProtocolId !== null && !isEditingRow}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  onClick={() => setFormStep("account")}
                  className="flex items-center justify-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-3 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7] sm:justify-start"
                >
                  Back
                </button>
                <button
                  onClick={() => setFormStep(regrantOnlyMode ? "activate" : "deposit")}
                  disabled={selectedCount === 0 || !hasDeployableSelectedProtocol}
                  className="flex w-full flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                >
                  {regrantOnlyMode ? "Continue to Re-grant" : "Continue"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <p className="text-[11px] text-[#8A837C]">
                Scores reflect SnowMind&apos;s independent assessment based on publicly available on-chain data and documentation. They are not endorsements or financial advice. Users should conduct their own research before making decisions.
              </p>
            </motion.div>
          )}

            {/* ─── Step 3: Deposit ─── */}
            {formStep === "deposit" && !activated && (
              <motion.div
                key="step-deposit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="rounded-xl border border-[#E8E2DA] bg-white p-6 space-y-5"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                    <Wallet className="h-3.5 w-3.5 text-[#E84142]" />
                  </div>
                  <span className="text-sm font-medium text-[#1A1715]">
                    Choose Deposit Amount
                  </span>
                </div>

                <p className="text-xs text-[#8A837C]">
                  Choose how much USDC to deposit. It will be transferred from your wallet
                  and deployed to earn yield automatically.
                </p>

                <div className="flex items-center gap-2 rounded-lg bg-[#F5F0EB] px-3 py-2.5">
                  <span className="text-sm font-medium text-[#5C5550]">$</span>
                  <input
                    type="number"
                    min="1"
                    max={eoaBalanceNum}
                    step="0.01"
                    placeholder="Enter amount"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="flex-1 bg-transparent font-mono text-base text-[#1A1715] outline-none placeholder:text-[#C4BEB8] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs font-medium text-[#8A837C]">USDC</span>
                  {eoaBalanceNum > 0 && (
                    <button
                      onClick={() => setDepositAmount(eoaBalanceNum.toFixed(2))}
                      className="rounded-md bg-[#E84142]/10 px-2 py-0.5 text-[10px] font-semibold text-[#E84142] hover:bg-[#E84142]/20 transition-colors"
                    >
                      MAX
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-[#8A837C]">
                  <span>Wallet balance: ${eoaBalanceNum.toFixed(2)} USDC</span>
                  {parsedAmount > eoaBalanceNum && (
                    <span className="text-[#DC2626]">Exceeds balance</span>
                  )}
                  {!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < 1 && (
                    <span className="text-[#DC2626]">Min $1.00</span>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  <button
                    onClick={() => setFormStep("strategy")}
                    className="flex items-center justify-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-3 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7] sm:justify-start"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep("activate")}
                    disabled={!isValidAmount}
                    className="flex w-full flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

          {/* ─── Step 4: Activate ─── */}
          {formStep === "activate" && !activated && (
            <motion.div
              key="step-activate"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="rounded-xl border border-[#E84142]/20 bg-white p-6 space-y-5"
            >
              {activating ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-[#1A1715]">
                    <Loader2 className="h-5 w-5 animate-spin text-[#E84142]" />
                    Launching your agent…
                  </div>

                  <div className="space-y-2.5 rounded-lg bg-[#F5F0EB] p-4">
                    {(["transferring-usdc", "granting-session-key", "registering-backend"] as const).map((phase) => {
                      const allPhases = ["transferring-usdc", "granting-session-key", "registering-backend"] as const;
                      const phaseIndex = allPhases.indexOf(phase);
                      const currentIndex = allPhases.indexOf(activationPhase as typeof allPhases[number]);
                      const isDone = currentIndex > phaseIndex || activationPhase === "done";
                      const isCurrent = activationPhase === phase;

                      const icons: Record<string, typeof Shield> = {
                        "transferring-usdc": Wallet,
                        "granting-session-key": Shield,
                        "registering-backend": Zap,
                      };
                      const Icon = icons[phase];

                      return (
                        <div key={phase} className="flex items-center gap-3">
                          <div className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all",
                            isDone ? "bg-[#059669] text-white" :
                            isCurrent ? "bg-[#E84142] text-white" :
                            "bg-[#E8E2DA] text-[#8A837C]"
                          )}>
                            {isDone ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : isCurrent ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Icon className="h-3 w-3" />
                            )}
                          </div>
                          <span className={cn(
                            "text-xs",
                            isDone ? "text-[#059669]" :
                            isCurrent ? "font-medium text-[#1A1715]" :
                            "text-[#8A837C]"
                          )}>
                            {PHASE_LABELS[phase]}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-center text-xs text-[#8A837C]">
                    This may require a wallet signature. Do not close this page.
                  </p>
                </div>
              ) : activationPhase === "error" ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#DC2626]/10">
                      <Shield className="h-5 w-5 text-[#DC2626]" />
                    </div>
                    <p className="text-sm font-medium text-[#DC2626]">Activation failed</p>
                    <p className="text-xs text-[#5C5550]">
                      Your funds are safe in your smart account. You can retry the activation.
                    </p>
                  </div>

                  {activationError && (
                    <div className="rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/15 p-3">
                      <p className="text-[11px] font-mono text-[#5C5550] break-words">{activationError}</p>
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-3 sm:flex-row">
                    <button
                      onClick={() => { setActivationPhase("idle"); setActivationError(null); }}
                      className="flex items-center justify-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-2.5 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7] sm:justify-start"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => { setActivationError(null); void handleActivate(); }}
                      disabled={!wallet || hasAuthError || !ready || !authenticated}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                    >
                      <Zap className="h-4 w-4" />
                      Retry Activation
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E84142]/10">
                      <Zap className="h-3.5 w-3.5 text-[#E84142]" />
                    </div>
                    <span className="text-sm font-medium text-[#1A1715]">
                      Review &amp; Activate
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#F5F0EB] p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] text-[#8A837C]">Deposit</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#1A1715]">
                          {regrantOnlyMode ? "No new deposit" : `$${effectiveDepositAmount.toFixed(2)} USDC`}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">APY</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#1A1715]">{bestApy.toFixed(2)}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">Fee</p>
                        <p className="mt-0.5 text-xs font-semibold text-[#059669]">Free (beta)</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">You&apos;ll earn /per year</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#059669]">${yearlyEarning.toFixed(2)} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A837C]">Markets</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#1A1715]">{selectedCount} {selectedCount === 1 ? 'market' : 'markets'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#FEF3C7] border border-[#F59E0B]/20 p-3">
                    <p className="text-[11px] text-[#92400E]">
                      <span className="font-semibold">Wallet note:</span> Your wallet will ask you to sign a permission grant.
                      Some wallets (e.g. Core) may show a &quot;Scam transaction&quot; warning — this is a false positive.
                      It&apos;s safe to proceed. We only request limited, time-bound DeFi permissions for your account.
                    </p>
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row">
                    <button
                      onClick={() => setFormStep(regrantOnlyMode ? "strategy" : "deposit")}
                      className="flex items-center justify-center gap-1 rounded-xl border border-[#E8E2DA] px-4 py-3 text-sm font-medium text-[#5C5550] transition-all hover:border-[#D4CEC7] sm:justify-start"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => {
                        void handleActivate();
                      }}
                      disabled={!wallet || !isValidAmount || hasAuthError || !ready || !authenticated}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
                    >
                      <Zap className="h-4 w-4" />
                      {regrantOnlyMode ? "Re-grant & Reactivate" : "Deposit & Activate"}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ─── Activated success ─── */}
          {activated && (
            <motion.div
              key="activated"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 rounded-xl bg-[#059669]/[0.05] border border-[#059669]/20 p-8 text-center"
            >
              <CheckCircle2 className="h-10 w-10 text-[#059669]" />
              <p className="text-base font-semibold text-[#1A1715]">
                Agent Activated
              </p>
              <p className="text-sm text-[#5C5550]">
                Your agent is now optimizing yield across Avalanche protocols.
                It will deploy your funds to the best protocol(s) and rebalance automatically.
              </p>
              <p className="text-xs text-[#8A837C]">
                Redirecting to dashboard…
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
