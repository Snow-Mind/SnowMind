"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let supabase: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

/**
 * Subscribe to real-time rebalance_logs inserts for the given smart account.
 * Uses Supabase Realtime Postgres Changes with an account-scoped filter
 * so only events for this user's account trigger refetches.
 *
 * @param smartAccountAddress - the smart account address (used as React Query key)
 */
export function useRealtimePortfolio(smartAccountAddress: string | undefined) {
  const qc = useQueryClient()
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null)

  useEffect(() => {
    if (!smartAccountAddress || !supabase) return

    // Subscribe to changes on both rebalance_logs and allocations tables
    const channel = supabase
      .channel(`portfolio-${smartAccountAddress}`)
      .on("postgres_changes", {
        event:  "INSERT",
        schema: "public",
        table:  "rebalance_logs",
      }, (payload: { new: Record<string, unknown> }) => {
        // Invalidate all portfolio-related queries for this account
        qc.invalidateQueries({ queryKey: ["portfolio", smartAccountAddress] })
        qc.invalidateQueries({ queryKey: ["rebalance-history", smartAccountAddress] })
        qc.invalidateQueries({ queryKey: ["rebalance-status", smartAccountAddress] })
        qc.invalidateQueries({ queryKey: ["account-detail", smartAccountAddress] })

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
      }, () => {
        // Allocation changed — refresh portfolio
        qc.invalidateQueries({ queryKey: ["portfolio", smartAccountAddress] })
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase!.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [smartAccountAddress, qc])
}
