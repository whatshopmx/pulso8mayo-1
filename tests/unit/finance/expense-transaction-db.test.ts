import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { createOperatingExpense, createOperatingExpenseIn, getOperatingExpenses } from "@/lib/services/expense-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: async () => ({
  managerAuthLimitCents: 200000, doubleApprovalThresholdCents: 1000000, managerAutonomy: "MEDIA" }) }));
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: { sendBatchNotifications: vi.fn() } }));
vi.mock("@/lib/services/domain-event-service", () => ({ emitDomainEvent: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), branchId = id(2), payeeId = id(3), costCenterId = id(4);
const tables = [schema.operatingExpenses, schema.payees, schema.branches, schema.costCenters, schema.financialPeriods,
  schema.expenseAuthorizationRules, schema.branchBudgets, schema.serviceOrders, schema.purchaseOrders,
  schema.pettyCashFunds, schema.pettyCashTransactions, schema.users];
let pg: PGlite, connection: ReturnType<typeof drizzle>;
beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg); const dialect = new PgDialect();
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(c => {
      const raw = c.getSQLType(), type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      const d = c.default, value = d instanceof SQL ? dialect.sqlToQuery(d).sql : typeof d === "string" ? `'${d.replaceAll("'", "''")}'` : String(d);
      return `"${c.name}" ${type}${d === undefined ? "" : ` default ${value}`}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(",")})`);
  }
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.insert).mockImplementation(connection.insert.bind(connection) as typeof db.insert);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.mocked(NotificationDispatcher.sendBatchNotifications).mockClear();
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Servicios" });
  await connection.insert(schema.branches).values({ id: branchId, companyId, name: "Centro" } as never);
  await connection.insert(schema.costCenters).values({ id: costCenterId, companyId, code: "SERV", name: "Servicios", active: true });
  await connection.insert(schema.users).values({ id: "approver", companyId, role: "ADMIN", active: true } as never);
});
const input = () => ({ companyId, branchId, payeeId, category: "SERVICIOS" as const,
  amountCents: 11600, taxCents: 1600, description: "Servicio", businessDate: "2026-11-16", requestedBy: "actor" });
it("T09 devuelve vínculo fiscal y RFC del mismo tenant para documentar desde Gastos", async () => {
  await pg.exec("update payees set tax_id='AAA010101AAA'");
  await connection.transaction(tx => createOperatingExpenseIn(tx as never, { ...input(), invoiceId: id(50) }));
  expect((await getOperatingExpenses(companyId, branchId)).items[0]).toMatchObject({ invoiceId: id(50), payeeTaxId: "AAA010101AAA" });
  await pg.exec(`update payees set company_id='${id(90)}'`);
  expect((await getOperatingExpenses(companyId, branchId)).items[0]).toMatchObject({ invoiceId: id(50), payeeName: null, payeeTaxId: null });
  expect((await getOperatingExpenses(id(90))).items).toHaveLength(0);
});
it("crea pendiente dentro de la transacción sin enviar avisos antes del commit", async () => {
  await connection.transaction(async tx => {
    const result = await createOperatingExpenseIn(tx as never, { ...input(), invoiceId: id(50) });
    expect(result.expense).toMatchObject({ status: "PENDING_APPROVAL", invoiceId: id(50), amount: 11600, taxAmount: 1600 });
    expect(NotificationDispatcher.sendBatchNotifications).not.toHaveBeenCalled();
  });
  expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(1);
});
it("un fallo posterior revierte el gasto sin avisos", async () => {
  await expect(connection.transaction(async tx => { await createOperatingExpenseIn(tx as never, input()); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(0);
  expect(NotificationDispatcher.sendBatchNotifications).not.toHaveBeenCalled();
});
it("conserva el alta manual sin factura y su notificación", async () => {
  expect((await createOperatingExpense(input())).status).toBe("PENDING_APPROVAL");
  expect(NotificationDispatcher.sendBatchNotifications).toHaveBeenCalledOnce();
  await expect(createOperatingExpense({ ...input(), invoiceId: id(50) })).rejects.toThrow(/asocia/);
});
it("conserva la evaluación de presupuesto en la misma transacción", async () => {
  await connection.insert(schema.branchBudgets).values({ branchId, costCenterId, month: "2026-11", amount: 12000 } as never);
  await connection.transaction(async tx => {
    await createOperatingExpenseIn(tx as never, { ...input(), costCenterId });
    const second = await createOperatingExpenseIn(tx as never, { ...input(), costCenterId });
    expect(second.expense.status).toBe("PENDING_OVERBUDGET_APPROVAL");
  });
});
it("rechaza periodo cerrado, contraparte ajena y centro inactivo sin gasto", async () => {
  await connection.insert(schema.financialPeriods).values({ companyId, year: 2026, month: 11, status: "CLOSED" } as never);
  await expect(connection.transaction(tx => createOperatingExpenseIn(tx as never, input()))).rejects.toThrow(/CERRADO/);
  await pg.exec("delete from financial_periods");
  await expect(connection.transaction(tx => createOperatingExpenseIn(tx as never, { ...input(), payeeId: id(99) }))).rejects.toThrow(/contraparte/);
  await pg.exec("update cost_centers set active=false");
  await expect(connection.transaction(tx => createOperatingExpenseIn(tx as never, { ...input(), costCenterId }))).rejects.toThrow(/centro de costo/);
  expect(await connection.select().from(schema.operatingExpenses)).toHaveLength(0);
});
