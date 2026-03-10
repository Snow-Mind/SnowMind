"use client";

import { motion } from "framer-motion";
import {
  Shield,
  CheckCircle2,
  Search,
  FileCheck,
  Gauge,
  TrendingDown,
  Activity,
} from "lucide-react";

/**
 * Inspired by ZYF.AI's 5 safety checks per rebalance and
 * SurfLiquid's Guardian Layer (pre-execution simulation, invariant
 * checks, circuit breakers). Shows the safety validation pipeline
 * that every SnowMind rebalance must pass before execution.
 */

const SAFETY_STEPS = [
  {
    id: "pre-simulation",
    label: "Pre-execution Simulation",
    description: "Every transaction is simulated before submission to verify correct outcome.",
    icon: Search,
    color: "#00C4FF",
  },
  {
    id: "calldata-validation",
    label: "Calldata Validation",
    description: "Encoded calldata is verified against expected function selectors and parameters.",
    icon: FileCheck,
    color: "#7C3AED",
  },
  {
    id: "exposure-limits",
    label: "Exposure Limits",
    description: "Max 60% per protocol. Min 2 active protocols for diversification.",
    icon: Gauge,
    color: "#F59E0B",
  },
  {
    id: "slippage-bounds",
    label: "Rate Anomaly Check",
    description: "TWAP-confirmed rates only. Any APY > 25% halts rebalancing and alerts.",
    icon: TrendingDown,
    color: "#00FF88",
  },
  {
    id: "post-verification",
    label: "Post-execution Verification",
    description: "On-chain balances verified after execution to confirm expected state.",
    icon: Activity,
    color: "#E84142",
  },
] as const;

export default function SafetyChecks() {
  return (
    <div className="crystal-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-void-2">
            <Shield className="h-4 w-4 text-glacier" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-arctic">
              Safety Pipeline
            </h2>
            <p className="text-xs text-muted-foreground">
              5 checks validated before every rebalance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-mint/10 px-2 py-0.5 text-[10px] font-medium text-mint">
          <CheckCircle2 className="h-3 w-3" />
          All Passing
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="space-y-1">
          {SAFETY_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.3 }}
                className="group flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-void-2/20"
              >
                {/* Vertical line + icon */}
                <div className="flex flex-col items-center">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${step.color}15` }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: step.color }} />
                  </div>
                  {i < SAFETY_STEPS.length - 1 && (
                    <div className="mt-1 h-4 w-px bg-border/30" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pt-0.5">
                  <p className="text-xs font-medium text-arctic">
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                {/* Check mark */}
                <CheckCircle2
                  className="mt-1 h-3.5 w-3.5 shrink-0 text-mint"
                />
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
