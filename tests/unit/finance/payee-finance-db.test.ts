import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { associatePayeeInvoice, getPayeeFinance, getPayeeInvoiceCandidates } from "@/lib/services/payee-finance-service";
import { getAccountsPayable } from "@/lib/services/accounts-payable-service";
import { getCashFlowProjection } from "@/lib/services/cash-flow-service";
import { mirrorExpenseInvoicePaid, serviceInvoiceBlocker } from "@/lib/services/expense-invoice-evidence";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/db/tenant-context", () => ({
  withCompanyContext: (_ctx: unknown, work: Parameters<typeof db.transaction>[0]) => db.transaction(work),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), payeeId = id(2), branchId = id(3), supplierId = id(4), invoiceId = id(5), expenseId = id(6);
const tables = [schema.payees, schema.suppliers, schema.branches, schema.invoices, schema.operatingExpenses,
  schema.recurringPayables, schema.supplierBankAccounts, schema.payeeBankAccounts, schema.paymentRuns,
  schema.paymentRunItems, schema.expensePayments, schema.accountingJournals, schema.financialPeriods, schema.inventoryAuditLog, schema.accountingPurchaseFacts, schema.accountingEvents,
  schema.cashFlowAssumptions, schema.dailySalesCuts, schema.purchaseOrders, schema.employeeContracts, schema.users];
let pg: PGlite;
let connection: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg);
  // SQL real con las columnas del esquema de producción. Se omiten únicamente
  // FKs/defaults generales: la prueba ejercita consultas, joins, locks y rollback.
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(c => {
      const raw = c.getSQLType();
      const type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      return `"${c.name}" ${type}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(", ")})`);
  }
  // T02 incorpora este default al migrar todos los históricos. Reproducirlo
  // en el harness para no confundir un NULL artificial con el esquema real.
  await pg.exec("alter table invoices alter column destination set default 'UNCLASSIFIED'");
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "CFE", active: true });
  await connection.insert(schema.branches).values({ id: branchId, companyId, name: "Centro" } as never);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "CFE proveedor", payeeId } as never);
  await connection.insert(schema.invoices).values({ id: invoiceId, companyId, branchId, supplierId,
    uuid: "UUID-CFE", fecha: "2026-11-01", total: 450000, paymentStatus: "PENDING", matchStatus: "MATCHED",
    dueDate: "2020-01-01", createdAt: new Date() } as never);
  await connection.insert(schema.operatingExpenses).values({ id: expenseId, companyId, branchId, payeeId,
    amount: 450000, status: "APPROVED", description: "Luz noviembre", businessDate: "2026-11-01", createdAt: new Date() } as never);
});

