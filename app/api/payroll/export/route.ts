import { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { payrollRuns } from "@/lib/db/schema";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import {
  buildPayrollSnapshotCsv,
  readApprovedPayrollSnapshot,
} from "@/lib/services/payroll-snapshot-service";

const exportPayrollSchema = z
  .object({
    runId: z.string().uuid().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((data) => Boolean(data.runId) || Boolean(data.startDate && data.endDate), {
    message: "Se requiere runId o el rango startDate y endDate.",
  });

/**
 * POST /api/payroll/export (NOM-04.a)
 *
 * Exporta CSV exclusivamente desde el snapshot inmutable aprobado (`ordinary_snapshot`)
 * de la corrida de nómina. Nunca recalcula asistencia ni estima tasas fijas (ISR/IMSS);
 * las sumas y el neto coinciden exactamente con los recibos de la misma versión congelada.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "SENSITIVE",
      audit: { action: "EXPORT", req },
    });

    const body = await req.json();
    const parsed = exportPayrollSchema.parse(body);

    let targetRunId = parsed.runId;
    if (!targetRunId && parsed.startDate && parsed.endDate) {
      const [latestApproved] = await db
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.companyId, ctx.userCompanyId),
            eq(payrollRuns.periodStart, parsed.startDate),
            eq(payrollRuns.periodEnd, parsed.endDate),
            inArray(payrollRuns.status, ["APPROVED", "COMPLETED"])
          )
        )
        .orderBy(desc(payrollRuns.snapshotVersion), desc(payrollRuns.updatedAt))
        .limit(1);

      if (!latestApproved) {
        throw ApiError.conflict(
          `No existe un snapshot aprobado para el período ${parsed.startDate} - ${parsed.endDate}; aprueba la corrida antes de exportar.`
        );
      }
      targetRunId = latestApproved.id;
    }

    const bundle = await readApprovedPayrollSnapshot(ctx.userCompanyId, targetRunId!);
    const content = buildPayrollSnapshotCsv(bundle);
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const filename = `NOMINA_${bundle.header.periodStart}_${bundle.header.periodEnd}_v${bundle.snapshotVersion}.csv`;

    return new Response(blob, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Payroll-Run-Id": bundle.runId,
        "X-Payroll-Snapshot-Version": String(bundle.snapshotVersion),
      },
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
