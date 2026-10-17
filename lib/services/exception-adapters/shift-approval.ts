import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { shiftApprovals } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "shift_approval";

/** Turnos pendientes de aprobación → excepción de dominio `personal`. */
export const shiftApprovalAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: shiftApprovals.id,
        branchId: shiftApprovals.branchId,
        title: shiftApprovals.title,
        description: shiftApprovals.description,
        requestedFor: shiftApprovals.requestedFor,
        overtimeMinutes: shiftApprovals.overtimeMinutes,
        detectedAt: shiftApprovals.createdAt,
      })
      .from(shiftApprovals)
      .where(
        and(
          eq(shiftApprovals.companyId, companyId),
          eq(shiftApprovals.status, "PENDING"),
          branchId ? eq(shiftApprovals.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "personal",
        qsrCategory: "PERSONAL",
        severity: "warning",
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: r.title,
        actionMeta: {
          type: "AUTHORIZE_SHIFT",
          label: "Autorizar Turno",
          url: "/dashboard/labor/approvals",
        },
        metadata: {
          title: r.title,
          description: r.description,
          requestedFor: r.requestedFor,
          overtimeMinutes: r.overtimeMinutes,
          sourceStatus: "PENDING",
          impact: "Turno pendiente de confirmación de plantilla",
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
