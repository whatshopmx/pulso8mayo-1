import { db } from "@/lib/db";
import {
  incidents,
  complianceAlerts,
  nom035ActionPlans,
  shiftApprovals,
  shiftChangeRequests,
  inventoryAlerts,
  equipmentAlerts,
  branches,
  dailySalesCuts,
} from "@/lib/db/schema";
import { and, desc, eq, ne, inArray, or, sql } from "drizzle-orm";

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

export type ExceptionDomain =
  | "operacion"
  | "cumplimiento"
  | "equipos"
  | "personal"
  | "inventario"
  | "finanzas";

export type ExceptionSeverity = "info" | "warning" | "high" | "critical" | "fatal";

export type QsrRiskCategory = "DINERO" | "INOCUIDAD" | "ABASTO" | "PERSONAL";

export type QsrActionType =
  | "AUDIT_DRAWER"
  | "INSPECT_EQUIPMENT"
  | "TRANSFER_STOCK"
  | "WHATSAPP_CALL"
  | "REVIEW_WORKFLOW"
  | "AUTHORIZE_SHIFT"
  | "RESOLVE_ALERT";

export interface QsrActionMeta {
  type: QsrActionType;
  label: string;
  url: string;
  whatsappSuggestedMessage?: string;
}

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
}

export interface ListOpenOptions {
  branchId?: string;
  domain?: ExceptionDomain;
  qsrCategory?: QsrRiskCategory;
  limit?: number;
}

function normalizeIncidentSeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    case "FATAL":
      return "fatal";
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "WARNING":
      return "warning";
    default:
      return "info";
  }
}

function normalizeEquipmentSeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "warning";
    default:
      return "info";
  }
}

function normalizeInventorySeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    case "CRITICA":
      return "critical";
    case "ALTA":
      return "high";
    case "MEDIA":
      return "warning";
    default:
      return "info";
  }
}

const INVENTORY_ALERT_TITLES: Record<string, string> = {
  LOW_STOCK: "Stock bajo en insumo clave",
  OUT_OF_STOCK: "Desabasto de insumo en turno",
  EXPIRING_SOON: "Insumo por vencer (caducidad)",
  EXPIRED: "Insumo vencido detectado",
  PRICE_INCREASE: "Alza de precio en compra",
  HIGH_VARIANCE: "Variación alta en porcionado",
  ANOMALOUS_WASTE: "Merma anómala registrada",
  YIELD_DROP: "Caída de rendimiento en receta",
};

function normalizeNom035Priority(p: string | null): ExceptionSeverity {
  switch (p) {
    case "URGENT":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "warning";
    default:
      return "info";
  }
}

function classifyQsrIncident(
  title: string,
  desc: string | null,
  incidentId: string,
): {
  qsrCategory: QsrRiskCategory;
  impact: string;
  action: QsrActionMeta;
} {
  const text = `${title} ${desc ?? ""}`.toLowerCase();
  if (
    text.includes("temp") ||
    text.includes("frio") ||
    text.includes("frío") ||
    text.includes("refrig") ||
    text.includes("congel") ||
    text.includes("nom-251") ||
    text.includes("higiene") ||
    text.includes("sanit") ||
    text.includes("plaga")
  ) {
    return {
      qsrCategory: "INOCUIDAD",
      impact: "Riesgo de inocuidad alimentaria o sanción sanitaria NOM-251",
      action: {
        type: "INSPECT_EQUIPMENT",
        label: "Inspeccionar en Turno",
        url: `/dashboard/incidents/${incidentId}`,
        whatsappSuggestedMessage: `Alerta sanitaria detectada en sucursal. Por favor revisar de inmediato la cámara de frío y registrar lectura de temperatura.`,
      },
    };
  }
  if (
    text.includes("caja") ||
    text.includes("dinero") ||
    text.includes("arqueo") ||
    text.includes("terminal") ||
    text.includes("tpv") ||
    text.includes("cobro") ||
    text.includes("robo") ||
    text.includes("faltante")
  ) {
    return {
      qsrCategory: "DINERO",
      impact: "Dinero en riesgo o descuadre de cobro",
      action: {
        type: "AUDIT_DRAWER",
        label: "Auditar Corte POS/TPV",
        url: `/dashboard/incidents/${incidentId}`,
      },
    };
  }
  if (
    text.includes("merma") ||
    text.includes("stock") ||
    text.includes("desabasto") ||
    text.includes("insumo") ||
    text.includes("carne") ||
    text.includes("pollo") ||
    text.includes("queso")
  ) {
    return {
      qsrCategory: "ABASTO",
      impact: "Riesgo de desabasto o merma crítica en servicio",
      action: {
        type: "TRANSFER_STOCK",
        label: "Transferir Insumos",
        url: `/dashboard/incidents/${incidentId}`,
      },
    };
  }
  if (
    text.includes("personal") ||
    text.includes("retardo") ||
    text.includes("falta") ||
    text.includes("asistencia") ||
    text.includes("turno")
  ) {
    return {
      qsrCategory: "PERSONAL",
      impact: "Falta o retardo en plantilla operativa",
      action: {
        type: "AUTHORIZE_SHIFT",
        label: "Revisar Asistencia",
        url: `/dashboard/labor/approvals`,
      },
    };
  }
  return {
    qsrCategory: "INOCUIDAD",
    impact: "Desviación operativa en línea de servicio",
    action: {
      type: "REVIEW_WORKFLOW",
      label: "Revisar Incidente",
      url: `/dashboard/incidents/${incidentId}`,
    },
  };
}

export const GroupExceptionsService = {
  /**
   * Todas las excepciones abiertas de las fuentes Nivel A, para una compañía.
   * Ejecuta queries en paralelo y normaliza el resultado a `GroupException`
   * clasificándolas por categoría QSR de negocio.
   */
  async listOpen(
    companyId: string,
    opts: ListOpenOptions = {},
  ): Promise<GroupException[]> {
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
          detectedAt: inventoryAlerts.detectedAt,
          resolvedAt: inventoryAlerts.resolvedAt,
          resolvedBy: inventoryAlerts.resolvedBy,
          notes: inventoryAlerts.notes,
        })
        .from(inventoryAlerts)
        .innerJoin(branches, eq(inventoryAlerts.branchId, branches.id))
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
        title: INVENTORY_ALERT_TITLES[r.type] ?? r.type,
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

    let filtered = domain ? results.filter((r) => r.domain === domain) : results;
    if (qsrCategory) {
      filtered = filtered.filter((r) => r.qsrCategory === qsrCategory);
    }

    filtered.sort((a, b) => {
      const rank: Record<ExceptionSeverity, number> = {
        fatal: 0,
        critical: 1,
        high: 2,
        warning: 3,
        info: 4,
      };
      const bySeverity = rank[a.severity] - rank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      const aTime = a.detectedAt?.getTime() ?? 0;
      const bTime = b.detectedAt?.getTime() ?? 0;
      return bTime - aTime;
    });

    return limit ? filtered.slice(0, limit) : filtered;
  },
};
