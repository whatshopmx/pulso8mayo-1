import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { complianceAlerts } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import { normalizeIncidentSeverity } from "./shared";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "compliance_alert";

/** Alertas de cumplimiento activas → excepción de dominio `cumplimiento`. */
export const complianceAlertAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: complianceAlerts.id,
        branchId: complianceAlerts.branchId,
        severity: complianceAlerts.severity,
        status: complianceAlerts.status,
        title: complianceAlerts.title,
        description: complianceAlerts.description,
        complianceType: complianceAlerts.complianceType,
        detectedAt: complianceAlerts.createdAt,
      })
      .from(complianceAlerts)
      .where(
        and(
          eq(complianceAlerts.companyId, companyId),
          inArray(complianceAlerts.status, ["ACTIVE", "ACKNOWLEDGED"]),
          branchId ? eq(complianceAlerts.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "cumplimiento",
        qsrCategory: "INOCUIDAD",
        severity: normalizeIncidentSeverity(r.severity),
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: r.title,
        actionMeta: {
          type: "RESOLVE_ALERT",
          label: "Atender Alerta Sanitaria",
          url: "/dashboard/compliance",
        },
        metadata: {
          title: r.title,
          description: r.description,
          complianceType: r.complianceType,
          sourceStatus: r.status,
          impact: "Riesgo de no conformidad sanitaria NOM-251",
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
