import { db } from "@/lib/db";
import {
  branches,
  shiftSessions,
  temperatureLogs,
  dailySalesCuts,
  incidents,
  workflowInstances,
} from "@/lib/db/schema";
import { and, eq, gte, lte, inArray, notInArray, desc } from "drizzle-orm";
import { businessDateIso, businessDayEnd, businessDayStart } from "@/lib/business-date";

/**
 * Status TERMINALES de un incidente: ya no requieren acción.
 *
 * Se define por exclusión a propósito. Enumerar los status abiertos a mano
 * dejó fuera de este feed a `ESCALATED` (más urgente que `CONFIRMED`) y a
 * `AWAITING_EXTERNAL` (bloqueado con terceros, sigue abierto), volviendo
 * invisible para el banner de pulso al incidente más grave de la base.
 * Ver incidentStatusEnum en lib/db/schema.ts.
 *
 * Dirección del fallo: si mañana se agrega un status nuevo, éste aparece en
 * el feed por defecto. Preferimos mostrar de más que ocultar un FATAL.
 */
const TERMINAL_INCIDENT_STATUSES = ["RESOLVED"] as const;

export interface BranchLiveStatus {
  branchId: string;
  branchName: string;
  code?: string | null;
  opening: {
    status: "ON_TIME" | "DELAYED" | "PENDING";
    openedAt: string | null;
    label: string;
  };
  staff: {
    activeCount: number;
    expectedCount: number;
    lateCount: number;
    status: "NORMAL" | "WARNING" | "CRITICAL";
  };
  nom251: {
    status: "OK" | "WARNING" | "CRITICAL";
    lastTempCelsius: number | null;
    nonCompliantCount: number;
  };
  sales: {
    totalCents: number;
    cutStatus: "VALIDATED" | "PENDING_REVIEW" | "IN_PROGRESS";
  };
  activeAlerts: {
    id: string;
    title: string;
    severity: "critical" | "warning";
  }[];
}

export interface LivePulseSummary {
  businessDate: string;
  totalBranches: number;
  openBranchesCount: number;
  openRatePercent: number;
  staffActiveNow: number;
  staffAttendanceRate: number;
  salesTodayCents: number;
  criticalAlertsCount: number;
  branches: BranchLiveStatus[];
  rushAlerts: {
    id: string;
    branchName: string;
    title: string;
    category: "DINERO" | "INOCUIDAD" | "ABASTO" | "PERSONAL";
    severity: "critical" | "warning";
    timeAgo: string;
    actionUrl: string;
  }[];
}

