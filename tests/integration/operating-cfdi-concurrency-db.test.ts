import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { confirmOperatingCfdi } from "@/lib/services/operating-cfdi-confirm";
import { createCfdiFixture, cfdiId as id, fixtureXml as xml } from "../support/operating-cfdi-fixture";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: { sendBatchNotifications: vi.fn() } }));
vi.mock("@/lib/services/domain-event-service", () => ({ emitDomainEvent: vi.fn() }));
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: async () => ({
  managerAuthLimitCents: 200000, doubleApprovalThresholdCents: 1000000, managerAutonomy: "MEDIA" }) }));
neonConfig.webSocketConstructor = ws;
const namespace = `ocfdi_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace},pg_catalog -c timezone=UTC -c statement_timeout=15000` });
const companyId = id(1), branchId = id(2), payeeId = id(3);
const actor = { userId: "actor", companyId, role: "ADMIN" as const };
const input = { mode: "CREATE", branchId, payeeId, category: "SERVICIOS", description: "Servicio" };
let created = false;
beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  let checked = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const url = parse(readFileSync(file)).DATABASE_URL;
    if (!url) continue;
    const operative = new URL(url); checked = true;
    if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "") && target.pathname === operative.pathname) {
      throw new Error("La base de pruebas coincide con la operativa.");
    }
  }
  if (!checked || !/^ocfdi_[a-f0-9]{32}$/.test(namespace)) throw new Error("No se pudo verificar el aislamiento de la prueba.");
  await pool.query(`create schema "${namespace}"`); created = true;
  await createCfdiFixture(sql => pool.query(sql), namespace);
  state.db = drizzle(pool, { schema });
  const first = await pool.connect(), second = await pool.connect();
  try {
    const [a, b] = await Promise.all([first.query("select pg_backend_pid() as pid"), second.query("select pg_backend_pid() as pid")]);
    expect(a.rows[0].pid).not.toBe(b.rows[0].pid);
  } finally { first.release(); second.release(); }
}, 60000);
afterAll(async () => {
  try { if (created && /^ocfdi_[a-f0-9]{32}$/.test(namespace)) await pool.query(`drop schema "${namespace}" cascade`); }
  finally { await pool.end(); }
});
beforeEach(async () => {
  await pool.query("truncate invoices,operating_expenses,payees,suppliers,companies,branches,cost_centers,expense_authorization_rules,branch_budgets,service_orders,purchase_orders,petty_cash_funds,petty_cash_transactions,payment_runs,payment_run_items,expense_payments,accounting_journals,accounting_purchase_facts,financial_periods,inventory_audit_log,users cascade");
  await pool.query("insert into companies(id,name,tax_id) values ($1,'Sintética','BBB010101BBB')", [companyId]);
  await pool.query("insert into users(id,email,company_id,role,active,created_at,updated_at) values ('actor','actor@fixture.invalid',$1,'ADMIN',true,now(),now()),('approver','approver@fixture.invalid',$1,'ADMIN',true,now(),now())", [companyId]);
  await pool.query("insert into branches(id,company_id,name) values ($1,$2,'Centro')", [branchId, companyId]);
  await pool.query("insert into payees(id,company_id,name,tax_id,active) values ($1,$2,'Servicios','AAA010101AAA',true)", [payeeId, companyId]);
  vi.mocked(NotificationDispatcher.sendBatchNotifications).mockClear();
});
async function counts() {
  const { rows } = await pool.query("select (select count(*)::int from invoices) as invoices,(select count(*)::int from operating_expenses) as expenses");
  return rows[0];
}
it("dos confirmaciones concurrentes generan una factura, un gasto y un aviso", async () => {
  const [first, second] = await Promise.all([confirmOperatingCfdi(actor, xml, input), confirmOperatingCfdi(actor, xml, input)]);
  expect(first.invoiceId).toBe(second.invoiceId); expect(first.expenseId).toBe(second.expenseId);
  expect([first.outcome, second.outcome].sort()).toEqual(["CREATED", "EXISTING"]);
  expect(await counts()).toEqual({ invoices: 1, expenses: 1 });
  expect(NotificationDispatcher.sendBatchNotifications).toHaveBeenCalledOnce();
});
it("dos CFDI para el mismo gasto dejan una sola asociación y revierten la factura perdedora", async () => {
  await pool.query("insert into operating_expenses(id,company_id,branch_id,payee_id,category,description,amount,status,requested_by,business_date) values ($1,$2,$3,$4,'SERVICIOS','Previo',116001,'APPROVED','actor','2026-11-01')", [id(20), companyId, branchId, payeeId]);
  const metadata = { mode: "ASSOCIATE", branchId, payeeId, expenseId: id(20) };
  const results = await Promise.allSettled([confirmOperatingCfdi(actor, xml, metadata),
    confirmOperatingCfdi(actor, xml.replace("ABCDEF00-0000-4000-8000-000000000001", "ABCDEF00-0000-4000-8000-000000000002"), metadata)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await counts()).toEqual({ invoices: 1, expenses: 1 });
  expect(NotificationDispatcher.sendBatchNotifications).not.toHaveBeenCalled();
});
it("el mismo UUID simultáneo entre empresas no revela el registro ganador", async () => {
  await pool.query("insert into companies(id,name,tax_id) values ($1,'Ajena sintética','BBB010101BBB')", [id(90)]);
  await pool.query("insert into users(id,email,company_id,role,active,created_at,updated_at) values ('foreign-actor','foreign@fixture.invalid',$1,'ADMIN',true,now(),now())", [id(90)]);
  await pool.query("insert into branches(id,company_id,name) values ($1,$2,'Ajena')", [id(91), id(90)]);
  await pool.query("insert into payees(id,company_id,name,tax_id) values ($1,$2,'Servicios','AAA010101AAA')", [id(92), id(90)]);
  const results = await Promise.allSettled([confirmOperatingCfdi(actor, xml, input), confirmOperatingCfdi(
    { ...actor, companyId: id(90), userId: "foreign-actor" }, xml, { ...input, branchId: id(91), payeeId: id(92) })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(r => r.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.statusCode).toBe(409);
  if (rejected?.status === "rejected") {
    expect(String(rejected.reason)).not.toContain("ABCDEF00"); expect(String(rejected.reason)).not.toContain(id(90));
  }
  expect(await counts()).toEqual({ invoices: 1, expenses: 1 });
});
