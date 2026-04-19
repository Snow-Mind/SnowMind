'use client'

/**
 * ProtocolCard — Displays a single protocol's status on the dashboard.
 * 
 * Shows: logo, name, current APY, user allocation, TVL, risk score.
 * Used on the dashboard and portfolio pages.
 */

import { useState } from 'react'
import Image from 'next/image'
import { ExternalLink, Shield, TrendingUp, AlertTriangle } from 'lucide-react'
import { PROTOCOL_CONFIG, type ProtocolId } from '@/lib/constants'
import { riskBandFromScore, toNinePointRiskScore } from '@/lib/risk-level'

interface ProtocolCardProps {
  protocolId: ProtocolId
  currentApy: number          // e.g., 0.045 = 4.5%
  userAllocation: number      // USDC amount allocated to this protocol
  totalBalance: number        // Total USDC across all protocols
  tvlUsd?: number             // Protocol TVL in USD
  riskScore?: number
  riskScoreMax?: number
  isHighlighted?: boolean     // True if this protocol has the highest APY
  status?: 'healthy' | 'high_utilization' | 'paused' | 'emergency'
}

export function ProtocolCard({
  protocolId,
  currentApy,
  userAllocation,
  totalBalance,
  tvlUsd,
  riskScore,
  riskScoreMax,
  isHighlighted = false,
  status = 'healthy',
}: ProtocolCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const config = PROTOCOL_CONFIG[protocolId]
  const allocationPct = totalBalance > 0 ? (userAllocation / totalBalance) * 100 : 0
  const riskBand = riskBandFromScore(
    toNinePointRiskScore(
      Number(riskScore),
      Number(riskScoreMax),
      config.riskScore,
    ),
  )

  const statusColors = {
    healthy: 'text-emerald-400',
    high_utilization: 'text-amber-400',
    paused: 'text-red-400',
    emergency: 'text-red-500',
  }

  const statusLabels = {
    healthy: 'Active',
    high_utilization: 'High Utilization',
    paused: 'Paused',
    emergency: 'Emergency',
  }

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl border transition-all duration-300 ease-out
        ${isHighlighted
          ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/5 to-transparent shadow-lg shadow-emerald-500/5'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
        }
        ${isHovered ? 'scale-[1.01] shadow-xl' : ''}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Highlight badge */}
      {isHighlighted && (
        <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
          <TrendingUp className="h-3 w-3" />
          Top Yield
        </div>
      )}

      <div className="p-5">
        {/* Header: Logo + Name */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="relative flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: config.bgColor }}
          >
            {!imageFailed ? (
              <Image
                src={config.logoPath}
                alt={config.name}
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span className="text-sm font-bold" style={{ color: config.color }}>
                {config.shortName[0]}
              </span>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white/90">{config.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${statusColors[status]}`}>
                {statusLabels[status]}
              </span>
              {status !== 'healthy' && (
                <AlertTriangle className="h-3 w-3 text-amber-400" />
              )}
            </div>
          </div>
        </div>

        {/* APY */}
        <div className="mb-4">
          <div className="text-xs text-white/40 mb-1">Current APY</div>
          <div className="text-2xl font-bold tracking-tight" style={{ color: config.color }}>
            {(currentApy * 100).toFixed(2)}%
          </div>
        </div>

        {/* Allocation bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
            <span>Your Allocation</span>
            <span className="font-mono">{allocationPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${Math.min(allocationPct, 100)}%`,
                backgroundColor: config.color,
                opacity: 0.8,
              }}
            />
          </div>
          <div className="mt-1 text-xs font-mono text-white/60">
            ${userAllocation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
          <div className="flex items-center gap-1.5 text-xs text-white/40">
            <Shield className="h-3 w-3" />
            <span>Risk: {riskBand}</span>
          </div>
          {tvlUsd && (
            <div className="text-xs text-white/40">
              TVL: ${(tvlUsd / 1e6).toFixed(1)}M
            </div>
          )}
          <a
            href={config.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}

export default ProtocolCard