describe("T10: documentos por destino", () => {
  async function mixed() {
    await connection.insert(schema.invoices).values([
      { id: id(20), companyId, branchId, payeeId, supplierId: null, destination: "OPERATING_EXPENSE", currency: "MXN",
        uuid: "OPERATING-20", fecha: "2026-11-02", total: 450000, paymentStatus: "PAID", createdAt: new Date("2026-11-02") },
      { id: id(21), companyId, branchId, supplierId, destination: "INVENTORY_PURCHASE", currency: "MXN",
        uuid: "PURCHASE-21", fecha: "2026-11-03", total: 200000, paymentStatus: "PENDING", purchaseOrderId: id(22), createdAt: new Date("2026-11-03") },
    ] as never);
    await pg.exec(`update operating_expenses set invoice_id='${id(20)}',status='PAID'`);
  }
  it("incluye comprobantes directos sin proveedor y no duplica la identidad histórica", async () => {
    await mixed();
    let result = await getPayeeFinance(companyId, payeeId, branchId);
    expect(result.documents).toHaveLength(3);
    expect(result.documents.find(row => row.id === id(20))).toMatchObject({ destination: "OPERATING_EXPENSE", expenseId, expenseCount: 1, requiresReview: false });
    expect(result.documents.find(row => row.id === id(21))).toMatchObject({ destination: "INVENTORY_PURCHASE", hasPurchaseOrder: true });
    await pg.exec(`update invoices set supplier_id='${supplierId}' where id='${id(20)}'`);
    result = await getPayeeFinance(companyId, payeeId, branchId);
    expect(new Set(result.documents.map(row => row.id)).size).toBe(3);
  });
  it.each(["OPERATING_EXPENSE", "INVENTORY_PURCHASE", "UNCLASSIFIED"] as const)("filtra %s sin cambiar saldos ni movimientos", async destination => {
    await mixed();
    const all = await getPayeeFinance(companyId, payeeId, branchId);
    const result = await getPayeeFinance(companyId, payeeId, branchId, 0, { destination });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].destination).toBe(destination);
    expect(result.payables.confirmedCents).toBe(all.payables.confirmedCents);
    expect(result.expenses).toEqual(all.expenses);
    expect(result.pendingApprovalCents).toBe(all.pendingApprovalCents);
  });
  it("conserva fechas inclusivas y paginación del destino filtrado", async () => {
    await mixed();
    await connection.insert(schema.invoices).values(Array.from({ length: 51 }, (_, n) => ({
      id: id(200 + n), companyId, branchId, payeeId, destination: "OPERATING_EXPENSE", currency: "MXN", uuid: `PAGE-${n}`,
      fecha: "2026-11-10", total: 100, paymentStatus: "PENDING", createdAt: new Date("2026-11-10"),
    })) as never);
    const filters = { destination: "OPERATING_EXPENSE" as const, from: "2026-11-10", to: "2026-11-10" };
    const first = await getPayeeFinance(companyId, payeeId, branchId, 0, filters);
    const second = await getPayeeFinance(companyId, payeeId, branchId, 1, filters);
    expect(first.documents).toHaveLength(50); expect(first.moreDocuments).toBe(true);
    expect(second.documents).toHaveLength(1); expect(second.moreDocuments).toBe(false);
    expect(new Set([...first.documents, ...second.documents].map(row => row.id)).size).toBe(51);
    expect(first.documents.every(row => row.date === "2026-11-10")).toBe(true);
  });
  it("no publica el id de un gasto de otra sucursal o contraparte", async () => {
    await mixed();
    await pg.exec(`update operating_expenses set branch_id='${id(90)}'`);
    let document = (await getPayeeFinance(companyId, payeeId, branchId)).documents.find(row => row.id === id(20));
    expect(document).toMatchObject({ expenseId: null, expenseCount: 0, requiresReview: true });
    await pg.exec(`update operating_expenses set branch_id='${branchId}',payee_id='${id(91)}'`);
    document = (await getPayeeFinance(companyId, payeeId, branchId)).documents.find(row => row.id === id(20));
    expect(document?.expenseId).toBeNull();
  });
  it("la identidad directa prevalece y oculta nombres de proveedor/sucursal ajenos", async () => {
    await mixed();
    await pg.exec(`update invoices set payee_id='${id(90)}' where id='${invoiceId}'`);
    expect((await getPayeeFinance(companyId, payeeId)).documents.map(row => row.id)).not.toContain(invoiceId);
    await pg.exec(`update invoices set supplier_id='${supplierId}' where id='${id(20)}'; update suppliers set company_id='${id(90)}',name='Nombre privado'; update branches set company_id='${id(90)}',name='Sucursal privada'`);
    const document = (await getPayeeFinance(companyId, payeeId)).documents.find(row => row.id === id(20));
    expect(document).toMatchObject({ supplierName: null, branchName: null, requiresReview: true });
    await expect(getPayeeFinance(id(90), payeeId)).rejects.toThrow(/no encontrada/);
  });
  it("señala vínculos múltiples/incompatibles sin reclasificar ni cambiar importes", async () => {
    await mixed();
    await connection.insert(schema.operatingExpenses).values({ id: id(30), companyId, branchId, payeeId, invoiceId: id(20), amount: 440000, status: "APPROVED", createdAt: new Date() } as never);
    const document = (await getPayeeFinance(companyId, payeeId)).documents.find(row => row.id === id(20));
    expect(document).toMatchObject({ expenseCount: 2, requiresReview: true, amountCents: 450000, destination: "OPERATING_EXPENSE" });
    expect((await connection.select().from(schema.invoices)).find(row => row.id === invoiceId)?.destination).toBe("UNCLASSIFIED");
  });
});

