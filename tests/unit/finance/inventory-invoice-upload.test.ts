import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { POST } from "@/app/api/inventory/invoices/upload/route";

const associateCalls = vi.hoisted(() => [] as Array<{ invoiceId: string; receivingReportId: string; purchaseOrderId: string | null }>);
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/services/invoice-matching-service", () => ({
  InvoiceMatchingService: {
    associateToReceiving: vi.fn(async (invoiceId: string, receivingReportId: string, purchaseOrderId: string | null) => {
      associateCalls.push({ invoiceId, receivingReportId, purchaseOrderId });
      return { matchDetails: { isPerfectMatch: true } };
    }),
  },
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), foreignCompanyId = id(2), branchId = id(3), supplierId = id(4), itemId = id(5);
const poUniqueId = id(6), poFirstId = id(7), poSecondId = id(8), receivingId = id(9);
const tables = [schema.invoices, schema.invoiceLines, schema.suppliers, schema.inventoryItems,
  schema.purchaseOrders, schema.receivingReports, schema.recurringContracts, schema.serviceOrders];

const xml = (uuid: string, folio = "123") => `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="F" Folio="${folio}"
  Fecha="2026-11-10T10:00:00" SubTotal="1000.00" Total="1160.00" Moneda="MXN">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Harina del Centro"/>
  <cfdi:Receptor Rfc="BBB010101BBB" Nombre="Empresa"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="24121021" NoIdentificacion="HAR-001" Cantidad="10"
    ClaveUnidad="H87" Descripcion="Harina" ValorUnitario="100.00" Importe="1000.00"/></cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-11-10T10:05:00"/></cfdi:Complemento>
</cfdi:Comprobante>`;

let pg: PGlite;
let connection: ReturnType<typeof drizzle>;

function upload(options: { text?: string; destination?: string | null; purchaseOrderId?: string; branch?: string } = {}) {
  const form = new FormData();
  form.set("file", new File([options.text ?? xml("UUID-DE-PRUEBA-1")], "cfdi.xml", { type: "application/xml" }));
  form.set("branchId", options.branch ?? branchId);
  if (options.destination !== null) form.set("destination", options.destination ?? "INVENTORY_PURCHASE");
  if (options.purchaseOrderId) form.set("purchaseOrderId", options.purchaseOrderId);
  return new Request("http://localhost/api/inventory/invoices/upload", { method: "POST", body: form });
}

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
    // Defaults reales del modelo: sin ellos el identificador y las fechas
    // quedarían nulos y la aserción no distinguiría un default de un hueco.
    await pg.exec(`alter table "${config.name}" alter column "id" set default gen_random_uuid()`);
    await pg.exec(`alter table "${config.name}" alter column "created_at" set default now()`);
  }
  await pg.exec("alter table invoices alter column destination set default 'UNCLASSIFIED'");
  await pg.exec(`alter table invoices alter column "payment_status" set default 'PENDING'`);
  await pg.exec(`alter table invoices alter column currency set default 'MXN'`);
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  associateCalls.length = 0;
  vi.mocked(getSession).mockResolvedValue({ user: { id: "actor", companyId, role: "ADMIN", branchId: null } } as never);
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Harina del Centro", taxId: "AAA010101AAA" } as never);
  await connection.insert(schema.inventoryItems).values({ id: itemId, companyId, name: "Harina", sku: "HAR-001" } as never);
});

