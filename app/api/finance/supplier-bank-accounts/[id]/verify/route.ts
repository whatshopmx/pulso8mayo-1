import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { verifySupplierBankAccount } from "@/lib/services/supplier-bank-account-service";

const verifySchema = z.object({
  holderNameFromCep: z
    .string()
    .min(1, "El titular que aparece en el CEP es obligatorio.")
    .max(300),
  evidenceUrl: z.string().min(1, "El CEP de Banxico es obligatorio.").max(1000),
});

/**
 * POST /api/finance/supplier-bank-accounts/[id]/verify
 *
 * Paso 3 del plan de cuentas por pagar, y la pieza sin la cual tesorería no
 * puede pagarle a nadie: `treasury-service.addItemToRun` exige que la cuenta
 * del proveedor esté VERIFIED y activa, y hasta aquí el único lugar del repo
 * que escribía ese estado era el seed.
 *
 * Mismo permiso que registrar y que rechazar (`settings:update`, clasificación
 * FINANCIAL). La separación que importa no es de rol sino de persona, y esa la
 * impone el servicio comparando contra `registered_by`.
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

    const result = await verifySupplierBankAccount({
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
