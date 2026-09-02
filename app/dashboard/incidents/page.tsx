import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { incidents, branches, remediationActions } from '@/lib/db/schema';
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { IncidentList, IncidentListSkeleton } from '@/components/incidents/incident-list';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, XCircle, CheckCircle2, Building2, ShieldAlert } from 'lucide-react';
import { BRANCH_COOKIE_NAME } from '@/lib/tenant-context';
import Link from 'next/link';
import { resolveBranchScope, canAccessAllBranches } from '@/lib/branch-scope';
import { getBranchIncidentStats } from '@/lib/services/branch-incident-stats';
import { BranchIncidentSummary } from '@/components/dashboard/branch-incident-summary';
import { BranchRanking } from '@/components/dashboard/branch-ranking';
import type { Role } from '@/lib/permissions';

// ── Constants ────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ── Data layer ──────────────────────────────────────────────────────

interface IncidentRow {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'FATAL';
  title: string;
  status: 'DETECTED' | 'IN_REMEDIATION' | 'AWAITING_EXTERNAL' | 'CONFIRMED' | 'RESOLVED' | 'ESCALATED';
  createdAt: Date;
  instanceId: string;
  branchId: string;
  /** Nombre de la sucursal, para la vista consolidada. */
  branchName?: string;
  /** Acciones de remediación externa esperando que gerencia agende la visita. */
  pendingActionCount: number;
}

function buildConditions(companyId: string, branchId?: string) {
  return async () => {
    const companyBranches = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const branchIds = companyBranches.map(b => b.id);
    if (branchIds.length === 0) return null;

    const conditions = [inArray(incidents.branchId, branchIds)];
    if (branchId) {
      conditions.push(eq(incidents.branchId, branchId));
    }
    return conditions;
  };
}

async function getTotalCount(companyId: string, branchId?: string): Promise<number> {
  const build = buildConditions(companyId, branchId);
  const conditions = await build();
  if (!conditions) return 0;

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(incidents)
    .where(and(...conditions));

  return Number(result?.count ?? 0);
}

async function getIncidentsPage(companyId: string, branchId: string | undefined, page: number): Promise<IncidentRow[]> {
  const build = buildConditions(companyId, branchId);
  const conditions = await build();
  if (!conditions) return [];

  // El conteo de acciones pendientes va agregado en la misma query: un leftJoin
  // filtrado por PENDING más un group by, en vez de una consulta por incidente.
  const rows = await db
    .select({
      id: incidents.id,
      severity: incidents.severity,
      title: incidents.title,
      status: incidents.status,
      createdAt: incidents.createdAt,
      instanceId: incidents.instanceId,
      branchId: incidents.branchId,
      branchName: branches.name,
      pendingActionCount: sql<number>`count(${remediationActions.id})`,
    })
    .from(incidents)
    .innerJoin(branches, eq(branches.id, incidents.branchId))
    .leftJoin(
      remediationActions,
      and(
        eq(remediationActions.incidentId, incidents.id),
        eq(remediationActions.status, 'PENDING')
      )
    )
    .where(and(...conditions))
    .groupBy(incidents.id, branches.name)
    .orderBy(desc(incidents.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return rows.map((row) => ({
    ...row,
    pendingActionCount: Number(row.pendingActionCount ?? 0),
  })) as IncidentRow[];
}

async function getStats(companyId: string, branchId?: string) {
  const build = buildConditions(companyId, branchId);
  const conditions = await build();
  if (!conditions) return { total: 0, active: 0, critical: 0, resolved: 0, requiresAction: 0 };

  const rows = await db
    .select({
      status: incidents.status,
      severity: incidents.severity,
    })
    .from(incidents)
    .where(and(...conditions))
    .limit(500);

  // Incidentes —no acciones— con al menos una acción de remediación pendiente.
  // Es la única query extra que añade el badge a la carga de la página.
  const [pending] = await db
    .select({ count: sql<number>`count(distinct ${incidents.id})` })
    .from(incidents)
    .innerJoin(remediationActions, eq(remediationActions.incidentId, incidents.id))
    .where(and(...conditions, eq(remediationActions.status, 'PENDING')));

  return {
    total: rows.length,
    active: rows.filter(i => i.status !== 'RESOLVED').length,
    critical: rows.filter(i => i.severity === 'CRITICAL' || i.severity === 'FATAL').length,
    resolved: rows.filter(i => i.status === 'RESOLVED').length,
    requiresAction: Number(pending?.count ?? 0),
  };
}

async function getBranchName(branchId: string) {
  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, branchId),
    columns: { name: true }
  });
  return branch?.name;
}

// ── Page ────────────────────────────────────────────────────────────

