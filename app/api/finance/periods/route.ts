import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { hasPermission, roleIsAtLeast } from "@/lib/permissions";
import {
  closeFinancialPeriod,
  reopenFinancialPeriod,
  listFinancialPeriods,
} from "@/lib/services/financial-period-service";
import { isAccountingPostingEnabled } from "@/lib/services/accounting/expense-adapter";
import {
  closeAccountingPeriod,
  getPeriodCloseBlockers,
  listPeriodCloseVersions,
  reopenAccountingPeriod,
} from "@/lib/services/accounting/close-service";

/**
 * GET /api/finance/periods?year=2026[&month=10]
 * Obtiene el estado de los periodos financieros del año especificado y, si se
 * indica mes con contabilidad activa, los bloqueos pendientes y versiones de cierre.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear();

  if (isNaN(year)) {
    throw ApiError.badRequest("El parámetro 'year' debe ser un número entero.");
  }

  const periods = await listFinancialPeriods(auth.tenantId, year);
  if (monthParam && isAccountingPostingEnabled() && hasPermission(auth.user.role, "accounting", "read")) {
    const month = parseInt(monthParam, 10);
    if (isNaN(month) || month < 1 || month > 12) {
      throw ApiError.badRequest("El parámetro 'month' debe estar entre 1 y 12.");
    }
    const ctx = { companyId: auth.tenantId, actorId: auth.user.id, role: auth.user.role };
    const [blockers, versions] = await Promise.all([
      getPeriodCloseBlockers(ctx, { year, month }),
      listPeriodCloseVersions(ctx, { year, month }),
    ]);
    return ApiHandler.success({ year, month, periods, blockers, versions });
  }

  return ApiHandler.success({ year, periods });
});

/**
 * POST /api/finance/periods
 * Body: { year: number, month: number, action: "CLOSE" | "REOPEN", reason?: string }
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
    if (isAccountingPostingEnabled()) {
      const result = await closeAccountingPeriod(
        { companyId: auth.tenantId, actorId: auth.user.id, role: auth.user.role },
        { year, month },
      );
      return ApiHandler.success({
        message: `Periodo ${year}-${String(month).padStart(2, "0")} cerrado con éxito.`,
        period: result.period,
        close: result.close,
        alreadyClosed: result.alreadyClosed,
      });
    }
    const period = await closeFinancialPeriod({
      companyId: auth.tenantId,
      year,
      month,
      closedBy: auth.user.id,
    });
    return ApiHandler.success({ message: `Periodo ${year}-${String(month).padStart(2, "0")} cerrado con éxito.`, period });
  } else {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      throw ApiError.badRequest("Se requiere un motivo ('reason') para reabrir un periodo financiero cerrado.");
    }
    if (isAccountingPostingEnabled()) {
      const result = await reopenAccountingPeriod(
        { companyId: auth.tenantId, actorId: auth.user.id, role: auth.user.role },
        { year, month, reason },
      );
      return ApiHandler.success({
        message: `Periodo ${year}-${String(month).padStart(2, "0")} reabierto con éxito.`,
        period: result.period,
        supersededClose: result.supersededClose,
      });
    }
    await reopenFinancialPeriod({
      companyId: auth.tenantId,
      year,
      month,
      reopenedBy: auth.user.id,
      reason,
    });
    return ApiHandler.success({ message: `Periodo ${year}-${String(month).padStart(2, "0")} reabierto con éxito.` });
  }
});
