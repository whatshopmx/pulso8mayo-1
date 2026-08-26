/**
 * Días de crédito de proveedor: `updateSupplierPaymentTerms` era código muerto
 * (definido y nunca llamado), así que esta es la primera vez que corre. Verifica
 * que persiste los términos y recalcula el vencimiento de las facturas NO
 * pagadas, dejando en paz las liquidadas.
 *
 *   npx tsx tests/tmp-verify/dias-credito-proveedor.ts
 */
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { updateSupplierPaymentTerms } = await import(
    "@/lib/services/accounts-payable-service"
  );

  const rows = async (q: any) => {
    const r: any = await db.execute(q);
    return Array.isArray(r) ? r : r.rows;
  };

  // Proveedor CON facturas pendientes si lo hay: es el único caso donde el
  // recálculo de vencimientos tiene algo que hacer.
  const [prov] = await rows(sql`
    select s.id, s.company_id, s.name, s.payment_terms_days,
           count(i.id) filter (where i.payment_status = 'PENDING')::int as pendientes
    from suppliers s
    left join invoices i on i.supplier_id = s.id
    group by s.id, s.company_id, s.name, s.payment_terms_days
    order by pendientes desc
    limit 1
  `);
  if (!prov) throw new Error("dev sin proveedores: corre los seeds");
  console.log("proveedor:", prov.name, "· términos actuales:", prov.payment_terms_days);

  const [antes] = await rows(sql`
    select count(*)::int as n from invoices where supplier_id = ${prov.id}::uuid
  `);
  console.log("facturas del proveedor:", antes.n);

  // Factura pendiente sembrada: sin ella el UPDATE del recálculo corre sobre 0
  // filas y no probaría nada. Se borra en el finally.
  const marca = `[VERIFY]-${Date.now()}`;
  const [facturaSembrada] = await rows(sql`
    insert into invoices (company_id, supplier_id, uuid, fecha, subtotal, tax_amount, total,
                          rfc_emisor, rfc_receptor, payment_status, due_date)
    values (${prov.company_id}::uuid, ${prov.id}::uuid, ${marca}, '2026-08-01T10:00:00',
            10000, 1600, 11600, 'AAA010101AAA', 'BBB020202BBB', 'PENDING',
            '2026-08-01'::date)
    returning id
  `);
  console.log("factura sembrada con vencimiento 2026-08-01 (contado)");

  try {
    await updateSupplierPaymentTerms(prov.company_id, prov.id, 30);
    const [despues] = await rows(sql`
      select payment_terms_days from suppliers where id = ${prov.id}::uuid
    `);
    console.log("términos tras el update:", despues.payment_terms_days);

    // Vencimiento esperado = fecha de la factura + 30 días, solo en las no pagadas.
    const facturas = await rows(sql`
      select id, payment_status as status, substring(fecha from 1 for 10) as emitida, due_date,
             (substring(fecha from 1 for 10)::date + 30) as esperada
      from invoices where supplier_id = ${prov.id}::uuid
      limit 5
    `);
    for (const f of facturas) {
      console.log(
        `  factura ${String(f.id).slice(0, 8)} status=${f.status} emitida=${f.emitida} due=${f.due_date} esperada=${f.esperada}`
      );
    }

    const [recalculada] = await rows(sql`
      select due_date from invoices where id = ${facturaSembrada.id}::uuid
    `);
    const venceEn = String(recalculada.due_date).slice(0, 10);
    console.log("vencimiento de la factura sembrada tras el cambio:", venceEn, "(esperado 2026-08-31)");

    const ok = Number(despues.payment_terms_days) === 30 && venceEn === "2026-08-31";
    console.log(ok ? "\nOK: términos persistidos y recálculo ejecutado sin error" : "\nFALLA");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await db.execute(sql`delete from invoices where id = ${facturaSembrada.id}::uuid`);
    await updateSupplierPaymentTerms(prov.company_id, prov.id, prov.payment_terms_days ?? 0);
    console.log("limpieza: factura [VERIFY] borrada y términos restaurados a", prov.payment_terms_days);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
