import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { detectViolations } from "@/lib/services/control-interno-service";

/**
 * GET /api/finance/control-interno/excepciones
 * Returns detected control violations sorted by severity.
 */
export async function GET(_req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const violations = await detectViolations(tenant.id);
    return ApiHandler.success({
      violations,
      total: violations.length,
      highSeverity: violations.filter((v) => v.severity === "HIGH").length,
      mediumSeverity: violations.filter((v) => v.severity === "MEDIUM").length,
      lowSeverity: violations.filter((v) => v.severity === "LOW").length,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