describe("T09: candidatos de comprobantes", () => {
  const candidates = () => getPayeeInvoiceCandidates(companyId, payeeId, expenseId, branchId);
  it("encuentra identidad directa sin proveedor y conserva la identidad histórica", async () => {
    expect((await candidates()).map(row => row.id)).toEqual([invoiceId]);
    await pg.exec(`update invoices set supplier_id=null,payee_id='${payeeId}'`);
    expect((await candidates()).map(row => row.id)).toEqual([invoiceId]);
  });
  it.each([
    "destination='INVENTORY_PURCHASE'", "currency='USD'", "sat_status='CANCELADO'", "payment_status='PAID'",
    `payee_id='${id(90)}'`, `recurring_contract_id='${id(91)}'`, `service_order_id='${id(92)}'`,
    `purchase_order_id='${id(93)}'`, `receiving_report_id='${id(94)}'`, "total=449999",
    `branch_id='${id(95)}'`, "destination='OPERATING_EXPENSE',currency=null",
  ])("no ofrece una factura incompatible: %s", async change => {
    await pg.exec(`update invoices set ${change}`);
    expect(await candidates()).toEqual([]);
  });
  it("no ofrece proveedor ajeno ni identidades contradictorias", async () => {
    await pg.exec(`update invoices set payee_id='${payeeId}'; update suppliers set company_id='${id(90)}'`);
    expect(await candidates()).toEqual([]);
  });
  it("un RFC contradictorio no aparece ni elude el POST directo", async () => {
    await pg.exec("update payees set tax_id='AAA010101AAA'; update invoices set rfc_emisor='CCC010101CCC'");
    expect(await candidates()).toEqual([]);
    await expect(associatePayeeInvoice({ companyId, payeeId, expenseId, invoiceId, actorId: "actor" })).rejects.toThrow(/RFC/);
  });
  it.each(["PAID", "REJECTED"])("explica gasto %s sin ofrecer documentos", async status => {
    await pg.exec(`update operating_expenses set status='${status}'`);
    await expect(candidates()).rejects.toThrow(/vigente/);
  });
  it("excluye facturas con hechos contables y periodos cerrados", async () => {
    await connection.insert(schema.accountingPurchaseFacts).values({ eventId: id(80), companyId, invoiceId } as never);
    expect(await candidates()).toEqual([]);
    await pg.exec("delete from accounting_purchase_facts");
    await connection.insert(schema.financialPeriods).values({ id: id(81), companyId, year: 2026, month: 11, status: "CLOSED" } as never);
    await expect(candidates()).rejects.toThrow(/periodo cerrado/);
  });
  it.each(["payment", "journal", "run"])("explica actividad previa del gasto: %s", async source => {
    if (source === "payment") await connection.insert(schema.expensePayments).values({ id: id(80), companyId, expenseId } as never);
    if (source === "journal") await connection.insert(schema.accountingJournals).values({ id: id(80), companyId, sourceType: "OPERATING_EXPENSE", sourceId: expenseId } as never);
    if (source === "run") {
      await connection.insert(schema.paymentRuns).values({ id: id(80), companyId, status: "DRAFT" } as never);
      await connection.insert(schema.paymentRunItems).values({ id: id(81), paymentRunId: id(80), referenceId: expenseId } as never);
    }
    await expect(candidates()).rejects.toThrow(/revisión/);
  });
  it.each(["journal", "run"])("no ofrece factura comprometida: %s", async source => {
    if (source === "journal") await connection.insert(schema.accountingJournals).values({ id: id(80), companyId, sourceType: "PURCHASE_INVOICE", sourceId: invoiceId } as never);
    else {
      await connection.insert(schema.paymentRuns).values({ id: id(80), companyId, status: "DRAFT" } as never);
      await connection.insert(schema.paymentRunItems).values({ id: id(81), paymentRunId: id(80), referenceId: invoiceId } as never);
    }
    expect(await candidates()).toEqual([]);
  });
  it("normaliza RFC equivalente y mantiene aislamiento de empresa/sucursal", async () => {
    await pg.exec("update payees set tax_id=' AAA010101AAA '; update invoices set rfc_emisor='aaa010101aaa'");
    expect((await candidates()).map(row => row.id)).toEqual([invoiceId]);
    await expect(getPayeeInvoiceCandidates(id(90), payeeId, expenseId)).rejects.toThrow(/no encontrado/);
    await expect(getPayeeInvoiceCandidates(companyId, payeeId, expenseId, id(91))).rejects.toThrow(/no encontrado/);
  });
});

