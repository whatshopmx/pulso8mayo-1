import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL!);
const C = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const B = 'b1000001-0000-4000-8000-000000000001';

async function run(label: string, q: string, params: unknown[] = []) {
  try {
    const r = await sql.query(q, params);
    console.log(label, 'OK', JSON.stringify(r).slice(0, 300));
  } catch (e: any) {
    console.log(label, 'ERR', e.code, e.message, e.detail ?? '', e.hint ?? '');
  }
}

async function main() {
  await run('full', `select "invoices"."id", greatest(0, "invoices"."total" - coalesce((select sum(p.amount_cents) from "payment_run_items" p join "payment_runs" r on r.id = p.payment_run_id where r.company_id = "invoices"."company_id" and p.item_type = 'INVOICE' and p.reference_id = "invoices"."id"::text and p.settlement_status = 'CONFIRMED'), 0) - coalesce((select sum((f.snapshot->>'totalCents')::bigint) from "accounting_purchase_facts" f join "accounting_events" e on e.id = f.event_id and e.status = 'POSTED' where f.company_id = "invoices"."company_id" and f.invoice_id = "invoices"."id" and f.kind = 'CREDIT'), 0)) from "invoices" left join "suppliers" on ("invoices"."supplier_id" = "suppliers"."id" and "suppliers"."company_id" = $1) where ("invoices"."company_id" = $2 and ("invoices"."payment_status" = $3 and "invoices"."destination" in ($4, $5) and not exists (select 1 from "operating_expenses" e where e.company_id = "invoices"."company_id" and e.invoice_id = "invoices"."id")) and ("invoices"."branch_id" = $6 OR "invoices"."branch_id" IS NULL))`, [C, C, 'PENDING', 'UNCLASSIFIED', 'INVENTORY_PURCHASE', B]);
  await run('pri', `select count(*) from payment_run_items p where p.settlement_status = 'CONFIRMED'`);
  await run('apf', `select count(*) from accounting_purchase_facts`);
  await run('ae', `select count(*) from accounting_events`);
  await run('oe', `select count(*) from operating_expenses where invoice_id is not null`);
  await run('cols', `select table_name, column_name, data_type from information_schema.columns where (table_name='payment_run_items' and column_name in ('settlement_status','reference_id','amount_cents')) or (table_name='accounting_purchase_facts' and column_name in ('invoice_id','kind','snapshot','company_id')) or (table_name='operating_expenses' and column_name='invoice_id') or (table_name='invoices' and column_name in ('id','total','destination'))`);
}
main();
