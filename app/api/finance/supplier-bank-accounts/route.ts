import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
  listSupplierBankAccounts,
  registerSupplierBankAccount,
} from "@/lib/services/supplier-bank-account-service";

/**
 * Cuentas bancarias de proveedor — paso 2 de
 * `docs/plan-cuentas-por-pagar-reconciliado.md`.
 *
 * Sobre los permisos: registrar una CLABE de proveedor exige `settings:update`,
 * que en la matriz (`lib/permissions.ts`) tienen ADMIN, OWNER y SUPER_ADMIN pero
 * NO GERENTE. Es una decisión deliberada y más restrictiva que el modelo general
 * de "el gerente prepara, el dueño autoriza":
 *
 * mientras la verificación de titularidad (paso 3) no exista, una cuenta
 * capturada es una cuenta que en algún momento alguien podría verificar, y este
 * es el único dato del sistema cuyo cambio silencioso redirige dinero. La
 * separación de funciones que importa aquí no es preparar/autorizar sino
 * **capturar ≠ verificar**, y esa se conserva con `registered_by` sin necesidad
 * de abrirle la captura al gerente.
 *
 * Si más adelante compras necesita capturar cuentas, el lugar de arreglarlo es
 * la matriz de permisos —o un recurso propio—, no relajar la clasificación.
 */

const registerSchema = z.object({
  supplierId: z.string().uuid("El proveedor es obligatorio."),
  // Se acepta con espacios o guiones: la CLABE se copia de correos y PDFs, y
  // `validateClabe` normaliza antes de validar.
  clabe: z.string().min(1, "La CLABE es obligatoria."),
  accountHolderName: z.string().min(1, "El titular de la cuenta es obligatorio."),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/finance/supplier-bank-accounts?supplierId=&activeOnly=
 *
 * Devuelve `clabeLast4`, nunca la CLABE. No es enmascarado de respuesta: la
 * consulta no la trae.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const supplierId = searchParams.get("supplierId") || undefined;
    const activeOnly = searchParams.get("activeOnly") === "true";

    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const accounts = await listSupplierBankAccounts({
      companyId: ctx.userCompanyId,
      supplierId,
      activeOnly,
    });

    return ApiHandler.success(accounts);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/finance/supplier-bank-accounts — registra una CLABE.
 *
 * La cuenta queda en PENDING_VERIFICATION: registrarla no la vuelve pagable y no
 * desplaza a la cuenta verificada vigente. Si el proveedor ya tenía una, se
 * despacha la alerta al dueño antes de responder.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("settings", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = registerSchema.parse(await req.json());

    const result = await registerSupplierBankAccount({
      companyId: ctx.userCompanyId,
      supplierId: body.supplierId,
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
