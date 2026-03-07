import { Skeleton } from "@/components/ui/skeleton";

export default function PortfolioLoading() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="crystal-card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="crystal-card overflow-hidden">
        <div className="border-b border-border/30 px-6 py-4">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-0 divide-y divide-border/20 px-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-20 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="crystal-card p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </div>

      <div className="crystal-card p-6">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}
