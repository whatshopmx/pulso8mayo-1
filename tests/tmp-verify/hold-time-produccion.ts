/**
 * Task 4 (loteprod §6.4): producir una receta con holdTime=30 debe dejar
 * `production_results.expires_at = production_date + 30 min`, y una receta sin
 * hold time debe seguir produciendo con expires_at null.
 *
 *   npx tsx tests/tmp-verify/hold-time-produccion.ts
 */
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { ProductionService } = await import("@/lib/services/production-service");

  const rows = async (q: any) => {
    const r: any = await db.execute(q);
    return Array.isArray(r) ? r : r.rows;
  };

  const [ctx] = await rows(sql`
    select r.id as recipe_id, r.company_id, r.hold_time_minutes, b.id as branch_id
    from recipes r
    join branches b on b.company_id = r.company_id
    limit 1
  `);
  if (!ctx) throw new Error("dev sin recetas/sucursales: corre los seeds");

  const creados: string[] = [];
  try {
    // 1) Receta CON hold time.
    await db.execute(sql`update recipes set hold_time_minutes = 30 where id = ${ctx.recipe_id}::uuid`);
    const conHold = await ProductionService.recordProduction({
      companyId: ctx.company_id,
      branchId: ctx.branch_id,
      recipeId: ctx.recipe_id,
      producedQuantity: 1,
      unit: "PORTION",
      notes: "[VERIFY] hold time",
      recordedBy: "verify-script",
      ingredients: [],
    });
    creados.push(conHold!.id);

    const [fila] = await rows(sql`
      select production_date, expires_at,
             extract(epoch from (expires_at - production_date))/60 as minutos
      from production_results where id = ${conHold!.id}::uuid
    `);
    console.log("con hold time:", fila);

    // 2) Receta SIN hold time: sigue funcionando, expires_at null.
    await db.execute(sql`update recipes set hold_time_minutes = null where id = ${ctx.recipe_id}::uuid`);
    const sinHold = await ProductionService.recordProduction({
      companyId: ctx.company_id,
      branchId: ctx.branch_id,
      recipeId: ctx.recipe_id,
      producedQuantity: 1,
      unit: "PORTION",
      notes: "[VERIFY] sin hold time",
      recordedBy: "verify-script",
      ingredients: [],
    });
    creados.push(sinHold!.id);
    const [fila2] = await rows(sql`
      select expires_at from production_results where id = ${sinHold!.id}::uuid
    `);
    console.log("sin hold time:", fila2);

    const minutos = Number(fila.minutos);
    const ok = Math.abs(minutos - 30) < 0.05 && fila2.expires_at === null;
    console.log(ok ? "\nOK: expires_at = production_date + 30 min y null sin hold time" : "\nFALLA");
    process.exitCode = ok ? 0 : 1;
  } finally {
    // Restaura el hold time original de la receta y borra lo producido.
    await db.execute(
      sql`update recipes set hold_time_minutes = ${ctx.hold_time_minutes} where id = ${ctx.recipe_id}::uuid`
    );
    for (const id of creados) {
      await db.execute(sql`delete from production_results where id = ${id}::uuid`);
    }
    console.log("limpieza: producciones [VERIFY] borradas, receta restaurada");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
