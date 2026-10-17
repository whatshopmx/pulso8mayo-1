import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { branches, incidents } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import { classifyQsrIncident, normalizeIncidentSeverity } from "./shared";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "incident";

/** Incidentes operativos no resueltos → excepción de dominio `operacion`. */
export const incidentAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: incidents.id,
        branchId: incidents.branchId,
        severity: incidents.severity,
        status: incidents.status,
        title: incidents.title,
        description: incidents.description,
        detectedAt: incidents.createdAt,
      })
      .from(incidents)
      .innerJoin(branches, eq(incidents.branchId, branches.id))
      .where(
        and(
          eq(branches.companyId, companyId),
          ne(incidents.status, "RESOLVED"),
          branchId ? eq(incidents.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      const qsr = classifyQsrIncident(r.title, r.description, r.id);
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "operacion",
        qsrCategory: qsr.qsrCategory,
        severity: normalizeIncidentSeverity(r.severity),
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: r.title,
        actionMeta: qsr.action,
        metadata: {
          title: r.title,
          description: r.description,
          impact: qsr.impact,
          sourceStatus: r.status,
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
