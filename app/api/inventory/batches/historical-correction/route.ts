import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  readReceivingOvercountRevalidation,
  ReceivingOvercountApplyError,
} from "@/lib/services/receiving-overcount-service";
import {
  applyHistoricalCorrectionProtocol,
  HistoricalCorrectionProtocolError,
} from "@/lib/services/historical-correction-protocol-service";

const postSchema = z.object({
  batchId: z.string().uuid(),
  expectedDelta: z.number().positive(),
  countedQuantity: z.number().min(0),
  unit: z.string().min(1).max(32),
  countedBy: z.string().min(1).max(128),
  reason: z.string().min(1).max(500),
  backupReference: z.string().min(1).max(200),
  fixCutoff: z.string().datetime().optional(),
});

function mapProtocolError(error: unknown): unknown {
  if (error instanceof HistoricalCorrectionProtocolError) {
    return new ApiError(error.message, error.httpStatus, {
      code: error.code,
      reasons: error.reasons,
    });
  }
  if (error instanceof ReceivingOvercountApplyError) {
    const status =
      error.code === "INVALID_INPUT"
        ? 400
        : error.code === "BATCH_NOT_FOUND"
          ? 404
          : 409;
    return new ApiError(error.message, status, {
      code: error.code,
      reasons: error.reasons,
    });
  }
  return error;
}

/**
 * GET /api/inventory/batches/historical-correction
 * Ejecuta dry-run READ ONLY (REC-03A) acotado estrictamente a la empresa de la sesión.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("inventory", "read", {
      audit: { action: "READ", req },
    });

    const fixCutoff = req.nextUrl.searchParams.get("fixCutoff") ?? undefined;
    const report = await db.transaction(
      (tx) =>
        readReceivingOvercountRevalidation(tx, {
          companyId: ctx.userCompanyId,
          fixCutoff,
        }),
      { accessMode: "read only" },
    );

    return ApiHandler.success(report);
  } catch (error) {
    return ApiHandler.error(mapProtocolError(error));
  }
}

/**
 * POST /api/inventory/batches/historical-correction
 * Aplica el protocolo REC-03B a un único lote `SUFFICIENT` respaldado:
 * conteo físico, unidad, actor de conteo != aprobador de sesión (>= ADMIN),
 * motivo, referencia de respaldo, idempotencia y auditoría `AUD-02` atómica.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("inventory", "update", {
      audit: { action: "UPDATE", req },
    });

    const body = postSchema.parse(await req.json());

    const result = await db.transaction((tx) =>
      applyHistoricalCorrectionProtocol(tx, {
        companyId: ctx.userCompanyId,
        batchId: body.batchId,
        expectedDelta: body.expectedDelta,
        countedQuantity: body.countedQuantity,
        unit: body.unit,
        countedBy: body.countedBy,
        approverId: ctx.userId,
        approverRole: ctx.userRole,
        reason: body.reason,
        backupReference: body.backupReference,
        fixCutoff: body.fixCutoff,
      }),
    );

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(mapProtocolError(error));
  }
}
