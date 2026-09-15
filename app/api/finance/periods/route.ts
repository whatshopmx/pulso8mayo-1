import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { roleIsAtLeast } from "@/lib/permissions";
import {
  closeFinancialPeriod,
  reopenFinancialPeriod,
  listFinancialPeriods,
} from "@/lib/services/financial-period-service";

/**
 * GET /api/finance/periods?year=2026
 * Obtiene el estado de los periodos financieros del año especificado.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear();

  if (isNaN(year)) {
    throw ApiError.badRequest("El parámetro 'year' debe ser un número entero.");
  }

  const periods = await listFinancialPeriods(auth.tenantId, year);
  return ApiHandler.success({ year, periods });
});

/**
 * POST /api/finance/periods
 * Body: { year: number, month: number, action: "CLOSE" | "REOPEN" }
 * Cierra o reabre un periodo financiero mensual.
 */
export const POST = withTenantAuth(async (req, { auth }) => {
  if (!roleIsAtLeast(auth.user.role, "ADMIN")) {
    throw ApiError.forbidden(
      "Se requiere rol ADMIN o superior para cerrar o reabrir periodos financieros."
    );
  }

  const body = await req.json();
  const { year, month, action } = body;

  if (!year || !month || !["CLOSE", "REOPEN"].includes(action)) {
    throw ApiError.badRequest("Se requieren 'year', 'month' y 'action' ('CLOSE' o 'REOPEN').");
  }

  if (month < 1 || month > 12) {
    throw ApiError.badRequest("El parámetro 'month' debe estar entre 1 y 12.");
  }

  if (action === "CLOSE") {
    const period = await closeFinancialPeriod({
      companyId: auth.tenantId,
      year,
      month,
      closedBy: auth.user.id,
    });
    return ApiHandler.success({ message: `Periodo ${year}-${String(month).padStart(2, "0")} cerrado con éxito.`, period });
  } else {
    await reopenFinancialPeriod({
      companyId: auth.tenantId,
      year,
      month,
    });
    return ApiHandler.success({ message: `Periodo ${year}-${String(month).padStart(2, "0")} reabierto con éxito.` });
  }
});
