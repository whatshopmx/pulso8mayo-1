import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * El esqueleto replica la geometría real: umbrales (5), costos (3), fiscales
 * (4 + 2 selects) y dimensiones plegadas. Antes dibujaba 6 bloques de
 * dimensiones y 4 umbrales, así que el contenido saltaba dos veces.
 */
export function OperatingConfigSkeleton() {
  return (
    <div className="space-y-6">
      {/* Umbrales: 5 celdas */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-3 w-96" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={i === 4 ? "space-y-2 md:col-span-2" : "space-y-2"}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Objetivos de costo: 3 pares + semáforo */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 border-b pb-4 last:border-0">
              <Skeleton className="h-4 w-44" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
              <Skeleton className="h-3 w-64" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Parámetros fiscales: 4 campos + 2 selects */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-3 w-48" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Modelo operativo, plegado por defecto */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-6">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-3 w-80" />
        <Skeleton className="h-11 w-64" />
      </div>
    </div>
  );
}
