import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { PinnedAnnouncements } from "@/components/dashboard/pinned-announcements";
import { ComplianceReportGenerator } from "@/components/compliance/report-generator";
import { GroupAreaOverview } from "@/components/dashboard/group-area-overview";
import { MetricCardSkeleton } from "@/components/ui/metric-card";
import { DataTableSkeleton } from "@/components/shared";
import { PageContainer, PageHeader, SectionErrorBoundary } from "@/components/shared";
import { BRANCH_COOKIE_NAME } from "@/lib/tenant-context";
import { LiveCommandSection, LiveCommandSkeleton } from "@/components/dashboard/live/live-command-section";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;
  // Branch scope flows from the header BranchScopeControl (cookie-backed, AD-1):
  // "pulso_selected_branch" is the single source of truth across home sections.
  const cookieBranch = (await cookies()).get(BRANCH_COOKIE_NAME)?.value;
  const selectedBranch = cookieBranch || params.branch;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const companyId = session?.user?.companyId ?? "";

  return (
    <PageContainer>
      <PageHeader
        title="Comando de Red en Vivo"
        description="Monitoreo en tiempo real del turno: aperturas, dotación de personal, control de frío NOM-251 y ventas del día."
        actions={<ComplianceReportGenerator />}
      />

      {/* #1 — Live Command Center: Pulso del turno, alertas de rush y matriz de sucursales */}
      <Suspense fallback={<LiveCommandSkeleton />}>
        <SectionErrorBoundary>
          <LiveCommandSection companyId={companyId} branchId={selectedBranch} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #2 — El Consejo del Grupo: salud por área operativa con colas de excepciones cruzadas */}
      <div className="pt-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground mb-3">
          Salud Operativa por Áreas del Grupo
        </h2>
        <Suspense fallback={<MetricCardSkeleton count={6} />}>
          <SectionErrorBoundary>
            <GroupAreaOverview branch={selectedBranch} />
          </SectionErrorBoundary>
        </Suspense>
      </div>

      {/* #3 — Bitácora de actividad reciente del turno */}
      <div className="pt-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground mb-3">
          Bitácora en Tiempo Real de la Red
        </h2>
        <Suspense fallback={<DataTableSkeleton columns={5} rows={5} />}>
          {companyId ? (
            <RecentActivity companyId={companyId} branchId={selectedBranch} />
          ) : (
            <DataTableSkeleton columns={5} rows={5} />
          )}
        </Suspense>
      </div>

      {/* #4 — Comunicados fijados a la red */}
      {companyId && (
        <Suspense fallback={null}>
          <PinnedAnnouncements companyId={companyId} />
        </Suspense>
      )}
    </PageContainer>
  );
}

