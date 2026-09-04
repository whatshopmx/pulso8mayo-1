import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
  listPayeeBankAccounts,
  registerPayeeBankAccount,
} from "@/lib/services/payee-bank-account-service";

/**
 * Cuentas bancarias de payee — espejo de `supplier-bank-accounts/route.ts`
 * para el catálogo de contrapartes de gasto operativo.
 *
 * Mismo permiso que el de proveedor (`settings:update`, clasificación
 * FINANCIAL) y misma razón: capturar ≠ verificar es la separación que importa,
 * no preparar/autorizar, así que no se abre a GERENTE.
 */

const registerSchema = z.object({
  payeeId: z.string().uuid("La contraparte es obligatoria."),
  clabe: z.string().min(1, "La CLABE es obligatoria."),
  accountHolderName: z.string().min(1, "El titular de la cuenta es obligatorio."),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/finance/payee-bank-accounts?payeeId=&activeOnly=
 *
 * Devuelve `clabeLast4`, nunca la CLABE.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const payeeId = searchParams.get("payeeId") || undefined;
    const activeOnly = searchParams.get("activeOnly") === "true";

    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const accounts = await listPayeeBankAccounts({
      companyId: ctx.userCompanyId,
      payeeId,
      activeOnly,
    });

    return ApiHandler.success(accounts);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/finance/payee-bank-accounts — registra una CLABE.
 *
 * La cuenta queda en PENDING_VERIFICATION: registrarla no la vuelve pagable y
 * no desplaza a la cuenta verificada vigente.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("settings", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = registerSchema.parse(await req.json());

    const result = await registerPayeeBankAccount({
      companyId: ctx.userCompanyId,
      payeeId: body.payeeId,
      clabe: body.clabe,
      accountHolderName: body.accountHolderName,
      registeredBy: ctx.userId,
      notes: body.notes,
    });

    return ApiHandler.success(result, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
