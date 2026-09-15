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
} from "@/lib/db/schema";
import { and, desc, eq, ne, inArray } from "drizzle-orm";

/**
 * GroupExceptionsService — capa de lectura que unifica los sistemas de
 * excepción "Nivel A" (ya tienen status + responsable + resolución propios,
 * solo están aislados entre sí). No escribe nada: cada dominio conserva su
 * propia pantalla de resolución, esto solo la hace encontrable desde un
 * único feed a nivel grupo. Ver tasks/plan.md (plan "Consejo del Grupo").
 *
 * `inventory_expiration_alerts` se dejó fuera a propósito: no tiene columna
 * de status/resolución (solo `window` + `notifiedAt`), así que no encaja en
 * este contrato — es candidato a Nivel C, no Nivel A.
 */

export type ExceptionDomain =
  | "operacion"
  | "cumplimiento"
  | "equipos"
  | "personal"
  | "inventario";

export type ExceptionSeverity = "info" | "warning" | "high" | "critical" | "fatal";

export interface GroupException {
  id: string;
  domain: ExceptionDomain;
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
}

export interface ListOpenOptions {
  branchId?: string;
  domain?: ExceptionDomain;
  limit?: number;
}

function normalizeIncidentSeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    // FATAL es un nivel propio, más grave que CRITICAL — colapsarlo en
    // "critical" hacía que el mismo incidente se leyera "Fatal" en su
    // detalle y "Crítico" en Excepciones/tarjetas de área.
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
  LOW_STOCK: "Stock bajo",
  OUT_OF_STOCK: "Sin stock",
  EXPIRING_SOON: "Por vencer",
  EXPIRED: "Vencido",
  PRICE_INCREASE: "Alza de precio",
  HIGH_VARIANCE: "Variación alta",
  ANOMALOUS_WASTE: "Merma anómala",
  YIELD_DROP: "Caída de rendimiento",
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

export const GroupExceptionsService = {
  /**
   * Todas las excepciones abiertas de las fuentes Nivel A, para una compañía.
   * Ejecuta 7 queries en paralelo (no una vista SQL: los shapes son distintos
   * por tabla) y normaliza el resultado a `GroupException`.
   */
  async listOpen(
    companyId: string,
    opts: ListOpenOptions = {},
  ): Promise<GroupException[]> {
    const { branchId, domain, limit } = opts;

    const [
      incidentRows,
      complianceRows,
      equipmentRows,
      nom035Rows,
      shiftApprovalRows,
      shiftChangeRows,
      inventoryRows,
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
    ]);

    const results: GroupException[] = [];

    for (const r of incidentRows) {
      results.push({
        id: r.id,
        domain: "operacion",
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
      });
    }

    for (const r of complianceRows) {
      results.push({
        id: r.id,
        domain: "cumplimiento",
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
      });
    }

    for (const r of equipmentRows) {
      results.push({
        id: r.id,
        domain: "equipos",
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
      });
    }

    for (const r of nom035Rows) {
      results.push({
        id: r.id,
        domain: "cumplimiento",
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
      });
    }

    for (const r of shiftApprovalRows) {
      results.push({
        id: r.id,
        domain: "personal",
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
      });
    }

    for (const r of shiftChangeRows) {
      results.push({
        id: r.id,
        domain: "personal",
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
      });
    }

    for (const r of inventoryRows) {
      results.push({
        id: r.id,
        domain: "inventario",
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
      });
    }

    const filtered = domain ? results.filter((r) => r.domain === domain) : results;

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
