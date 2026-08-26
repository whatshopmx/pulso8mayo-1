/**
 * Task 11 (loteprod §8.1): merma por preparación contra el rendimiento de la
 * ficha, verificada por la API real (sesión de demo, igual que Task 3).
 *
 * Requiere el server servido desde el build nuevo:
 *   BETTER_AUTH_URL=http://localhost:3100 npx next start -p 3100
 *   npx tsx tests/tmp-verify/merma-preparacion-api.ts
 */
import { config } from "dotenv";
config({ path: ".env" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.VERIFY_EMAIL ?? "carlos@pulso.mx";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "123456";

async function main() {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");

  const rows = async (q: any) => {
    const r: any = await db.execute(q);
    return Array.isArray(r) ? r : r.rows;
  };

  // Ficha con rendimiento < 100 y un lote con stock del mismo insumo/sucursal.
  const [ctx] = await rows(sql`
    select ri.recipe_id, ri.item_id, ri.yield_percent,
           b.id as batch_id, b.branch_id, b.current_quantity, i.unit
    from recipe_items ri
    join inventory_items i on i.id = ri.item_id
    join inventory_batches b on b.item_id = ri.item_id and b.status = 'AVAILABLE'
    join recipes r on r.id = ri.recipe_id
    where b.current_quantity > 5 and ri.is_sub_recipe = false
    limit 1
  `);
  if (!ctx) throw new Error("dev sin receta+lote utilizable: corre pnpm seed:4");

  // Rendimiento conocido para que el esperado no dependa del seed.
  const yieldOriginal = ctx.yield_percent;
  await db.execute(sql`
    update recipe_items set yield_percent = 90
    where recipe_id = ${ctx.recipe_id}::uuid and item_id = ${ctx.item_id}::uuid
  `);

  const login = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    // better-auth exige Origin en peticiones no-navegador (MISSING_OR_NULL_ORIGIN).
    headers: { "Content-Type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login falló: ${login.status} ${await login.text()}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const postWaste = async (body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/inventory/waste`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin: BASE },
      body: JSON.stringify(body),
    });
    return { status: res.status, payload: await res.json().catch(() => null) };
  };

  const base = {
    branchId: ctx.branch_id,
    itemId: ctx.item_id,
    batchId: ctx.batch_id,
    unit: ctx.unit,
    reason: "PREPARATION",
  };

  const creados: string[] = [];
  const cantidadInicial = Number(ctx.current_quantity);

  try {
    // 1) Dentro de lo esperado: 10 procesados con rendimiento 90 → 1.0 esperado.
    const dentro = await postWaste({ ...base, quantity: 1, recipeId: ctx.recipe_id, processedQuantity: 10 });
    const idDentro = dentro.payload?.data?.waste?.id;
    if (idDentro) creados.push(idDentro);
    console.log("1) dentro de lo esperado →", dentro.status, {
      expected: dentro.payload?.data?.waste?.expectedQuantity,
      flagged: dentro.payload?.data?.waste?.yieldFlagged,
    });

    // 2) Muy por encima: 3 de merma contra 1.0 esperado → marcada.
    const fuera = await postWaste({ ...base, quantity: 3, recipeId: ctx.recipe_id, processedQuantity: 10 });
    const idFuera = fuera.payload?.data?.waste?.id;
    if (idFuera) creados.push(idFuera);
    console.log("2) desviada →", fuera.status, {
      expected: fuera.payload?.data?.waste?.expectedQuantity,
      flagged: fuera.payload?.data?.waste?.yieldFlagged,
    });

    // 3) Receta colgada de otro motivo → rechazo con código estable.
    const cruzada = await postWaste({ ...base, reason: "EXPIRED", quantity: 1, recipeId: ctx.recipe_id, processedQuantity: 10 });
    console.log("3) receta con motivo ajeno →", cruzada.status, cruzada.payload?.error?.details?.code);

    // 4) Receta sin cantidad procesada → rechazo.
    const sinProcesado = await postWaste({ ...base, quantity: 1, recipeId: ctx.recipe_id });
    console.log("4) sin cantidad procesada →", sinProcesado.status, sinProcesado.payload?.error?.details?.code);

    // 5) Insumo que no está en la receta → rechazo.
    const [otro] = await rows(sql`
      select id from inventory_items
      where id <> ${ctx.item_id}::uuid
        and id not in (select item_id from recipe_items where recipe_id = ${ctx.recipe_id}::uuid)
      limit 1
    `);
    const ajeno = otro
      ? await postWaste({ ...base, itemId: otro.id, batchId: undefined, quantity: 1, recipeId: ctx.recipe_id, processedQuantity: 10 })
      : null;
    if (ajeno) console.log("5) insumo ajeno a la receta →", ajeno.status, ajeno.payload?.error?.details?.code);

    const ok =
      dentro.status === 200 &&
      Number(dentro.payload?.data?.waste?.expectedQuantity) === 1 &&
      dentro.payload?.data?.waste?.yieldFlagged === false &&
      fuera.status === 200 &&
      fuera.payload?.data?.waste?.yieldFlagged === true &&
      cruzada.status === 400 &&
      cruzada.payload?.error?.details?.code === "PREPARATION_INVALID" &&
      sinProcesado.status === 400 &&
      (!ajeno || ajeno.payload?.error?.details?.code === "PREPARATION_INVALID");

    console.log(ok ? "\nOK: Task 11 verificada por API" : "\nFALLA: revisar salidas de arriba");
    process.exitCode = ok ? 0 : 1;
  } finally {
    for (const id of creados) {
      await db.execute(sql`delete from inventory_waste where id = ${id}::uuid`);
    }
    await db.execute(sql`
      delete from inventory_movements
      where item_id = ${ctx.item_id}::uuid and reason like 'WASTE: PREPARATION%'
        and timestamp > now() - interval '10 minutes'
    `);
    await db.execute(sql`
      update inventory_batches set current_quantity = ${String(cantidadInicial)}, status = 'AVAILABLE'
      where id = ${ctx.batch_id}::uuid
    `);
    await db.execute(sql`
      update recipe_items set yield_percent = ${yieldOriginal}
      where recipe_id = ${ctx.recipe_id}::uuid and item_id = ${ctx.item_id}::uuid
    `);
    console.log("limpieza: mermas y movimientos [VERIFY] borrados, lote y rendimiento restaurados");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
