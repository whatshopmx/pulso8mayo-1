// Estado del backfill de proveedor principal (migración 0071).
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const r: any = await db.execute(sql`
    select
      (select count(*) from supplier_items) as filas_catalogo,
      (select count(*) from supplier_items where preference_rank = 1) as principales,
      (select count(*) from inventory_items where supplier_id is not null) as con_preferido,
      (select count(*) from inventory_items i
        where i.supplier_id is not null and not exists (
          select 1 from supplier_items si
          where si.item_id = i.id and si.supplier_id = i.supplier_id and si.preference_rank = 1
        )) as huerfanos
  `);
  console.log((Array.isArray(r) ? r : r.rows)[0]);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
