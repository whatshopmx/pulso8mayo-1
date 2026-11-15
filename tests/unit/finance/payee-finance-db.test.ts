import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { associatePayeeInvoice, getPayeeFinance } from "@/lib/services/payee-finance-service";
import { getAccountsPayable } from "@/lib/services/accounts-payable-service";
import { mirrorExpenseInvoicePaid, serviceInvoiceBlocker } from "@/lib/services/expense-invoice-evidence";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/db/tenant-context", () => ({
  withCompanyContext: (_ctx: unknown, work: Parameters<typeof db.transaction>[0]) => db.transaction(work),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), payeeId = id(2), branchId = id(3), supplierId = id(4), invoiceId = id(5), expenseId = id(6);
const tables = [schema.payees, schema.suppliers, schema.branches, schema.invoices, schema.operatingExpenses,
  schema.recurringPayables, schema.supplierBankAccounts, schema.payeeBankAccounts, schema.paymentRuns,
  schema.paymentRunItems, schema.expensePayments, schema.accountingJournals, schema.financialPeriods, schema.inventoryAuditLog, schema.accountingPurchaseFacts, schema.accountingEvents];
let pg: PGlite;
let connection: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg);
  // SQL real con las columnas del esquema de producción. Se omiten únicamente
  // FKs/defaults: la prueba ejercita las consultas, joins, locks y rollback.
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(c => {
      const raw = c.getSQLType();
      const type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      return `"${c.name}" ${type}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(", ")})`);
  }
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

describe("ficha financiera con SQL real", () => {
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
});
