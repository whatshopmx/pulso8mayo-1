import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { rejectPayeeBankAccount } from "@/lib/services/payee-bank-account-service";

const rejectSchema = z.object({
  reason: z.string().min(1, "El motivo del rechazo es obligatorio.").max(1000),
});

/**
 * POST /api/finance/payee-bank-accounts/[id]/reject
 *
 * Espejo de `supplier-bank-accounts/[id]/reject`. La cuenta no se borra —queda
 * REJECTED inactiva con motivo y autor— porque el intento de cambio es lo que
 * hay que poder auditar después.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const { ctx } = await requirePermissionApi("settings", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", resourceId: id, req },
    });

    const { reason } = rejectSchema.parse(await req.json());

    const account = await rejectPayeeBankAccount({
      companyId: ctx.userCompanyId,
      accountId: id,
      rejectedBy: ctx.userId,
      reason,
    });

    return ApiHandler.success(account);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
