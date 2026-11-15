import type { db } from "@/lib/db";
import { branches, recipes } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { buildRows, type NormalizedSaleRow, type SalesRowError } from "./sales-ingest-pure";
import { planSalesImport } from "./sales-ingest-plan";
import { normalizeSaleConsumptionIdentity } from "./sale-consumption-contract";

export * from "./sales-ingest-pure";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface ImportInput {
  companyId: string; branchId: string; userId: string; rows: NormalizedSaleRow[];
  /** Namespace estable; jamás usar el nombre del archivo. */
  source?: string;
  /** Captura manual: cualquier error revierte el lote completo. CSV mantiene grupos independientes. */
  atomic?: boolean;
}

export class SalesIngestService {
  static buildRows = buildRows;

  /** UUID y nombres se verifican contra catálogo propio; nombres ambiguos no resuelven. */
  static async resolveRecipeRefs(companyId: string, refs: string[], tx?: Tx): Promise<Map<string, string | null>> {
    if (!tx) {
      const { db } = await import("@/lib/db");
      return db.transaction(async scoped => {
        await scoped.execute(sql`SELECT set_config('app.current_company_id', ${companyId}, true)`);
        return this.resolveRecipeRefs(companyId, refs, scoped);
      });
    }
    const matches = await tx.select({ id: recipes.id, name: recipes.name }).from(recipes).where(eq(recipes.companyId, companyId));
    return new Map(refs.map(ref => {
      const key = ref.trim().toLowerCase();
      const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
      const found = matches.filter(row => byId ? row.id === key : row.name.trim().toLowerCase() === key);
      return [ref, found.length === 1 ? found[0].id : null];
    }));
  }

  /** Misma conexión para contexto, catálogo y writer. Cada grupo usa el savepoint del writer. */
  static async ingestInTransaction(tx: Tx, params: ImportInput) {
    return params.atomic ? tx.transaction(scoped => this.ingestGroups(scoped, params)) : this.ingestGroups(tx, params);
  }

  private static async ingestGroups(tx: Tx, params: ImportInput) {
    const { companyId, branchId, source } = normalizeSaleConsumptionIdentity({ ...params,
      source: params.source ?? "pos:import", productKey: "scope-check", saleDay: "2000-01-01" });
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyId}, true), set_config('app.current_branch_id', ${branchId}, true)`);
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
    const { applySaleConsumptionInTransaction, SaleConsumptionError } = await import("./sale-consumption-service");
    if (!branch) throw new SaleConsumptionError("INVALID_SCOPE", "Sucursal fuera de la empresa");
    const plan = planSalesImport(params.rows);
    if (params.atomic && plan.errors.length) throw new SaleConsumptionError("INVALID_INPUT", plan.errors.map(row => `Fila ${row.rowNumber}: ${row.message}`).join("; "));
    const resolved = await this.resolveRecipeRefs(companyId, plan.groups.map(row => row.recipeRef), tx);
    let inserted = 0, updated = 0, skipped = 0;
    const errors: SalesRowError[] = [...plan.errors];
    for (const group of plan.groups) {
      const recipeId = resolved.get(group.recipeRef);
      try {
        if (!recipeId) throw new SaleConsumptionError("INVALID_INPUT", `Producto/receta no encontrada o ambigua: "${group.recipeRef}"`);
        const result = await applySaleConsumptionInTransaction(tx, { companyId, branchId, source,
          productKey: group.productKey, saleDay: group.saleDay, recipeId, quantitySold: group.quantitySold,
          totalRevenueCents: group.totalRevenueCents, userId: params.userId });
        if (!result.applied) skipped++;
        else if (result.created) inserted++;
        else updated++;
      } catch (error) {
        // Infraestructura/serialización exige rollback/reintento del lote entero.
        if (!(error instanceof SaleConsumptionError)) throw error;
        if (params.atomic) throw error;
        for (const rowNumber of group.rowNumbers) errors.push({ rowNumber, message: error.message });
      }
    }
    // Cobertura final incluyendo productos/fuentes que comparten receta y proyección.
    const revenueCoverage: { recipeId: string; saleDay: string; complete: boolean }[] = [];
    for (const group of plan.groups) {
      const recipeId = resolved.get(group.recipeRef);
      if (!recipeId || revenueCoverage.some(row => row.recipeId === recipeId && row.saleDay === group.saleDay)) continue;
      const result = await tx.execute<{ complete: boolean }>(sql`SELECT bool_and(h.total_revenue IS NOT NULL) AS complete FROM (
        SELECT DISTINCT ON (r.identity_id) r.total_revenue, r.recipe_id
        FROM sales_consumption_revisions r JOIN sales_consumption_identities i ON i.id=r.identity_id
        WHERE i.company_id=${companyId} AND i.branch_id=${branchId} AND i.sale_day=${group.saleDay}::date
        ORDER BY r.identity_id,r.revision DESC
      ) h WHERE h.recipe_id=${recipeId}`);
      revenueCoverage.push({ recipeId, saleDay: group.saleDay, complete: result.rows[0]?.complete === true });
    }
    return { inserted, updated, skipped, errors, revenueCoverage,
      revenueComplete: errors.length === 0 && revenueCoverage.every(row => row.complete) };
  }

  /** Transacción serializable; nunca persiste venta separada del consumo. */
  static async ingest(params: ImportInput) {
    const { db } = await import("@/lib/db");
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(tx => this.ingestInTransaction(tx, params), { isolationLevel: "serializable" }); }
      catch (error) {
        const failure = error as { code?: string; cause?: { code?: string } };
        if (attempt >= 2 || !["40001", "40P01"].includes(failure.cause?.code ?? failure.code)) throw error;
      }
    }
  }
}
