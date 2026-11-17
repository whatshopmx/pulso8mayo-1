import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { GET } from "@/app/api/inventory/invoices/route";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/services/invoice-matching-service", () => ({ InvoiceMatchingService: { getInvoiceDetail: vi.fn() } }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), foreignCompanyId = id(2), branchId = id(3), supplierId = id(4);
const purchaseId = id(10), unclassifiedId = id(11), operatingId = id(12), foreignId = id(13);
const tables = [schema.invoices, schema.suppliers, schema.purchaseOrders];

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
  }
  await pg.exec("alter table invoices alter column destination set default 'UNCLASSIFIED'");
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.mocked(getSession).mockResolvedValue({ user: { id: "actor", companyId, role: "ADMIN", branchId: null } } as never);
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Proveedor" } as never);
  await connection.insert(schema.invoices).values([
    { id: purchaseId, companyId, branchId, supplierId, destination: "INVENTORY_PURCHASE", uuid: "UUID-COMPRA",
      fecha: "2026-11-01", subtotal: 100000, total: 116000, rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    { id: unclassifiedId, companyId, branchId, supplierId, destination: "UNCLASSIFIED", uuid: "UUID-SIN-CLASIFICAR",
      fecha: "2026-11-02", subtotal: 50000, total: 58000, rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    { id: operatingId, companyId, branchId, supplierId, destination: "OPERATING_EXPENSE", uuid: "UUID-GASTO",
      fecha: "2026-11-03", subtotal: 20000, total: 23200, rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    { id: foreignId, companyId: foreignCompanyId, branchId, destination: "INVENTORY_PURCHASE", uuid: "UUID-AJENA",
      fecha: "2026-11-04", subtotal: 90000, total: 104400, rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
  ] as never);
});

async function list(query = "") {
  const response = await GET(new Request(`http://localhost/api/inventory/invoices${query}`));
  return { status: response.status, body: await response.json() };
}

describe("T11b: la lista de Inventario separa destinos y conserva históricos", () => {
  it("muestra compras y documentos por clasificar y deja los gastos operativos fuera", async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.invoices.map((invoice: { id: string }) => invoice.id)).toEqual([unclassifiedId, purchaseId]);
    expect(body.invoices.find((invoice: { id: string }) => invoice.id === purchaseId))
      .toMatchObject({ destination: "INVENTORY_PURCHASE", supplierName: "Proveedor" });
  });

  it("filtra por cada destino bajo pedido explícito", async () => {
    expect((await list("?destination=OPERATING_EXPENSE")).body.invoices.map((i: { id: string }) => i.id)).toEqual([operatingId]);
    expect((await list("?destination=UNCLASSIFIED")).body.invoices.map((i: { id: string }) => i.id)).toEqual([unclassifiedId]);
    expect((await list("?destination=INVENTORY_PURCHASE")).body.invoices.map((i: { id: string }) => i.id)).toEqual([purchaseId]);
    expect((await list("?destination=ALL")).body.invoices.map((i: { id: string }) => i.id))
      .toEqual([operatingId, unclassifiedId, purchaseId]);
  });

  it("rechaza un destino desconocido sin devolver documentos", async () => {
    const { status, body } = await list("?destination=TRAMPA");
    expect(status).toBe(400);
    expect(body.invoices).toBeUndefined();
  });

  it("separa un emisor que vende insumos y presta servicios", async () => {
    // Mismo proveedor y mismo RFC en las tres filas: el destino, no el emisor,
    // decide si el documento pertenece a Inventario.
    const { body } = await list();
    expect(body.invoices.map((invoice: { id: string }) => invoice.id)).not.toContain(operatingId);
    const servicios = await list("?destination=OPERATING_EXPENSE");
    expect(servicios.body.invoices.map((invoice: { id: string }) => invoice.id)).toEqual([operatingId]);
    expect(servicios.body.invoices[0]).toMatchObject({ supplierName: "Proveedor" });
  });

  it("no publica documentos de otra empresa en ningún filtro", async () => {
    for (const query of ["", "?destination=ALL", "?destination=INVENTORY_PURCHASE", "?destination=OPERATING_EXPENSE"]) {
      const { body } = await list(query);
      expect(body.invoices.map((invoice: { id: string }) => invoice.id)).not.toContain(foreignId);
    }
  });
});
