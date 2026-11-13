import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountingInventoryValuations as valuations, branches, companies, inventoryItems, inventoryMovements } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { getPnLByBranch } from "./pnl-service";
import type { LineSource } from "./pnl-types";
import { isInventoryValuationEnabled } from "./accounting/inventory-contract";
import { withCompanyContext } from "@/lib/db/tenant-context";

type Input = { companyId: string; branchId: string; line: "foodCost" | "waste";
  period: { startDate: string; endDate: string; days: number }; page: number; pageSize: number };
type Row = Record<string, unknown> & { usage_count: number; waste_count: number; receiving_count: number;
  usage_days: number; waste_days: number; receiving_days: number; foreign_count: number;
  fallback_count: number; uncosted_count: number; frozen_pending_count: number; frozen_count: number; legacy_count: number;
  total_count: number; total_raw: string; rounded_total: string;
  id: string | null; date: string; cents: string; quantity: string; unit_cost: string | null; item_name: string; type: string };
function exact(value: string | number) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw ApiError.conflict("El importe excede el rango de centavos exactos.");
  return amount;
}

/** Internal: caller resolves session scope first. Query still checks company/branch. */
export async function getInventoryPnlDetail(p: Input) {
  const from = new Date(`${p.period.startDate}T00:00:00Z`);
  const to = new Date(`${p.period.endDate}T23:59:59.999Z`);
  const frozen = isInventoryValuationEnabled();
  const quantity = frozen ? sql`CASE WHEN ${inventoryMovements.type}::text='USAGE' THEN -${inventoryMovements.quantityChange}
    ELSE ABS(${inventoryMovements.quantityChange}) END` : sql`ABS(${inventoryMovements.quantityChange})`;
  const currentCost = sql`CASE WHEN config.use_average THEN COALESCE(${inventoryItems.averageCost}, ${inventoryItems.lastCost}, 0)
    ELSE COALESCE(${inventoryItems.lastCost}, ${inventoryItems.averageCost}, 0) END`;
  const captured = frozen ? sql`${valuations.movementId} IS NOT NULL` : sql`false`;
  const unitCost = frozen ? sql`CASE WHEN ${captured} THEN ${valuations.unitCostCents} ELSE ${currentCost} END` : currentCost;
  const rawCents = frozen ? sql`CASE WHEN ${captured} THEN COALESCE(${valuations.amountCents},0)
    * CASE WHEN ${valuations.kind}='USAGE_RETURN' THEN -1 ELSE 1 END ELSE ${quantity}*(${currentCost}) END`
    : sql`${quantity}*(${currentCost})`;
  const fallback = sql`${inventoryItems.averageCost} IS NULL AND ${inventoryItems.lastCost} IS NOT NULL AND config.use_average`;
  const uncosted = sql`${inventoryItems.averageCost} IS NULL AND ${inventoryItems.lastCost} IS NULL`;
  const query = sql`WITH config AS (
    SELECT CASE WHEN ${branches.costingMethod} = 'AVERAGE_COST' THEN true
      WHEN ${branches.costingMethod} = 'LAST_COST' THEN false ELSE ${companies.costingMethod} = 'AVERAGE_COST' END use_average
    FROM ${branches} JOIN ${companies} ON ${companies.id} = ${branches.companyId}
    WHERE ${branches.id} = ${p.branchId} AND ${branches.companyId} = ${p.companyId}
  ), movements AS (
    SELECT ${inventoryMovements.id}::text id, ${inventoryMovements.timestamp}::date::text date,
      ${inventoryMovements.type}::text type, ${quantity} quantity,
      ${inventoryItems.name} item_name, ${inventoryItems.companyId} item_company,
      ${unitCost} unit_cost, ${rawCents} raw_cents, (${captured}) frozen,
      (${frozen ? sql`${captured} AND ${valuations.amountCents} IS NULL` : sql`false`}) frozen_pending,
      (${frozen ? sql`CASE WHEN ${captured} THEN ${valuations.costingMethod}='LAST_COST_FALLBACK' ELSE ${fallback} END` : fallback}) fallback,
      (${frozen ? sql`CASE WHEN ${captured} THEN ${valuations.amountCents} IS NULL ELSE ${uncosted} END` : uncosted}) uncosted
    FROM ${inventoryMovements} JOIN ${inventoryItems} ON ${inventoryItems.id} = ${inventoryMovements.itemId} CROSS JOIN config
    ${frozen ? sql`LEFT JOIN ${valuations} ON ${valuations.movementId}=${inventoryMovements.id} AND ${valuations.companyId}=${p.companyId}` : sql``}
    WHERE ${inventoryMovements.branchId} = ${p.branchId} AND ${inventoryMovements.timestamp} BETWEEN ${from} AND ${to}
      AND ${inventoryMovements.type}::text IN ('USAGE', 'WASTE', 'RECEIVING')
  ), stats AS (
    SELECT count(*) FILTER (WHERE type = 'USAGE')::int usage_count, count(*) FILTER (WHERE type = 'WASTE')::int waste_count,
      count(*) FILTER (WHERE type = 'RECEIVING')::int receiving_count,
      count(DISTINCT date) FILTER (WHERE type = 'USAGE')::int usage_days, count(DISTINCT date) FILTER (WHERE type = 'WASTE')::int waste_days,
      count(DISTINCT date) FILTER (WHERE type = 'RECEIVING')::int receiving_days,
      count(*) FILTER (WHERE fallback AND type IN ('USAGE','WASTE'))::int fallback_count,
      count(*) FILTER (WHERE uncosted AND type IN ('USAGE','WASTE'))::int uncosted_count,
      count(*) FILTER (WHERE frozen_pending AND type IN ('USAGE','WASTE'))::int frozen_pending_count,
      count(*) FILTER (WHERE item_company <> ${p.companyId})::int foreign_count FROM movements
  ), picked AS (
    SELECT movements.* FROM movements CROSS JOIN stats WHERE type = CASE
      WHEN ${p.line} = 'waste' THEN CASE WHEN usage_count + waste_count > 0 THEN 'WASTE' END
      WHEN usage_count + waste_count > 0 THEN 'USAGE' ELSE 'RECEIVING' END
  ), valued AS (
    SELECT picked.*, sum(raw_cents) OVER (ORDER BY date DESC, id DESC ROWS UNBOUNDED PRECEDING) cumulative FROM picked
  ), totals AS (
    SELECT count(*)::int total_count, count(*) FILTER (WHERE frozen)::int frozen_count,
      count(*) FILTER (WHERE NOT frozen)::int legacy_count, COALESCE(sum(raw_cents),0)::text total_raw,
      floor(COALESCE(sum(raw_cents),0) + 0.5)::text rounded_total FROM picked
  ) SELECT stats.*, totals.*, page.* FROM stats CROSS JOIN totals LEFT JOIN LATERAL (
    SELECT id, date, type, item_name, quantity::text, unit_cost::text,
      (floor(cumulative + 0.5) - floor(cumulative - raw_cents + 0.5))::text cents
    FROM valued ORDER BY date DESC, id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}
  ) page ON true WHERE EXISTS (SELECT 1 FROM config)`;
  const result = frozen ? await withCompanyContext({ companyId: p.companyId }, tx => tx.execute<Row>(query)) : await db.execute<Row>(query);
  const row = result.rows[0];
  if (!row) throw ApiError.notFound("Sucursal no encontrada.");
  if (row.foreign_count > 0) throw ApiError.conflict("Hay movimientos con artículos fuera de la empresa. Revisa sus referencias.");
  const consumption = row.usage_count + row.waste_count > 0;
  let source: LineSource = consumption ? p.line === "waste" || row.fallback_count === 0 ? "MEASURED" : "DERIVED"
    : p.line === "foodCost" && row.receiving_count > 0 ? "DERIVED" : "NO_DATA";
  if (consumption && row.frozen_pending_count > 0) source = "DERIVED";
  let totalCents = exact(Math.round(Number(row.total_raw)));
  if (totalCents !== exact(row.rounded_total)) throw ApiError.conflict("No se pudo representar el redondeo del periodo con precisión.");
  let coveragePercent = source === "NO_DATA" ? 0 : Math.min(100, Math.round((consumption
    ? Math.max(row.usage_days, row.waste_days) : row.receiving_days) / p.period.days * 100));
  let calculation: { cents: number; note: string } | null = null;
  if (p.line === "foodCost" && !consumption && row.receiving_count === 0) {
    const pnl = (await getPnLByBranch(p.companyId, p.period.startDate, p.period.endDate)).find(b => b.branchId === p.branchId);
    if (!pnl) throw ApiError.notFound("Sucursal no encontrada.");
    if (pnl.foodCost.source !== "NO_DATA" && pnl.foodCost.source !== "SECTOR_DEFAULT") {
      throw ApiError.conflict("Los movimientos cambiaron durante la consulta. Vuelve a consultar el detalle.");
    }
    ({ cents: totalCents, source, coveragePercent } = pnl.foodCost);
    if (source === "SECTOR_DEFAULT") calculation = { cents: totalCents, note: pnl.foodCost.note };
  }
  return {
    branchId: p.branchId, line: p.line, period: p.period, page: p.page, pageSize: p.pageSize,
    totalCount: row.total_count, totalCents, hasMore: p.page * p.pageSize < row.total_count, source, coveragePercent, calculation,
    valuation: row.frozen_count > 0 ? row.legacy_count > 0 ? "MIXED_FROZEN_AND_CURRENT" : "FROZEN_MOVEMENT_COST" : "CURRENT_ITEM_COST",
    rounding: "CUMULATIVE_PERIOD_ROUNDING", uncostedLines: row.uncosted_count,
    frozenUncostedLines: row.frozen_pending_count,
    basis: consumption ? "CONSUMPTION" : row.receiving_count > 0 ? "PURCHASES" : "NO_MOVEMENTS",
    items: result.rows.filter(r => r.id !== null).map(r => ({ id: r.id!, date: r.date, cents: exact(r.cents),
      label: r.item_name, status: r.type, costCenter: null, quantity: r.quantity,
      unitCostCents: r.unit_cost == null ? null : exact(r.unit_cost) })),
  };
}
