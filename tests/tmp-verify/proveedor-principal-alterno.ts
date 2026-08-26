/**
 * Proveedor principal vs alterno por insumo (loteprod §4), por API contra el
 * build. Verifica el backfill, la promoción con degradación del anterior, el
 * espejo en `inventory_items.supplier_id` (lo que agrupa las OC sugeridas) y
 * que la BD impida dos principales.
 *
 *   npx tsx tests/tmp-verify/proveedor-principal-alterno.ts
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

  // 0) Backfill: ningún insumo con "proveedor preferido" debe haber quedado sin principal.
  const [huerfanos] = await rows(sql`
    select count(*)::int as n
    from inventory_items i
    where i.supplier_id is not null
      and not exists (
        select 1 from supplier_items si
        where si.item_id = i.id and si.supplier_id = i.supplier_id and si.preference_rank = 1
      )
  `);
  console.log("0) insumos con proveedor preferido sin rango 1 tras el backfill:", huerfanos.n);

  const [ctx] = await rows(sql`
    select i.id as item_id, i.company_id, i.name, i.supplier_id
    from inventory_items i
    where i.supplier_id is not null
    limit 1
  `);
  if (!ctx) throw new Error("dev sin insumos con proveedor: corre los seeds");

  const [alterno] = await rows(sql`
    select id, name from suppliers
    where company_id = ${ctx.company_id}::uuid and id <> ${ctx.supplier_id}::uuid
    limit 1
  `);
  if (!alterno) throw new Error("dev con un solo proveedor: no se puede probar la promoción");

  const estadoInicial = await rows(sql`
    select supplier_id, preference_rank from supplier_items
    where item_id = ${ctx.item_id}::uuid order by preference_rank asc nulls last
  `);
  console.log("estado inicial:", estadoInicial);

  const login = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login falló: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const patch = async (body: unknown) => {
    const res = await fetch(`${BASE}/api/inventory/products/${ctx.item_id}/suppliers`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie, origin: BASE },
      body: JSON.stringify(body),
    });
    return { status: res.status, payload: await res.json().catch(() => null) };
  };

  try {
    // 1) Alta del alterno.
    const agregado = await patch({ supplierId: alterno.id, action: "ADD_ALTERNATE" });
    const trasAlta = agregado.payload?.data?.suppliers ?? [];
    console.log(
      "1) agregar alterno →",
      agregado.status,
      trasAlta.map((r: any) => `${r.supplierName}:${r.preferenceRank}`)
    );

    // 2) Promoción del alterno a principal: el anterior debe caer a 2.
    const promovido = await patch({ supplierId: alterno.id, action: "SET_PRIMARY" });
    const trasPromocion = promovido.payload?.data?.suppliers ?? [];
    console.log(
      "2) promover a principal →",
      promovido.status,
      trasPromocion.map((r: any) => `${r.supplierName}:${r.preferenceRank}`)
    );

    // 3) Espejo: inventory_items.supplier_id sigue al principal.
    const [espejo] = await rows(sql`
      select supplier_id from inventory_items where id = ${ctx.item_id}::uuid
    `);
    console.log("3) espejo inventory_items.supplier_id =", espejo.supplier_id === alterno.id ? "alterno (correcto)" : espejo.supplier_id);

    // 4) La BD rechaza dos principales aunque se intente por SQL directo.
    let rechazado = false;
    try {
      await db.execute(sql`
        update supplier_items set preference_rank = 1
        where item_id = ${ctx.item_id}::uuid and supplier_id = ${ctx.supplier_id}::uuid
      `);
    } catch {
      rechazado = true;
    }
    console.log("4) segundo principal por SQL directo →", rechazado ? "rechazado por el índice" : "PERMITIDO (mal)");

    const nuevoPrincipal = trasPromocion.find((r: any) => r.preferenceRank === 1);
    const degradado = trasPromocion.find((r: any) => r.supplierId === ctx.supplier_id);
    const ok =
      Number(huerfanos.n) === 0 &&
      agregado.status === 200 &&
      promovido.status === 200 &&
      nuevoPrincipal?.supplierId === alterno.id &&
      degradado?.preferenceRank === 2 &&
      espejo.supplier_id === alterno.id &&
      rechazado;

    if (!ok) {
      console.log("diagnostico:", {
        huerfanos: Number(huerfanos.n) === 0,
        alta: agregado.status,
        promocion: promovido.status,
        nuevoPrincipal: nuevoPrincipal?.supplierId === alterno.id,
        degradadoRank: degradado?.preferenceRank,
        espejo: espejo.supplier_id === alterno.id,
        rechazado,
      });
    }
    console.log(ok ? "\nOK: principal y alterno funcionan de punta a punta" : "\nFALLA");
    process.exitCode = ok ? 0 : 1;
  } finally {
    // Restaura el estado exacto que había antes.
    await db.execute(sql`
      update supplier_items set preference_rank = null where item_id = ${ctx.item_id}::uuid
    `);
    for (const fila of estadoInicial) {
      await db.execute(sql`
        update supplier_items set preference_rank = ${fila.preference_rank}
        where item_id = ${ctx.item_id}::uuid and supplier_id = ${fila.supplier_id}::uuid
      `);
    }
    // El alterno de prueba solo se borra si no estaba en el catálogo antes.
    const alternoYaEstaba = estadoInicial.some((f: any) => f.supplier_id === alterno.id);
    if (!alternoYaEstaba) {
      await db.execute(sql`
        delete from supplier_items
        where item_id = ${ctx.item_id}::uuid and supplier_id = ${alterno.id}::uuid
      `);
    }
    await db.execute(sql`
      update inventory_items set supplier_id = ${ctx.supplier_id}::uuid where id = ${ctx.item_id}::uuid
    `);
    console.log("limpieza: rangos, alterno de prueba y espejo restaurados");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
