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
  ShieldOff,
} from "lucide-react";
import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSessionKey } from "@/hooks/useSessionKey";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { EXPLORER } from "@/lib/constants";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

function TopBar({
  smartAccountAddress,
  eoaAddress,
  isAgentActive,
  onDeposit,
  onWithdraw,
  onAgentDetails,
  onDisconnect,
}: {
  smartAccountAddress: string | null;
  eoaAddress: string | null;
  isAgentActive: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onAgentDetails: () => void;
  onDisconnect: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
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
          <>
            <button
              onClick={onDeposit}
              className="flex items-center gap-1.5 rounded-lg border border-[#E8E2DA] bg-white px-3 py-1.5 text-xs font-medium text-[#1A1715] transition-all hover:border-[#D4CEC7] hover:shadow-sm"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Deposit
            </button>
          </>
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
  const { authenticated, ready, login, logout, activeWallet, eoaAddress, isLoading: authLoading } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const { data: portfolio, isLoading: portfolioLoading } = usePortfolio(smartAccount.address ?? undefined);
  const { data: sessionKey, isLoading: sessionKeyLoading } = useSessionKey(smartAccount.address ?? undefined);
  const storeActivated = usePortfolioStore((s) => s.isAgentActivated);
  const setAgentActivated = usePortfolioStore((s) => s.setAgentActivated);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showAgentDetails, setShowAgentDetails] = useState(false);

  const handleDeactivateAgent = async () => {
    const addr = smartAccount.address;
    setAgentActivated(false);
    setShowAgentDetails(false);
    router.push("/onboarding");

    // Revoke session key on the backend (non-blocking but critical)
    if (addr) {
      try {
        await api.revokeSessionKey(addr);
        toast.success("Agent deactivated. Session key revoked.");
      } catch {
        toast.warning("Agent deactivated locally. Backend revocation will retry.");
      }
    } else {
      toast.success("Agent deactivated.");
    }
  };

  const handleDisconnect = () => {
    logout();
    router.push("/");
  };

  // Agent is "active" when it has an active session key (backend can auto-rebalance)
  // OR the store flag is set (immediate after activation, before query refetch)
  // OR funds are already deployed to protocols
  const hasProtocolAllocations = portfolio?.allocations?.some(
    (a) => a.protocolId !== "idle" && Number(a.amountUsdc) > 0,
  ) ?? false;
  const hasActiveSessionKey = sessionKey?.isActive ?? false;

  // Clear stale storeActivated flag when real data proves no activation
  const dataLoaded = !portfolioLoading && !sessionKeyLoading && !!smartAccount.address;
  useEffect(() => {
    if (dataLoaded && storeActivated && !hasActiveSessionKey && !hasProtocolAllocations) {
      setAgentActivated(false);
    }
  }, [dataLoaded, storeActivated, hasActiveSessionKey, hasProtocolAllocations, setAgentActivated]);

  const isAgentActive = storeActivated || hasActiveSessionKey || hasProtocolAllocations;

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

  // Redirect portfolio/settings to dashboard (removed pages)
  useEffect(() => {
    if (pathname === "/portfolio" || pathname === "/settings") {
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
          onWithdraw={() => setShowWithdraw(true)}
          onAgentDetails={() => setShowAgentDetails(true)}
          onDisconnect={handleDisconnect}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          {/* Pass deposit/withdraw modal state to children via data attributes */}
          <div
            data-show-deposit={showDeposit ? "true" : "false"}
            data-show-withdraw={showWithdraw ? "true" : "false"}
          >
            {children}
          </div>
        </main>
      </div>

      {/* Deposit Modal */}
      {showDeposit && (
        <DepositModal onClose={() => setShowDeposit(false)} />
      )}

      {/* Withdraw Modal */}
      {showWithdraw && (
        <WithdrawModal onClose={() => setShowWithdraw(false)} />
      )}

      {/* Agent Details Modal — Giza-style */}
      {showAgentDetails && smartAccount.address && (
        <AgentDetailsModal
          smartAccountAddress={smartAccount.address}
          onClose={() => setShowAgentDetails(false)}
          onWithdraw={() => { setShowAgentDetails(false); setShowWithdraw(true); }}
          onDeactivate={handleDeactivateAgent}
        />
      )}


    </div>
  );
}

// ── Deposit Modal ───────────────────────────────────────────

import {
  ArrowDown,
  Loader2,
  CheckCircle2,
  Wallet,
  X,
} from "lucide-react";
import {
  parseUnits,
  encodeFunctionData,
  formatUnits,
  createWalletClient,
  createPublicClient,
  custom,
  http,
} from "viem";
import { avalancheFuji } from "viem/chains";
import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { CONTRACTS, AVALANCHE_RPC_URL } from "@/lib/constants";
import { createSmartAccount, BENQI_ABI } from "@/lib/zerodev";

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
    const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(AVALANCHE_RPC_URL) });
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
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xA869" }] }); } catch {}

      const walletClient = createWalletClient({ chain: avalancheFuji, transport: custom(provider) });
      const [account] = await walletClient.getAddresses();
      const amountWei = parseUnits(parsedAmount.toString(), 6);

      const transferHash = await walletClient.sendTransaction({
        account,
        to: CONTRACTS.USDC,
        data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [smartAccountAddress as `0x${string}`, amountWei] }),
      });

      const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(AVALANCHE_RPC_URL) });
      await publicClient.waitForTransactionReceipt({ hash: transferHash });
      toast.success("USDC transferred to smart account!");

      setStep("deploying");
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      await kernelClient.sendTransaction({
        calls: [
          { to: CONTRACTS.USDC, value: 0n, data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "approve", args: [CONTRACTS.BENQI_POOL, amountWei] }) },
          { to: CONTRACTS.BENQI_POOL, value: 0n, data: encodeFunctionData({ abi: BENQI_ABI, functionName: "mint", args: [amountWei] }) },
        ],
      });

      toast.success("Deposited to Benqi! Now earning yield.");
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
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E84142]/10"><ArrowDownToLine className="h-4 w-4 text-[#E84142]" /></div>
          <h2 className="text-base font-semibold text-[#1A1715]">Deposit USDC</h2>
        </div>

        <div className="relative">
          <input type="number" min="1" step="any" placeholder="0.00" value={amount}
            onChange={(e) => { setAmount(e.target.value); if (step === "done") setStep("idle"); }}
            disabled={step === "transferring" || step === "deploying"}
            className="w-full rounded-xl border border-[#E8E2DA] bg-[#F5F0EB] px-4 py-3 pr-16 text-lg font-mono text-[#1A1715] placeholder:text-[#B8B0A8] focus:border-[#E84142]/40 focus:outline-none disabled:opacity-50"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[#5C5550]">USDC</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-[#8A837C]">
          <span>Balance: ${eoaBalanceNum.toFixed(2)} USDC</span>
          {eoaBalanceNum > 0 && (
            <button onClick={() => setAmount(eoaBalanceNum.toFixed(2))} className="text-[#E84142] font-medium hover:underline">MAX</button>
          )}
        </div>

        {isValidAmount && step === "idle" && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[#8A837C]">
            <ArrowDown className="h-3 w-3" />
            <span>Wallet → Smart Account → Benqi (earning yield)</span>
          </div>
        )}

        <button onClick={handleDeposit} disabled={!isValidAmount || !wallet || step === "transferring" || step === "deploying"}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50">
          {(step === "transferring" || step === "deploying") && <Loader2 className="h-4 w-4 animate-spin" />}
          {step === "done" && <CheckCircle2 className="h-4 w-4" />}
          {step === "idle" ? "Deposit" : step === "transferring" ? "Transferring…" : step === "deploying" ? "Deploying to Benqi…" : "Done!"}
        </button>
      </div>
    </div>
  );
}

