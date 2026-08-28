import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { deactivatePayee, updatePayee } from "@/lib/services/payee-service";

/** Ver la justificación completa en `app/api/finance/payees/route.ts`. */
const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

/**
 * PATCH /api/finance/payees/[id] — actualiza campos de contacto de la contraparte.
 *
 * El `name` NO es actualizable: es la identidad y está protegida por el índice
 * único `(company_id, lower(name))`. Si una contraparte cambia razón social, se
 * crea una nueva — editar el nombre haría que los gastos históricos apuntaran a
 * una entidad diferente.
 */
export const PATCH = withRoleAuth(
  [...ROLES_FINANZAS],
  async (req, { params, auth }) => {
    try {
      const { id } = await params;
      const body = await req.json();
      const schema = z.object({
        // `name` excluido intencionalmente — ver comentario de función.
        taxId: z.string().trim().optional().nullable(),
        contactName: z.string().trim().optional().nullable(),
        email: z
          .union([z.string().trim().email("El correo no es válido."), z.literal("")])
          .optional()
          .nullable(),
        phone: z.string().trim().optional().nullable(),
      });
      const data = schema.parse(body);

      const payee = await updatePayee(auth.tenantId, id, {
        ...data,
        performedBy: auth.user.id,
        branchId: auth.branchId ?? null,
      });
      return ApiHandler.success(payee);
    } catch (error) {
      return ApiHandler.error(error);
    }
  },
);

/**
 * DELETE /api/finance/payees/[id] — baja lógica de una contraparte.
 *
 * `active = false`: el catálogo deja de ofrecerla, pero los gastos históricos
 * que la referencian conservan el nombre congelado. No se borra nada.
 */
export const DELETE = withRoleAuth(
  [...ROLES_FINANZAS],
  async (_req, { params, auth }) => {
    try {
      const { id } = await params;
      const payee = await deactivatePayee(
        auth.tenantId,
        id,
        auth.user.id,
        auth.branchId ?? null
      );
      return ApiHandler.success(payee);
    } catch (error) {
      return ApiHandler.error(error);
    }
  }
);

