import { db } from "@/lib/db";
import {
  incidents,
  complianceAlerts,
  nom035ActionPlans,
  shiftApprovals,
  shiftChangeRequests,
  inventoryAlerts,
  inventoryItems,
  equipmentAlerts,
  branches,
  dailySalesCuts,
} from "@/lib/db/schema";
import { and, eq, ne, inArray, or, sql } from "drizzle-orm";

/**
 * GroupExceptionsService — capa de lectura que unifica los sistemas de
 * excepción "Nivel A" (ya tienen status + responsable + resolución propios,
 * solo están aislados entre sí). No escribe nada: cada dominio conserva su
 * propia pantalla de resolución, esto solo la hace encontrable desde un
 * único feed a nivel grupo.
 *
 * Enriquecido para el perfil QSR multi-unidad (3 a 15 sucursales) clasificando
 * las anomalías en 4 categorías de impacto: DINERO, INOCUIDAD, ABASTO y PERSONAL.
 */

import {
  normalizeIncidentSeverity,
  normalizeEquipmentSeverity,
  normalizeInventorySeverity,
  normalizeNom035Priority,
  classifyQsrIncident,
  INVENTORY_ALERT_TITLES,
  type QsrActionMeta,
  type ExceptionDomain,
  type ExceptionSeverity,
  type QsrRiskCategory,
} from "./exception-adapters/shared";
import { ExceptionService, type ExceptionRow } from "./exception-service";
import type { ExceptionStatus } from "./exception-types";

export type {
  ExceptionDomain,
  ExceptionSeverity,
  QsrRiskCategory,
  QsrActionType,
  QsrActionMeta,
} from "./exception-adapters/shared";

export interface GroupException {
  id: string;
  domain: ExceptionDomain;
  qsrCategory: QsrRiskCategory;
  sourceTable: string;
  branchId: string | null;
  branchName: string | null;
  severity: ExceptionSeverity;
  title: string;
  description: string | null;
  status: string;
  assignedTo: string | null;
  detectedAt: Date | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  deepLinkUrl: string;
  estimatedImpact?: string | null;
  action?: QsrActionMeta;
  /**
   * Presente solo cuando la fila proviene de la tabla canónica `exceptions`:
   * `id` es el id canónico y las acciones de lifecycle pueden operar sobre él.
   */
  lifecycle?: GroupExceptionLifecycle;
}

export interface GroupExceptionLifecycle {
  status: ExceptionStatus;
  ownerId: string | null;
  slaDueAt: Date | null;
}

export interface ListOpenOptions {
  branchId?: string;
  domain?: ExceptionDomain;
  qsrCategory?: QsrRiskCategory;
  limit?: number;
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  fatal: 0,
  critical: 1,
  high: 2,
  warning: 3,
  info: 4,
};

/** Filtra/ordena el feed igual para la fuente legacy y la canónica. */
function applyListOpenFilters(
  results: GroupException[],
  opts: ListOpenOptions,
): GroupException[] {
  const { domain, qsrCategory, limit } = opts;
  let filtered = domain ? results.filter((r) => r.domain === domain) : results;
  if (qsrCategory) {
    filtered = filtered.filter((r) => r.qsrCategory === qsrCategory);
  }
  filtered.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const aTime = a.detectedAt?.getTime() ?? 0;
    const bTime = b.detectedAt?.getTime() ?? 0;
    return bTime - aTime;
  });
  return limit ? filtered.slice(0, limit) : filtered;
}

/** Flag de rollout del feed canónico (env). Phase 7 retira el legacy. */
export function isCanonicalReadEnabled(): boolean {
  return process.env.EXCEPTIONS_CANONICAL_READ === "true";
}

/** Enlaces por defecto cuando la fila no trae `action_meta.url`. */
const SUBJECT_DEEP_LINKS: Record<string, string> = {
  incident: "/dashboard/incidents",
  inventory_alert: "/dashboard/inventory/alerts",
  compliance_alert: "/dashboard/compliance",
  equipment_alert: "/dashboard/equipment/maintenance",
  nom035_action_plan: "/dashboard/compliance",
  shift_approval: "/dashboard/labor/approvals",
  shift_change_request: "/dashboard/labor/shift-changes",
  cash_variance: "/dashboard/finance/cash-flow",
  invoice_discrepancy: "/dashboard/inventory/invoices",
};

