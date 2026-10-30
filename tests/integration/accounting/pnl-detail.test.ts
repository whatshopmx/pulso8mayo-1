import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { getPnlDetail } from "@/lib/services/pnl-detail-service";
import { getPnLByBranch } from "@/lib/services/pnl-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
// FC-03a only reconciles these three lines. Inventory/labor/commissions have
// their own increments; do not require their tables or manufacture documents.
vi.mock("@/lib/services/food-cost-service", () => ({ getFoodCostByBranch: async () => [] }));
vi.mock("@/lib/services/labor-cost-service", () => ({ getLaborCostByBranch: async () => [] }));
vi.mock("@/lib/services/commission-service", () => ({ getCommissionsByBranch: async () => [] }));
vi.mock("@/lib/services/sales-base", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/services/sales-base")>(),
  getVatRatePercent: async () => 16,
}));

neonConfig.webSocketConstructor = ws;
const namespace = `fc03_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL, max: 1, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000,
  options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000`,
});
const isolated = drizzle(pool, { schema });
const tables = ["branches", "daily_sales_cuts", "operating_expenses", "petty_cash_funds", "petty_cash_transactions", "cost_centers"];
const companyId = randomUUID();
const foreignCompany = randomUUID();
const branchId = randomUUID();
const hiddenBranch = randomUUID();
const foreignBranch = randomUUID();
const cc = randomUUID();
const foreignCc = randomUUID();
const fund = randomUUID();
const foreignFund = randomUUID();
const input = { companyId, branchId, scope: { kind: "ALL" as const },
  startDate: "2026-10-01", endDate: "2026-10-31", pageSize: 1 };
let created = false;

