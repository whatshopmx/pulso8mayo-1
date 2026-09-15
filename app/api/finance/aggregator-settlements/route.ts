import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  createAndReconcileAggregatorSettlement,
  getAggregatorSettlements,
} from "@/lib/services/aggregator-settlement-service";

/**
 * GET /api/finance/aggregator-settlements?branchId=…
 * Lista las liquidaciones semanales de agregadores conciliadas.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId") || undefined;

  const settlements = await getAggregatorSettlements(auth.tenantId, branchId);
  return ApiHandler.success(settlements);
});

/**
 * POST /api/finance/aggregator-settlements
 * Body: { branchId, channel, periodStart, periodEnd, grossSalesCents, commissionCents, netDepositedCents, notes }
 * Registra y concilia una liquidación periódica de agregador/TPV.
 */
export const POST = withTenantAuth(async (req, { auth }) => {
  const body = await req.json();

  if (
    !body.branchId ||
    !body.channel ||
    !body.periodStart ||
    !body.periodEnd ||
    body.grossSalesCents == null ||
    body.commissionCents == null ||
    body.netDepositedCents == null
  ) {
    throw ApiError.badRequest(
      "Se requieren los campos branchId, channel, periodStart, periodEnd, grossSalesCents, commissionCents y netDepositedCents."
    );
  }

  const result = await createAndReconcileAggregatorSettlement({
    companyId: auth.tenantId,
    branchId: body.branchId,
    channel: body.channel,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    grossSalesCents: body.grossSalesCents,
    commissionCents: body.commissionCents,
    netDepositedCents: body.netDepositedCents,
    notes: body.notes,
  });

  return ApiHandler.success(result);
});