export default async function IncidentsPage(
  props: { searchParams: Promise<{ page?: string; branchId?: string }> }
) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, parseInt(searchParams.page ?? '1'));

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect('/sign-in');
  }

  const cookieStore = await cookies();
  /**
   * La URL puede pedir sucursal; el rol decide si se le concede.
   *
   * `?branchId=` es lo que enlazan las cards del resumen y el ranking, y hace
   * que el filtro se pueda compartir y abrir en otra pestaña —cosa que la
   * cookie global no permite. Entra como *peticion* y baja por el mismo
   * `resolveBranchScope` que la cookie: un GERENTE que edite la barra de
   * direcciones sigue viendo solo la suya.
   */
  const branchIdPedida = searchParams.branchId;
  const selectedBranchId =
    branchIdPedida ?? cookieStore.get(BRANCH_COOKIE_NAME)?.value;

  const companyId = session.user.companyId;
  if (!companyId) {
    redirect('/onboarding');
  }

  // La sucursal salía SOLO de la cookie, sin mirar el rol: un GERENTE que
  // cambiaba de sucursal veía la lista de otra. El alcance lo decide el rol; la
  // cookie solo puede elegir para quien no está acotado.
  const alcance = resolveBranchScope(
    ((session.user as any).role || 'EMPLEADO') as Role,
    (session.user as any).branchId ?? null,
    selectedBranchId ?? null
  );
  const sinSucursal = alcance.kind === 'NONE';
  const effectiveBranchId = alcance.kind === 'BRANCH' ? alcance.branchId : undefined;

  /**
   * El desglose por sucursal solo se calcula para quien puede ver mas de una.
   *
   * La pregunta es del **rol**, no del alcance ya resuelto: un ADMIN que filtra
   * a una sucursal tiene `alcance.kind === 'BRANCH'`, y mirarlo ahi le habria
   * escondido el resumen justo cuando lo usa para saltar de sucursal. Un
   * GERENTE esta fijado a la suya: un ranking de una fila no le dice nada y le
   * cuesta una consulta extra en cada carga de la lista.
   */
  const puedeVerVariasSucursales = canAccessAllBranches(
    ((session.user as any).role || 'EMPLEADO') as Role
  );

  const [allIncidents, totalCount, stats, branchName, branchStats] = sinSucursal
    ? [[] as IncidentRow[], 0, { total: 0, active: 0, critical: 0, resolved: 0, requiresAction: 0 }, null, []]
    : await Promise.all([
        getIncidentsPage(companyId, effectiveBranchId, page),
        getTotalCount(companyId, effectiveBranchId),
        getStats(companyId, effectiveBranchId),
        effectiveBranchId ? getBranchName(effectiveBranchId) : Promise.resolve(null),
        puedeVerVariasSucursales
          ? getBranchIncidentStats(companyId)
          : Promise.resolve([]),
      ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Incidentes</h1>
          <p className="text-muted-foreground">
            Monitorea y gestiona los incidentes de flujos de trabajo
          </p>
        </div>
        {branchName && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Building2 className="h-3 w-3" />
              {branchName}
            </Badge>
            {/*
              * La salida del filtro solo aparece cuando lo puso la URL. Con la
              * cookie global el badge es informativo —lo cambia el control del
              * header— y un "ver todas" aqui dejaria dos mandos peleandose por
              * el mismo estado.
              */}
            {branchIdPedida && puedeVerVariasSucursales && (
              <Link
                href="/dashboard/incidents"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Ver todas las sucursales
              </Link>
            )}
          </div>
        )}
      </div>

      {sinSucursal && (
        <div className="rounded-md border border-amber-200/60 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="font-medium">Tu usuario no tiene una sucursal asignada.</p>
          <p className="text-muted-foreground">
            Por eso esta lista aparece vacía. Pídele a un administrador que te asigne una sucursal.
          </p>
        </div>
      )}

      {/* Zero-incidents empty state */}
      {stats.total === 0 && !sinSucursal ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <h2 className="text-lg font-semibold">Operaciones limpias</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            No hay incidentes activos. Todo en orden.
          </p>
        </div>
      ) : (
        <>
          {/* Inline summary strip — icons are decorative (text labels them), so aria-hidden */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-medium text-foreground">{stats.total}</span> totales
            </span>

            <span className="text-border">·</span>

            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              <span className="font-medium text-foreground">{stats.active}</span> activos
            </span>

            <span className="text-border">·</span>

            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
              <span className={`font-medium ${stats.critical > 0 ? 'text-destructive' : 'text-foreground'}`}>
                {stats.critical}
              </span> críticos
            </span>

            <span className="text-border">·</span>

            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              <span className="font-medium text-foreground">{stats.resolved}</span> resueltos
            </span>

            <span className="text-border">·</span>

            {/* title on the span provides the tooltip; icon is decorative */}
            <span
              className={`inline-flex items-center gap-1.5 ${
                stats.requiresAction > 0
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/50'
              }`}
              title="Incidentes con acciones de remediación pendientes de agendar."
            >
              <ShieldAlert
                className={`h-3.5 w-3.5 ${
                  stats.requiresAction > 0 ? 'text-amber-600' : 'text-muted-foreground/40'
                }`}
                aria-hidden="true"
              />
              <span
                className={`font-medium ${
                  stats.requiresAction > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-muted-foreground/50'
                }`}
              >
                {stats.requiresAction}
              </span>{' '}
              requieren acción
            </span>
          </div>

          {/*
            * Vista consolidada: solo para quien ve mas de una sucursal, y solo
            * cuando hay mas de una que comparar. Con una sola sucursal el
            * ranking es una lista de un elemento y el resumen repite lo que ya
            * dice la tira de estadisticas de arriba.
            */}
          {puedeVerVariasSucursales && branchStats.length > 1 && (
            <div className="space-y-6">
              <BranchIncidentSummary
                branches={branchStats}
                selectedBranchId={effectiveBranchId}
              />
              <BranchRanking branches={branchStats} />
            </div>
          )}

          {/* Incidents table */}
          <Suspense fallback={<IncidentListSkeleton />}>
            <IncidentList
              // El nombre de sucursal solo viaja en la vista consolidada: con
              // la lista ya filtrada, un badge idéntico en cada fila repite lo
              // que el encabezado dice una vez.
              incidents={
                effectiveBranchId
                  ? allIncidents.map(({ branchName: _omitido, ...resto }) => resto)
                  : allIncidents
              }
              totalCount={totalCount}
              page={page}
              totalPages={totalPages}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