describe("FC-03a — P&L detail on isolated Postgres", () => {
  beforeAll(async () => {
    // Refuse the operational database even when somebody misconfigures .env.test.
    const target = new URL(process.env.TEST_DATABASE_URL!);
    for (const file of [".env", ".env.local"]) {
      if (!existsSync(file)) continue;
      const configured = parse(readFileSync(file)).DATABASE_URL;
      if (!configured) continue;
      const operative = new URL(configured);
      if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
        && target.pathname === operative.pathname) throw new Error("La base de pruebas coincide con la operativa.");
    }
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    for (const table of tables) {
      // Copy structure, never real rows. No public fallback in search_path.
      await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    state.db = isolated;
    // Raw inserts deliberately include inconsistent legacy references so the
    // read boundary, rather than foreign keys, must prevent cross-tenant leaks.
    await pool.query(`INSERT INTO branches (id, company_id, name, code) VALUES
      ($1, $4, 'Visible', 'FC-A'), ($2, $4, 'Oculta', 'FC-B'), ($3, $5, 'Ajena', 'FC-X')`,
    [branchId, hiddenBranch, foreignBranch, companyId, foreignCompany]);
    await pool.query(`INSERT INTO cost_centers (id, company_id, code, name, accounting_line) VALUES
      ($1, $3, 'G01', 'Servicios', 'OPERATING'), ($2, $4, 'SECRET', 'Centro ajeno', 'SECRET')`,
    [cc, foreignCc, companyId, foreignCompany]);
    await pool.query(`INSERT INTO daily_sales_cuts
      (company_id, branch_id, business_date, shift, channel, total_sales, source, status, raw_file_url) VALUES
      ($1, $2, '2026-10-01', 'COMPLETO', 'TOTAL', 10001, 'MANUAL_FORM', 'VALIDATED', 'private://evidence'),
      ($1, $2, '2026-10-31', 'COMPLETO', 'TOTAL', 20002, 'MANUAL_FORM', 'PENDING_REVIEW', NULL),
      ($1, $2, '2026-09-30', 'COMPLETO', 'TOTAL', 90000, 'MANUAL_FORM', 'VALIDATED', NULL),
      ($1, $2, '2026-11-01', 'COMPLETO', 'TOTAL', 90000, 'MANUAL_FORM', 'VALIDATED', NULL),
      ($1, $3, '2026-10-01', 'COMPLETO', 'TOTAL', 70000, 'MANUAL_FORM', 'VALIDATED', NULL),
      ($4, $5, '2026-10-01', 'COMPLETO', 'TOTAL', 999999, 'MANUAL_FORM', 'VALIDATED', NULL),
      ($4, $2, '2026-10-02', 'COMPLETO', 'TOTAL', 888888, 'MANUAL_FORM', 'VALIDATED', NULL)`,
    [companyId, branchId, hiddenBranch, foreignCompany, foreignBranch]);
    await pool.query(`INSERT INTO operating_expenses
      (company_id, branch_id, category, amount, description, requested_by, status,
       business_date, paid_at, due_date, created_at, cost_center_id, evidence_url) VALUES
      ($1, $2, 'OTROS', 101, 'Privado', 'synthetic', 'PENDING_APPROVAL', '2026-10-01', '2026-11-02', '2026-11-03', '2026-11-04', $5, 'private://expense'),
      ($1, $2, 'OTROS', 202, 'Privado', 'synthetic', 'PAID', NULL, '2026-10-31 23:59:59', '2026-11-03', '2026-11-04', $6, NULL),
      ($1, $2, 'OTROS', 303, 'Privado', 'synthetic', 'APPROVED', NULL, NULL, '2026-10-15', '2026-11-04', NULL, NULL),
      ($1, $2, 'OTROS', 404, 'Privado', 'synthetic', 'APPROVED', NULL, NULL, NULL, '2026-10-20', NULL, NULL),
      ($1, $2, 'OTROS', 9999, 'Rechazado', 'synthetic', 'REJECTED', '2026-10-01', NULL, NULL, '2026-10-01', NULL, NULL),
      ($1, $2, 'OTROS', 9999, 'Fuera', 'synthetic', 'PAID', '2026-11-01', '2026-10-01', NULL, '2026-10-01', NULL, NULL),
      ($1, $3, 'OTROS', 8888, 'Oculto', 'synthetic', 'PAID', '2026-10-01', NULL, NULL, '2026-10-01', NULL, NULL),
      ($4, $2, 'OTROS', 7777, 'Ajeno', 'synthetic', 'PAID', '2026-10-01', NULL, NULL, '2026-10-01', NULL, NULL)`,
    [companyId, branchId, hiddenBranch, foreignCompany, cc, foreignCc]);
    await pool.query(`INSERT INTO petty_cash_funds
      (id, company_id, branch_id, fund_amount, current_balance, low_threshold) VALUES
      ($1, $3, $4, 10000, 10000, 0), ($2, $5, $4, 10000, 10000, 0)`,
    [fund, foreignFund, companyId, branchId, foreignCompany]);
    await pool.query(`INSERT INTO petty_cash_transactions
      (fund_id, type, amount, concept, registered_by, created_at, cost_center_id) VALUES
      ($1, 'OUT', 51, 'Privado', 'synthetic', '2026-10-01 00:00:00', $3),
      ($1, 'OUT', 52, 'Privado', 'synthetic', '2026-10-31 23:59:59', $4),
      ($1, 'REPLENISHMENT', 999, 'Reposición', 'synthetic', '2026-10-15', NULL),
      ($1, 'OUT', 999, 'Fuera', 'synthetic', '2026-11-01 00:00:00', NULL),
      ($2, 'OUT', 888, 'Ajeno', 'synthetic', '2026-10-15', NULL)`,
    [fund, foreignFund, cc, foreignCc]);
  });

  afterAll(async () => {
    try {
      if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    } finally { await pool.end(); }
  });

  it.each([
    ["sales", 30003, 2], ["operatingExpenses", 1010, 4], ["pettyCash", 103, 2],
  ] as const)("reconciles every page and the existing %s line", async (line, cents, count) => {
    const pnl = (await getPnLByBranch(companyId, input.startDate, input.endDate))
      .find(branch => branch.branchId === branchId)!;
    const ids = new Set<string>();
    let sum = 0;
    for (let page = 1; page <= count; page++) {
      const detail = await getPnlDetail({ ...input, line, page });
      expect(detail).toMatchObject({ totalCount: count, totalCents: cents,
        source: pnl[line].source, coveragePercent: pnl[line].coveragePercent,
        hasMore: page < count });
      expect(detail.items).toHaveLength(1);
      ids.add(detail.items[0].id);
      sum += detail.items[0].cents;
    }
    expect(ids.size).toBe(count);
    expect(sum).toBe(cents);
    expect(sum).toBe(pnl[line].cents);
    expect(await getPnlDetail({ ...input, line, page: count + 1 }))
      .toMatchObject({ totalCents: cents, totalCount: count, items: [], hasMore: false });
  });

  it("returns effective dates and only same-company cost centers, without private evidence", async () => {
    const expenses = await getPnlDetail({ ...input, line: "operatingExpenses", pageSize: 100 });
    expect(expenses.items.map(row => [row.cents, row.date])).toEqual([
      [202, "2026-10-31"], [404, "2026-10-20"], [303, "2026-10-15"], [101, "2026-10-01"],
    ]);
    expect(expenses.items.find(row => row.cents === 101)?.costCenter)
      .toEqual({ id: cc, code: "G01", name: "Servicios", accountingLine: "OPERATING" });
    expect(expenses.items.find(row => row.cents === 202)?.costCenter).toBeNull();
    const petty = await getPnlDetail({ ...input, line: "pettyCash", pageSize: 100 });
    expect(petty.items.find(row => row.cents === 52)?.costCenter).toBeNull();
    expect(JSON.stringify([expenses, petty])).not.toMatch(/SECRET|private:\/\/|Privado|synthetic/);
  });

  it.each(["sales", "operatingExpenses", "pettyCash"] as const)("denies foreign and hidden branches for %s", async line => {
    await expect(getPnlDetail({ ...input, line, branchId: foreignBranch }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(getPnlDetail({ ...input, line, branchId: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(getPnlDetail({ ...input, line, branchId: hiddenBranch,
      scope: { kind: "BRANCH", branchId } })).rejects.toMatchObject({ statusCode: 403 });
    await expect(getPnlDetail({ ...input, line, scope: { kind: "NONE" } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("distinguishes a measured zero from missing data", async () => {
    const day = { startDate: "2026-10-12", endDate: "2026-10-12" };
    expect(await getPnlDetail({ ...input, ...day, line: "sales" }))
      .toMatchObject({ source: "NO_DATA", totalCents: 0, totalCount: 0, items: [], coveragePercent: 0 });
    await pool.query(`INSERT INTO daily_sales_cuts
      (company_id, branch_id, business_date, shift, channel, total_sales, source)
      VALUES ($1, $2, '2026-10-12', 'COMPLETO', 'TOTAL', 0, 'MANUAL_FORM')`, [companyId, branchId]);
    const detail = await getPnlDetail({ ...input, ...day, line: "sales" });
    expect(detail).toMatchObject({ source: "MEASURED", totalCents: 0, totalCount: 1, coveragePercent: 100 });
    expect(detail.items).toHaveLength(1);
  });
});
