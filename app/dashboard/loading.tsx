import { PageContainer } from "@/components/shared/page-container"
import { PageHeaderSkeleton, ChartSkeleton, DataTableSkeleton } from "@/components/shared/skeletons"
import { MetricCardSkeleton } from "@/components/ui/metric-card"

export default function DashboardLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <MetricCardSkeleton />
      <div className="grid gap-4 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <DataTableSkeleton columns={5} rows={5} />
    </PageContainer>
  )
}
