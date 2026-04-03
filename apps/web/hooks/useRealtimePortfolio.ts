"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let supabase: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
      params: { eventsPerSecond: 2 },
    },
  })
}

const REALTIME_DISABLE_KEY = "snowmind_realtime_disabled_until"
const REALTIME_WARNED_KEY = "snowmind_realtime_warned"

function isRealtimeTemporarilyDisabled(): boolean {
  if (typeof window === "undefined") return false
  const raw = window.localStorage.getItem(REALTIME_DISABLE_KEY)
  if (!raw) return false
  const until = Number(raw)
  return Number.isFinite(until) && Date.now() < until
}

function disableRealtimeFor(ms: number): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(REALTIME_DISABLE_KEY, String(Date.now() + ms))
}

function logRealtimeFallbackOnce(status: string, message: string): void {
  if (typeof window === "undefined") return
  if (window.localStorage.getItem(REALTIME_WARNED_KEY)) return
  window.localStorage.setItem(REALTIME_WARNED_KEY, "1")

  if (process.env.NODE_ENV !== "production") {
    console.warn("[SnowMind] Supabase Realtime subscription failed:", status, message)
  }
}

/**
 * Subscribe to real-time rebalance_logs inserts for the given smart account.
 * Uses Supabase Realtime Postgres Changes with an account-scoped filter
 * so only events for this user's account trigger refetches.
 *
 * Gracefully handles WebSocket connection failures (e.g. missing env vars,
 * network issues) instead of throwing uncaught errors.
 */
export function useRealtimePortfolio(
  smartAccountAddress: string | undefined,
  accountId?: string | null,
) {
  const qc = useQueryClient()
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null)

  useEffect(() => {
    if (!smartAccountAddress || !accountId || !supabase || isRealtimeTemporarilyDisabled()) return

    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const pendingInvalidations = {
      portfolio: false,
      history: false,
      status: false,
    }

    const flushInvalidations = () => {
      if (pendingInvalidations.portfolio) {
        qc.invalidateQueries({ queryKey: ["portfolio", smartAccountAddress] })
      }
      if (pendingInvalidations.history) {
        qc.invalidateQueries({ queryKey: ["rebalance-history", smartAccountAddress] })
      }
      if (pendingInvalidations.status) {
        qc.invalidateQueries({ queryKey: ["rebalance-status", smartAccountAddress] })
      }

      pendingInvalidations.portfolio = false
      pendingInvalidations.history = false
      pendingInvalidations.status = false
      flushTimer = null
    }

    const scheduleInvalidations = (
      keys: Array<keyof typeof pendingInvalidations>,
    ) => {
      for (const key of keys) {
        pendingInvalidations[key] = true
      }
      if (flushTimer) return
      flushTimer = setTimeout(flushInvalidations, 600)
    }

    // Subscribe to changes on both rebalance_logs and allocations tables
    const channel = supabase
      .channel(`portfolio-${smartAccountAddress}`)
      .on("postgres_changes", {
        event:  "INSERT",
        schema: "public",
        table:  "rebalance_logs",
        filter: `account_id=eq.${accountId}`,
      }, (payload: { new: Record<string, unknown> }) => {
        // Coalesce invalidations so multi-row bursts do not flood API reads.
        scheduleInvalidations(["portfolio", "history", "status"])

        const status = payload.new.status
        if (status === "executed") {
          toast.success("Rebalance executed — portfolio updated", {
            duration: 5000,
          })
        } else if (status === "failed") {
          toast.error("Rebalance failed — funds unchanged and safe")
        } else if (status === "skipped") {
          toast.info("Agent checked rates — no rebalance needed", {
            duration: 3000,
          })
        }
      })
      .on("postgres_changes", {
        event:  "UPDATE",
        schema: "public",
        table:  "allocations",
        filter: `account_id=eq.${accountId}`,
      }, () => {
        // Allocation changed — refresh portfolio (coalesced).
        scheduleInvalidations(["portfolio"])
      })
      .on("postgres_changes", {
        event:  "INSERT",
        schema: "public",
        table:  "allocations",
        filter: `account_id=eq.${accountId}`,
      }, () => {
        scheduleInvalidations(["portfolio"])
      })
      .on("postgres_changes", {
        event:  "DELETE",
        schema: "public",
        table:  "allocations",
        filter: `account_id=eq.${accountId}`,
      }, () => {
        scheduleInvalidations(["portfolio"])
      })
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          logRealtimeFallbackOnce(status, err?.message ?? "")
          // Circuit-breaker: avoid repeated websocket failures and rely on polling for 15 min.
          disableRealtimeFor(15 * 60 * 1000)
          if (channelRef.current) {
            supabase!.removeChannel(channelRef.current)
            channelRef.current = null
          }
        }
      })

    channelRef.current = channel

    return () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (channelRef.current) {
        supabase!.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [smartAccountAddress, accountId, qc])
}
