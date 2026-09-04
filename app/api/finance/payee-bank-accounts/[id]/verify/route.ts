import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { verifyPayeeBankAccount } from "@/lib/services/payee-bank-account-service";

const verifySchema = z.object({
  holderNameFromCep: z
    .string()
    .min(1, "El titular que aparece en el CEP es obligatorio.")
    .max(300),
  evidenceUrl: z.string().min(1, "El CEP de Banxico es obligatorio.").max(1000),
});

/**
 * POST /api/finance/payee-bank-accounts/[id]/verify
 *
 * Espejo de `supplier-bank-accounts/[id]/verify`: sin esto,
 * `TreasuryService.assertCounterpartyPayable` nunca encuentra una cuenta
 * VERIFIED de payee y un gasto operativo no puede entrar a una corrida.
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

    const body = verifySchema.parse(await req.json());

    const result = await verifyPayeeBankAccount({
      companyId: ctx.userCompanyId,
      accountId: id,
      verifiedBy: ctx.userId,
      holderNameFromCep: body.holderNameFromCep,
      evidenceUrl: body.evidenceUrl,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
