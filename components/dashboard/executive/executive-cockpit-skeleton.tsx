import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ExecutiveCockpitSkeleton() {
  return (
    <div className="space-y-4">
      {/* Title skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Vital signs cards skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-border shadow-none">
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-4" />
              </div>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Mode switcher skeleton */}
      <div className="flex gap-2 border-b border-border pb-1">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-40" />
      </div>

      {/* Content body skeleton */}
      <div className="space-y-4 pt-2">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
