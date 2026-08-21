import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { createPayee, listPayees } from "@/lib/services/payee-service";

/**
 * Contrapartes: a quién le paga la empresa.
 *
 * Misma lista que `ROLES_FINANZAS` en `app/api/expenses/route.ts` y que la
 * entrada `/dashboard/finance` de `ROUTE_PERMISSIONS`. La ruta del dashboard ya
 * estaba cerrada; esta API no, así que un `fetch` desde la consola daba de alta
 * beneficiarios de pago o leía el catálogo completo de proveedores. Es la misma
 * fuga que A2 cerró en Ventas, en el último rincón del módulo que seguía en
 * `lib/tenant-context.ts` sin guarda de rol.
 *
 * El `GET` también se cierra: sus dos únicos consumidores —la pantalla de
 * Contrapartes y el formulario de gasto— viven bajo `/dashboard/finance`, que
 * admite exactamente estos cuatro roles, así que nadie legítimo se queda fuera.
 */
const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

/**
 * GET /api/finance/payees — catálogo de contrapartes de la empresa.
 *
 * Filtros: `search` (nombre/RFC/contacto/correo/teléfono, ILIKE) y `active`
 * (`active=false` para incluir las dadas de baja; por defecto solo activas,
 * que es lo que necesita el form de gasto).
 */
export const GET = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  // El `try/catch` se conserva dentro del wrapper: `withRoleAuth` traduce
  // `ApiError`, pero un `ZodError` caería a 500 y aquí ya devolvía 400.
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const includeInactive = searchParams.get("active") === "false";

    const payees = await listPayees(auth.tenantId, { search, includeInactive });
    return ApiHandler.success(payees);
  } catch (error) {
    return ApiHandler.error(error);
  }
});

const payeeSchema = z.object({
  name: z.string().trim().min(1, "El nombre de la contraparte es obligatorio."),
  taxId: z.string().trim().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  email: z
    .union([z.string().trim().email("El correo no es válido."), z.literal("")])
    .optional()
    .nullable(),
  phone: z.string().trim().optional().nullable(),
});

/**
 * POST /api/finance/payees — crea una contraparte.
 *
 * Requiere sesión (para auditar quién crea) y tenant (para saber a qué empresa
 * pertenece). El RFC es opcional a propósito: un plomero o una ferretería que
 * no emiten CFDI son contrapartes legítimas de gasto.
 */
export const POST = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  try {
    const body = await req.json();
    const data = payeeSchema.parse(body);

    const payee = await createPayee({
      companyId: auth.tenantId,
      branchId: auth.branchId ?? null,
      performedBy: auth.user.id,
      name: data.name,
      taxId: data.taxId || null,
      contactName: data.contactName || null,
      email: data.email || null,
      phone: data.phone || null,
    });

    return ApiHandler.success(payee, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
});