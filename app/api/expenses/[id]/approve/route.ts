import { z } from "zod";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { approveOperatingExpense, rejectOperatingExpense } from "@/lib/services/expense-service";

const approveBodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]).default("APPROVE"),
  notes: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
});

/**
 * POST /api/expenses/[id]/approve
 * 
 * Permite autorizar o rechazar un gasto operativo directamente con validación
 * de autoridad basada en rol y alcance de sucursal.
 */
export const POST = withTenantAuth(async (req, { auth, params }) => {
  const { id } = await (params as unknown as Promise<{ id: string }>);
  if (!id) throw ApiError.badRequest("Falta el identificador del gasto.");

  const body = await req.json().catch(() => ({}));
  const parsed = approveBodySchema.safeParse(body);
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Datos de autorización inválidos.");
  }

  const scope = resolveBranchScope(auth.user.role, auth.user.branchId);

  if (parsed.data.action === "REJECT") {
    const reason = parsed.data.reason?.trim();
    if (!reason) {
      throw ApiError.badRequest("El motivo del rechazo es obligatorio para asentar en bitácora.");
    }
    const updated = await rejectOperatingExpense(
      id,
      auth.tenantId,
      scope,
      auth.user.id,
      auth.user.role,
      reason
    );
    return ApiHandler.success(updated);
  }

  const updated = await approveOperatingExpense(
    id,
    auth.tenantId,
    scope,
    auth.user.id,
    auth.user.role,
    parsed.data.notes || undefined
  );

  return ApiHandler.success(updated);
});
