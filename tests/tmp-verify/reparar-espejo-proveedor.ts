/**
 * Repara la coherencia entre `supplier_items.preference_rank` (fuente de verdad)
 * e `inventory_items.supplier_id` (espejo del rango 1). Necesario tras una
 * corrida de verificación cuya limpieza se cayó a medias.
 */
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const rows = async (q: any) => {
    const r: any = await db.execute(q);
    return Array.isArray(r) ? r : r.rows;
  };

  const antes = await rows(sql`
    select i.id, i.name, i.supplier_id, si.supplier_id as rango1
    from inventory_items i
    left join supplier_items si on si.item_id = i.id and si.preference_rank = 1
    where i.supplier_id is distinct from si.supplier_id
  `);
  console.log("insumos incoherentes:", antes.length);
  for (const f of antes) console.log(`  ${f.name}: espejo=${f.supplier_id} rango1=${f.rango1}`);

  // 1) Donde hay rango 1, el espejo lo sigue.
  await db.execute(sql`
    update inventory_items i
    set supplier_id = si.supplier_id, updated_at = now()
    from supplier_items si
    where si.item_id = i.id and si.preference_rank = 1
      and i.supplier_id is distinct from si.supplier_id
  `);

  // 2) Donde hay espejo pero nadie tiene rango 1, el espejo se vuelve principal.
  await db.execute(sql`
    insert into supplier_items (company_id, supplier_id, item_id, preference_rank)
    select i.company_id, i.supplier_id, i.id, 1
    from inventory_items i
    where i.supplier_id is not null
      and not exists (select 1 from supplier_items si where si.item_id = i.id and si.preference_rank = 1)
    on conflict (supplier_id, item_id) do update set preference_rank = 1
  `);

  const despues = await rows(sql`
    select count(*)::int as n
    from inventory_items i
    left join supplier_items si on si.item_id = i.id and si.preference_rank = 1
    where i.supplier_id is distinct from si.supplier_id
  `);
  console.log("incoherentes tras reparar:", despues[0].n);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
