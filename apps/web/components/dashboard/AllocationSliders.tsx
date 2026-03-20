'use client'

/**
 * AllocationSliders — Per-protocol allocation cap controls for ≥$10K deposits.
 * 
 * Shows sliders for each protocol with risk-preset buttons.
 * Only visible to users with deposits ≥ $10,000.
 * Most restrictive wins: min(system_tvl_cap, user_cap).
 */

import { useState, useCallback } from 'react'
import { SlidersHorizontal, Info, Lock } from 'lucide-react'
import {
  PROTOCOL_CONFIG,
  RISK_PRESETS,
  ACTIVE_PROTOCOLS,
  type ProtocolId,
  type RiskPreset,
} from '@/lib/constants'

interface AllocationSliderProps {
  protocolId: ProtocolId
  value: number              // 0-100 (percentage)
  maxValue: number           // System-enforced maximum
  onChange: (protocolId: ProtocolId, value: number) => void
  disabled?: boolean
}

function AllocationSlider({
  protocolId,
  value,
  maxValue,
  onChange,
  disabled = false,
}: AllocationSliderProps) {
  const config = PROTOCOL_CONFIG[protocolId]

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          <span className="text-sm font-medium text-white/80">{config.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-semibold text-white/90">
            {value}%
          </span>
          {maxValue < 100 && (
            <span className="text-xs text-white/30 font-mono">
              (max {maxValue}%)
            </span>
          )}
        </div>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={maxValue}
          step={5}
          value={value}
          onChange={(e) => onChange(protocolId, Number(e.target.value))}
          disabled={disabled}
          className="w-full h-2 rounded-full appearance-none cursor-pointer
            bg-white/[0.06] accent-current
            disabled:opacity-40 disabled:cursor-not-allowed
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-125"
          style={{ color: config.color }}
        />
        {/* Fill track */}
        <div
          className="absolute top-0 left-0 h-2 rounded-full pointer-events-none transition-all duration-150"
          style={{
            width: `${(value / maxValue) * 100}%`,
            backgroundColor: config.color,
            opacity: disabled ? 0.3 : 0.6,
          }}
        />
      </div>
    </div>
  )
}

interface AllocationSlidersProps {
  totalBalance: number
  currentCaps: Record<ProtocolId, number>  // Current caps (0-100)
  onCapsChange: (caps: Record<ProtocolId, number>) => void
  onPresetSelect?: (preset: RiskPreset) => void
  selectedPreset?: RiskPreset | 'custom'
  disabled?: boolean
}

export function AllocationSliders({
  totalBalance,
  currentCaps,
  onCapsChange,
  onPresetSelect,
  selectedPreset = 'balanced',
  disabled = false,
}: AllocationSlidersProps) {
  const isEligible = totalBalance >= 10000
  const [activePreset, setActivePreset] = useState<RiskPreset | 'custom'>(selectedPreset)

  const handleSliderChange = useCallback(
    (protocolId: ProtocolId, value: number) => {
      const newCaps = { ...currentCaps, [protocolId]: value }
      onCapsChange(newCaps)
      setActivePreset('custom')
    },
    [currentCaps, onCapsChange]
  )

  const handlePresetClick = useCallback(
    (preset: RiskPreset) => {
      const presetConfig = RISK_PRESETS[preset]
      const presetCaps = presetConfig.caps as Record<string, number | undefined>
      const newCaps = {} as Record<ProtocolId, number>
      for (const pid of ACTIVE_PROTOCOLS) {
        newCaps[pid] = Math.round((presetCaps[pid] ?? 1.0) * 100)
      }
      onCapsChange(newCaps)
      setActivePreset(preset)
      onPresetSelect?.(preset)
    },
    [onCapsChange, onPresetSelect]
  )

  if (!isEligible) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 text-white/40 mb-2">
          <Lock className="h-4 w-4" />
          <span className="text-sm font-medium">Custom Allocation</span>
        </div>
        <p className="text-xs text-white/30 leading-relaxed">
          Per-protocol allocation caps are available for deposits of $10,000 or more.
          Your current balance: ${totalBalance.toLocaleString()}.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-white/50" />
          <span className="text-sm font-semibold text-white/90">Allocation Preferences</span>
        </div>
        <div className="group relative">
          <Info className="h-4 w-4 text-white/30 cursor-help" />
          <div className="absolute right-0 top-6 z-50 hidden group-hover:block w-64 rounded-lg bg-zinc-800 border border-white/10 p-3 text-xs text-white/60 shadow-xl">
            Set maximum allocation per protocol. The system applies the most restrictive
            of your cap and the 15% TVL system cap. Spark has no TVL cap since its rate is fixed.
          </div>
        </div>
      </div>

      {/* Risk Preset Buttons */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {(Object.keys(RISK_PRESETS) as RiskPreset[]).map((preset) => {
          const presetConfig = RISK_PRESETS[preset]
          const isActive = activePreset === preset
          return (
            <button
              key={preset}
              onClick={() => handlePresetClick(preset)}
              disabled={disabled}
              className={`
                rounded-xl px-3 py-2.5 text-center transition-all duration-200
                ${isActive
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                  : 'bg-white/[0.03] border border-white/[0.06] text-white/50 hover:text-white/70 hover:border-white/[0.10]'
                }
                disabled:opacity-40 disabled:cursor-not-allowed
              `}
            >
              <div className="text-xs font-semibold">{presetConfig.label}</div>
              <div className="text-[10px] mt-0.5 opacity-60">{presetConfig.description}</div>
            </button>
          )
        })}
      </div>

      {/* Sliders */}
      <div className="space-y-5">
        {ACTIVE_PROTOCOLS.map((pid) => {
          // Spark has no system TVL cap → slider goes to 100%
          const systemMax = pid === 'spark' ? 100 : 60
          return (
            <AllocationSlider
              key={pid}
              protocolId={pid}
              value={currentCaps[pid] ?? systemMax}
              maxValue={systemMax}
              onChange={handleSliderChange}
              disabled={disabled}
            />
          )
        })}
      </div>

      {/* Custom preset indicator */}
      {activePreset === 'custom' && (
        <div className="mt-4 flex items-center gap-1.5 text-xs text-white/30">
          <SlidersHorizontal className="h-3 w-3" />
          Custom allocation
        </div>
      )}
    </div>
  )
}

export default AllocationSliders
