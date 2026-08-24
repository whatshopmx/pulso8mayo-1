// scripts/diag-sales-duplicates.ts
//
// T7 (plan-inventario-desconexion): query de diagnóstico ANTES de aplicar la
// unique index `sales_entries_unique_sale`. Si encuentra duplicados, la
// política acordada es keep-latest (se conserva la fila con mayor updatedAt).
//
//   npx tsx scripts/diag-sales-duplicates.ts

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { salesEntries } from "../lib/db/schema";

async function main() {
  const groups = await db
    .select({
      companyId: salesEntries.companyId,
      branchId: salesEntries.branchId,
      saleDate: salesEntries.saleDate,
      recipeId: salesEntries.recipeId,
      count: sql<number>`count(*)::int`,
    })
    .from(salesEntries)
    .groupBy(
      salesEntries.companyId,
      salesEntries.branchId,
      salesEntries.saleDate,
      salesEntries.recipeId
    )
    .having(sql`count(*) > 1`);

  if (groups.length === 0) {
    console.log("Sin duplicados históricos: la migración puede aplicarse directo.");
    return;
  }

  console.error(`ATENCIÓN: ${groups.length} grupo(s) con duplicados:`);
  for (const g of groups) {
    console.error(`  company=${g.companyId} branch=${g.branchId} day=${g.saleDate.toISOString().slice(0, 10)} recipe=${g.recipeId} x${g.count}`);
  }
  console.error("\nPolítica acordada: keep-latest. Antes de aplicar la migración ejecutar:");
  console.error(`
  DELETE FROM sales_entries a
  USING sales_entries b
  WHERE a.company_id = b.company_id
    AND a.branch_id = b.branch_id
    AND a.sale_date = b.sale_date
    AND a.recipe_id = b.recipe_id
    AND a.updated_at < b.updated_at;
  `);
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
