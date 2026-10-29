import { Suspense } from "react";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { PinnedAnnouncements } from "@/components/dashboard/pinned-announcements";
import { ComplianceReportGenerator } from "@/components/compliance/report-generator";
import { GroupAreaOverview } from "@/components/dashboard/group-area-overview";
import { MetricCardSkeleton } from "@/components/ui/metric-card";
import { DataTableSkeleton } from "@/components/shared";
import { PageContainer, PageHeader, SectionErrorBoundary } from "@/components/shared";
import { LiveCommandSection, LiveCommandSkeleton } from "@/components/dashboard/live/live-command-section";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { scopeBranchId, resolveRequestBranchScope } from "@/lib/server/effective-branch";
import { hasAccess, type UserRole } from "@/lib/rbac/permissions";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;

  // F01: el alcance autorizado se resuelve una sola vez, aquí, y se comparte
  // con todos los widgets. Antes la cookie/query se pasaba tal cual al pulso y
  // un GERENTE de Condesa podía leer Roma con `?branch=<roma>`.
  const scope = await resolveRequestBranchScope(params.branch);
  const selectedBranch = scopeBranchId(scope);

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const companyId = session?.user?.companyId ?? "";

  // RBAC-01: la bitácora enlaza a /dashboard/workflows, que READONLY tiene
  // denegado. Sin esta bandera el CTA "Iniciar" era un enlace que expulsaba.
  const role = (session?.user?.role ?? "EMPLEADO") as UserRole;
  const canExecute = hasAccess(role, "/dashboard/workflows");

  if (scope.kind === "NONE") {
    return (
      <PageContainer>
        <PageHeader
          title="Comando de Red en Vivo"
          description="Monitoreo en tiempo real del turno: aperturas, dotación de personal, control de frío NOM-251 y ventas del día."
        />
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold text-foreground">Sin sucursal asignada</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tu usuario tiene un rol que solo puede ver una sucursal, pero no tiene ninguna
            asignada. Pide a un administrador que te asigne una para consultar el pulso.
          </p>
        </div>
      </PageContainer>
    );
  }

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
          <LiveCommandSection companyId={companyId} branchId={selectedBranch ?? undefined} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #2 — El Consejo del Grupo: salud por área operativa con colas de excepciones cruzadas */}
      <div className="pt-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground mb-3">
          Salud Operativa por Áreas del Grupo
        </h2>
        <Suspense fallback={<MetricCardSkeleton count={6} columns={3} />}>
          <SectionErrorBoundary>
            <GroupAreaOverview branch={selectedBranch} />
          </SectionErrorBoundary>
        </Suspense>
      </div>

      {/* #3 — Bitácora de actividad reciente del turno (histórico: sí respeta el rango de fechas) */}
      <div className="pt-2">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Bitácora en Tiempo Real de la Red
          </h2>
          <p className="text-xs text-muted-foreground">
            El pulso del turno es en vivo; el rango de fechas aplica a esta bitácora.
          </p>
        </div>
        <Suspense fallback={<DataTableSkeleton columns={6} rows={5} />}>
          {companyId ? (
            <RecentActivity
              companyId={companyId}
              branchId={selectedBranch ?? undefined}
              startDate={params.startDate}
              endDate={params.endDate}
              canExecute={canExecute}
            />
          ) : (
            <DataTableSkeleton columns={6} rows={5} />
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