export const LiveCommandService = {
  /**
   * Obtiene el pulso operativo en tiempo real de la cadena de sucursales para el día de hoy.
   */
  async getLivePulse(companyId: string, targetBranchId?: string): Promise<LivePulseSummary> {
    // Un solo calendario para toda la función: el día de negocio (zona MX).
    // Antes `todayStart` era local y `todayIsoDate` era UTC, así que a partir
    // de las 18:00 hora local la página pedía los cortes de venta de MAÑANA.
    const todayStart = businessDayStart();
    const todayEnd = businessDayEnd();
    const todayIsoDate = businessDateIso();

    // 1. Obtener sucursales activas de la empresa
    const branchRows = await db
      .select({
        id: branches.id,
        name: branches.name,
        code: branches.code,
      })
      .from(branches)
      .where(
        and(
          eq(branches.companyId, companyId),
          targetBranchId ? eq(branches.id, targetBranchId) : undefined,
        ),
      );

    if (branchRows.length === 0) {
      return {
        businessDate: todayIsoDate,
        totalBranches: 0,
        openBranchesCount: 0,
        openRatePercent: 100,
        staffActiveNow: 0,
        staffAttendanceRate: 100,
        salesTodayCents: 0,
        criticalAlertsCount: 0,
        branches: [],
        rushAlerts: [],
      };
    }

    const branchIds = branchRows.map((b) => b.id);

    // 2. Ejecutar lecturas paralelas del estado de hoy
    const [
      sessionRows,
      tempRows,
      salesCutRows,
      incidentRows,
      workflowRows,
    ] = await Promise.all([
      // Sesiones de personal iniciadas o programadas hoy
      db
        .select({
          id: shiftSessions.id,
          branchId: shiftSessions.branchId,
          status: shiftSessions.status,
          startedAt: shiftSessions.startedAt,
        })
        .from(shiftSessions)
        .where(
          and(
            inArray(shiftSessions.branchId, branchIds),
            gte(shiftSessions.startedAt, todayStart),
            lte(shiftSessions.startedAt, todayEnd),
          ),
        )
        .catch(() => []),

      // Lecturas de temperatura de hoy
      db
        .select({
          id: temperatureLogs.id,
          branchId: temperatureLogs.branchId,
          readingValue: temperatureLogs.readingValue,
          isCompliant: temperatureLogs.isCompliant,
          timestamp: temperatureLogs.timestamp,
        })
        .from(temperatureLogs)
        .where(
          and(
            inArray(temperatureLogs.branchId, branchIds),
            gte(temperatureLogs.timestamp, todayStart),
            lte(temperatureLogs.timestamp, todayEnd),
          ),
        )
        .orderBy(desc(temperatureLogs.timestamp))
        .catch(() => []),

      // Cortes de venta del día de hoy
      db
        .select({
          id: dailySalesCuts.id,
          branchId: dailySalesCuts.branchId,
          totalSales: dailySalesCuts.totalSales,
          status: dailySalesCuts.status,
          businessDate: dailySalesCuts.businessDate,
        })
        .from(dailySalesCuts)
        .where(
          and(
            inArray(dailySalesCuts.branchId, branchIds),
            eq(dailySalesCuts.businessDate, todayIsoDate),
          ),
        )
        .catch(() => []),

      // Incidentes abiertos de la red (cualquier status no terminal).
      // No se filtra por fecha: un incidente sin resolver sigue siendo accionable
      // aunque haya abierto ayer.
      db
        .select({
          id: incidents.id,
          branchId: incidents.branchId,
          title: incidents.title,
          severity: incidents.severity,
          status: incidents.status,
          createdAt: incidents.createdAt,
        })
        .from(incidents)
        .where(
          and(
            inArray(incidents.branchId, branchIds),
            notInArray(incidents.status, [...TERMINAL_INCIDENT_STATUSES]),
          ),
        )
        .orderBy(desc(incidents.createdAt))
        .limit(15)
        .catch(() => []),

      // Workflows de hoy (para detectar hora de apertura)
      db
        .select({
          id: workflowInstances.id,
          branchId: workflowInstances.branchId,
          status: workflowInstances.status,
          createdAt: workflowInstances.createdAt,
          completedAt: workflowInstances.completedAt,
        })
        .from(workflowInstances)
        .where(
          and(
            inArray(workflowInstances.branchId, branchIds),
            gte(workflowInstances.createdAt, todayStart),
            lte(workflowInstances.createdAt, todayEnd),
          ),
        )
        .catch(() => []),
    ]);

    // Indexar por sucursal para armado rápido
    const sessionsByBranch = new Map<string, typeof sessionRows>();
    for (const s of sessionRows) {
      const list = sessionsByBranch.get(s.branchId) ?? [];
      list.push(s);
      sessionsByBranch.set(s.branchId, list);
    }

    const tempsByBranch = new Map<string, typeof tempRows>();
    for (const t of tempRows) {
      const list = tempsByBranch.get(t.branchId) ?? [];
      list.push(t);
      tempsByBranch.set(t.branchId, list);
    }

    const cutsByBranch = new Map<string, typeof salesCutRows>();
    for (const c of salesCutRows) {
      const list = cutsByBranch.get(c.branchId) ?? [];
      list.push(c);
      cutsByBranch.set(c.branchId, list);
    }

    const incidentsByBranch = new Map<string, typeof incidentRows>();
    for (const i of incidentRows) {
      const list = incidentsByBranch.get(i.branchId) ?? [];
      list.push(i);
      incidentsByBranch.set(i.branchId, list);
    }

    const workflowsByBranch = new Map<string, typeof workflowRows>();
    for (const w of workflowRows) {
      const list = workflowsByBranch.get(w.branchId) ?? [];
      list.push(w);
      workflowsByBranch.set(w.branchId, list);
    }

    let totalActiveStaff = 0;
    let totalSalesCents = 0;
    let openCount = 0;
    const branchesLive: BranchLiveStatus[] = [];

    for (const b of branchRows) {
      const bSessions = sessionsByBranch.get(b.id) ?? [];
      const bTemps = tempsByBranch.get(b.id) ?? [];
      const bCuts = cutsByBranch.get(b.id) ?? [];
      const bIncidents = incidentsByBranch.get(b.id) ?? [];
      const bWorkflows = workflowsByBranch.get(b.id) ?? [];

      // Apertura: evaluada si hay workflows completados o sesiones antes de las 12:00 hrs
      const earliestActivity = bWorkflows[0]?.createdAt || bSessions[0]?.startedAt;
      const isOpen = Boolean(earliestActivity);
      if (isOpen) openCount++;

      const openHour = earliestActivity ? new Date(earliestActivity).getHours() : 0;
      const openMinutes = earliestActivity ? new Date(earliestActivity).getMinutes() : 0;
      const timeString = earliestActivity
        ? `${openHour.toString().padStart(2, "0")}:${openMinutes.toString().padStart(2, "0")}`
        : null;

      const openingStatus: "ON_TIME" | "DELAYED" | "PENDING" = !isOpen
        ? "PENDING"
        : openHour > 11 || (openHour === 11 && openMinutes > 30)
        ? "DELAYED"
        : "ON_TIME";

      const openingLabel = !isOpen
        ? "Pendiente de apertura"
        : openingStatus === "DELAYED"
        ? `Abrió tarde (${timeString} hrs)`
        : `Abrió a tiempo (${timeString} hrs)`;

      // Personal:
      const activeStaff = bSessions.filter((s) => s.status === "ACTIVE" || s.status === "COMPLETED").length;
      totalActiveStaff += activeStaff;
      const expectedStaff = Math.max(activeStaff, 4); // plantilla QSR estimada estándar por turno
      const staffStatus = activeStaff >= expectedStaff ? "NORMAL" : activeStaff >= expectedStaff - 1 ? "WARNING" : "CRITICAL";

      // NOM-251 y temperaturas:
      const nonCompliant = bTemps.filter((t) => t.isCompliant === false).length;
      const lastReading = bTemps[0]?.readingValue ?? null;
      const nomStatus = nonCompliant > 0 ? "CRITICAL" : bTemps.length > 0 ? "OK" : "WARNING";

      // Ventas:
      const branchSales = bCuts.reduce((acc, c) => acc + (c.totalSales || 0), 0);
      totalSalesCents += branchSales;
      const cutStatus = bCuts[0]?.status === "VALIDATED" ? "VALIDATED" : bCuts.length > 0 ? "PENDING_REVIEW" : "IN_PROGRESS";

      // Alertas activas de la sucursal:
      const branchActiveAlerts = bIncidents.map((i) => ({
        id: i.id,
        title: i.title,
        severity: (i.severity === "CRITICAL" || i.severity === "FATAL" ? "critical" : "warning") as "critical" | "warning",
      }));

      branchesLive.push({
        branchId: b.id,
        branchName: b.name,
        code: b.code,
        opening: {
          status: openingStatus,
          openedAt: timeString,
          label: openingLabel,
        },
        staff: {
          activeCount: activeStaff,
          expectedCount: expectedStaff,
          lateCount: 0,
          status: staffStatus,
        },
        nom251: {
          status: nomStatus,
          lastTempCelsius: lastReading,
          nonCompliantCount: nonCompliant,
        },
        sales: {
          totalCents: branchSales,
          cutStatus,
        },
        activeAlerts: branchActiveAlerts,
      });
    }

    // Alertas críticas de rush
    const branchMap = new Map(branchRows.map((b) => [b.id, b.name]));
    const rushAlerts = incidentRows
      .filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL")
      .slice(0, 4)
      .map((i) => ({
        id: i.id,
        branchName: branchMap.get(i.branchId) ?? "Sucursal",
        title: i.title,
        category: "INOCUIDAD" as const,
        severity: "critical" as const,
        timeAgo: "Activo en turno",
        actionUrl: `/dashboard/incidents/${i.id}`,
      }));

    const totalBranches = branchRows.length;
    const openRatePercent = totalBranches > 0 ? Math.round((openCount / totalBranches) * 100) : 100;
    const staffAttendanceRate = totalBranches > 0 ? Math.min(100, Math.round((totalActiveStaff / (totalBranches * 4)) * 100)) : 100;

    return {
      businessDate: todayIsoDate,
      totalBranches,
      openBranchesCount: openCount,
      openRatePercent,
      staffActiveNow: totalActiveStaff,
      staffAttendanceRate,
      salesTodayCents: totalSalesCents,
      criticalAlertsCount: rushAlerts.length,
      branches: branchesLive,
      rushAlerts,
    };
  },
};
