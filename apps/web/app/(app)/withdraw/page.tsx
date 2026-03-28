'use client'

/**
 * Withdraw Page — Full and partial withdrawal flow.
 * 
 * Flow:
 * 1. User enters amount (or clicks "Withdraw All")
 * 2. Preview shows fee breakdown (proportional agent fee)
 * 3. User confirms → backend builds + submits atomic UserOp
 * 4. Shows success with tx hash link to Snowtrace
 */

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDownToLine,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Shield,
  Info,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { EXPLORER, FEE_CONFIG } from '@/lib/constants'
import { api, APIError } from '@/lib/api-client'
import { usePortfolioStore } from '@/stores/portfolio.store'

type WithdrawalStep = 'input' | 'preview' | 'executing' | 'success' | 'error'

interface FeePreview {
  withdrawAmount: string
  currentBalance: string
  netPrincipal: string
  accruedProfit: string
  attributableProfit: string
  agentFee: string
  userReceives: string
  feeRate: string
  feeExempt: boolean
}

interface WithdrawalResult {
  status: string
  txHash: string | null
  agentFee: string
  userReceives: string
  accountDeactivated: boolean
  message: string
}

const FULL_WITHDRAWAL_DUST_USDC = 0.01

function isEffectivelyFullWithdrawal(amount: string, currentBalance: number): boolean {
  const requested = parseFloat(amount)
  if (!Number.isFinite(requested) || requested <= 0) return false
  if (requested >= currentBalance) return true
  return currentBalance - requested <= FULL_WITHDRAWAL_DUST_USDC
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function WithdrawPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<WithdrawalStep>('input')
  const [amount, setAmount] = useState('')
  const [isFullWithdrawal, setIsFullWithdrawal] = useState(false)
  const [preview, setPreview] = useState<FeePreview | null>(null)
  const [result, setResult] = useState<WithdrawalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const smartAccountAddress = usePortfolioStore((s) => s.smartAccountAddress)
  const totalDepositedUsd = usePortfolioStore((s) => s.totalDepositedUsd)
  const setAllocations = usePortfolioStore((s) => s.setAllocations)
  const setTotals = usePortfolioStore((s) => s.setTotals)
  const setAgentActivated = usePortfolioStore((s) => s.setAgentActivated)
  const balance = parseFloat(totalDepositedUsd || '0')

  const handlePreview = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      if (!smartAccountAddress) throw new Error('Smart account not found')

      const requestedAmount = amount
      const effectiveFullWithdrawal = isFullWithdrawal || isEffectivelyFullWithdrawal(requestedAmount, balance)
      const withdrawAmount = effectiveFullWithdrawal ? String(balance) : requestedAmount
      if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
        throw new Error('Please enter a valid amount')
      }

      const data = await api.previewWithdrawal({
        smartAccountAddress,
        withdrawAmount,
        isFullWithdrawal: effectiveFullWithdrawal,
      })

      setPreview(data)
      setStep('preview')
    } catch (err: unknown) {
      if (err instanceof APIError) {
        setError(err.message)
      } else {
        setError(getErrorMessage(err, 'Failed to preview withdrawal'))
      }
    } finally {
      setIsLoading(false)
    }
  }, [amount, isFullWithdrawal, balance, smartAccountAddress])

  const handleExecute = useCallback(async () => {
    setStep('executing')
    setError(null)
    try {
      if (!smartAccountAddress) throw new Error('Smart account not found')

      const fallbackAmount = preview?.withdrawAmount || amount
      const previewBalance = parseFloat(preview?.currentBalance ?? String(balance))
      const effectiveFullWithdrawal =
        isFullWithdrawal || isEffectivelyFullWithdrawal(fallbackAmount, previewBalance)

      const data = await api.executeWithdrawal({
        smartAccountAddress,
        withdrawAmount: fallbackAmount,
        isFullWithdrawal: effectiveFullWithdrawal,
      })

      if (data.accountDeactivated) {
        setAgentActivated(false)
        setAllocations([])
        setTotals('0', '0')
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-detail', smartAccountAddress] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio', smartAccountAddress] }),
      ])

      setResult(data)
      setStep('success')
    } catch (err: unknown) {
      if (err instanceof APIError) {
        setError(err.message)
      } else {
        setError(getErrorMessage(err, 'Withdrawal failed'))
      }
      setStep('error')
    }
  }, [amount, balance, isFullWithdrawal, preview, queryClient, setAgentActivated, setAllocations, setTotals, smartAccountAddress])

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-lg px-4 py-8">
        {/* Back button */}
        <button
          onClick={() => router.push('/dashboard')}
          className="mb-6 flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <ArrowDownToLine className="h-5 w-5 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold">Withdraw USDC</h1>
          </div>
          <p className="text-sm text-white/40 ml-[52px]">
            Your funds are withdrawn from all protocols in a single atomic transaction.
          </p>
        </div>

        {/* ══════ Step: Input ══════ */}
        {step === 'input' && (
          <div className="space-y-5">
            {/* Balance display */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-xs text-white/40 mb-1">Available Balance</div>
              <div className="text-2xl font-bold font-mono text-white/90">
                ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-white/30 mt-1">USDC across all protocols</div>
            </div>

            {/* Amount input */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-white/60">Withdrawal Amount</label>
                <button
                  onClick={() => { setIsFullWithdrawal(true); setAmount(String(balance)) }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                >
                  Withdraw All
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-lg">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => {
                    const nextAmount = e.target.value
                    setAmount(nextAmount)
                    setIsFullWithdrawal(isEffectivelyFullWithdrawal(nextAmount, balance))
                  }}
                  placeholder="0.00"
                  min="0"
                  max={balance}
                  step="0.01"
                  className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3 pl-9
                    text-lg font-mono text-white placeholder:text-white/20
                    focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20
                    transition-colors"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/30">USDC</span>
              </div>
              {isFullWithdrawal && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400/80">
                  <AlertCircle className="h-3 w-3" />
                  Full withdrawal — account will be deactivated and session key revoked
                </div>
              )}
            </div>

            {/* Fee info */}
            <div className="flex items-start gap-2 rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <Info className="h-4 w-4 text-white/30 mt-0.5 shrink-0" />
              <div className="text-xs text-white/40 leading-relaxed">
                A {(FEE_CONFIG.rate * 100).toFixed(0)}% {FEE_CONFIG.label.toLowerCase()} is charged on any profit
                earned. It&apos;s proportional — only on the yield portion of your withdrawal.
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {/* Preview button */}
            <button
              onClick={handlePreview}
              disabled={isLoading || (!amount && !isFullWithdrawal)}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30
                px-4 py-3.5 text-sm font-semibold text-zinc-950 disabled:text-white/30
                transition-all duration-200 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Calculating fees...
                </span>
              ) : (
                'Preview Withdrawal'
              )}
            </button>
          </div>
        )}

        {/* ══════ Step: Preview ══════ */}
        {step === 'preview' && preview && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white/80 mb-4">Fee Breakdown</h3>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Withdrawal Amount</span>
                  <span className="font-mono text-white/90">${parseFloat(preview.withdrawAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Accrued Profit</span>
                  <span className="font-mono text-white/70">${parseFloat(preview.accruedProfit).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Attributable Profit</span>
                  <span className="font-mono text-white/70">${parseFloat(preview.attributableProfit).toFixed(2)}</span>
                </div>

                <div className="border-t border-white/[0.06] my-2" />

                <div className="flex justify-between text-sm">
                  <span className="text-white/50">
                    {preview.feeExempt ? 'Agent Fee (Beta — FREE)' : `Agent Fee (${(parseFloat(preview.feeRate) * 100).toFixed(0)}%)`}
                  </span>
                  <span className={`font-mono ${preview.feeExempt ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {preview.feeExempt ? 'Free' : `-$${parseFloat(preview.agentFee).toFixed(2)}`}
                  </span>
                </div>

                <div className="border-t border-white/[0.06] my-2" />

                <div className="flex justify-between text-base font-semibold">
                  <span className="text-white/80">You Receive</span>
                  <span className="font-mono text-emerald-400">${parseFloat(preview.userReceives).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Security note */}
            <div className="flex items-start gap-2 rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
              <Shield className="h-4 w-4 text-emerald-400/60 mt-0.5 shrink-0" />
              <div className="text-xs text-white/40 leading-relaxed">
                All protocol withdrawals are batched into a single atomic transaction.
                If any step fails, the entire operation reverts — your funds are always safe.
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => { setStep('input'); setPreview(null) }}
                className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3
                  text-sm font-medium text-white/60 hover:text-white/80 hover:border-white/[0.12] transition-all"
              >
                Back
              </button>
              <button
                onClick={handleExecute}
                className="flex-[2] rounded-xl bg-emerald-500 hover:bg-emerald-400
                  px-4 py-3 text-sm font-semibold text-zinc-950 transition-all duration-200"
              >
                Confirm Withdrawal
              </button>
            </div>
          </div>
        )}

        {/* ══════ Step: Executing ══════ */}
        {step === 'executing' && (
          <div className="flex flex-col items-center py-12 text-center">
            <Loader2 className="h-10 w-10 text-emerald-400 animate-spin mb-4" />
            <h3 className="text-lg font-semibold text-white/90 mb-2">Processing Withdrawal</h3>
            <p className="text-sm text-white/40 max-w-xs">
              Building and submitting your withdrawal transaction.
              This typically takes 10-30 seconds on Avalanche.
            </p>
          </div>
        )}

        {/* ══════ Step: Success ══════ */}
        {step === 'success' && result && (
          <div className="space-y-5">
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 mb-4">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white/90 mb-1">Withdrawal Complete</h3>
              <p className="text-sm text-white/50">{result.message}</p>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-white/50">You Received</span>
                <span className="font-mono font-semibold text-emerald-400">${parseFloat(result.userReceives).toFixed(2)} USDC</span>
              </div>
              {parseFloat(result.agentFee) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Agent Fee</span>
                  <span className="font-mono text-white/60">${parseFloat(result.agentFee).toFixed(2)}</span>
                </div>
              )}
              {result.txHash && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/50">Transaction</span>
                  <a
                    href={EXPLORER.tx(result.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <span className="font-mono text-xs">
                      {result.txHash.slice(0, 8)}...{result.txHash.slice(-6)}
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            <button
              onClick={() => router.push(result.accountDeactivated ? '/onboarding' : '/dashboard')}
              className="w-full rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08]
                px-4 py-3 text-sm font-medium text-white/70 transition-all duration-200"
            >
              {result.accountDeactivated ? 'Continue to Onboarding' : 'Return to Dashboard'}
            </button>
          </div>
        )}

        {/* ══════ Step: Error ══════ */}
        {step === 'error' && (
          <div className="space-y-5">
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 mb-4">
                <AlertCircle className="h-7 w-7 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white/90 mb-1">Withdrawal Failed</h3>
              <p className="text-sm text-red-400/80">{error}</p>
              <p className="text-xs text-white/30 mt-2">Your funds are safe. The transaction was reverted.</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('input'); setError(null) }}
                className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3
                  text-sm font-medium text-white/60 hover:text-white/80 transition-all"
              >
                Try Again
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="flex-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.10]
                  px-4 py-3 text-sm font-medium text-white/60 transition-all"
              >
                Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