/** Mapea una fila canónica al shape `GroupException` del feed. Puro. */
export function canonicalExceptionToGroupException(
  row: ExceptionRow,
  branchName: string | null = null,
): GroupException {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const actionMeta = (row.actionMeta ?? null) as QsrActionMeta | null;
  return {
    id: row.id,
    domain: row.domain,
    qsrCategory: row.qsrCategory,
    sourceTable: row.subjectType,
    branchId: row.branchId,
    branchName,
    severity: row.severity,
    title: (meta.title as string) ?? row.reason,
    description: (meta.description as string) ?? null,
    status: row.status,
    assignedTo: row.ownerId,
    detectedAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolutionNotes: row.resolution,
    deepLinkUrl:
      actionMeta?.url ??
      SUBJECT_DEEP_LINKS[row.subjectType] ??
      "/dashboard/exceptions",
    estimatedImpact: (meta.impact as string) ?? null,
    action: actionMeta ?? undefined,
    lifecycle: {
      status: row.status,
      ownerId: row.ownerId,
      slaDueAt: row.slaDueAt,
    },
  };
}

async function listOpenCanonical(
  companyId: string,
  opts: ListOpenOptions,
): Promise<GroupException[]> {
  const rows = await ExceptionService.listOpen(companyId, {
    branchId: opts.branchId ?? null,
  });
  const branchRows = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));
  const names = new Map(branchRows.map((b) => [b.id, b.name]));
  const mapped = rows.map((r) =>
    canonicalExceptionToGroupException(
      r,
      r.branchId ? names.get(r.branchId) ?? null : null,
    ),
  );
  return applyListOpenFilters(mapped, opts);
}

