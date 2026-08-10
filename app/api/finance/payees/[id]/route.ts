import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { deactivatePayee } from "@/lib/services/payee-service";

/**
 * DELETE /api/finance/payees/[id] — baja lógica de una contraparte.
 *
 * `active = false`: el catálogo deja de ofrecerla, pero los gastos históricos
 * que la referencian conservan el nombre congelado. No se borra nada.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const { id } = await params;
    const payee = await deactivatePayee(tenant.id, id, user.id, tenant.branchId ?? null);
    return ApiHandler.success(payee);
  } catch (error) {
    return ApiHandler.error(error);
  }
}