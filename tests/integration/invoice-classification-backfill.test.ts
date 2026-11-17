import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  backfillInvoiceClassification,
  getInvoiceClassificationReport,
} from "@/lib/services/invoice-classification-service";

/**
 * T12 — el backfill histórico escribe metadata que las restricciones reales de
 * 0151 aceptan, y no cambia la elegibilidad de compra.
 *
 * Base PostgreSQL embebida y descartable: tablas creadas desde el modelo
 * Drizzle y, encima, las restricciones y triggers reales de la migración 0151.
 * No usa TEST_DATABASE_URL ni la base operativa.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
}));
vi.mock("@/lib/db/tenant-context", () => ({
  withCompanyContext: (_ctx: unknown, work: Parameters<typeof db.transaction>[0]) => db.transaction(work),
}));

const migration = readFileSync("drizzle/0151_invoice_destination.sql", "utf8");
// Solo destino, restricciones, funciones y triggers: las columnas ya existen
// porque las tablas se generan desde el modelo actual.
const guards = migration.slice(
  migration.indexOf('ALTER TABLE "invoices" ADD CONSTRAINT "invoices_destination_check"'),
);

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), otherCompanyId = id(2), branchId = id(3), supplierId = id(4), payeeId = id(5), userId = id(6);
const gastoId = id(10), compraId = id(11), sinIndicioId = id(12), otraEmpresaId = id(13);
const tables = [schema.branches, schema.invoices, schema.operatingExpenses, schema.suppliers, schema.users, schema.payees];

let pg: PGlite;
let connection: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  connection = drizzle(pg);
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(column => {
      const raw = column.getSQLType();
      const type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      return `"${column.name}" ${type}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(", ")})`);
    await pg.exec(`alter table "${config.name}" alter column "id" set default gen_random_uuid()`);
    await pg.exec(`alter table "${config.name}" alter column "created_at" set default now()`);
  }
  await pg.exec("alter table invoices alter column destination set default 'UNCLASSIFIED'");
  await pg.exec("alter table invoices alter column currency set default 'MXN'");
  await pg.exec("alter table invoices alter column payment_status set default 'PENDING'");
  await pg.exec(guards);
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.update).mockImplementation(connection.update.bind(connection) as typeof db.update);
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
}, 30000);

afterAll(async () => { await pg?.close(); });

beforeEach(async () => {
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.users).values({ id: userId, companyId, name: "Clasificador" } as never);
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Servicios", active: true } as never);
  await connection.insert(schema.branches).values({ id: branchId, companyId, name: "Sucursal" } as never);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Harina", payeeId } as never);
  await connection.insert(schema.invoices).values([
    // Respalda un gasto coherente y no tiene OC: gasto operativo.
    { id: gastoId, companyId, branchId, supplierId, uuid: "UUID-GASTO", fecha: "2026-11-01", subtotal: 100000,
      total: 116000, currency: "MXN", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    // Tiene OC de inventario y ningún gasto: compra.
    { id: compraId, companyId, branchId, supplierId, purchaseOrderId: id(20), uuid: "UUID-COMPRA", fecha: "2026-11-02",
      subtotal: 50000, total: 58000, currency: "MXN", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    // Ni OC, ni recepción, ni gasto: se queda «Por clasificar».
    { id: sinIndicioId, companyId, branchId, supplierId, uuid: "UUID-SIN-INDICIO", fecha: "2026-11-03", subtotal: 20000,
      total: 23200, currency: "MXN", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    // Documento de otra empresa: fuera del alcance.
    { id: otraEmpresaId, companyId: otherCompanyId, branchId: null, supplierId: null, uuid: "UUID-AJENO",
      fecha: "2026-11-04", subtotal: 10000, total: 11600, currency: "MXN" },
  ] as never);
  await connection.insert(schema.operatingExpenses).values({ id: id(30), companyId, branchId, payeeId,
    invoiceId: gastoId, amount: 116000, status: "APPROVED", description: "Luz", createdAt: new Date("2026-11-01") } as never);
});

describe("T12: backfill contra las restricciones reales de 0151", () => {
  it("las restricciones reales están activas en este entorno", async () => {
    // Sin contraparte directa, el CHECK de 0151 rechaza el gasto operativo.
    await expect(pg.query(
      `update invoices set destination='OPERATING_EXPENSE', classified_at=now(), classified_by=$1,
        classification_reason='Prueba', classification_source='BACKFILL' where id=$2`, [userId, compraId],
    )).rejects.toThrow();
    // Una compra no puede respaldar un gasto: lo impide el trigger diferido.
    await expect(pg.query(
      `update invoices set destination='INVENTORY_PURCHASE', classified_at=now(), classified_by=$1,
        classification_reason='Prueba', classification_source='BACKFILL' where id=$2`, [userId, gastoId],
    )).rejects.toThrow(/gasto/i);
  });

  it("clasifica gasto y compra sin salir del alcance de la empresa", async () => {
    const aplicado = await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    expect(aplicado.applied.count).toBe(2);
    expect(aplicado.pending.count).toBe(1);

    const rows = await connection.select().from(schema.invoices);
    expect(rows.find(row => row.id === gastoId)).toMatchObject({
      destination: "OPERATING_EXPENSE", payeeId, classifiedBy: userId, classificationSource: "BACKFILL",
    });
    expect(rows.find(row => row.id === compraId)).toMatchObject({ destination: "INVENTORY_PURCHASE", classifiedBy: userId });
    expect(rows.find(row => row.id === sinIndicioId)?.destination).toBe("UNCLASSIFIED");
    expect(rows.find(row => row.id === otraEmpresaId)?.destination).toBe("UNCLASSIFIED");
  });

  it("la clasificación no altera la elegibilidad de compra ni crea gastos", async () => {
    const reporte = await getInvoiceClassificationReport(companyId);
    expect(reporte.balanceImpact).toMatchObject({ deltaCents: 0, affectedInvoices: 0 });
    const antes = await connection.select().from(schema.operatingExpenses);
    await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    // Las dos facturas siguen siendo deuda de compra por CFDI (la del gasto ya
    // no lo era por su gasto; la de OC lo era y lo sigue siendo).
    const elegibles = await pg.query<{ count: number }>(
      `select count(*)::integer as count from invoices
        where company_id=$1 and payment_status='PENDING' and destination in ('UNCLASSIFIED','INVENTORY_PURCHASE')
          and not exists (select 1 from operating_expenses e where e.invoice_id=invoices.id)`,
      [companyId],
    );
    expect(elegibles.rows[0].count).toBe(2);
    expect((await connection.select().from(schema.operatingExpenses)).length).toBe(antes.length);
  });

  it("una segunda corrida no escribe nada y rechaza a un actor de otra empresa", async () => {
    const primera = await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    expect(primera.applied.count).toBe(2);
    const instantanea = await connection.select().from(schema.invoices);

    const segunda = await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    expect(segunda.proposals.count).toBe(0);
    expect(segunda.applied).toEqual({ count: 0, skipped: 0 });
    expect(await connection.select().from(schema.invoices)).toEqual(instantanea);

    await expect(backfillInvoiceClassification(companyId, {
      actorId: id(41), reason: "Actor de otra empresa", dryRun: false, limit: 0,
    })).rejects.toThrow(/actor/);
  });
});
