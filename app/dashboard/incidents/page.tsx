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
      pendingActionCount: sql<number>`count(${remediationActions.id})`,
    })
    .from(incidents)
    .leftJoin(
      remediationActions,
      and(
        eq(remediationActions.incidentId, incidents.id),
        eq(remediationActions.status, 'PENDING')
      )
    )
    .where(and(...conditions))
    .groupBy(incidents.id)
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

export default async function IncidentsPage(props: { searchParams: Promise<{ page?: string }> }) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, parseInt(searchParams.page ?? '1'));

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect('/sign-in');
  }

  const cookieStore = await cookies();
  const selectedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value;

  const companyId = session.user.companyId;
  if (!companyId) {
    redirect('/onboarding');
  }

  const [allIncidents, totalCount, stats, branchName] = await Promise.all([
    getIncidentsPage(companyId, selectedBranchId, page),
    getTotalCount(companyId, selectedBranchId),
    getStats(companyId, selectedBranchId),
    selectedBranchId ? getBranchName(selectedBranchId) : Promise.resolve(null),
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
          <Badge variant="outline" className="gap-1">
            <Building2 className="h-3 w-3" />
            {branchName}
          </Badge>
        )}
      </div>

      {/* Inline summary strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{stats.total}</span> totales
        </span>

        <span className="text-border">·</span>

        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span className="font-medium text-foreground">{stats.active}</span> activos
        </span>

        <span className="text-border">·</span>

        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <XCircle className="h-3.5 w-3.5 text-destructive" />
          <span className={`font-medium ${stats.critical > 0 ? 'text-destructive' : 'text-foreground'}`}>
            {stats.critical}
          </span> críticos
        </span>

        <span className="text-border">·</span>

        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span className="font-medium text-foreground">{stats.resolved}</span> resueltos
        </span>

        {stats.requiresAction > 0 && (
          <>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {stats.requiresAction}
              </span> requieren acción
            </span>
          </>
        )}
      </div>

      {/* Incidents table */}
      <Suspense fallback={<IncidentListSkeleton />}>
        <IncidentList
          incidents={allIncidents}
          totalCount={totalCount}
          page={page}
          totalPages={totalPages}
        />
      </Suspense>
    </div>
  );
}
