import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface DataTableSkeletonProps {
  columns?: number
  rows?: number
  className?: string
}

export function DataTableSkeleton({ columns = 5, rows = 8, className }: DataTableSkeletonProps) {
  return (
    <div className={cn("bg-card border rounded-xl overflow-hidden", className)}>
      <div className="px-6 py-4 border-b bg-muted/30">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="divide-y">
        <div
          className="grid px-6 py-3 bg-muted/20 gap-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={`h-${i}`} className="h-4 w-20" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={`r-${r}`}
            className="grid px-6 py-4 gap-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={`c-${r}-${c}`} className="h-4" style={{ width: `${60 + Math.random() * 30}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("bg-card border rounded-xl p-6", className)}>
      <Skeleton className="h-5 w-36 mb-4" />
      <Skeleton className="h-[300px] w-full rounded-lg" />
    </div>
  )
}

export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-9 w-32" />
    </div>
  )
}
