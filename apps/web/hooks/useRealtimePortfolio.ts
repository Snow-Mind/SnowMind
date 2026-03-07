import { createClient } from "@supabase/supabase-js"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { toast } from "sonner"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!   // anon key ONLY on frontend
)

export function useRealtimePortfolio(accountId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!accountId) return

    const channel = supabase
      .channel(`portfolio-${accountId}`)
      .on("postgres_changes", {
        event:  "INSERT",
        schema: "public",
        table:  "rebalance_logs",
        filter: `account_id=eq.${accountId}`,
      }, (payload: { new: Record<string, unknown> }) => {
        // Immediately refetch portfolio data on new rebalance
        qc.invalidateQueries({ queryKey: ["portfolio", accountId] })
        qc.invalidateQueries({ queryKey: ["history",   accountId] })

        const status = payload.new.status
        if (status === "completed") {
          toast.success("Rebalance executed — portfolio updated", {
            duration: 5000,
          })
        } else if (status === "failed") {
          toast.error("Rebalance failed — funds unchanged and safe")
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [accountId, qc])
}
