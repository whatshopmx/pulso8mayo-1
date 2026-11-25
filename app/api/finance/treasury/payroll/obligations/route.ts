import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
  listPayrollObligations,
  recordPayrollObligationPayment,
  syncPayrollObligationsFromApprovedSnapshot,
  type PayrollObligationPaymentStatus,
} from "@/lib/services/payroll-treasury-service";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SYNC_FROM_SNAPSHOT"),
    runId: z.string().uuid("runId debe ser un UUID válido."),
  }),
  z.object({
    action: z.literal("RECORD_PAYMENT"),
    obligationId: z.string().uuid("obligationId debe ser un UUID válido."),
    paymentRunItemId: z.string().uuid("paymentRunItemId debe ser un UUID válido."),
    amountCents: z.number().int().positive("amountCents debe ser entero positivo."),
    idempotencyKey: z.string().min(1, "idempotencyKey es obligatorio.").max(128),
  }),
]);

/**
 * GET /api/finance/treasury/payroll/obligations
 * Lista obligaciones netas de nómina por empleado/período aprobado con estado
 * de pago, estado CFDI independiente y estado de conciliación bancaria.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const sp = req.nextUrl.searchParams;
    const runId = sp.get("runId") || undefined;
    const paymentStatus = (sp.get("paymentStatus") as PayrollObligationPaymentStatus) || undefined;

    const obligations = await listPayrollObligations({
      companyId: ctx.userCompanyId,
      runId,
      paymentStatus,
    });

    return ApiHandler.success({ obligations });
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/finance/treasury/payroll/obligations
 * - SYNC_FROM_SNAPSHOT: crea idempotentemente una obligación por empleado/período aprobado.
 * - RECORD_PAYMENT: aplica un pago parcial o total confirmado con idempotencia por clave.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "manage", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = postSchema.parse(await req.json());

    if (body.action === "SYNC_FROM_SNAPSHOT") {
      const result = await syncPayrollObligationsFromApprovedSnapshot({
        companyId: ctx.userCompanyId,
        runId: body.runId,
        createdBy: ctx.userId,
      });
      return ApiHandler.success(result);
    }

    const result = await recordPayrollObligationPayment({
      companyId: ctx.userCompanyId,
      obligationId: body.obligationId,
      paymentRunItemId: body.paymentRunItemId,
      amountCents: body.amountCents,
      idempotencyKey: body.idempotencyKey,
      actorId: ctx.userId,
    });
    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
