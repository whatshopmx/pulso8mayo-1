import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { POST } from "@/app/api/finance/expense-invoices/confirm/route";
import { GET as getXml } from "@/app/api/finance/expense-invoices/[id]/xml/route";
import { confirmOperatingCfdi } from "@/lib/services/operating-cfdi-confirm";
import { createCfdiFixture, cfdiId as id, fixtureXml as xml } from "../support/operating-cfdi-fixture";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn(), select: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: { sendBatchNotifications: vi.fn() } }));
vi.mock("@/lib/services/domain-event-service", () => ({ emitDomainEvent: vi.fn() }));
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: async () => ({
  managerAuthLimitCents: 200000, doubleApprovalThresholdCents: 1000000, managerAutonomy: "MEDIA" }) }));
const companyId = id(1), branchId = id(2), payeeId = id(3), actorId = "actor";
const actor = { companyId, userId: actorId, role: "ADMIN" as const };
const input = () => ({ mode: "CREATE" as const, branchId, payeeId, category: "SERVICIOS" as const, description: "Luz noviembre" });
let pg: PGlite, connection: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg, { schema }); await createCfdiFixture(sql => pg.exec(sql));
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate invoices,operating_expenses,payees,suppliers,companies,branches,cost_centers,expense_authorization_rules,branch_budgets,service_orders,purchase_orders,petty_cash_funds,petty_cash_transactions,payment_runs,payment_run_items,expense_payments,accounting_journals,accounting_purchase_facts,financial_periods,inventory_audit_log,users cascade");
  await connection.insert(schema.companies).values({ id: companyId, name: "Empresa", taxId: "BBB010101BBB" });
  await connection.insert(schema.users).values([{ id: actorId, companyId, email: "actor@fixture.invalid", role: "ADMIN", active: true, createdAt: new Date(), updatedAt: new Date() },
    { id: "approver", companyId, email: "approver@fixture.invalid", role: "ADMIN", active: true, createdAt: new Date(), updatedAt: new Date() }] as never);
  await connection.insert(schema.branches).values({ id: branchId, companyId, name: "Centro" });
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Servicios", taxId: "AAA010101AAA", active: true });
  vi.mocked(NotificationDispatcher.sendBatchNotifications).mockClear();
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: actorId, companyId, role: "ADMIN", branchId: null, email: "actor@fixture.invalid" } } as never);
});
const confirm = (overrides: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { ...input(), ...overrides };
  if (data.mode === "ASSOCIATE") { delete data.category; delete data.description; }
  return confirmOperatingCfdi(actor, xml, data);
};
async function manualExpense(overrides = {}) {
  const [expense] = await connection.insert(schema.operatingExpenses).values({ id: id(20), companyId, branchId,
    payeeId, category: "SERVICIOS", description: "Gasto previo", amount: 116001, status: "APPROVED",
    requestedBy: actorId, businessDate: "2026-11-01", ...overrides } as never).returning(); return expense;
}
async function legacyInvoice(overrides = {}) {
  const [invoice] = await connection.insert(schema.invoices).values({ companyId, branchId, uuid: "abcdef00-0000-4000-8000-000000000001",
    fecha: "2026-11-16T12:00:00", subtotal: 100001, taxAmount: 16000, total: 116001, rfcEmisor: "AAA010101AAA",
    rfcReceptor: "BBB010101BBB", xmlContent: xml, ...overrides } as never).returning(); return invoice;
}
describe("T07: confirmación atómica de CFDI operativo", () => {
  it("integra sesión, multipart, validación y commit desde el endpoint real", async () => {
    const form = new FormData(); form.set("file", new File([xml], "cfdi.xml", { type: "application/xml" }));
    form.set("data", JSON.stringify(input()));
    const response = await POST(new Request("http://localhost/api/finance/expense-invoices/confirm", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(body.data.outcome).toBe("CREATED");
    expect((await connection.select().from(schema.operatingExpenses))[0]).toMatchObject({ invoiceId: body.data.invoiceId, status: "PENDING_APPROVAL" });
    expect(await connection.select().from(schema.invoices)).toHaveLength(1);
  });
  it("crea una factura y un gasto pendiente sin proveedor, inventario, póliza ni pago", async () => {
    const result = await confirm(); expect(result.outcome).toBe("CREATED");
    expect((await connection.select().from(schema.invoices))[0]).toMatchObject({ destination: "OPERATING_EXPENSE",
      payeeId, supplierId: null, purchaseOrderId: null, receivingReportId: null, taxAmount: 16000, total: 116001, xmlContent: xml });
    expect((await connection.select().from(schema.operatingExpenses))[0]).toMatchObject({ id: result.expenseId,
      invoiceId: result.invoiceId, status: "PENDING_APPROVAL", amount: 116001, taxAmount: 16000 });
    expect(await connection.select().from(schema.suppliers)).toHaveLength(0);
    expect(await connection.select().from(schema.accountingJournals)).toHaveLength(0);
    expect(await connection.select().from(schema.expensePayments)).toHaveLength(0);
    expect(NotificationDispatcher.sendBatchNotifications).toHaveBeenCalledOnce();
  });
  it("reintentar devuelve el documento accesible sin otro gasto ni aviso", async () => {
    const first = await confirm(), again = await confirm();
    expect(again).toMatchObject({ invoiceId: first.invoiceId, expenseId: first.expenseId, outcome: "EXISTING" });
    expect(await connection.select().from(schema.invoices)).toHaveLength(1);
    expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(1);
    expect(NotificationDispatcher.sendBatchNotifications).toHaveBeenCalledOnce();
  });
  it("asocia un gasto previo sin cambiar su total/estado ni duplicarlo", async () => {
    await manualExpense(); const result = await confirm({ mode: "ASSOCIATE", expenseId: id(20) });
    expect(result.outcome).toBe("ASSOCIATED");
    expect((await connection.select().from(schema.operatingExpenses))[0]).toMatchObject({ id: id(20), amount: 116001,
      status: "APPROVED", taxAmount: 16000, invoiceId: result.invoiceId, businessDate: "2026-11-01" });
    expect(NotificationDispatcher.sendBatchNotifications).not.toHaveBeenCalled();
  });
  it.each([{ amount: 116002 }, { taxAmount: 100 }, { payeeId: id(99) }, { status: "PAID" }])("rechaza gasto previo incompatible %j y revierte factura", async values => {
    await manualExpense(values);
    await expect(confirm({ mode: "ASSOCIATE", expenseId: id(20) })).rejects.toThrow();
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
    expect((await connection.select().from(schema.operatingExpenses))[0].invoiceId).toBeNull();
  });
  it("un error al escribir auditoría revierte factura y gasto", async () => {
    await pg.exec("create function fail_cfdi_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure'; end$$; create trigger fail_audit before insert on inventory_audit_log for each row execute function fail_cfdi_audit()");
    try { await expect(confirm()).rejects.toThrow(); }
    finally { await pg.exec("drop trigger fail_audit on inventory_audit_log; drop function fail_cfdi_audit()"); }
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
    expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(0);
    expect(NotificationDispatcher.sendBatchNotifications).not.toHaveBeenCalled();
  });
  it.each(["tax_id='CCC010101CCC'", "active=false"])("rechaza contraparte incompatible %s", async change => {
    await pg.exec(`update payees set ${change}`); await expect(confirm()).rejects.toThrow();
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it("rechaza periodo cerrado sin registros", async () => {
    await connection.insert(schema.financialPeriods).values({ companyId, year: 2026, month: 11, status: "CLOSED" } as never);
    await expect(confirm()).rejects.toThrow(/cerrado|CERRADO/);
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it("no confía en importes ni metadata fiscal enviados por el cliente", async () => {
    await expect(confirm({ totalCents: 1, taxCents: 0 })).rejects.toThrow();
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it("rechaza receptor ajeno y permisos de sucursal antes de capturar", async () => {
    await expect(confirmOperatingCfdi(actor, xml.replace("BBB010101BBB", "CCC010101CCC"), input())).rejects.toThrow(/receptor/);
    await expect(confirmOperatingCfdi({ ...actor, role: "GERENTE", assignedBranchId: id(99) }, xml, input())).rejects.toThrow();
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it("reutiliza UUID histórico en minúsculas sin proveedor ni contraparte previa", async () => {
    const invoice = await legacyInvoice(); const result = await confirm();
    expect(result.invoiceId).toBe(invoice.id); expect(await connection.select().from(schema.invoices)).toHaveLength(1);
    expect((await connection.select().from(schema.invoices))[0]).toMatchObject({ uuid: invoice.uuid, payeeId, destination: "OPERATING_EXPENSE", xmlContent: xml });
  });
  it.each([{ paymentStatus: "PAID" }, { satStatus: "CANCELADO" }, { purchaseOrderId: id(50) },
    { recurringContractId: id(51) }, { serviceOrderId: id(52) }])("no reutiliza documento con origen/estado incompatible %j", async state => {
    const before = await legacyInvoice(state); await expect(confirm()).rejects.toThrow();
    expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(0);
    expect((await connection.select().from(schema.invoices))[0]).toEqual(before);
  });
  it("no revela duplicado de otra empresa y revierte cualquier escritura propia", async () => {
    await connection.insert(schema.companies).values({ id: id(90), name: "Ajena", taxId: "CCC010101CCC" });
    await legacyInvoice({ companyId: id(90), branchId: null, rfcReceptor: "CCC010101CCC" });
    try { await confirm(); throw new Error("Se aceptó el duplicado"); } catch (error) {
      expect(error).toMatchObject({ statusCode: 409 });
      expect(String(error)).not.toContain(id(90)); expect(String(error)).not.toContain("ABCDEF00");
    }
    expect(await connection.select().from(schema.invoices)).toHaveLength(1);
    expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(0);
  });
  it("revalida la pertenencia y rol actuales del actor", async () => {
    await pg.exec("update users set active=false where id='actor'"); await expect(confirm()).rejects.toThrow(/sesión/);
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it("no confirma si falta el índice fiscal requerido", async () => {
    await pg.exec("drop index invoices_uuid_casefold_unique");
    try { await expect(confirm()).rejects.toThrow(/migración/); }
    finally { await pg.exec("create unique index invoices_uuid_casefold_unique on invoices(upper(uuid))"); }
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it("conserva guardas de pólizas previas del gasto", async () => {
    await manualExpense();
    await connection.insert(schema.accountingJournals).values({ companyId, accountingDate: "2026-11-01", description: "Gasto previo",
      sourceType: "OPERATING_EXPENSE", sourceId: id(20), eventType: "EXPENSE_RECOGNIZED", sourceVersion: 1, createdBy: actorId, updatedBy: actorId } as never);
    await expect(confirm({ mode: "ASSOCIATE", expenseId: id(20) })).rejects.toThrow(/pólizas/);
    expect(await connection.select().from(schema.invoices)).toHaveLength(0);
  });
  it.each([{ xmlContent: "<invalid/>" }, { fecha: "2026-11-15T12:00:00" }])("no reclasifica un histórico cuya evidencia fiscal es incompatible %j", async fields => {
    const before = await legacyInvoice(fields); await expect(confirm()).rejects.toThrow();
    expect((await connection.select().from(schema.invoices))[0]).toEqual(before);
    expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(0);
  });
});

describe("T09: consulta autorizada del XML del gasto", () => {
  const download = (invoiceId: string) => getXml(new Request("http://localhost/api/finance/expense-invoices/xml"), { params: Promise.resolve({ id: invoiceId }) });
  it("descarga el XML original como adjunto y conserva lectura tras el pago", async () => {
    const result = await confirm();
    await pg.exec("update operating_expenses set status='PAID'");
    const response = await download(result.invoiceId);
    expect(response.status).toBe(200); expect(await response.text()).toBe(xml);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it.each([
    { companyId: id(90), role: "ADMIN", branchId: null },
    { companyId, role: "GERENTE", branchId: id(91) },
  ])("oculta XML de otra empresa o sucursal %j", async scope => {
    const result = await confirm();
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: actorId, ...scope } } as never);
    const response = await download(result.invoiceId);
    expect(response.status).toBe(404); expect(await response.text()).not.toContain("AAA010101AAA");
  });
  it("sin sesión o sin rol de Finanzas no entrega el XML", async () => {
    const result = await confirm();
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    expect((await download(result.invoiceId)).status).toBe(401);
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: actorId, companyId, role: "EMPLEADO" } } as never);
    expect((await download(result.invoiceId)).status).toBe(403);
  });
  it("no sirve una factura sin gasto asociado ni un identificador inválido", async () => {
    const invoice = await legacyInvoice();
    expect((await download(invoice.id)).status).toBe(404);
    expect((await download("invalid")).status).toBe(400);
  });
  it("explica ausencia de XML sin sustituir el comprobante", async () => {
    const result = await confirm();
    await pg.exec("update invoices set xml_content=null");
    expect((await download(result.invoiceId)).status).toBe(404);
    expect((await connection.select().from(schema.operatingExpenses))[0].invoiceId).toBe(result.invoiceId);
  });
});
