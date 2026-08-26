/**
 * Días de crédito por API: alta con términos, edición que dispara el recálculo
 * de vencimientos, y rechazo de valores fuera de rango.
 *
 *   BETTER_AUTH_URL=http://localhost:3100 npx next start -p 3100
 *   npx tsx tests/tmp-verify/proveedor-credito-api.ts
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

  const login = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login falló: ${login.status} ${await login.text()}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const api = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", cookie, origin: BASE },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, payload: await res.json().catch(() => null) };
  };

  let supplierId: string | null = null;
  let facturaId: string | null = null;

  try {
    // 1) Alta con crédito a 30 días.
    const alta = await api("/api/inventory/suppliers", "POST", {
      name: "[VERIFY] Proveedor con crédito",
      taxId: "XAXX010101000",
      active: true,
      paymentTermsDays: 30,
      paymentMethod: "TRANSFER",
    });
    supplierId = alta.payload?.supplier?.id ?? alta.payload?.id ?? null;
    const [creado] = supplierId
      ? await rows(sql`select payment_terms_days, payment_method, company_id from suppliers where id = ${supplierId}::uuid`)
      : [null];
    console.log("1) alta con 30 días + transferencia →", alta.status, {
      dias: creado?.payment_terms_days,
      forma: creado?.payment_method,
    });

    // 2) Factura pendiente para ver el recálculo al cambiar los términos.
    const [f] = await rows(sql`
      insert into invoices (company_id, supplier_id, uuid, fecha, subtotal, tax_amount, total,
                            rfc_emisor, rfc_receptor, payment_status, due_date)
      values (${creado.company_id}::uuid, ${supplierId}::uuid, ${"[VERIFY]-" + Date.now()},
              '2026-08-01T10:00:00', 10000, 1600, 11600, 'AAA010101AAA', 'BBB020202BBB',
              'PENDING', '2026-08-31'::date)
      returning id
    `);
    facturaId = f.id;

    // 3) Edición a 15 días: debe mover el vencimiento a 2026-08-16.
    const edicion = await api(`/api/inventory/suppliers/${supplierId}`, "PATCH", {
      name: "[VERIFY] Proveedor con crédito",
      paymentTermsDays: 15,
      paymentMethod: "CHECK",
    });
    const [tras] = await rows(sql`select payment_terms_days, payment_method from suppliers where id = ${supplierId}::uuid`);
    const [fac] = await rows(sql`select due_date from invoices where id = ${facturaId}::uuid`);
    const vence = String(fac.due_date).slice(0, 10);
    console.log("2) edición a 15 días + cheque →", edicion.status, {
      dias: tras?.payment_terms_days,
      forma: tras?.payment_method,
      vencimiento: vence,
    });

    // 4) Fuera de rango: 400 del zod.
    const invalido = await api(`/api/inventory/suppliers/${supplierId}`, "PATCH", {
      name: "[VERIFY] Proveedor con crédito",
      paymentTermsDays: 400,
    });
    console.log("3) 400 días →", invalido.status);

    // 5) Forma de pago fuera del catálogo: rechazo del zod.
    const formaInvalida = await api(`/api/inventory/suppliers/${supplierId}`, "PATCH", {
      name: "[VERIFY] Proveedor con crédito",
      paymentMethod: "BITCOIN",
    });
    console.log("4) forma de pago inventada →", formaInvalida.status);

    const ok =
      alta.status === 200 &&
      Number(creado?.payment_terms_days) === 30 &&
      edicion.status === 200 &&
      Number(tras?.payment_terms_days) === 15 &&
      vence === "2026-08-16" &&
      invalido.status === 400 &&
      creado?.payment_method === "TRANSFER" &&
      tras?.payment_method === "CHECK" &&
      formaInvalida.status === 400;

    console.log(ok ? "\nOK: días de crédito capturables y vencimientos recalculados" : "\nFALLA");
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (facturaId) await db.execute(sql`delete from invoices where id = ${facturaId}::uuid`);
    if (supplierId) await db.execute(sql`delete from suppliers where id = ${supplierId}::uuid`);
    console.log("limpieza: proveedor y factura [VERIFY] borrados");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
