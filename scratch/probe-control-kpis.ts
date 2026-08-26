import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

async function main() {
  const q = async (label: string, statement: any) => {
    try {
      const r: any = await db.execute(statement);
      console.log(`\n### ${label}`);
      console.table(r.rows ?? r);
    } catch (e: any) {
      console.log(`\n### ${label}\n  ERROR: ${e.message}`);
    }
  };

  await q("sales_entries (food cost teórico)", sql`select count(*)::int as n from sales_entries`);
  await q("daily_sales_cuts por mes", sql`
    select to_char(business_date::date,'YYYY-MM') as mes, count(*)::int as cortes, sum(total_sales)::bigint as ventas_cents
    from daily_sales_cuts where company_id = ${COMPANY} group by 1 order by 1 desc limit 6`);
  await q("operating_expenses por mes", sql`
    select to_char(created_at,'YYYY-MM') as mes, status, count(*)::int as n, sum(amount)::bigint as cents
    from operating_expenses where company_id = ${COMPANY} group by 1,2 order by 1 desc limit 8`);
  await q("purchase_order_items (precios por insumo)", sql`
    select count(*)::int as lineas, count(distinct poi.item_id)::int as insumos, count(distinct po.branch_id)::int as sucursales
    from purchase_order_items poi join purchase_orders po on po.id = poi.po_id where po.company_id = ${COMPANY}`);
  await q("insumos comprados en >1 sucursal", sql`
    select poi.item_id, count(distinct po.branch_id)::int as sucursales
    from purchase_order_items poi join purchase_orders po on po.id = poi.po_id
    where po.company_id = ${COMPANY} group by 1 having count(distinct po.branch_id) > 1 limit 10`);
  await q("ranking proveedores (OC por proveedor)", sql`
    select s.name, count(*)::int as ocs, sum(po.total_amount)::bigint as cents
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.company_id = ${COMPANY} group by 1 order by 3 desc nulls last limit 10`);
  await q("emergencias: OC por purchase_type", sql`
    select purchase_type, status, count(*)::int as n, sum(total_amount)::bigint as cents
    from purchase_orders where company_id = ${COMPANY} group by 1,2 order by 1`);
  await q("emergencias: OS por urgency", sql`
    select urgency, status, count(*)::int as n, sum(amount)::bigint as cents
    from service_orders where company_id = ${COMPANY} group by 1,2 order by 1`);
  await q("branch_budgets", sql`
    select bb.month, count(*)::int as filas, sum(bb.amount)::bigint as cents
    from branch_budgets bb join branches b on b.id = bb.branch_id
    where b.company_id = ${COMPANY} group by 1 order by 1 desc limit 6`);
  await q("inventory_movements (food cost real)", sql`
    select type, count(*)::int as n from inventory_movements im
    join branches b on b.id = im.branch_id where b.company_id = ${COMPANY} group by 1 order by 2 desc limit 10`);
  process.exit(0);
}
main();