describe("ficha financiera con SQL real", () => {
  const project = () => getCashFlowProjection(companyId, 30, branchId, { includeRecurringContracts: false });
  async function dueInWindow() {
    const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await pg.exec(`update invoices set due_date='${due}';
      update operating_expenses set due_date='${due}', category='SERVICIOS'`);
    return due;
  }
  it("filtra el historial por periodo sin ocultar la deuda vigente", async () => {
    const result = await getPayeeFinance(companyId, payeeId, branchId, 0, { from: "2026-12-01" });
    expect(result.expenses).toHaveLength(0);
    expect(result.documents).toHaveLength(0);
    expect(result.payables.confirmedCents).toBe(900000);
  });

  it("el saldo resta solo abonos confirmados", async () => {
    vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
    try {
      await connection.insert(schema.expensePayments).values([
        { id: id(70), companyId, expenseId, amountCents: 100000, status: "CONFIRMED" },
        { id: id(71), companyId, expenseId, amountCents: 50000, status: "FAILED" },
      ] as never);
      const result = await getAccountsPayable({ companyId, payeeId });
      expect(result.items.find(i => i.source === "OPERATING_EXPENSE")?.amountCents).toBe(350000);
    } finally { vi.unstubAllEnvs(); }
  });

  const associate = (overrides = {}) => associatePayeeInvoice({ companyId, payeeId, invoiceId, expenseId, actorId: "admin", ...overrides });

  it("asocia una factura, conserva el gasto y cuenta una sola obligación", async () => {
    await associate();
    const result = await getPayeeFinance(companyId, payeeId, branchId);
    expect(result.payables.confirmedCents).toBe(450000);
    expect(result.payables.itemsTotal).toBe(1);
    expect(result.payables.items[0].source).toBe("OPERATING_EXPENSE");
    expect(result.expenses[0].invoiceId).toBe(invoiceId);
    expect(result.documents[0].expenseId).toBe(expenseId);
    expect(result.expenses[0].status).toBe("APPROVED");
  });

  it("reintentar la asociación no crea otra deuda ni otro evento", async () => {
    await associate(); await associate();
    expect((await connection.select().from(schema.inventoryAuditLog))).toHaveLength(1);
  });

  it("conserva el bloqueo de aprobación al asociar un gasto pendiente", async () => {
    await pg.exec("update operating_expenses set status = 'PENDING_APPROVAL'");
    await associate();
    const result = await getAccountsPayable({ companyId, payeeId });
    expect(result.items).toHaveLength(0);
    expect((await getPayeeFinance(companyId, payeeId)).pendingApprovalCents).toBe(450000);
  });
  it("asocia evidencia con contraparte directa sin proveedor", async () => {
    await pg.exec(`update invoices set supplier_id=null,payee_id='${payeeId}',destination='OPERATING_EXPENSE',currency='MXN'`);
    await associate();
    expect((await connection.select().from(schema.operatingExpenses))[0].invoiceId).toBe(invoiceId);
  });
  it.each(["destination='INVENTORY_PURCHASE'", "currency='USD'", `payee_id='${id(90)}'`])("rechaza asociación incompatible %s", async change => {
    await pg.exec(`update invoices set ${change}`);
    await expect(associate()).rejects.toThrow();
    expect((await connection.select().from(schema.operatingExpenses))[0].invoiceId).toBeNull();
  });

  it.each([
    ["importe diferente", "update invoices set total = 440000"],
    ["sucursal diferente", `update invoices set branch_id = '${id(90)}'`],
    ["factura pagada", "update invoices set payment_status = 'PAID'"],
    ["proveedor sin vínculo", "update suppliers set payee_id = null"],
    ["gasto pagado", "update operating_expenses set status = 'PAID'"],
  ])("rechaza %s sin modificar la relación", async (_label, change) => {
    await pg.exec(change);
    await expect(associate()).rejects.toThrow();
    const [row] = await connection.select().from(schema.operatingExpenses);
    expect(row.invoiceId).toBeNull();
  });

  it("impide leer o asociar documentos de otro tenant o sucursal", async () => {
    await expect(getPayeeFinance(id(90), payeeId)).rejects.toThrow(/no encontrada/);
    await expect(associate({ companyId: id(90) })).rejects.toThrow(/alcance/);
    await expect(associate({ branchId: id(90) })).rejects.toThrow(/alcance/);
    expect((await getPayeeFinance(companyId, payeeId, id(90))).expenses).toHaveLength(0);
  });

  it("separa los estimados de los saldos documentados antes de limitar las filas", async () => {
    await associate();
    await connection.insert(schema.recurringPayables).values({ id: id(20), companyId, branchId, supplierId,
      label: "Próximo recibo", estimatedAmountCents: 100000, status: "OPEN", periodKey: "2026-12", dueDate: "2026-12-01" } as never);
    const result = await getAccountsPayable({ companyId, payeeId, itemsLimit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.itemsTotal).toBe(2);
    expect(result.confirmedCents).toBe(450000);
    expect(result.estimatedCents).toBe(100000);
  });

  it("impide asociar cuando hay una póliza o un pago previo del gasto", async () => {
    await connection.insert(schema.accountingJournals).values({ id: id(30), companyId,
      sourceType: "OPERATING_EXPENSE", sourceId: expenseId } as never);
    await expect(associate()).rejects.toThrow(/pólizas/);
  });

  it("el historial incluye facturas pagadas que ya no aparecen en pendientes", async () => {
    await pg.exec("update invoices set payment_status = 'PAID'");
    const result = await getPayeeFinance(companyId, payeeId);
    expect(result.documents[0].status).toBe("PAID");
    expect(result.payables.items.every(i => i.source !== "INVOICE")).toBe(true);
  });

  it("no salda la factura hasta que el gasto quede pagado completo", async () => {
    await associate();
    await mirrorExpenseInvoicePaid(connection as never, companyId, "admin", [expenseId]);
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PENDING");
    await pg.exec("update operating_expenses set status = 'PAID'");
    await mirrorExpenseInvoicePaid(connection as never, companyId, "admin", [expenseId]);
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PAID");
  });

  it("permite respaldar un servicio pero impide pagar con factura cancelada", async () => {
    await associate();
    const [expense] = await connection.select().from(schema.operatingExpenses);
    expect(await serviceInvoiceBlocker(connection as never, companyId, expense)).toBeNull();
    await pg.exec("update invoices set payment_status = 'CANCELLED'");
    expect(await serviceInvoiceBlocker(connection as never, companyId, expense)).toMatch(/cancelada/);
  });

  it("no mezcla las facturas de mercancía con gastos operativos", async () => {
    await pg.exec(`update invoices set receiving_report_id = '${id(95)}'`);
    await expect(associate()).rejects.toThrow(/inventario/);
  });

  // F0/T01: caracterización previa a introducir el destino explícito.
  it("el mismo emisor conserva harina como compra y electricidad como gasto", async () => {
    await associate();
    await connection.insert(schema.invoices).values({ id: id(100), companyId, branchId, supplierId,
      uuid: "UUID-HARINA", fecha: "2026-11-01", total: 116001, paymentStatus: "PENDING",
      matchStatus: "MATCHED", purchaseOrderId: id(101), createdAt: new Date() } as never);
    const result = await getAccountsPayable({ companyId, payeeId });
    expect(result.confirmedCents).toBe(566001);
    expect(result.items.map(i => [i.source, i.amountCents])).toEqual(expect.arrayContaining([
      ["INVOICE", 116001], ["OPERATING_EXPENSE", 450000],
    ]));
    expect(result.itemsTotal).toBe(2);
  });

  it("caracteriza que una factura sin proveedor sigue en CxP global pero no en la ficha", async () => {
    await pg.exec("update invoices set supplier_id = null");
    expect((await getAccountsPayable({ companyId })).confirmedCents).toBe(900000);
    const ficha = await getPayeeFinance(companyId, payeeId);
    expect(ficha.documents).toHaveLength(0);
    expect(ficha.payables.confirmedCents).toBe(450000);
  });

  it("resta abonos confirmados de factura y gasto sin perder centavos ni duplicar fuentes", async () => {
    await associate();
    await connection.insert(schema.invoices).values({ id: id(100), companyId, branchId, supplierId,
      uuid: "UUID-COMPRA", fecha: "2026-11-01", total: 116001, paymentStatus: "PENDING",
      matchStatus: "MATCHED", createdAt: new Date() } as never);
    await connection.insert(schema.paymentRuns).values({ id: id(101), companyId, status: "PROCESSING" } as never);
    await connection.insert(schema.paymentRunItems).values([
      { id: id(102), paymentRunId: id(101), itemType: "INVOICE", referenceId: id(100), amountCents: 16001, settlementStatus: "CONFIRMED" },
      { id: id(103), paymentRunId: id(101), itemType: "INVOICE", referenceId: id(100), amountCents: 20000, settlementStatus: "FAILED" },
    ] as never);
    await connection.insert(schema.expensePayments).values({ id: id(104), companyId, expenseId,
      amountCents: 100001, status: "CONFIRMED" } as never);
    vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
    try {
      const result = await getAccountsPayable({ companyId, payeeId });
      expect(result.confirmedCents).toBe(449999);
      expect(result.items.map(i => [i.source, i.amountCents])).toEqual(expect.arrayContaining([
        ["INVOICE", 100000], ["OPERATING_EXPENSE", 349999],
      ]));
      expect(result.itemsTotal).toBe(2);
      const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await pg.exec(`update invoices set due_date = '${due}';
        update operating_expenses set due_date = '${due}', category = 'SERVICIOS'`);
      const projection = await getCashFlowProjection(companyId, 30, branchId, { includeRecurringContracts: false });
      expect(projection.days.reduce((sum, day) => sum + day.projectedOutflowCents, 0)).toBe(result.confirmedCents);
      expect(projection.outflowItems).toHaveLength(2);
      expect(projection.procurementCommitments.invoicesTotalCents).toBe(100000);
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["PENDING_APPROVAL", "APPROVED"])("proyecta una sola salida del gasto %s respaldado por CFDI", async status => {
    await associate();
    // Fecha futura dentro de la ventana, independiente del reloj del runner.
    const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await pg.exec(`update invoices set due_date = '${due}';
      update operating_expenses set due_date = '${due}', status = '${status}', category = 'SERVICIOS'`);
    const projection = await getCashFlowProjection(companyId, 30, branchId, { includeRecurringContracts: false });
    expect(projection.outflowItems).toMatchObject([{ id: expenseId, source: "OPERATING_EXPENSE", amountCents: 450000 }]);
    expect(projection.outflowItems).toHaveLength(1);
    expect(projection.days.reduce((sum, day) => sum + day.projectedOutflowCents, 0)).toBe(450000);
    expect(projection.procurementCommitments.invoicesCount).toBe(0);
    expect((await getAccountsPayable({ companyId, payeeId })).confirmedCents).toBe(status === "APPROVED" ? 450000 : 0);
  });

  // T03: lecturas por destino; este harness comprueba las consultas incluso
  // ante relaciones incompletas. Las restricciones reales se prueban en T02.
  it("un CFDI operativo sin gasto no se convierte en compra ni se proyecta", async () => {
    await pg.exec(`delete from operating_expenses;
      update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', supplier_id=null`);
    await dueInWindow();
    const payable = await getAccountsPayable({ companyId });
    expect(payable.confirmedCents).toBe(0);
    expect(payable.items).toHaveLength(0);
    const projection = await project();
    expect(projection.outflowItems).toHaveLength(0);
    expect(projection.procurementCommitments.invoicesTotalCents).toBe(0);
  });

  it.each(["PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID"])(
    "el gasto %s es la única fuente del CFDI operativo sin proveedor", async status => {
      await pg.exec(`update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', supplier_id=null;
        update operating_expenses set invoice_id='${invoiceId}', status='${status}'`);
      await dueInWindow();
      const payable = await getAccountsPayable({ companyId, payeeId });
      expect(payable.confirmedCents).toBe(status === "APPROVED" ? 450000 : 0);
      expect(payable.items.every(item => item.source === "OPERATING_EXPENSE")).toBe(true);
      const projection = await project();
      const projected = ["PENDING_APPROVAL", "APPROVED"].includes(status);
      expect(projection.outflowItems).toHaveLength(projected ? 1 : 0);
      expect(projection.days.reduce((sum, day) => sum + day.projectedOutflowCents, 0)).toBe(projected ? 450000 : 0);
      expect(projection.procurementCommitments.invoicesCount).toBe(0);
    },
  );

  it("expone destino y elegibilidad histórica sin cambiar saldo ni canPay", async () => {
    await pg.exec("delete from operating_expenses");
    await connection.insert(schema.supplierBankAccounts).values({ id: id(300), companyId, supplierId,
      status: "VERIFIED", active: true } as never);
    const before = await getAccountsPayable({ companyId, payeeId });
    expect(before.items[0]).toMatchObject({ invoiceDestination: "UNCLASSIFIED", canPay: true, amountCents: 450000 });
    await pg.exec("update invoices set destination='INVENTORY_PURCHASE'");
    const after = await getAccountsPayable({ companyId, payeeId });
    expect(after.items[0]).toMatchObject({ invoiceDestination: "INVENTORY_PURCHASE", canPay: true, amountCents: 450000 });
    expect(after.confirmedCents).toBe(before.confirmedCents);
    expect(after.buckets).toEqual(before.buckets);
    expect(after.byCounterparty).toEqual(before.byCounterparty);
  });

  it("usa contraparte directa en CxP sin exigir el join de proveedor", async () => {
    await pg.exec(`delete from operating_expenses;
      update invoices set payee_id='${payeeId}', supplier_id=null`);
    const payable = await getAccountsPayable({ companyId, payeeId });
    expect(payable.confirmedCents).toBe(450000);
    expect(payable.items[0]).toMatchObject({ payeeId, counterparty: "CFE", canPay: false,
      blockedReason: "Factura sin proveedor asignado", invoiceDestination: "UNCLASSIFIED" });
    expect((await getAccountsPayable({ companyId: id(301), payeeId })).items).toHaveLength(0);
    expect((await getAccountsPayable({ companyId, payeeId, branchId: id(302) })).items).toHaveLength(0);
  });

  it("un emisor mixto suma compra y gasto en centavos, omitiendo el CFDI operativo huérfano", async () => {
    await pg.exec(`update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', supplier_id=null;
      update operating_expenses set invoice_id='${invoiceId}'`);
    await connection.insert(schema.invoices).values([
      { id: id(310), companyId, branchId, supplierId, uuid: "UUID-HARINA-T03", fecha: "2026-11-16",
        total: 116001, paymentStatus: "PENDING", destination: "INVENTORY_PURCHASE", matchStatus: "MATCHED" },
      { id: id(311), companyId, branchId, payeeId, uuid: "UUID-HUERFANA-T03", fecha: "2026-11-16",
        total: 99001, paymentStatus: "PENDING", destination: "OPERATING_EXPENSE" },
    ] as never);
    await connection.insert(schema.expensePayments).values({ id: id(312), companyId, expenseId,
      amountCents: 100001, status: "CONFIRMED" } as never);
    await dueInWindow();
    vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
    try {
      const payable = await getAccountsPayable({ companyId, payeeId });
      expect(payable.confirmedCents).toBe(466000);
      expect(payable.itemsTotal).toBe(2);
      const projection = await project();
      expect(projection.outflowItems).toHaveLength(2);
      expect(projection.days.reduce((sum, day) => sum + day.projectedOutflowCents, 0)).toBe(466000);
      expect(projection.procurementCommitments.invoicesTotalCents).toBe(116001);
      expect(projection.outflowItems.find(item => item.id === id(310)))
        .toMatchObject({ source: "PROCUREMENT_INVOICE", invoiceDestination: "INVENTORY_PURCHASE" });
    } finally { vi.unstubAllEnvs(); }
  });

  it("conserva proyección y fuentes de documentos históricos sin reclasificarlos", async () => {
    await dueInWindow();
    const before = await project();
    expect(before.outflowItems).toHaveLength(2);
    expect(before.outflowItems.find(item => item.id === invoiceId))
      .toMatchObject({ source: "PROCUREMENT_INVOICE", invoiceDestination: "UNCLASSIFIED" });
    expect(before.days.reduce((sum, day) => sum + day.projectedOutflowCents, 0)).toBe(900000);
    expect((await getAccountsPayable({ companyId })).confirmedCents).toBe(900000);
  });

  it.each(["2026-11", "2026-11-01"])("el CFDI operativo con gasto sustituye al estimado %s aunque el sync no haya corrido", async periodKey => {
    await pg.exec(`update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', recurring_contract_id='${id(320)}';
      update operating_expenses set invoice_id='${invoiceId}'`);
    await connection.insert(schema.recurringPayables).values([
      { id: id(321), companyId, branchId, supplierId, contractId: id(320), label: "Recibo noviembre",
        estimatedAmountCents: 400000, status: "OPEN", periodKey, dueDate: "2026-11-01" },
      { id: id(322), companyId, branchId, supplierId, contractId: id(320), label: "Recibo diciembre",
        estimatedAmountCents: 400000, status: "OPEN", periodKey: "2026-12", dueDate: "2026-12-01" },
    ] as never);
    const result = await getAccountsPayable({ companyId, payeeId });
    expect(result.confirmedCents).toBe(450000);
    expect(result.estimatedCents).toBe(400000);
    expect(result.items.map(item => item.id)).toEqual(expect.arrayContaining([expenseId, id(322)]));
    expect(result.items.some(item => item.id === id(321))).toBe(false);
  });

  it("el CFDI operativo huérfano no elimina una obligación recurrente estimada", async () => {
    await pg.exec(`delete from operating_expenses;
      update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', recurring_contract_id='${id(320)}'`);
    await connection.insert(schema.recurringPayables).values({ id: id(321), companyId, branchId, supplierId,
      contractId: id(320), label: "Recibo noviembre", estimatedAmountCents: 400000, status: "OPEN",
      periodKey: "2026-11", dueDate: "2026-11-01" } as never);
    const result = await getAccountsPayable({ companyId, payeeId });
    expect(result.confirmedCents).toBe(0);
    expect(result.estimatedCents).toBe(400000);
  });

  it.each(["UNCLASSIFIED", "INVENTORY_PURCHASE"])("%s conserva la exclusión de facturas pagadas o canceladas", async destination => {
    await pg.exec("delete from operating_expenses");
    await dueInWindow();
    for (const status of ["PENDING", "PAID", "CANCELLED"]) {
      await pg.exec(`update invoices set destination='${destination}', payment_status='${status}'`);
      const payable = await getAccountsPayable({ companyId });
      const projection = await project();
      expect(payable.confirmedCents).toBe(status === "PENDING" ? 450000 : 0);
      expect(projection.procurementCommitments.invoicesTotalCents).toBe(payable.confirmedCents);
      expect(projection.outflowItems).toHaveLength(status === "PENDING" ? 1 : 0);
    }
  });

  it.each([["0", 450000], ["1", 349999]] as const)("mantiene saldos con bandera contable %s", async (flag, expected) => {
    await pg.exec(`update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', supplier_id=null;
      update operating_expenses set invoice_id='${invoiceId}'`);
    await connection.insert(schema.expensePayments).values([
      { id: id(330), companyId, expenseId, amountCents: 100001, status: "CONFIRMED" },
      { id: id(331), companyId, expenseId, amountCents: 50000, status: "FAILED" },
    ] as never);
    await dueInWindow();
    vi.stubEnv("ACCOUNTING_POSTING_ENABLED", flag);
    try {
      expect((await getAccountsPayable({ companyId, payeeId })).confirmedCents).toBe(expected);
      expect((await project()).days.reduce((sum, day) => sum + day.projectedOutflowCents, 0)).toBe(expected);
    } finally { vi.unstubAllEnvs(); }
  });

  it("un vínculo de gasto de otra empresa no oculta una factura de compra propia", async () => {
    await pg.exec(`update operating_expenses set company_id='${id(340)}', invoice_id='${invoiceId}';
      update invoices set destination='INVENTORY_PURCHASE'`);
    await dueInWindow();
    const payable = await getAccountsPayable({ companyId });
    expect(payable.items).toHaveLength(1);
    expect(payable.confirmedCents).toBe(450000);
    expect((await project()).procurementCommitments.invoicesTotalCents).toBe(450000);
  });

  it.each(["sucursal", "importe", "contraparte"])("no suprime un estimado con %s incompatible", async conflict => {
    await pg.exec(`update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}', recurring_contract_id='${id(320)}';
      update operating_expenses set invoice_id='${invoiceId}'`);
    if (conflict === "importe") await pg.exec("update operating_expenses set amount=449999");
    if (conflict === "contraparte") await pg.exec(`update suppliers set payee_id='${id(346)}'`);
    await connection.insert(schema.recurringPayables).values({ id: id(321), companyId,
      branchId: conflict === "sucursal" ? id(347) : branchId, supplierId, contractId: id(320),
      label: "Recibo noviembre", estimatedAmountCents: 400000, status: "OPEN", periodKey: "2026-11", dueDate: "2026-11-01" } as never);
    expect((await getAccountsPayable({ companyId })).estimatedCents).toBe(400000);
  });

  it("conserva el saldo de un histórico mal vinculado sin revelar el proveedor de otra empresa", async () => {
    await pg.exec(`delete from operating_expenses;
      update suppliers set company_id='${id(348)}', name='Proveedor confidencial ajeno'`);
    await dueInWindow();
    const payable = await getAccountsPayable({ companyId });
    const projection = await project();
    expect(payable.confirmedCents).toBe(450000);
    expect(projection.procurementCommitments.invoicesTotalCents).toBe(450000);
    expect(JSON.stringify(payable)).not.toContain("Proveedor confidencial ajeno");
    expect(JSON.stringify(projection)).not.toContain("Proveedor confidencial ajeno");
  });
});
