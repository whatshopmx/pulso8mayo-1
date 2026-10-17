import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { equipmentAlerts } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import { normalizeEquipmentSeverity } from "./shared";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "equipment_alert";

/** Alertas de equipo activas → excepción de dominio `equipos`. */
export const equipmentAlertAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: equipmentAlerts.id,
        branchId: equipmentAlerts.branchId,
        severity: equipmentAlerts.severity,
        status: equipmentAlerts.status,
        alertType: equipmentAlerts.alertType,
        title: equipmentAlerts.title,
        description: equipmentAlerts.description,
        dueDate: equipmentAlerts.dueDate,
        detectedAt: equipmentAlerts.createdAt,
      })
      .from(equipmentAlerts)
      .where(
        and(
          eq(equipmentAlerts.companyId, companyId),
          inArray(equipmentAlerts.status, ["ACTIVE", "ACKNOWLEDGED"]),
          branchId ? eq(equipmentAlerts.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "equipos",
        qsrCategory: "INOCUIDAD",
        severity: normalizeEquipmentSeverity(r.severity),
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: r.title,
        actionMeta: {
          type: "INSPECT_EQUIPMENT",
          label: "Ver Orden de Servicio",
          url: "/dashboard/equipment/maintenance",
        },
        metadata: {
          title: r.title,
          description: r.description,
          alertType: r.alertType,
          sourceStatus: r.status,
          dueDate: r.dueDate,
          impact: "Falla de equipo en línea de cocina / cadena de frío",
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
