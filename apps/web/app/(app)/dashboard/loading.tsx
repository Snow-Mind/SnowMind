import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <Skeleton className="h-8 w-36" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="crystal-card p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Yield chart skeleton */}
      <div className="crystal-card p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </div>

      {/* Allocation + History */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Allocation chart */}
        <div className="crystal-card p-6 lg:col-span-2">
          <Skeleton className="h-4 w-32" />
          <div className="mt-6 flex items-center gap-6">
            <Skeleton className="h-44 w-44 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>

        {/* Rebalance table */}
        <div className="crystal-card overflow-hidden lg:col-span-3">
          <div className="border-b border-border/30 px-6 py-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-0 divide-y divide-border/20 px-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-40 flex-1" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="crystal-card flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1 h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