describe("T11a: la captura de inventario es de compras y no toma la OC por ambigüedad", () => {
  it("exige el destino de compra y no escribe sin él", async () => {
    for (const destination of [null, "OPERATING_EXPENSE", "UNCLASSIFIED", ""]) {
      const response = await POST(upload({ destination }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Finanzas/);
    }
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });

  it("registra el CFDI como compra de inventario con su línea y sin efectos de servicio", async () => {
    const response = await POST(upload());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, destination: "INVENTORY_PURCHASE", purchaseOrderMatch: "NONE" });
    const [invoice] = await connection.select().from(schema.invoices);
    expect(invoice).toMatchObject({ destination: "INVENTORY_PURCHASE", supplierId, branchId, total: 116000, subtotal: 100000 });
    expect(invoice.payeeId).toBeNull();
    const lines = await connection.select().from(schema.invoiceLines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ invoiceId: invoice.id, itemId });
  });

  it("rechaza un CFDI ya registrado como gasto operativo y remite a Finanzas", async () => {
    await connection.insert(schema.invoices).values({ id: id(30), companyId, branchId, payeeId: id(31),
      destination: "OPERATING_EXPENSE", currency: "MXN", uuid: "UUID-DE-PRUEBA-1", fecha: "2026-11-10",
      subtotal: 100000, total: 116000, rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" } as never);
    const response = await POST(upload());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/gasto operativo/);
    expect(await connection.select().from(schema.invoices)).toHaveLength(1);
  });

  it("rechaza un CFDI de otra empresa sin revelar su UUID", async () => {
    await connection.insert(schema.invoices).values({ id: id(32), companyId: foreignCompanyId, branchId,
      destination: "INVENTORY_PURCHASE", uuid: "UUID-DE-PRUEBA-1", fecha: "2026-11-10", subtotal: 100000,
      total: 116000, rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" } as never);
    const response = await POST(upload());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/otra empresa/);
    expect(JSON.stringify(body)).not.toContain("UUID-DE-PRUEBA-1");
  });

  it("detecta el duplicado del mismo CFDI sin distinguir mayúsculas", async () => {
    await connection.insert(schema.invoices).values({ id: id(33), companyId, branchId, destination: "INVENTORY_PURCHASE",
      uuid: "uuid-de-prueba-1", fecha: "2026-11-10", subtotal: 100000, total: 116000,
      rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" } as never);
    const response = await POST(upload());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/ya fue registrada/);
    expect(await connection.select().from(schema.invoices)).toHaveLength(1);
  });

  it("vincula la OC solo cuando es inequívoca o el usuario la confirma", async () => {
    await connection.insert(schema.purchaseOrders).values([
      { id: poUniqueId, companyId, supplierId, poNumber: "OC-1", status: "APPROVED", totalAmount: 116000 } as never,
    ]);
    let response = await POST(upload({ text: xml("UUID-UNICA") }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchaseOrderMatch: "UNIQUE", purchaseOrderId: poUniqueId });
    expect((await connection.select().from(schema.invoices)).at(-1)).toMatchObject({ purchaseOrderId: poUniqueId });

    await connection.insert(schema.purchaseOrders).values([
      { id: poFirstId, companyId, supplierId, poNumber: "OC-2", status: "APPROVED", totalAmount: 116000 } as never,
      { id: poSecondId, companyId, supplierId, poNumber: "OC-3", status: "SENT", totalAmount: 50000 } as never,
    ]);
    response = await POST(upload({ text: xml("UUID-AMBIGUA") }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchaseOrderMatch: "AMBIGUOUS", purchaseOrderId: null });
    expect((await connection.select().from(schema.invoices)).at(-1)).toMatchObject({ purchaseOrderId: null });

    response = await POST(upload({ text: xml("UUID-CONFIRMADA"), purchaseOrderId: poSecondId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchaseOrderMatch: "CONFIRMED", purchaseOrderId: poSecondId });
    expect((await connection.select().from(schema.invoices)).at(-1)).toMatchObject({ purchaseOrderId: poSecondId });
  });

  it("rechaza confirmar una OC que no es del proveedor o no está abierta", async () => {
    await connection.insert(schema.purchaseOrders).values([
      { id: poFirstId, companyId, supplierId, poNumber: "OC-2", status: "APPROVED", totalAmount: 116000 } as never,
      { id: poSecondId, companyId, supplierId, poNumber: "OC-3", status: "SENT", totalAmount: 50000 } as never,
      { id: id(40), companyId, supplierId: id(41), poNumber: "OC-4", status: "APPROVED", totalAmount: 116000 } as never,
      { id: id(42), companyId, supplierId, poNumber: "OC-5", status: "COMPLETED", totalAmount: 116000 } as never,
    ]);
    const ajena = await POST(upload({ text: xml("UUID-OC-AJENA"), purchaseOrderId: id(40) }));
    expect(ajena.status).toBe(400);
    expect((await ajena.json()).error).toMatch(/no está disponible/);
    const cerrada = await POST(upload({ text: xml("UUID-OC-CERRADA"), purchaseOrderId: id(42) }));
    expect(cerrada.status).toBe(400);
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });

  it("conserva la conciliación con recepción de una compra y su orden elegida", async () => {
    await connection.insert(schema.purchaseOrders).values([
      { id: poUniqueId, companyId, supplierId, poNumber: "OC-1", status: "APPROVED", totalAmount: 116000 } as never,
    ]);
    await connection.insert(schema.receivingReports).values({ id: receivingId, companyId, supplierId,
      invoiceNumber: "F-123", receivedAt: new Date("2026-11-09") } as never);
    const response = await POST(upload());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ autoMatch: { receivingReportId: receivingId, matched: true } });
    expect(associateCalls).toHaveLength(1);
    expect(associateCalls[0]).toMatchObject({ receivingReportId: receivingId, purchaseOrderId: poUniqueId });
  });

  it("no vincula recepción ni orden de un emisor distinto al del CFDI", async () => {
    await connection.insert(schema.purchaseOrders).values([
      { id: poUniqueId, companyId, supplierId: id(41), poNumber: "OC-1", status: "APPROVED", totalAmount: 116000 } as never,
    ]);
    await connection.insert(schema.receivingReports).values({ id: receivingId, companyId, supplierId: id(41),
      invoiceNumber: "F-123", receivedAt: new Date("2026-11-09") } as never);
    const response = await POST(upload());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchaseOrderMatch: "NONE", autoMatch: null });
    expect(associateCalls).toHaveLength(0);
  });
});
