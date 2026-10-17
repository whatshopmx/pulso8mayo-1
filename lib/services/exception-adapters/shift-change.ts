import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { shiftChangeRequests } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "shift_change_request";

/** Solicitudes de cambio de turno pendientes → excepción de `personal`. */
export const shiftChangeAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: shiftChangeRequests.id,
        branchId: shiftChangeRequests.branchId,
        reason: shiftChangeRequests.reason,
        requestedBy: shiftChangeRequests.requestedBy,
        counterpartyId: shiftChangeRequests.counterpartyId,
        detectedAt: shiftChangeRequests.createdAt,
      })
      .from(shiftChangeRequests)
      .where(
        and(
          eq(shiftChangeRequests.companyId, companyId),
          eq(shiftChangeRequests.status, "PENDING"),
          branchId ? eq(shiftChangeRequests.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "personal",
        qsrCategory: "PERSONAL",
        severity: "info",
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: `Cambio de turno: ${r.reason}`,
        actionMeta: {
          type: "AUTHORIZE_SHIFT",
          label: "Evaluar Cambio",
          url: `/dashboard/labor/shift-changes/${r.id}`,
        },
        metadata: {
          reason: r.reason,
          requestedBy: r.requestedBy,
          counterpartyId: r.counterpartyId,
          sourceStatus: "PENDING",
          impact: "Reemplazo de personal en turno de servicio",
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
