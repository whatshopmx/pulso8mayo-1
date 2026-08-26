import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

async function main() {
  const q = async (label: string, statement: any) => {
    try { const r: any = await db.execute(statement); console.log(`\n### ${label}`); console.table(r.rows ?? r); }
    catch (e: any) { console.log(`\n### ${label}\n  ERROR: ${e.message}`); }
  };

  await q("OC por mes y estado", sql`
    select to_char(created_at,'YYYY-MM') as mes, status, count(*)::int as n
    from purchase_orders where company_id = ${COMPANY} group by 1,2 order by 1 desc, 2 limit 15`);

  await q("líneas por estado de la OC (base para precios)", sql`
    select po.status, count(*)::int as lineas, count(distinct poi.item_id)::int as insumos
    from purchase_order_items poi join purchase_orders po on po.id = poi.po_id
    where po.company_id = ${COMPANY} group by 1 order by 2 desc`);

  await q("insumos comparables 2026-08 en estados que comprometen", sql`
    select i.name, count(distinct po.branch_id)::int as sucursales,
           min(poi.unit_cost)::int as min_cents, max(poi.unit_cost)::int as max_cents
    from purchase_order_items poi
    join purchase_orders po on po.id = poi.po_id
    join inventory_items i on i.id = poi.item_id
    where po.company_id = ${COMPANY}
      and po.status in ('APPROVED','SENT','PARTIALLY_RECEIVED','CLOSED')
      and to_char(po.created_at,'YYYY-MM') = '2026-08'
    group by 1 having count(distinct po.branch_id) > 1 order by 2 desc limit 10`);

  await q("insumos comparables 2026-08 TODOS los estados", sql`
    select i.name, count(distinct po.branch_id)::int as sucursales,
           min(poi.unit_cost)::int as min_cents, max(poi.unit_cost)::int as max_cents
    from purchase_order_items poi
    join purchase_orders po on po.id = poi.po_id
    join inventory_items i on i.id = poi.item_id
    where po.company_id = ${COMPANY} and to_char(po.created_at,'YYYY-MM') = '2026-08'
    group by 1 having count(distinct po.branch_id) > 1 order by 2 desc limit 10`);

  await q("proveedores 2026-08 (estados que comprometen)", sql`
    select s.name, count(*)::int as ocs, coalesce(sum(po.total_amount),0)::bigint as cents
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.company_id = ${COMPANY}
      and po.status in ('APPROVED','SENT','PARTIALLY_RECEIVED','CLOSED')
      and to_char(po.created_at,'YYYY-MM') = '2026-08'
    group by 1 order by 3 desc limit 10`);

  await q("OS con proveedor 2026-08", sql`
    select coalesce(s.name,'(sin proveedor)') as name, count(*)::int as oss, coalesce(sum(so.amount),0)::bigint as cents
    from service_orders so left join suppliers s on s.id = so.supplier_id
    where so.company_id = ${COMPANY}
      and so.status in ('APPROVED','SCHEDULED','IN_PROGRESS','PENDING_CONFORMITY','CLOSED')
      and to_char(so.created_at,'YYYY-MM') = '2026-08'
    group by 1 order by 3 desc limit 10`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