export const GroupExceptionsService = {
  /**
   * Todas las excepciones abiertas de las fuentes Nivel A, para una compañía.
   * Ejecuta queries en paralelo y normaliza el resultado a `GroupException`
   * clasificándolas por categoría QSR de negocio.
   *
   * Con `EXCEPTIONS_CANONICAL_READ=true` lee la tabla canónica `exceptions`
   * (Phase 7 retira el agregador legacy).
   */
  async listOpen(
    companyId: string,
    opts: ListOpenOptions = {},
  ): Promise<GroupException[]> {
    if (isCanonicalReadEnabled()) {
      return listOpenCanonical(companyId, opts);
    }

    const { branchId, domain, qsrCategory, limit } = opts;

    const [
      incidentRows,
      complianceRows,
      equipmentRows,
      nom035Rows,
      shiftApprovalRows,
      shiftChangeRows,
      inventoryRows,
      salesCutRows,
    ] = await Promise.all([
      db
        .select({
          id: incidents.id,
          branchId: incidents.branchId,
          branchName: branches.name,
          severity: incidents.severity,
          status: incidents.status,
          title: incidents.title,
          description: incidents.description,
          assignedTo: incidents.resolvedBy,
          detectedAt: incidents.createdAt,
          resolvedAt: incidents.resolvedAt,
          resolution: incidents.resolution,
        })
        .from(incidents)
        .innerJoin(branches, eq(incidents.branchId, branches.id))
        .where(
          and(
            eq(branches.companyId, companyId),
            ne(incidents.status, "RESOLVED"),
            branchId ? eq(incidents.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: complianceAlerts.id,
          branchId: complianceAlerts.branchId,
          branchName: branches.name,
          severity: complianceAlerts.severity,
          status: complianceAlerts.status,
          title: complianceAlerts.title,
          description: complianceAlerts.description,
          assignedTo: complianceAlerts.acknowledgedBy,
          detectedAt: complianceAlerts.createdAt,
          resolvedAt: complianceAlerts.resolvedAt,
          resolution: complianceAlerts.resolutionNotes,
        })
        .from(complianceAlerts)
        .leftJoin(branches, eq(complianceAlerts.branchId, branches.id))
        .where(
          and(
            eq(complianceAlerts.companyId, companyId),
            inArray(complianceAlerts.status, ["ACTIVE", "ACKNOWLEDGED"]),
            branchId ? eq(complianceAlerts.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: equipmentAlerts.id,
          branchId: equipmentAlerts.branchId,
          branchName: branches.name,
          severity: equipmentAlerts.severity,
          status: equipmentAlerts.status,
          title: equipmentAlerts.title,
          description: equipmentAlerts.description,
          assignedTo: equipmentAlerts.acknowledgedBy,
          detectedAt: equipmentAlerts.createdAt,
          resolvedAt: equipmentAlerts.resolvedAt,
          resolution: equipmentAlerts.resolutionNotes,
        })
        .from(equipmentAlerts)
        .innerJoin(branches, eq(equipmentAlerts.branchId, branches.id))
        .where(
          and(
            eq(equipmentAlerts.companyId, companyId),
            inArray(equipmentAlerts.status, ["ACTIVE", "ACKNOWLEDGED"]),
            branchId ? eq(equipmentAlerts.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: nom035ActionPlans.id,
          branchId: nom035ActionPlans.branchId,
          branchName: branches.name,
          priority: nom035ActionPlans.priority,
          status: nom035ActionPlans.status,
          title: nom035ActionPlans.title,
          description: nom035ActionPlans.description,
          assignedTo: nom035ActionPlans.assignedTo,
          detectedAt: nom035ActionPlans.createdAt,
        })
        .from(nom035ActionPlans)
        .leftJoin(branches, eq(nom035ActionPlans.branchId, branches.id))
        .where(
          and(
            eq(nom035ActionPlans.companyId, companyId),
            inArray(nom035ActionPlans.status, ["PENDING", "IN_PROGRESS"]),
            branchId ? eq(nom035ActionPlans.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: shiftApprovals.id,
          branchId: shiftApprovals.branchId,
          branchName: branches.name,
          title: shiftApprovals.title,
          description: shiftApprovals.description,
          requestedFor: shiftApprovals.requestedFor,
          detectedAt: shiftApprovals.createdAt,
        })
        .from(shiftApprovals)
        .innerJoin(branches, eq(shiftApprovals.branchId, branches.id))
        .where(
          and(
            eq(shiftApprovals.companyId, companyId),
            eq(shiftApprovals.status, "PENDING"),
            branchId ? eq(shiftApprovals.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: shiftChangeRequests.id,
          branchId: shiftChangeRequests.branchId,
          branchName: branches.name,
          reason: shiftChangeRequests.reason,
          requestedBy: shiftChangeRequests.requestedBy,
          detectedAt: shiftChangeRequests.createdAt,
        })
        .from(shiftChangeRequests)
        .innerJoin(branches, eq(shiftChangeRequests.branchId, branches.id))
        .where(
          and(
            eq(shiftChangeRequests.companyId, companyId),
            eq(shiftChangeRequests.status, "PENDING"),
            branchId ? eq(shiftChangeRequests.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: inventoryAlerts.id,
          branchId: inventoryAlerts.branchId,
          branchName: branches.name,
          severity: inventoryAlerts.severity,
          status: inventoryAlerts.status,
          type: inventoryAlerts.type,
          itemName: inventoryItems.name,
          detectedAt: inventoryAlerts.detectedAt,
          resolvedAt: inventoryAlerts.resolvedAt,
          resolvedBy: inventoryAlerts.resolvedBy,
          notes: inventoryAlerts.notes,
        })
        .from(inventoryAlerts)
        .innerJoin(branches, eq(inventoryAlerts.branchId, branches.id))
        .innerJoin(inventoryItems, eq(inventoryAlerts.itemId, inventoryItems.id))
        .where(
          and(
            eq(inventoryAlerts.companyId, companyId),
            inArray(inventoryAlerts.status, ["ACTIVE", "VIEWED", "IN_PROGRESS"]),
            branchId ? eq(inventoryAlerts.branchId, branchId) : undefined,
          ),
        ),

      db
        .select({
          id: dailySalesCuts.id,
          branchId: dailySalesCuts.branchId,
          branchName: branches.name,
          businessDate: dailySalesCuts.businessDate,
          shift: dailySalesCuts.shift,
          status: dailySalesCuts.status,
          cashSales: dailySalesCuts.cashSales,
          cashCountedCents: dailySalesCuts.cashCountedCents,
          totalSales: dailySalesCuts.totalSales,
          detectedAt: dailySalesCuts.createdAt,
        })
        .from(dailySalesCuts)
        .innerJoin(branches, eq(dailySalesCuts.branchId, branches.id))
        .where(
          and(
            eq(branches.companyId, companyId),
            or(
              eq(dailySalesCuts.status, "PENDING_REVIEW"),
              and(
                sql`${dailySalesCuts.cashSales} IS NOT NULL`,
                sql`${dailySalesCuts.cashCountedCents} IS NOT NULL`,
                sql`ABS(${dailySalesCuts.cashSales} - ${dailySalesCuts.cashCountedCents}) >= 10000`,
              ),
            ),
            branchId ? eq(dailySalesCuts.branchId, branchId) : undefined,
          ),
        ),
    ]);

    const results: GroupException[] = [];

    // 1. Incidents
    for (const r of incidentRows) {
      const qsr = classifyQsrIncident(r.title, r.description, r.id);
      results.push({
        id: r.id,
        domain: "operacion",
        qsrCategory: qsr.qsrCategory,
        sourceTable: "incidents",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: normalizeIncidentSeverity(r.severity),
        title: r.title,
        description: r.description,
        status: r.status ?? "DETECTED",
        assignedTo: r.assignedTo,
        detectedAt: r.detectedAt,
        resolvedAt: r.resolvedAt,
        resolutionNotes: r.resolution,
        deepLinkUrl: `/dashboard/incidents/${r.id}`,
        estimatedImpact: qsr.impact,
        action: qsr.action,
      });
    }

    // 2. Compliance Alerts (NOM-251)
    for (const r of complianceRows) {
      results.push({
        id: r.id,
        domain: "cumplimiento",
        qsrCategory: "INOCUIDAD",
        sourceTable: "compliance_alerts",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: normalizeIncidentSeverity(r.severity),
        title: r.title,
        description: r.description,
        status: r.status,
        assignedTo: r.assignedTo,
        detectedAt: r.detectedAt,
        resolvedAt: r.resolvedAt,
        resolutionNotes: r.resolution,
        deepLinkUrl: `/dashboard/compliance`,
        estimatedImpact: "Riesgo de no conformidad sanitaria NOM-251",
        action: {
          type: "RESOLVE_ALERT",
          label: "Atender Alerta Sanitaria",
          url: "/dashboard/compliance",
        },
      });
    }

    // 3. Equipment Alerts (Cold Chain & Kitchen Line)
    for (const r of equipmentRows) {
      results.push({
        id: r.id,
        domain: "equipos",
        qsrCategory: "INOCUIDAD",
        sourceTable: "equipment_alerts",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: normalizeEquipmentSeverity(r.severity),
        title: r.title,
        description: r.description,
        status: r.status ?? "ACTIVE",
        assignedTo: r.assignedTo,
        detectedAt: r.detectedAt,
        resolvedAt: r.resolvedAt,
        resolutionNotes: r.resolution,
        deepLinkUrl: `/dashboard/equipment/maintenance`,
        estimatedImpact: "Falla de equipo en línea de cocina / cadena de frío",
        action: {
          type: "INSPECT_EQUIPMENT",
          label: "Ver Orden de Servicio",
          url: `/dashboard/equipment/maintenance`,
        },
      });
    }

    // 4. NOM-035 (Labor compliance)
    for (const r of nom035Rows) {
      results.push({
        id: r.id,
        domain: "cumplimiento",
        qsrCategory: "PERSONAL",
        sourceTable: "nom035_action_plans",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: normalizeNom035Priority(r.priority),
        title: r.title,
        description: r.description,
        status: r.status,
        assignedTo: r.assignedTo,
        detectedAt: r.detectedAt,
        resolvedAt: null,
        resolutionNotes: null,
        deepLinkUrl: `/dashboard/compliance`,
        estimatedImpact: "Riesgo psicosocial / normativo NOM-035",
        action: {
          type: "RESOLVE_ALERT",
          label: "Ver Plan NOM-035",
          url: `/dashboard/compliance`,
        },
      });
    }

    // 5. Shift Approvals
    for (const r of shiftApprovalRows) {
      results.push({
        id: r.id,
        domain: "personal",
        qsrCategory: "PERSONAL",
        sourceTable: "shift_approvals",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: "warning",
        title: r.title,
        description: r.description,
        status: "PENDING",
        assignedTo: r.requestedFor,
        detectedAt: r.detectedAt,
        resolvedAt: null,
        resolutionNotes: null,
        deepLinkUrl: `/dashboard/labor/approvals`,
        estimatedImpact: "Turno pendiente de confirmación de plantilla",
        action: {
          type: "AUTHORIZE_SHIFT",
          label: "Autorizar Turno",
          url: `/dashboard/labor/approvals`,
        },
      });
    }

    // 6. Shift Change Requests
    for (const r of shiftChangeRows) {
      results.push({
        id: r.id,
        domain: "personal",
        qsrCategory: "PERSONAL",
        sourceTable: "shift_change_requests",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: "info",
        title: `Cambio de turno: ${r.reason}`,
        description: null,
        status: "PENDING",
        assignedTo: r.requestedBy,
        detectedAt: r.detectedAt,
        resolvedAt: null,
        resolutionNotes: null,
        deepLinkUrl: `/dashboard/labor/shift-changes/${r.id}`,
        estimatedImpact: "Reemplazo de personal en turno de servicio",
        action: {
          type: "AUTHORIZE_SHIFT",
          label: "Evaluar Cambio",
          url: `/dashboard/labor/shift-changes/${r.id}`,
        },
      });
    }

    // 7. Inventory Alerts
    for (const r of inventoryRows) {
      const isCriticalSupply = r.type === "LOW_STOCK" || r.type === "OUT_OF_STOCK";
      results.push({
        id: r.id,
        domain: "inventario",
        qsrCategory: "ABASTO",
        sourceTable: "inventory_alerts",
        branchId: r.branchId,
        branchName: r.branchName,
        severity: normalizeInventorySeverity(r.severity),
        // El título interpola el sujeto real: un mapa estático por tipo hacía
        // que tres sucursales con stock bajo emitieran el mismo string.
        title: `${INVENTORY_ALERT_TITLES[r.type] ?? r.type}${r.itemName ? `: ${r.itemName}` : ""}`,
        description: r.notes,
        status: r.status,
        assignedTo: r.resolvedBy,
        detectedAt: r.detectedAt,
        resolvedAt: r.resolvedAt,
        resolutionNotes: r.notes,
        deepLinkUrl: `/dashboard/inventory/alerts?highlight=${r.id}`,
        estimatedImpact: isCriticalSupply
          ? "Riesgo de desabasto en rush de ventas"
          : "Merma o caducidad detectada en almacén",
        action: {
          type: "TRANSFER_STOCK",
          label: "Transferir Insumos",
          url: `/dashboard/inventory/alerts?highlight=${r.id}`,
        },
      });
    }

    // 8. Sales & Cash Discrepancies (DINERO)
    for (const r of salesCutRows) {
      const cashExpected = r.cashSales ?? 0;
      const cashCounted = r.cashCountedCents ?? cashExpected;
      const diffCents = cashExpected - cashCounted;
      const absDiff = Math.abs(diffCents);

      let title: string;
      let severity: ExceptionSeverity = "warning";
      let impactText: string;

      if (absDiff >= 10000) {
        if (diffCents > 0) {
          title = `Faltante de caja en turno ${r.shift}: -$${(diffCents / 100).toFixed(2)} MXN`;
          severity = absDiff >= 50000 ? "critical" : "high";
          impactText = `Faltante físico de $${(diffCents / 100).toFixed(2)} MXN sin justificar`;
        } else {
          title = `Sobrante de caja en turno ${r.shift}: +$${(absDiff / 100).toFixed(2)} MXN`;
          severity = "warning";
          impactText = `Diferencia de $${(absDiff / 100).toFixed(2)} MXN en arqueo`;
        }
      } else {
        title = `Corte de caja pendiente de validación (${r.shift})`;
        severity = "info";
        impactText = `Corte del ${r.businessDate} pendiente de cierre administrativo`;
      }

      results.push({
        id: r.id,
        domain: "finanzas",
        qsrCategory: "DINERO",
        sourceTable: "daily_sales_cuts",
        branchId: r.branchId,
        branchName: r.branchName,
        severity,
        title,
        description: `Fecha de negocio: ${r.businessDate} · Turno ${r.shift}`,
        status: r.status,
        assignedTo: null,
        detectedAt: r.detectedAt,
        resolvedAt: null,
        resolutionNotes: null,
        deepLinkUrl: `/dashboard/finance/cash-flow?cutId=${r.id}`,
        estimatedImpact: impactText,
        action: {
          type: "AUDIT_DRAWER",
          label: "Auditar Arqueo de Caja",
          url: `/dashboard/finance/cash-flow?cutId=${r.id}`,
          whatsappSuggestedMessage: `Hola, detectamos una diferencia de efectivo en el corte del turno ${r.shift} de ${r.branchName}. ¿Podrías confirmar el arqueo?`,
        },
      });
    }

    return applyListOpenFilters(results, opts);
  },
};
