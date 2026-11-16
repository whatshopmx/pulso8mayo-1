import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Base PostgreSQL embebida y descartable. Aplica el SQL real de T02 sobre
// tablas pre-migración reducidas; no usa ni modifica TEST_DATABASE_URL.
const migrationPath = "drizzle/0151_invoice_destination.sql";
let pg: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const invoice = id(10), payee = id(3), supplier = id(4), branch = id(2), company = id(1);

async function rejects(sql: string, code = "23514") {
  try { await pg.exec(sql); } catch (error) {
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error("La escritura incompatible fue aceptada");
}

async function rollback(work: () => Promise<void>) {
  await pg.exec("BEGIN");
  try { await work(); } finally { await pg.exec("ROLLBACK"); }
}

function classify(destination = "OPERATING_EXPENSE", overrides: Record<string, string> = {}, target = invoice) {
  const assignments = { destination: `'${destination}'`, payee_id: `'${payee}'`, classified_by: "'actor'",
    classified_at: "now()", classification_reason: "'Clasificación sintética'", classification_source: "'MANUAL'", ...overrides };
  return `UPDATE invoices SET ${Object.entries(assignments).map(([column, value]) => `${column}=${value}`).join(",")}
    WHERE id='${target}'`;
}

describe("T02: migración aditiva de destino e identidad de CFDI", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE companies (id uuid PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY, company_id uuid NOT NULL);
      CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL);
      CREATE TABLE payees (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text NOT NULL);
      CREATE TABLE suppliers (id uuid PRIMARY KEY, company_id uuid NOT NULL, payee_id uuid);
      CREATE TABLE invoices (id uuid PRIMARY KEY, company_id uuid NOT NULL, branch_id uuid, supplier_id uuid,
        purchase_order_id uuid, receiving_report_id uuid, currency text NOT NULL DEFAULT 'MXN',
        total integer NOT NULL, payment_status text NOT NULL DEFAULT 'PENDING', uuid text UNIQUE NOT NULL,
        xml_content text, paid_by text, paid_at timestamp);
      CREATE TABLE operating_expenses (id uuid PRIMARY KEY, company_id uuid NOT NULL, branch_id uuid,
        payee_id uuid, invoice_id uuid, amount integer NOT NULL, status text NOT NULL DEFAULT 'APPROVED');
      INSERT INTO companies VALUES ('${company}'),('${id(20)}');
      INSERT INTO users VALUES ('actor','${company}'),('other-actor','${id(20)}');
      INSERT INTO branches VALUES ('${branch}','${company}'),('${id(21)}','${id(20)}');
      INSERT INTO payees VALUES ('${payee}','${company}','Servicios'),('${id(22)}','${id(20)}','Otro tenant'),
        ('${id(23)}','${company}','Otra contraparte');
      INSERT INTO suppliers VALUES ('${supplier}','${company}','${payee}'),('${id(24)}','${id(20)}','${id(22)}');
      INSERT INTO invoices (id,company_id,branch_id,supplier_id,total,uuid,xml_content) VALUES
        ('${invoice}','${company}','${branch}','${supplier}',116001,'legacy-service','<xml histórico/>'),
        ('${id(11)}','${company}','${branch}',NULL,50000,'legacy-unknown',NULL);
      INSERT INTO operating_expenses (id,company_id,branch_id,payee_id,invoice_id,amount) VALUES
        ('${id(5)}','${company}','${branch}','${payee}','${invoice}',116001),
        ('${id(12)}','${company}','${branch}','${payee}','${id(11)}',50000),
        ('${id(13)}','${company}','${branch}','${payee}','${id(11)}',50000);
    `);
    const before = (await pg.query("SELECT row_to_json(i) AS data FROM invoices i ORDER BY id")).rows;
    const expensesBefore = (await pg.query("SELECT row_to_json(e) AS data FROM operating_expenses e ORDER BY id")).rows;
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|SCHEMA)\b/i);
    await pg.exec(migration);
    const after = (await pg.query(`SELECT to_jsonb(i) - ARRAY['payee_id','destination','classified_at','classified_by',
      'classification_reason','classification_source'] AS data FROM invoices i ORDER BY id`)).rows;
    expect(after).toEqual(before);
    expect((await pg.query("SELECT row_to_json(e) AS data FROM operating_expenses e ORDER BY id")).rows).toEqual(expensesBefore);
  }, 30000);
  afterAll(async () => { await pg?.close(); });

  it("conserva importes, XML, proveedor e históricos sin inferir destino", async () => {
    const rows = (await pg.query("SELECT destination,payee_id,classified_by FROM invoices")).rows;
    expect(rows).toEqual(Array.from({ length: 2 }, () => ({ destination: "UNCLASSIFIED", payee_id: null, classified_by: null })));
  });

  it("acepta gasto con identidad directa sin proveedor de inventario", async () => {
    await rollback(async () => {
      await pg.exec(classify("OPERATING_EXPENSE", { supplier_id: "NULL" }));
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await pg.query("SELECT destination,supplier_id FROM invoices WHERE id=$1", [invoice])).rows[0])
        .toEqual({ destination: "OPERATING_EXPENSE", supplier_id: null });
    });
  });

  it("permite factura y gasto nuevos en una misma transacción", async () => {
    await rollback(async () => {
      await pg.exec(`INSERT INTO invoices (id,company_id,branch_id,payee_id,total,uuid,destination,
        classified_by,classified_at,classification_reason,classification_source)
        VALUES ('${id(30)}','${company}','${branch}','${payee}',116001,'new-expense','OPERATING_EXPENSE',
          'actor',now(),'Captura sintética','CAPTURE');
        INSERT INTO operating_expenses (id,company_id,branch_id,payee_id,invoice_id,amount)
        VALUES ('${id(31)}','${company}','${branch}','${payee}','${id(30)}',116001)`);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  it("acepta compra con OC sin gasto y conserva la captura antigua por defecto", async () => {
    await rollback(async () => {
      await pg.exec(`INSERT INTO invoices (id,company_id,branch_id,supplier_id,total,uuid,purchase_order_id)
        VALUES ('${id(30)}','${company}','${branch}','${supplier}',116001,'new-purchase','${id(40)}')`);
      expect((await pg.query("SELECT destination FROM invoices WHERE id=$1", [id(30)])).rows[0]).toEqual({ destination: "UNCLASSIFIED" });
      await pg.exec(classify("INVENTORY_PURCHASE", {}, id(30)));
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  it.each([
    ["destino desconocido", "UPDATE invoices SET destination='OTRO'", "23514"],
    ["clasificación sin auditoría", "UPDATE invoices SET destination='INVENTORY_PURCHASE'", "23514"],
    ["motivo vacío", classify("OPERATING_EXPENSE", { classification_reason: "'   '" }), "23514"],
    ["procedencia desconocida", classify("OPERATING_EXPENSE", { classification_source: "'OTRA'" }), "23514"],
    ["contraparte de otra empresa", `UPDATE invoices SET payee_id='${id(22)}'`, "23503"],
    ["operativo con OC", classify("OPERATING_EXPENSE", { purchase_order_id: `'${id(50)}'` }), "23514"],
    ["operativo con recepción", classify("OPERATING_EXPENSE", { receiving_report_id: `'${id(50)}'` }), "23514"],
    ["operativo sin contraparte", classify("OPERATING_EXPENSE", { payee_id: "NULL" }), "23514"],
    ["operativo en USD", classify("OPERATING_EXPENSE", { currency: "'USD'" }), "23514"],
  ])("rechaza %s", async (_label, sql, code) => { await rejects(sql, code); });

  it.each([
    ["actor ajeno", classify("OPERATING_EXPENSE", { classified_by: "'other-actor'" })],
    ["sucursal ajena", classify("OPERATING_EXPENSE", { branch_id: `'${id(21)}'` })],
    ["proveedor ajeno", classify("OPERATING_EXPENSE", { supplier_id: `'${id(24)}'` })],
    ["proveedor y contraparte contradictorios", classify("OPERATING_EXPENSE", { payee_id: `'${id(23)}'` })],
    ["compra que respalda gasto", classify("INVENTORY_PURCHASE")],
  ])("rechaza %s al validar el estado final", async (_label, sql) => {
    await rollback(async () => {
      await pg.exec(sql);
      await rejects("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  it("rechaza que una factura operativa respalde dos gastos", async () => {
    await rollback(async () => {
      await pg.exec(classify());
      await pg.exec(`INSERT INTO operating_expenses (id,company_id,branch_id,payee_id,invoice_id,amount)
        VALUES ('${id(6)}','${company}','${branch}','${payee}','${invoice}',116001)`);
      await rejects("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  it.each([
    ["empresa", `company_id='${id(20)}'`],
    ["contraparte", `payee_id='${id(23)}'`],
    ["sucursal", `branch_id='${id(21)}'`],
    ["importe", "amount=116000"],
  ])("impide romper la %s del gasto ya vinculado", async (_label, change) => {
    await rollback(async () => {
      await pg.exec(classify());
      await pg.exec(`UPDATE operating_expenses SET ${change} WHERE id='${id(5)}'`);
      await rejects("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  it("también valida automáticamente al COMMIT y revierte toda la clasificación incompatible", async () => {
    await pg.exec("BEGIN");
    await pg.exec(classify("INVENTORY_PURCHASE"));
    await rejects("COMMIT");
    expect((await pg.query("SELECT destination FROM invoices WHERE id=$1", [invoice])).rows[0])
      .toEqual({ destination: "UNCLASSIFIED" });
  });

  it.each([
    ["identidad del proveedor", `UPDATE suppliers SET payee_id='${id(23)}' WHERE id='${supplier}'`],
    ["empresa de la sucursal", `UPDATE branches SET company_id='${id(20)}' WHERE id='${branch}'`],
  ])("impide cambiar la %s después de clasificar", async (_label, sql) => {
    await rollback(async () => {
      await pg.exec(classify());
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await rejects(sql);
    });
  });

  it("rechaza snapshots de aislamiento que no permiten revalidar después del bloqueo", async () => {
    await pg.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await pg.exec(classify());
      await rejects("SET CONSTRAINTS ALL IMMEDIATE", "0A000");
    } finally { await pg.exec("ROLLBACK"); }
  });

  it("conserva metadata acumulada y registra la migración después de 0150", () => {
    const previous = JSON.parse(readFileSync("drizzle/meta/0149_snapshot.json", "utf8"));
    const current = JSON.parse(readFileSync("drizzle/meta/0151_snapshot.json", "utf8"));
    expect(current.prevId).toBe(previous.id);
    const owned = new Set(["public.invoices", "public.payees", "public.operating_expenses", "public.accounting_company_settings"]);
    for (const name of Object.keys(previous.tables)) {
      if (!owned.has(name)) expect(current.tables[name]).toEqual(previous.tables[name]);
    }
    expect(current.tables["public.accounting_company_settings"]).toBeDefined();
    expect(current.tables["public.operating_expenses"].indexes.operating_expenses_invoice_idx).toBeDefined();
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const position = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0151_invoice_destination");
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toMatchObject({ idx: 151, tag: "0151_invoice_destination" });
    expect(journal.entries[position - 1]).toMatchObject({ idx: 150 });
    expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  });
});
