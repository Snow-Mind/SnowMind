"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { toast } from "sonner"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let supabase: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

export function useRealtimePortfolio(accountId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!accountId || !supabase) return

    const channel = supabase
      .channel(`portfolio-${accountId}`)
      .on("postgres_changes", {
        event:  "INSERT",
        schema: "public",
        table:  "rebalance_logs",
      }, (payload: { new: Record<string, unknown> }) => {
        // Immediately refetch portfolio data on new rebalance
        qc.invalidateQueries({ queryKey: ["portfolio", accountId] })
        qc.invalidateQueries({ queryKey: ["rebalance-history", accountId] })
        qc.invalidateQueries({ queryKey: ["rebalance-status", accountId] })

        const status = payload.new.status
        if (status === "executed") {
          toast.success("Rebalance executed — portfolio updated", {
            duration: 5000,
          })
        } else if (status === "failed") {
          toast.error("Rebalance failed — funds unchanged and safe")
        }
      })
      .subscribe()

    return () => { supabase!.removeChannel(channel) }
  }, [accountId, qc])
}