// ── Withdraw Modal ──────────────────────────────────────────

const BALANCE_OF_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const ERC20_TRANSFER_ONLY_ABI = [
  { name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
] as const;

type WithdrawPhase = "protocol" | "to-eoa";

function WithdrawModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<WithdrawPhase>("protocol");
  const [withdrawing, setWithdrawing] = useState(false);
  const [done, setDone] = useState(false);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;

  async function handleWithdrawFromProtocol() {
    if (!wallet || !smartAccountAddress) return;
    setWithdrawing(true);
    try {
      const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(AVALANCHE_RPC_URL) });
      const qiBalance = await publicClient.readContract({
        address: CONTRACTS.BENQI_POOL, abi: BALANCE_OF_ABI, functionName: "balanceOf",
        args: [smartAccountAddress as `0x${string}`],
      });
      if (qiBalance === 0n) { toast.info("No funds in protocol to withdraw."); setWithdrawing(false); return; }

      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      await kernelClient.sendTransaction({
        calls: [{ to: CONTRACTS.BENQI_POOL, value: 0n, data: encodeFunctionData({ abi: BENQI_ABI, functionName: "redeem", args: [qiBalance] }) }],
      });

      toast.success("Withdrawn from Benqi! USDC now in your smart account.");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("User denied") ? "Transaction cancelled." : msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleWithdrawToEOA() {
    if (!wallet || !smartAccountAddress) return;
    setWithdrawing(true);
    try {
      const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(AVALANCHE_RPC_URL) });
      const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.USDC, abi: BALANCE_OF_ABI, functionName: "balanceOf",
        args: [smartAccountAddress as `0x${string}`],
      });
      if (usdcBalance === 0n) { toast.info("No USDC in smart account."); setWithdrawing(false); return; }

      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      await kernelClient.sendTransaction({
        calls: [{ to: CONTRACTS.USDC, value: 0n, data: encodeFunctionData({ abi: ERC20_TRANSFER_ONLY_ABI, functionName: "transfer", args: [wallet.address as `0x${string}`, usdcBalance] }) }],
      });

      toast.success("USDC sent to your wallet!");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      setTimeout(onClose, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("User denied") ? "Transaction cancelled." : msg.length > 120 ? msg.slice(0, 100) + "…" : msg);
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl border border-[#E8E2DA] bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-[#8A837C] hover:text-[#1A1715]"><X className="h-4 w-4" /></button>
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E84142]/10"><ArrowUpFromLine className="h-4 w-4 text-[#E84142]" /></div>
          <h2 className="text-base font-semibold text-[#1A1715]">Withdraw</h2>
        </div>

        {/* Phase tabs */}
        <div className="flex gap-1 rounded-lg bg-[#F5F0EB] p-1 mb-5">
          <button
            onClick={() => { setPhase("protocol"); setDone(false); }}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${phase === "protocol" ? "bg-white shadow-sm text-[#1A1715]" : "text-[#8A837C] hover:text-[#5C5550]"}`}
          >
            From Protocol
          </button>
          <button
            onClick={() => { setPhase("to-eoa"); setDone(false); }}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${phase === "to-eoa" ? "bg-white shadow-sm text-[#1A1715]" : "text-[#8A837C] hover:text-[#5C5550]"}`}
          >
            To Your Wallet
          </button>
        </div>

        {phase === "protocol" ? (
          <div className="space-y-4">
            <p className="text-xs text-[#5C5550]">
              Redeems all protocol positions (Benqi, Aave) back to USDC in your smart account.
            </p>
            <button onClick={handleWithdrawFromProtocol} disabled={withdrawing || !wallet}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50">
              {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}
              {done ? <CheckCircle2 className="h-4 w-4" /> : null}
              {withdrawing ? "Withdrawing…" : done ? "Withdrawn!" : "Withdraw from Protocol"}
            </button>
            {done && (
              <p className="text-center text-xs text-[#059669]">
                USDC is now in your smart account. Switch to &quot;To Your Wallet&quot; tab to send it to your EOA.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-[#5C5550]">
              Transfers all USDC from your smart account to your connected wallet (EOA).
            </p>
            <button onClick={handleWithdrawToEOA} disabled={withdrawing || !wallet}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E84142] py-3 text-sm font-semibold text-white transition-all hover:bg-[#D63031] disabled:opacity-50">
              {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}
              {withdrawing ? "Sending…" : "Send to Wallet"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Details Modal (Giza-style) ────────────────────────

function AgentDetailsModal({
  smartAccountAddress,
  onClose,
  onWithdraw,
  onDeactivate,
}: {
  smartAccountAddress: string;
  onClose: () => void;
  onWithdraw: () => void;
  onDeactivate: () => void;
}) {
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const { data: portfolio } = usePortfolio(smartAccountAddress);

  // Compute USDC balance across all allocations
  const totalUsdc = portfolio?.allocations?.reduce(
    (sum, a) => sum + Number(a.amountUsdc),
    0,
  ) ?? 0;

  const truncated = `${smartAccountAddress.slice(0, 6)}...${smartAccountAddress.slice(-4)}`;

  async function handleDeactivate() {
    setDeactivating(true);
    await onDeactivate();
    setDeactivating(false);
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
                <span className="inline-block h-4 w-4 rounded-full bg-[#2775CA] text-[8px] font-bold text-white flex items-center justify-center">$</span>
                <span className="font-mono text-sm text-[#5C5550]">{totalUsdc.toFixed(2)} USDC</span>
              </div>
            </div>
            <button
              onClick={onWithdraw}
              className="rounded-lg border border-[#E8E2DA] bg-white px-5 py-2 text-xs font-semibold text-[#1A1715] transition-all hover:border-[#D4CEC7] hover:shadow-sm"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Deactivate section */}
        <div className="border-t border-[#E8E2DA] px-6 py-5">
          <p className="text-sm font-medium text-[#1A1715]">Deactivate agent</p>
          <p className="mt-1 text-xs text-[#8A837C] leading-relaxed">
            Once you deactivate your agent, all tokens will need to be withdrawn manually and your agent will be turned off.
          </p>
          <div className="mt-4 flex items-center justify-between">
            {!confirmDeactivate ? (
              <button
                onClick={() => setConfirmDeactivate(true)}
                className="rounded-lg border border-[#E8E2DA] px-5 py-2 text-xs font-medium text-[#8A837C] transition-all hover:border-[#DC2626]/30 hover:text-[#DC2626]"
              >
                Deactivate
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeactivate}
                  disabled={deactivating}
                  className="flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-[#B91C1C] disabled:opacity-50"
                >
                  {deactivating && <Loader2 className="h-3 w-3 animate-spin" />}
                  <ShieldOff className="h-3 w-3" />
                  Confirm Deactivation
                </button>
                <button
                  onClick={() => setConfirmDeactivate(false)}
                  className="rounded-lg border border-[#E8E2DA] px-3 py-2 text-xs text-[#8A837C] hover:bg-[#F5F0EB]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
