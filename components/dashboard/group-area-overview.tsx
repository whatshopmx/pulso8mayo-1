import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  Building2,
  Coins,
  Package,
  ShieldCheck,
  SquareTerminal,
  Users,
  Wrench,
} from "lucide-react";
import { AreaCard } from "./area-card";
import { GroupExceptionsService, type ExceptionDomain } from "@/lib/services/group-exceptions-service";
import { CrossBranchService, type MetricRanking } from "@/lib/services/cross-branch-service";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";

interface GroupAreaOverviewProps {
  /** Active branch scope (cookie-derived by the home page; null/"all" ⇒ chain rollup). */
  branch?: string | null;
}

/**
 * "finanzas" no es un `ExceptionDomain`: hoy no hay ninguna fuente Nivel A
 * financiera en GroupExceptionsService (Control Interno calcula al vuelo,
 * sin tabla — ver tasks/plan.md). La tarjeta se muestra igual, siempre vacía
 * hasta que exista una fuente real, en vez de ocultar el área.
 */
const AREAS: { domain: ExceptionDomain | "finanzas"; title: string; icon: typeof Building2; href: string; metricLabel?: string }[] = [
  { domain: "operacion", title: "Operación", icon: SquareTerminal, href: "/dashboard/workflows", metricLabel: "Tasa de Cumplimiento de Workflows" },
  { domain: "inventario", title: "Inventario", icon: Package, href: "/dashboard/inventory", metricLabel: "Merma Total (30d)" },
  { domain: "personal", title: "Personal", icon: Users, href: "/dashboard/labor", metricLabel: "Ausencias (30d)" },
  { domain: "cumplimiento", title: "Cumplimiento", icon: ShieldCheck, href: "/dashboard/compliance", metricLabel: "Compliance Score" },
  { domain: "equipos", title: "Equipos", icon: Wrench, href: "/dashboard/equipment" },
  { domain: "finanzas", title: "Finanzas", icon: Coins, href: "/dashboard/finance" },
];

function formatMetric(metrics: MetricRanking[] | null | undefined, label: string): { label: string; value: string } | null {
  if (!metrics) return null;
  const metric = metrics.find((m) => m.label === label);
  if (!metric || metric.rankings.length === 0) return null;

  const avg = metric.rankings.reduce((sum, r) => sum + r.value, 0) / metric.rankings.length;
  let value: string;
  if (metric.unit === "%") value = `${Math.round(avg * 10) / 10}%`;
  else if (metric.unit === "MXN") value = `$${Math.round(avg).toLocaleString("es-MX")}`;
  else value = `${Math.round(avg * 10) / 10} ${metric.unit}`;

  return { label: "Promedio del grupo", value };
}

/**
 * "Consejo del Grupo" — una tarjeta por área operativa con su cola de
 * excepciones abiertas (GroupExceptionsService, fuentes Nivel A) y, cuando
 * existe un dato cross-sucursal confiable, un promedio del grupo. Finanzas y
 * Equipos no tienen todavía una métrica cross-sucursal madura en
 * CrossBranchService — se omite en vez de inventar un número (ver
 * tasks/plan.md, Roadmap).
 */
export async function GroupAreaOverview({ branch }: GroupAreaOverviewProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  const companyId = session?.user?.companyId;
  const userRole = (session?.user as { role?: Role })?.role;
  const userBranchId = (session?.user as { branchId?: string })?.branchId;

  if (!companyId || !userRole) return null;

  const requestedBranchId = branch && branch !== "all" ? branch : null;
  const scope = resolveBranchScope(userRole, userBranchId ?? null, requestedBranchId);
  if (scope.kind === "NONE") return null;

  const scopedBranchId = scope.kind === "BRANCH" ? scope.branchId : undefined;

  const [exceptions, benchmarking] = await Promise.all([
    GroupExceptionsService.listOpen(companyId, { branchId: scopedBranchId }),
    // El benchmarking es una comparación entre sucursales del grupo completo:
    // no tiene sentido filtrarlo cuando ya se acotó a una sola.
    scopedBranchId ? Promise.resolve(null) : CrossBranchService.getBenchmarking(companyId),
  ]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {AREAS.map((area) => {
        const areaExceptions = exceptions.filter((e) => e.domain === area.domain);
        return (
          <AreaCard
            key={area.domain}
            domain={area.domain}
            title={area.title}
            icon={area.icon}
            href={area.href}
            metric={area.metricLabel ? formatMetric(benchmarking?.metrics, area.metricLabel) : null}
            exceptions={areaExceptions}
            totalExceptionCount={areaExceptions.length}
          />
        );
      })}
    </div>
  );
}
