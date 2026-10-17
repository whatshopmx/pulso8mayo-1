import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { exceptionBranchScope, findExceptionForTenant } from "@/lib/api/exception-access";
import { requirePermissionApi, type AccessContext } from "@/lib/rbac/abac";
import type { ExceptionRow } from "@/lib/services/exception-service";

interface ExceptionMutationArgs {
  req: NextRequest;
  ctx: AccessContext;
  exception: ExceptionRow;
}

type MutationHandler = (
  args: ExceptionMutationArgs,
) => Promise<ExceptionRow | void>;

/**
 * Envuelve una mutación de excepción con:
 *  1. auth + RBAC (`exceptions:update`) con auditoría de acceso;
 *  2. alcance de sucursal fail-closed;
 *  3. 404 indistinto para id inexistente o ajeno;
 *  4. manejo uniforme de errores (incluidas las guardas de lifecycle).
 */
export function withExceptionMutation(handler: MutationHandler) {
  return async (
    req: NextRequest,
    routeCtx: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    try {
      const { ctx } = await requirePermissionApi("exceptions", "update", {
        audit: { action: "UPDATE", req },
      });

      const { id } = await routeCtx.params;
      const scope = exceptionBranchScope(ctx.userRole, ctx.userBranchId);
      const exception = await findExceptionForTenant(
        id,
        ctx.userCompanyId,
        scope,
      );
      if (!exception) {
        throw ApiError.notFound("Excepción no encontrada.");
      }

      const updated = await handler({ req, ctx, exception });
      return ApiHandler.success({ exception: updated ?? exception });
    } catch (error) {
      return ApiHandler.error(error);
    }
  };
}
