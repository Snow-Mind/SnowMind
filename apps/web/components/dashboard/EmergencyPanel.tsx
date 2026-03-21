"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Zap,
  Wallet,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { createPublicClient, http, encodeFunctionData } from "viem";
import { useWallets, toViemAccount } from "@privy-io/react-auth";
import { CONTRACTS, EXPLORER, PROTOCOL_CONFIG, AVALANCHE_RPC_URL, CHAIN } from "@/lib/constants";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { toast } from "sonner";
import { createSmartAccount, BENQI_ABI, ERC4626_VAULT_ABI } from "@/lib/zerodev";

const BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const AAVE_WITHDRAW_ABI = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Map raw error messages to user-friendly ones. */
function friendlyWithdrawError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("User denied") || msg.includes("User rejected"))
    return "Transaction cancelled.";
  if (msg.includes("zd_getUserOperationGasPrice") || msg.includes("does not exist"))
    return "Gas estimation failed — please try again.";
  if (msg.includes("chainId"))
    return "Please switch MetaMask to Avalanche C-Chain.";
  if (msg.length > 120) return msg.slice(0, 100) + "…";
  return msg;
}

type WithdrawPath = "snowmind" | "direct" | null;

export default function EmergencyPanel() {
  const [expanded, setExpanded] = useState(false);
  const [activePath, setActivePath] = useState<WithdrawPath>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress);
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType !== "privy") ?? wallets[0] ?? null;
  const queryClient = useQueryClient();

  async function handleWithdrawAll() {
    if (!wallet || !smartAccountAddress) return;
    setWithdrawing(true);
    setTxHash(null);
    try {
      const sa = smartAccountAddress as `0x${string}`;
      const publicClient = createPublicClient({
        chain: CHAIN,
        transport: http(AVALANCHE_RPC_URL),
      });

      // Check balances across all active protocols
      const [qiBalance, sparkShares, eulerShares, siloSavusdShares, siloSusdpShares] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.BENQI_POOL,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [sa],
        }).catch(() => 0n),
        publicClient.readContract({
          address: CONTRACTS.SPARK_VAULT,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [sa],
        }).catch(() => 0n),
        publicClient.readContract({
          address: CONTRACTS.EULER_VAULT,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [sa],
        }).catch(() => 0n),
        publicClient.readContract({
          address: CONTRACTS.SILO_SAVUSD_VAULT,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [sa],
        }).catch(() => 0n),
        publicClient.readContract({
          address: CONTRACTS.SILO_SUSDP_VAULT,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [sa],
        }).catch(() => 0n),
      ]);

      const hasAnyFunds = qiBalance > 0n || sparkShares > 0n || eulerShares > 0n || siloSavusdShares > 0n || siloSusdpShares > 0n;

      if (!hasAnyFunds) {
        toast.info("No funds deposited in any protocol to withdraw.");
        return;
      }

      // Create kernel client and send batched withdrawal UserOp
      const viemAccount = await toViemAccount({ wallet });
      const { kernelClient } = await createSmartAccount(viemAccount);

      const calls: { to: `0x${string}`; value: bigint; data: `0x${string}` }[] = [];

      // Benqi: redeem qiTokens
      if (qiBalance > 0n) {
        calls.push({
          to: CONTRACTS.BENQI_POOL,
          value: 0n,
          data: encodeFunctionData({
            abi: BENQI_ABI,
            functionName: "redeem",
            args: [qiBalance],
          }),
        });
      }

      // Aave: always try withdraw max (reverts harmlessly if no position)
      const maxUint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      calls.push({
        to: CONTRACTS.AAVE_POOL,
        value: 0n,
        data: encodeFunctionData({
          abi: AAVE_WITHDRAW_ABI,
          functionName: "withdraw",
          args: [CONTRACTS.USDC, maxUint, sa],
        }),
      });

      // Spark: redeem shares
      if (sparkShares > 0n) {
        calls.push({
          to: CONTRACTS.SPARK_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_VAULT_ABI,
            functionName: "redeem",
            args: [sparkShares, sa, sa],
          }),
        });
      }

      // Euler: redeem shares
      if (eulerShares > 0n) {
        calls.push({
          to: CONTRACTS.EULER_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_VAULT_ABI,
            functionName: "redeem",
            args: [eulerShares, sa, sa],
          }),
        });
      }

      // Silo savUSD: redeem shares
      if (siloSavusdShares > 0n) {
        calls.push({
          to: CONTRACTS.SILO_SAVUSD_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_VAULT_ABI,
            functionName: "redeem",
            args: [siloSavusdShares, sa, sa],
          }),
        });
      }

      // Silo sUSDp: redeem shares
      if (siloSusdpShares > 0n) {
        calls.push({
          to: CONTRACTS.SILO_SUSDP_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_VAULT_ABI,
            functionName: "redeem",
            args: [siloSusdpShares, sa, sa],
          }),
        });
      }

      const hash = await kernelClient.sendTransaction({ calls });

      setTxHash(hash);
      toast.success("Withdrawal successful! USDC returned to your smart account.");

      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-status"] });
      queryClient.invalidateQueries({ queryKey: ["rebalance-history"] });
    } catch (err) {
      toast.error(friendlyWithdrawError(err));
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="crystal-card border-crimson/20 p-6">
      {/* Header — click to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-crimson/30 bg-crimson/10">
            <ShieldAlert className="h-4 w-4 text-crimson" />
          </div>
          <div className="text-left">
            <h2 className="text-sm font-medium text-arctic">
              Emergency Withdrawal
            </h2>
            <p className="text-xs text-muted-foreground">
              Two independent paths to recover your funds.
            </p>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Warning */}
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200/80">
                Your funds are always in <strong>your</strong> smart account.
                SnowMind never has custody. These paths let you withdraw even if
                our backend is offline.
              </p>
            </div>

            {/* Two paths */}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {/* Path 1: SnowMind API */}
              <button
                onClick={() =>
                  setActivePath(activePath === "snowmind" ? null : "snowmind")
                }
                className={`rounded-xl border p-4 text-left transition-all ${
                  activePath === "snowmind"
                    ? "border-glacier/40 bg-glacier/5"
                    : "border-border/50 bg-void-2/30 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-glacier" />
                  <span className="text-sm font-medium text-arctic">
                    Via SnowMind
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  One-click withdrawal via our API. Redeems all protocol
                  positions back to USDC in your smart account.
                </p>
                <span className="mt-3 inline-block rounded-full border border-mint/30 bg-mint/10 px-2 py-0.5 text-[10px] text-mint">
                  Recommended
                </span>
              </button>

              {/* Path 2: Direct EOA */}
              <button
                onClick={() =>
                  setActivePath(activePath === "direct" ? null : "direct")
                }
                className={`rounded-xl border p-4 text-left transition-all ${
                  activePath === "direct"
                    ? "border-glacier/40 bg-glacier/5"
                    : "border-border/50 bg-void-2/30 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-frost" />
                  <span className="text-sm font-medium text-arctic">
                    Direct from EOA
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Call protocol contracts directly as the smart account owner.
                  Works even if SnowMind is fully down.
                </p>
                <span className="mt-3 inline-block rounded-full border border-frost/30 bg-frost/10 px-2 py-0.5 text-[10px] text-frost">
                  Self-sovereign
                </span>
              </button>
            </div>

            {/* Path details */}
            <AnimatePresence mode="wait">
              {activePath === "snowmind" && (
                <motion.div
                  key="snowmind"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 space-y-3 rounded-lg border border-border/50 bg-void-2/20 p-4"
                >
                  <h3 className="text-xs font-medium text-arctic">
                    How it works:
                  </h3>
                  <ol className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">1.</span>
                      Click &quot;Withdraw All&quot; below
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">2.</span>
                      SnowMind builds UserOperations to redeem all positions
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">3.</span>
                      USDC returns to your smart account
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-glacier">4.</span>
                      Transfer USDC from smart account to your EOA wallet
                    </li>
                  </ol>
                  <button
                    onClick={handleWithdrawAll}
                    disabled={withdrawing || !smartAccountAddress || !wallet}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-crimson/80 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-crimson disabled:opacity-50"
                  >
                    {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {withdrawing ? "Withdrawing…" : "Withdraw All Funds"}
                  </button>

                  {txHash && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-mint/20 bg-mint/5 px-3 py-2">
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-mint" />
                      <span className="text-[11px] text-mint">Withdrawn</span>
                      <a
                        href={EXPLORER.tx(txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto flex items-center gap-1 text-[10px] text-mint underline"
                      >
                        {txHash.slice(0, 6)}…{txHash.slice(-4)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  )}
                </motion.div>
              )}

              {activePath === "direct" && (
                <motion.div
                  key="direct"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 space-y-3 rounded-lg border border-border/50 bg-void-2/20 p-4"
                >
                  <h3 className="text-xs font-medium text-arctic">
                    Manual withdrawal steps:
                  </h3>
                  <ol className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">1.</span>
                      Connect your EOA wallet to Snowtrace or a block explorer
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">2.</span>
                      <span>
                        Call <code className="text-arctic">redeem()</code> on
                        Benqi ({PROTOCOL_CONFIG.benqi.shortName})
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">3.</span>
                      <span>
                        Call <code className="text-arctic">withdraw()</code> on
                        Aave V3 Pool
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-frost">4.</span>
                      Funds are returned to your smart account as USDC
                    </li>
                  </ol>

                  <div className="mt-3 space-y-2">
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Contract Links
                    </h4>
                    {[
                      { label: "Benqi Pool", addr: CONTRACTS.BENQI_POOL },
                      { label: "Aave V3 Pool", addr: CONTRACTS.AAVE_POOL },
                      { label: "Spark Vault", addr: CONTRACTS.SPARK_VAULT },
                      { label: "USDC Token", addr: CONTRACTS.USDC },
                    ].filter(c => c.addr).map((c) => (
                      <a
                        key={c.label}
                        href={EXPLORER.contract(c.addr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-lg border border-border/30 bg-void-2/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-glacier/30 hover:text-arctic"
                      >
                        <span>{c.label}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px]">
                            {c.addr.slice(0, 6)}...{c.addr.slice(-4)}
                          </span>
                          <ExternalLink className="h-3 w-3" />
                        </div>
                      </a>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
