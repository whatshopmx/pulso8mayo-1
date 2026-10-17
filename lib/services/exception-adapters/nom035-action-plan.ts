import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { nom035ActionPlans } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import { normalizeNom035Priority } from "./shared";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "nom035_action_plan";

/** Planes de acción NOM-035 pendientes → excepción de `cumplimiento`/PERSONAL. */
export const nom035ActionPlanAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: nom035ActionPlans.id,
        branchId: nom035ActionPlans.branchId,
        priority: nom035ActionPlans.priority,
        status: nom035ActionPlans.status,
        title: nom035ActionPlans.title,
        description: nom035ActionPlans.description,
        assignedTo: nom035ActionPlans.assignedTo,
        dueDate: nom035ActionPlans.dueDate,
        detectedAt: nom035ActionPlans.createdAt,
      })
      .from(nom035ActionPlans)
      .where(
        and(
          eq(nom035ActionPlans.companyId, companyId),
          inArray(nom035ActionPlans.status, ["PENDING", "IN_PROGRESS"]),
          branchId ? eq(nom035ActionPlans.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "cumplimiento",
        qsrCategory: "PERSONAL",
        severity: normalizeNom035Priority(r.priority),
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: r.title,
        actionMeta: {
          type: "RESOLVE_ALERT",
          label: "Ver Plan NOM-035",
          url: "/dashboard/compliance",
        },
        metadata: {
          title: r.title,
          description: r.description,
          priority: r.priority,
          sourceStatus: r.status,
          assignedTo: r.assignedTo,
          dueDate: r.dueDate,
          impact: "Riesgo psicosocial / normativo NOM-035",
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
