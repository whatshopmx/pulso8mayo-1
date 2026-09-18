import { PageContainer } from "@/components/shared/page-container"
import { PageHeaderSkeleton, DataTableSkeleton } from "@/components/shared/skeletons"
import { MetricCardSkeleton } from "@/components/ui/metric-card"
import { LiveCommandSkeleton } from "@/components/dashboard/live/live-command-section"

/**
 * Espeja la composición real de `app/dashboard/page.tsx`:
 * header → comando en vivo → 6 tarjetas de área (3 columnas) → tabla de 6 columnas.
 *
 * Antes renderizaba 2 `ChartSkeleton`, pero la página NO tiene charts: el
 * skeleton era más alto/distinto que el contenido y producía salto de layout.
 */
export default function DashboardLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />

      <LiveCommandSkeleton />

      <div className="pt-2 space-y-3">
        <div className="h-5 w-64 rounded bg-muted animate-pulse" />
        <MetricCardSkeleton count={6} columns={3} />
      </div>

      <div className="pt-2 space-y-3">
        <div className="h-5 w-64 rounded bg-muted animate-pulse" />
        <DataTableSkeleton columns={6} rows={5} />
      </div>
    </PageContainer>
  )
}
