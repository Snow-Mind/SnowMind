'use client'

/**
 * YieldProjection — Live APY projection with projected returns.
 * 
 * Shows:
 * - Blended APY across all protocols (weighted by allocation)
 * - Projected returns at 1mo, 3mo, 6mo, 1yr
 * - Visual APY comparison bars per protocol
 */

import { useMemo } from 'react'
import { TrendingUp, Info, DollarSign } from 'lucide-react'
import {
  PROTOCOL_CONFIG,
  type ProtocolId,
} from '@/lib/constants'

interface ProtocolApy {
  protocolId: ProtocolId
  effectiveApy: number  // After adjustments (e.g., Spark ×0.90 - PSM fee)
  allocation: number    // USDC amount in this protocol
}

interface YieldProjectionProps {
  totalBalance: number
  protocolApys: ProtocolApy[]
  isFeeExempt?: boolean
  isLoading?: boolean
}

interface ProjectionPeriod {
  label: string
  months: number
}

const PROJECTION_PERIODS: ProjectionPeriod[] = [
  { label: '1 Month', months: 1 },
  { label: '3 Months', months: 3 },
  { label: '6 Months', months: 6 },
  { label: '1 Year', months: 12 },
]

export function YieldProjection({
  totalBalance,
  protocolApys,
  isLoading = false,
}: YieldProjectionProps) {
  // Calculate blended APY (weighted average)
  const blendedApy = useMemo(() => {
    if (totalBalance <= 0 || protocolApys.length === 0) return 0
    let weighted = 0
    for (const p of protocolApys) {
      weighted += (p.allocation / totalBalance) * p.effectiveApy
    }
    return weighted
  }, [totalBalance, protocolApys])

  // Fee charging is currently disabled, so display blended APY directly.
  const netApy = useMemo(() => {
    return blendedApy
  }, [blendedApy])

  // Projected returns
  const projections = useMemo(() => {
    return PROJECTION_PERIODS.map((period) => {
      const grossReturn = totalBalance * (Math.pow(1 + blendedApy, period.months / 12) - 1)
      const fee = 0
      const netReturn = grossReturn
      return {
        ...period,
        grossReturn,
        fee,
        netReturn,
      }
    })
  }, [totalBalance, blendedApy])

  // Find max APY for bar scaling
  const maxApy = useMemo(() => {
    return Math.max(...protocolApys.map((p) => p.effectiveApy), 0.001)
  }, [protocolApys])

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 animate-pulse">
        <div className="h-4 w-32 rounded bg-white/[0.06] mb-4" />
        <div className="h-8 w-24 rounded bg-white/[0.06] mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-3 w-full rounded bg-white/[0.06]" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white/90">Yield Projection</span>
        </div>
        <div className="group relative">
          <Info className="h-4 w-4 text-white/30 cursor-help" />
          <div className="absolute right-0 top-6 z-50 hidden group-hover:block w-72 rounded-lg bg-zinc-800 border border-white/10 p-3 text-xs text-white/60 shadow-xl">
            Projections are estimates based on current APY rates.
            Actual returns may vary as rates fluctuate.
          </div>
        </div>
      </div>

      {/* Blended APY */}
      <div className="mb-5">
        <div className="text-xs text-white/40 mb-1">Blended APY</div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-emerald-400">
            {(netApy * 100).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Protocol APY comparison bars */}
      <div className="mb-6 space-y-2.5">
        <div className="text-xs text-white/40 mb-2">Per Protocol</div>
        {protocolApys
          .sort((a, b) => b.effectiveApy - a.effectiveApy)
          .map((p) => {
            const config = PROTOCOL_CONFIG[p.protocolId]
            const barWidth = maxApy > 0 ? (p.effectiveApy / maxApy) * 100 : 0
            return (
              <div key={p.protocolId} className="flex items-center gap-3">
                <span className="text-xs text-white/50 w-14 truncate">{config.shortName}</span>
                <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: config.color,
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-white/70 w-14 text-right">
                  {(p.effectiveApy * 100).toFixed(2)}%
                </span>
              </div>
            )
          })}
      </div>

      {/* Projected returns table */}
      <div>
        <div className="text-xs text-white/40 mb-3 flex items-center gap-1.5">
          <DollarSign className="h-3 w-3" />
          Projected Returns
        </div>
        <div className="grid grid-cols-2 gap-2">
          {projections.map((proj) => (
            <div
              key={proj.label}
              className="rounded-xl bg-white/[0.03] border border-white/[0.04] p-3 transition-colors hover:border-white/[0.08]"
            >
              <div className="text-[10px] text-white/30 mb-1">{proj.label}</div>
              <div className="text-sm font-semibold text-white/90 font-mono">
                +${proj.netReturn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default YieldProjection
