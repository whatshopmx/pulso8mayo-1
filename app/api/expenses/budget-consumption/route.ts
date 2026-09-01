import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getBudgetConsumption } from "@/lib/services/budget-service";

/**
 * GET /api/expenses/budget-consumption?month=YYYY-MM&branchId=…
 *
 * Consumo del presupuesto del mes por centro de costo, más el renglón de gasto
 * sin clasificar. Misma lista de roles que `/api/expenses`: quien no puede ver
 * los gastos tampoco debe ver contra qué presupuesto corren.
 */
const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const GET = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  if (!MONTH_PATTERN.test(month)) {
    throw ApiError.badRequest("El mes debe venir como YYYY-MM.");
  }

  // `resolveBranchScope` y no `enforceBranchScope`: el segundo devuelve `null`
  // tanto para "ve toda la empresa" como para "está acotado y no tiene sucursal",
  // y ese segundo caso mostraría el presupuesto del grupo entero.
  const alcance = resolveBranchScope(
    auth.user.role as never,
    auth.branchId,
    searchParams.get("branchId")
  );

  if (alcance.kind === "NONE") {
    return ApiHandler.success({
      month,
      rows: [],
      unclassified: { amountCents: 0, percentOfTotal: 0 },
      totalExpensesCents: 0,
      scope: { branchId: null, kind: "NONE" as const },
    });
  }

  const branchIds =
    alcance.kind === "BRANCH"
      ? [alcance.branchId]
      : (
          await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.companyId, auth.tenantId), eq(branches.active, true)))
            .orderBy(asc(branches.name))
        ).map((b) => b.id);

  const report = await getBudgetConsumption(auth.tenantId, branchIds, month);

  return ApiHandler.success({
    ...report,
    scope: {
      branchId: alcance.kind === "BRANCH" ? alcance.branchId : null,
      kind: alcance.kind,
    },
  });
});
