"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  ChevronDown,
  LogOut,
  Settings,
  X,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";
import { ChainGuard } from "@/components/ChainGuard";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSessionKey } from "@/hooks/useSessionKey";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { EXPLORER, CONTRACTS, AVALANCHE_RPC_URL, CHAIN } from "@/lib/constants";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import {
  parseUnits,
  encodeFunctionData,
  formatUnits,
  createWalletClient,
  createPublicClient,
  custom,
  http,
} from "viem";

import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { createSmartAccount, BENQI_ABI, emergencyWithdrawAll } from "@/lib/zerodev";

function TopBar({
  smartAccountAddress,
  eoaAddress,
  isAgentActive,
  onDeposit,
  onEmergencyWithdraw,
  onAgentDetails,
  onDisconnect,
}: {
  smartAccountAddress: string | null;
  eoaAddress: string | null;
  isAgentActive: boolean;
  onDeposit: () => void;
  onEmergencyWithdraw: () => void;
  onAgentDetails: () => void;
  onDisconnect: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const router = useRouter();
  const truncatedEoa = eoaAddress
    ? `${eoaAddress.slice(0, 6)}...${eoaAddress.slice(-4)}`
    : "Connected";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#E8E2DA] bg-[#FAFAF8]/90 px-6 backdrop-blur-xl">
      {/* Left: Logo */}
      <Link href="/" className="flex items-center gap-2">
        <NeuralSnowflakeLogo className="h-5 w-5" />
        <span className="font-display text-sm font-semibold text-[#E84142]">
          SnowMind
        </span>
      </Link>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {isAgentActive && (
          <button
            onClick={onDeposit}
            className="flex items-center gap-1.5 rounded-lg border border-[#E8E2DA] bg-white px-3 py-1.5 text-xs font-medium text-[#1A1715] transition-all hover:border-[#D4CEC7] hover:shadow-sm"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Deposit
          </button>
        )}

        {/* Account dropdown — Giza-style */}
        <div className="relative">
          <button
            onClick={() => setAccountOpen(!accountOpen)}
            className="flex items-center gap-2 rounded-lg border border-[#E8E2DA] bg-white px-3 py-1.5 transition-colors hover:border-[#D4CEC7]"
          >
            <span className="inline-block h-2 w-2 rounded-full bg-[#059669]" />
            <span className="font-mono text-xs text-[#5C5550]">{truncatedEoa}</span>
            <ChevronDown className="h-3 w-3 text-[#8A837C]" />
          </button>

          {accountOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-[#E8E2DA] bg-white shadow-lg overflow-hidden">
                {/* EOA address header */}
                {eoaAddress && (
                  <div className="border-b border-[#E8E2DA] px-4 py-3">
                    <p className="font-mono text-xs text-[#1A1715]">
                      {eoaAddress.slice(0, 6)}...{eoaAddress.slice(-4)}
                    </p>
                    <button
                      onClick={() => { navigator.clipboard.writeText(eoaAddress); toast.success("Address copied"); }}
                      className="mt-0.5 text-[10px] text-[#8A837C] hover:text-[#5C5550] transition-colors"
                    >
                      Copy address
                    </button>
                  </div>
                )}

                {/* Menu items */}
                <div className="py-1">
                  {isAgentActive && smartAccountAddress && (
                    <button
                      onClick={() => { setAccountOpen(false); onAgentDetails(); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-[#1A1715] transition-colors hover:bg-[#F5F0EB]"
                    >
                      <Settings className="h-3.5 w-3.5 text-[#8A837C]" />
                      Agent account details
                    </button>
                  )}
                  {isAgentActive && (
                    <button
                      onClick={() => { setAccountOpen(false); onEmergencyWithdraw(); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-[#DC2626] transition-colors hover:bg-[#DC2626]/5"
                    >
                      <ArrowUpFromLine className="h-3.5 w-3.5 text-[#DC2626]" />
                      Withdraw
                    </button>
                  )}
                  <button
                    onClick={() => { setAccountOpen(false); onDisconnect(); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-[#1A1715] transition-colors hover:bg-[#F5F0EB]"
                  >
                    <LogOut className="h-3.5 w-3.5 text-[#8A837C]" />
                    Disconnect
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { authenticated, ready, logout, activeWallet, eoaAddress } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const { data: portfolio, isLoading: portfolioLoading } = usePortfolio(smartAccount.address ?? undefined);
  const { data: sessionKey, isLoading: sessionKeyLoading } = useSessionKey(smartAccount.address ?? undefined);
  const storeActivated = usePortfolioStore((s) => s.isAgentActivated);
  const setAgentActivated = usePortfolioStore((s) => s.setAgentActivated);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showAgentDetails, setShowAgentDetails] = useState(false);

  const handleDeactivateAgent = async () => {
    const addr = smartAccount.address;
    setAgentActivated(false);
    setShowAgentDetails(false);

    // Revoke session key on the backend (non-blocking but critical)
    if (addr) {
      try {
        await api.revokeSessionKey(addr);
      } catch {
        // Will retry on next visit
      }
    }
    router.push("/onboarding");
  };

  const handleDisconnect = () => {
    logout();
    router.push("/");
  };

  // Agent is "active" when it has an active session key (backend can auto-rebalance)
  // OR the store flag is set (immediate after activation, before query refetch)
  // OR funds exist (deployed to protocols OR idle USDC waiting for optimizer)
  const hasFunds = portfolio?.allocations?.some(
    (a) => Number(a.amountUsdc) > 0,
  ) ?? false;
  const hasActiveSessionKey = sessionKey?.isActive ?? false;

  // Clear stale storeActivated flag ONLY when real data proves no activation
  // Keep flag if user has any funds (idle or deployed) — optimizer will deploy them
  const dataLoaded = !portfolioLoading && !sessionKeyLoading && !!smartAccount.address;
  useEffect(() => {
    if (dataLoaded && storeActivated && !hasActiveSessionKey && !hasFunds) {
      setAgentActivated(false);
    }
  }, [dataLoaded, storeActivated, hasActiveSessionKey, hasFunds, setAgentActivated]);

  const isAgentActive = storeActivated || hasActiveSessionKey || hasFunds;

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (ready && !authenticated) {
      router.replace("/");
    }
  }, [ready, authenticated, router]);

  // Redirect FRESH users (no stored smart account) to onboarding
  useEffect(() => {
    if (
      smartAccount.setupStep === "creating" &&
      !smartAccount.address &&
      pathname !== "/onboarding"
    ) {
      router.replace("/onboarding");
    }
  }, [smartAccount.setupStep, smartAccount.address, pathname, router]);

  // Gate: redirect to onboarding if agent NOT active and accessing dashboard
  const dataReady = storeActivated || (!portfolioLoading && !sessionKeyLoading);
  useEffect(() => {
    if (!dataReady) return;
    if (!isAgentActive && pathname === "/dashboard") {
      router.replace("/onboarding");
    }
  }, [dataReady, isAgentActive, pathname, router]);

  // Redirect portfolio to dashboard (removed page)
  useEffect(() => {
    if (pathname === "/portfolio") {
      router.replace("/dashboard");
    }
  }, [pathname, router]);

  // Gate: redirect to dashboard if agent IS active and on onboarding
  useEffect(() => {
    if (!portfolio) return;
    if (isAgentActive && pathname === "/onboarding") {
      router.replace("/dashboard");
    }
  }, [portfolio, isAgentActive, pathname, router]);



  // Don't render until auth is ready
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F0EB]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E84142] border-t-transparent" />
      </div>
    );
  }

  if (!authenticated) return null;

  // Show loading spinner while determining routing
  if (!storeActivated && !isAgentActive && pathname === "/dashboard" && !dataReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F0EB]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E84142] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="app-light min-h-screen bg-[#F5F0EB] text-[#1A1715]">
      <div className="flex min-h-screen flex-col">
        <TopBar
          smartAccountAddress={smartAccount.address}
          eoaAddress={eoaAddress}
          isAgentActive={isAgentActive}
          onDeposit={() => setShowDeposit(true)}
          onEmergencyWithdraw={() => setShowAgentDetails(true)}
          onAgentDetails={() => setShowAgentDetails(true)}
          onDisconnect={handleDisconnect}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          {/* Pass deposit/withdraw modal state to children via data attributes */}
          <ChainGuard>
            <div
              data-show-deposit={showDeposit ? "true" : "false"}
            >
              {children}
            </div>
          </ChainGuard>
        </main>
      </div>

      {/* Deposit Modal */}
      {showDeposit && (
        <DepositModal onClose={() => setShowDeposit(false)} />
      )}

      {/* Agent Details Modal — Giza-style */}
      {showAgentDetails && smartAccount.address && (
        <AgentDetailsModal
          smartAccountAddress={smartAccount.address}
          onClose={() => setShowAgentDetails(false)}
          onDeactivate={handleDeactivateAgent}
        />
      )}


    </div>
  );
}

// ── Deposit Modal (Giza-style) ──────────────────────────────

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type DepositStep = "idle" | "transferring" | "deploying" | "done";

function DepositModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [eoaBalance, setEoaBalance] = useState("0");
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  const parsedAmount = parseFloat(amount);
  const eoaBalanceNum = parseFloat(eoaBalance);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount >= 1 && parsedAmount <= eoaBalanceNum;

  // Poll EOA balance
  useEffect(() => {
    if (!wallet) return;
    const publicClient = createPublicClient({ chain: CHAIN, transport: http(AVALANCHE_RPC_URL) });
    const check = async () => {
      try {
        const balance = await publicClient.readContract({
          address: CONTRACTS.USDC, abi: ERC20_TRANSFER_ABI, functionName: "balanceOf",
          args: [wallet.address as `0x${string}`],
        });
        setEoaBalance(formatUnits(balance as bigint, 6));
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, [wallet]);

  async function handleDeposit() {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;
    setStep("transferring");
    try {
      const provider = await wallet.getEthereumProvider();
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${CHAIN.id.toString(16)}` }] }); } catch {}

      const walletClient = createWalletClient({ chain: CHAIN, transport: custom(provider) });
      const [account] = await walletClient.getAddresses();
      const amountWei = parseUnits(parsedAmount.toString(), 6);

      const transferHash = await walletClient.sendTransaction({
        account,
        to: CONTRACTS.USDC,
        data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [smartAccountAddress as `0x${string}`, amountWei] }),
      });

      const publicClient = createPublicClient({ chain: CHAIN, transport: http(AVALANCHE_RPC_URL) });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      setStep("deploying");
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      await kernelClient.sendTransaction({
        calls: [
          { to: CONTRACTS.USDC, value: 0n, data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "approve", args: [CONTRACTS.BENQI_POOL, amountWei] }) },
          { to: CONTRACTS.BENQI_POOL, value: 0n, data: encodeFunctionData({ abi: BENQI_ABI, functionName: "mint", args: [amountWei] }) },
        ],
      });

      toast.success("Deposited! Now earning yield.");
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      setTimeout(onClose, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User denied") || msg.includes("User rejected")) toast.error("Transaction cancelled.");
      else toast.error(msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
      setStep("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl border border-[#E8E2DA] bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-[#8A837C] hover:text-[#1A1715]"><X className="h-4 w-4" /></button>

        {/* Title */}
        <p className="text-xs font-medium text-[#8A837C] mb-2">Your Deposit</p>

        {/* Large amount input */}
        <div className="flex items-baseline gap-2 mb-1">
          <input
            type="number"
            min="1"
            step="any"
            placeholder="0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); if (step === "done") setStep("idle"); }}
            disabled={step === "transferring" || step === "deploying"}
            className="w-full bg-transparent text-4xl font-semibold text-[#1A1715] placeholder:text-[#D4CEC7] focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-2xl font-medium text-[#B8B0A8] whitespace-nowrap">USDC</span>
        </div>

        {/* Available balance */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-[#8A837C]">{eoaBalanceNum.toFixed(2)} USDC available</span>
          {eoaBalanceNum > 0 && (
            <button
              onClick={() => setAmount(eoaBalanceNum.toFixed(2))}
              className="rounded border border-[#E8E2DA] px-2 py-0.5 text-[10px] font-semibold text-[#1A1715] hover:bg-[#F5F0EB] transition-colors"
            >
              MAX
            </button>
          )}
        </div>

        {/* Deposit button */}
        <button
          onClick={handleDeposit}
          disabled={!isValidAmount || !wallet || step === "transferring" || step === "deploying"}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50"
        >
          {(step === "transferring" || step === "deploying") && <Loader2 className="h-4 w-4 animate-spin" />}
          {step === "done" && <CheckCircle2 className="h-4 w-4" />}
          {step === "idle" ? "Deposit" : step === "transferring" ? "Transferring…" : step === "deploying" ? "Deploying to protocol…" : "Done!"}
        </button>
      </div>
    </div>
  );
}

// ── Withdraw Modal (Giza-style unified flow) ───────────────

const EXCHANGE_RATE_ABI = [
  { name: "exchangeRateStored", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const BALANCE_OF_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const ERC20_TRANSFER_ONLY_ABI = [
  { name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
] as const;

const ERC4626_CONVERT_ABI = [
  { name: "convertToAssets", type: "function", stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }], outputs: [{ name: "assets", type: "uint256" }] },
] as const;

/**
 * Read total USDC value across ALL protocol positions + idle balance.
 * Also returns raw share balances needed for on-chain redeem calls.
 */
async function readAllProtocolBalances(
  publicClient: ReturnType<typeof createPublicClient>,
  smartAddr: `0x${string}`,
) {
  // Read all balances in parallel
  const [idleBalance, qiBalance, aaveBalance, sparkShares, eulerShares, siloSavusdShares, siloSusdpShares] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.USDC, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.BENQI_POOL, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.AAVE_AUSDC, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.SPARK_VAULT, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.EULER_VAULT, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.SILO_SAVUSD_VAULT, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.SILO_SUSDP_VAULT, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [smartAddr] }).catch(() => 0n),
  ]);

  // Convert share tokens → USDC value
  let benqiUsdc = 0;
  if ((qiBalance as bigint) > 0n) {
    try {
      const exchangeRate = await publicClient.readContract({ address: CONTRACTS.BENQI_POOL, abi: EXCHANGE_RATE_ABI, functionName: "exchangeRateStored" });
      benqiUsdc = Number((qiBalance as bigint) * (exchangeRate as bigint)) / 1e18 / 1e12;
    } catch { /* fallback: 0 */ }
  }

  let sparkUsdc = 0;
  if ((sparkShares as bigint) > 0n) {
    try {
      const assets = await publicClient.readContract({ address: CONTRACTS.SPARK_VAULT, abi: ERC4626_CONVERT_ABI, functionName: "convertToAssets", args: [sparkShares as bigint] });
      sparkUsdc = Number(formatUnits(assets as bigint, 6));
    } catch { /* fallback: 0 */ }
  }

  let eulerUsdc = 0;
  if ((eulerShares as bigint) > 0n) {
    try {
      const assets = await publicClient.readContract({ address: CONTRACTS.EULER_VAULT, abi: ERC4626_CONVERT_ABI, functionName: "convertToAssets", args: [eulerShares as bigint] });
      eulerUsdc = Number(formatUnits(assets as bigint, 6));
    } catch { /* fallback: 0 */ }
  }

  let siloSavusdUsdc = 0;
  if ((siloSavusdShares as bigint) > 0n) {
    try {
      const assets = await publicClient.readContract({ address: CONTRACTS.SILO_SAVUSD_VAULT, abi: ERC4626_CONVERT_ABI, functionName: "convertToAssets", args: [siloSavusdShares as bigint] });
      siloSavusdUsdc = Number(formatUnits(assets as bigint, 6));
    } catch { /* fallback: 0 */ }
  }

  let siloSusdpUsdc = 0;
  if ((siloSusdpShares as bigint) > 0n) {
    try {
      const assets = await publicClient.readContract({ address: CONTRACTS.SILO_SUSDP_VAULT, abi: ERC4626_CONVERT_ABI, functionName: "convertToAssets", args: [siloSusdpShares as bigint] });
      siloSusdpUsdc = Number(formatUnits(assets as bigint, 6));
    } catch { /* fallback: 0 */ }
  }

  // Aave: aToken balance IS the USDC value (1:1 with underlying)
  const aaveUsdc = Number(formatUnits(aaveBalance as bigint, 6));

  const idleUsdc = Number(formatUnits(idleBalance as bigint, 6));

  return {
    totalUsdc: idleUsdc + benqiUsdc + aaveUsdc + sparkUsdc + eulerUsdc + siloSavusdUsdc + siloSusdpUsdc,
    idleUsdc,
    benqiUsdc,
    aaveUsdc,
    sparkUsdc,
    eulerUsdc,
    siloSavusdUsdc,
    siloSusdpUsdc,
    // Raw values for on-chain redeem calls
    qiBalance: qiBalance as bigint,
    aaveBalance: aaveBalance as bigint,
    sparkShares: sparkShares as bigint,
    eulerShares: eulerShares as bigint,
    siloSavusdShares: siloSavusdShares as bigint,
    siloSusdpShares: siloSusdpShares as bigint,
  };
}

type WithdrawStep = "idle" | "redeeming" | "transferring" | "deactivating" | "done";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WithdrawModal({ onClose, onDeactivate }: { onClose: () => void; onDeactivate: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<WithdrawStep>("idle");
  const [availableUsdc, setAvailableUsdc] = useState(0);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  const parsedAmount = parseFloat(amount);
  const isFullWithdrawal = !isNaN(parsedAmount) && parsedAmount >= availableUsdc * 0.99;
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= availableUsdc + 0.01;

  // Read total available USDC (protocol positions + idle)
  useEffect(() => {
    if (!smartAccountAddress) return;
    const publicClient = createPublicClient({ chain: CHAIN, transport: http(AVALANCHE_RPC_URL) });
    const fetchBalance = async () => {
      try {
        const balances = await readAllProtocolBalances(publicClient, smartAccountAddress as `0x${string}`);
        setAvailableUsdc(balances.totalUsdc);
      } catch { /* ignore */ }
      setLoadingBalance(false);
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [smartAccountAddress]);

  async function handleWithdraw() {
    if (!wallet || !smartAccountAddress || !isValidAmount) return;

    try {
      const publicClient = createPublicClient({ chain: CHAIN, transport: http(AVALANCHE_RPC_URL) });

      // Step 1: Redeem from ALL protocols
      setStep("redeeming");
      const balances = await readAllProtocolBalances(publicClient, smartAccountAddress as `0x${string}`);

      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      // Use emergencyWithdrawAll to redeem from every protocol in one batched UserOp
      const hasPositions = balances.qiBalance > 0n || balances.sparkShares > 0n || balances.eulerShares > 0n || balances.siloSavusdShares > 0n || balances.siloSusdpShares > 0n || (balances.aaveBalance ?? 0n) > 0n;
      if (hasPositions) {
        await emergencyWithdrawAll(
          kernelClient,
          smartAccountAddress as `0x${string}`,
          CONTRACTS,
          balances.qiBalance,
          balances.sparkShares,
          balances.eulerShares,
          balances.siloSavusdShares,
          balances.siloSusdpShares,
          balances.aaveBalance ?? 0n,
        );
      }

      // Step 2: Transfer requested USDC to EOA
      setStep("transferring");
      const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.USDC, abi: BALANCE_OF_ABI, functionName: "balanceOf",
        args: [smartAccountAddress as `0x${string}`],
      });

      const amountToSend = isFullWithdrawal
        ? (usdcBalance as bigint)
        : parseUnits(parsedAmount.toString(), 6);
      const actualSend = amountToSend > (usdcBalance as bigint) ? (usdcBalance as bigint) : amountToSend;

      if (actualSend > 0n) {
        await kernelClient.sendTransaction({
          calls: [{ to: CONTRACTS.USDC, value: 0n, data: encodeFunctionData({ abi: ERC20_TRANSFER_ONLY_ABI, functionName: "transfer", args: [wallet.address as `0x${string}`, actualSend] }) }],
        });
      }

      queryClient.invalidateQueries({ queryKey: ["portfolio"] });

      // Step 3: If full withdrawal, deactivate agent
      if (isFullWithdrawal) {
        setStep("deactivating");
        toast.success("Successfully withdrawn funds!");
        await new Promise((r) => setTimeout(r, 1500));
        await onDeactivate();
        return;
      }

      toast.success("Successfully withdrawn funds!");
      setStep("done");
      setTimeout(onClose, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User denied") || msg.includes("User rejected")) toast.error("Transaction cancelled.");
      else toast.error(msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
      setStep("idle");
    }
  }

  // Deactivation confirmation screen
  if (step === "deactivating") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="relative w-full max-w-md rounded-2xl border border-[#E8E2DA] bg-white p-8 shadow-xl text-center">
          <button onClick={onClose} className="absolute right-4 top-4 text-[#8A837C] hover:text-[#1A1715]"><X className="h-4 w-4" /></button>
          <p className="text-sm font-medium text-[#1A1715] mb-6">Deactivation request received</p>
          <div className="flex items-center justify-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#3B82F6]">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#1A1715] mb-2">In progress</h3>
          <p className="text-sm text-[#8A837C] leading-relaxed">
            We received your deactivation request.<br />
            This can take a few minutes to process.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl border border-[#E8E2DA] bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-[#8A837C] hover:text-[#1A1715]"><X className="h-4 w-4" /></button>

        {/* Title */}
        <h2 className="text-base font-semibold text-[#1A1715] mb-5">Withdraw your funds</h2>

        {/* Large amount input */}
        <div className="flex items-baseline gap-2 mb-1">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); if (step === "done") setStep("idle"); }}
            disabled={step !== "idle"}
            className="w-full bg-transparent text-4xl font-semibold text-[#1A1715] placeholder:text-[#D4CEC7] focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-2xl font-medium text-[#B8B0A8] whitespace-nowrap">USDC</span>
        </div>

        {/* Available balance */}
        <div className="flex items-center gap-2 mb-5">
          {loadingBalance ? (
            <span className="text-xs text-[#8A837C]">Loading...</span>
          ) : (
            <>
              <span className="text-xs text-[#8A837C]">{availableUsdc.toFixed(2)} USDC available</span>
              <button
                onClick={() => setAmount(availableUsdc.toFixed(2))}
                className="rounded border border-[#E8E2DA] px-2 py-0.5 text-[10px] font-semibold text-[#1A1715] hover:bg-[#F5F0EB] transition-colors"
              >
                MAX
              </button>
            </>
          )}
        </div>

        {/* Warnings */}
        {isFullWithdrawal && isValidAmount && (
          <div className="mb-4 space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[#F59E0B] shrink-0" />
              <p className="text-xs text-[#5C5550]">
                Withdrawing all funds will <span className="font-semibold">deactivate your agent</span>.
              </p>
            </div>
          </div>
        )}

        {/* Withdraw / Deactivate button */}
        <button
          onClick={handleWithdraw}
          disabled={!isValidAmount || !wallet || step !== "idle"}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-50 ${
            isFullWithdrawal && isValidAmount
              ? "bg-[#DC2626] hover:bg-[#B91C1C]"
              : "bg-[#1A1715] hover:bg-[#2D2926]"
          }`}
        >
          {(step === "redeeming" || step === "transferring") && <Loader2 className="h-4 w-4 animate-spin" />}
          {step === "done" && <CheckCircle2 className="h-4 w-4" />}
          {step === "idle"
            ? isFullWithdrawal && isValidAmount ? "Deactivate" : "Withdraw"
            : step === "redeeming" ? "Redeeming from protocol…"
            : step === "transferring" ? "Sending to wallet…"
            : "Done!"}
        </button>
      </div>
    </div>
  );
}

// ── Agent Details Modal (Giza-style) ────────────────────────

function AgentDetailsModal({
  smartAccountAddress,
  onClose,
  onDeactivate,
}: {
  smartAccountAddress: string;
  onClose: () => void;
  onDeactivate: () => Promise<void>;
}) {
  const { data: portfolio } = usePortfolio(smartAccountAddress);
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;
  const [withdrawStep, setWithdrawStep] = useState<"idle" | "processing" | "deactivating">("idle");

  // Compute USDC balance across all allocations
  const totalUsdc = portfolio?.allocations?.reduce(
    (sum, a) => sum + Number(a.amountUsdc),
    0,
  ) ?? 0;

  const truncated = `${smartAccountAddress.slice(0, 6)}...${smartAccountAddress.slice(-4)}`;

  async function handleFullWithdraw() {
    if (!wallet || !smartAccountAddress) return;
    setWithdrawStep("processing");
    try {
      const publicClient = createPublicClient({ chain: CHAIN, transport: http(AVALANCHE_RPC_URL) });

      // Read share balances from ALL protocols
      const balances = await readAllProtocolBalances(publicClient, smartAccountAddress as `0x${string}`);

      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      // Step 1: Redeem from ALL protocols in one batched UserOp
      const hasPositions = balances.qiBalance > 0n || balances.sparkShares > 0n || balances.eulerShares > 0n || balances.siloSavusdShares > 0n || balances.siloSusdpShares > 0n || (balances.aaveBalance ?? 0n) > 0n;
      if (hasPositions) {
        await emergencyWithdrawAll(
          kernelClient,
          smartAccountAddress as `0x${string}`,
          CONTRACTS,
          balances.qiBalance,
          balances.sparkShares,
          balances.eulerShares,
          balances.siloSavusdShares,
          balances.siloSusdpShares,
          balances.aaveBalance ?? 0n,
        );
      }

      // Step 2: Transfer ALL USDC to EOA
      const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.USDC, abi: BALANCE_OF_ABI, functionName: "balanceOf",
        args: [smartAccountAddress as `0x${string}`],
      });

      if ((usdcBalance as bigint) > 0n) {
        await kernelClient.sendTransaction({
          calls: [{ to: CONTRACTS.USDC, value: 0n, data: encodeFunctionData({ abi: ERC20_TRANSFER_ONLY_ABI, functionName: "transfer", args: [wallet.address as `0x${string}`, usdcBalance as bigint] }) }],
        });
      }


      // Step 3: Deactivate agent
      setWithdrawStep("deactivating");
      toast.success("Successfully withdrawn funds!");
      await new Promise((r) => setTimeout(r, 1500));
      await onDeactivate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User denied") || msg.includes("User rejected")) toast.error("Transaction cancelled.");
      else toast.error(msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
      setWithdrawStep("idle");
    }
  }

  // Deactivation confirmation screen
  if (withdrawStep === "deactivating") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="relative w-full max-w-md rounded-2xl border border-[#E8E2DA] bg-white p-8 shadow-xl text-center">
          <button onClick={onClose} className="absolute right-4 top-4 text-[#8A837C] hover:text-[#1A1715]"><X className="h-4 w-4" /></button>
          <p className="text-sm font-medium text-[#1A1715] mb-6">Deactivation request received</p>
          <div className="flex items-center justify-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#3B82F6]">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#1A1715] mb-2">In progress</h3>
          <p className="text-sm text-[#8A837C] leading-relaxed">
            We received your deactivation request.<br />
            This can take a few minutes to process.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl border border-[#E8E2DA] bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E8E2DA] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1A1715]">Agent Details</h2>
          <button onClick={onClose} className="text-[#8A837C] hover:text-[#1A1715] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Agent address section */}
        <div className="px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#059669]/10 mb-3">
            <span className="inline-block h-3 w-3 rounded-full bg-[#059669]" />
          </div>
          <p className="font-mono text-sm font-medium text-[#1A1715]">{truncated}</p>
          <div className="mt-1.5 flex items-center gap-4">
            <button
              onClick={() => { navigator.clipboard.writeText(smartAccountAddress); toast.success("Address copied"); }}
              className="flex items-center gap-1 text-xs text-[#8A837C] hover:text-[#5C5550] transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copy address
            </button>
            <a
              href={EXPLORER.address(smartAccountAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#8A837C] hover:text-[#5C5550] transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Open in explorer
            </a>
          </div>
        </div>

        {/* Withdraw section */}
        <div className="border-t border-[#E8E2DA] px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#1A1715]">Withdraw Agent Account balance</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#2775CA] text-[8px] font-bold text-white">$</span>
                <span className="font-mono text-sm text-[#5C5550]">{totalUsdc.toFixed(2)} USDC</span>
              </div>
            </div>
            <button
              onClick={handleFullWithdraw}
              disabled={withdrawStep === "processing" || totalUsdc <= 0}
              className="flex items-center gap-1.5 rounded-lg border border-[#E8E2DA] bg-white px-5 py-2 text-xs font-semibold text-[#1A1715] transition-all hover:border-[#D4CEC7] hover:shadow-sm disabled:opacity-50"
            >
              {withdrawStep === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Withdraw
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
