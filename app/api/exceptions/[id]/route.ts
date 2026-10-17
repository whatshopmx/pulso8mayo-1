import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { requirePermissionApi } from "@/lib/rbac/abac";
import {
  exceptionBranchScope,
  findExceptionForTenant,
} from "@/lib/api/exception-access";

/**
 * GET /api/exceptions/[id]
 * Detalle de una excepción del tenant (404 indistinto si es ajena).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await requirePermissionApi("exceptions", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { id } = await params;
    const exception = await findExceptionForTenant(
      id,
      ctx.userCompanyId,
      exceptionBranchScope(ctx.userRole, ctx.userBranchId),
    );
    if (!exception) {
      throw ApiError.notFound("Excepción no encontrada.");
    }

    return ApiHandler.success({ exception });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
