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
// Calculations/queries are real; only tenant/law configuration is fixed.
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: async () => ({ showAguinaldoProvision: true }) }));
vi.mock("@/lib/services/labor-rules-resolver", () => ({ resolveLaborLawRules: async () => ({ aguinaldoDaysMxn: 15 }) }));
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
const tables = ["companies", "branches", "daily_sales_cuts", "operating_expenses", "petty_cash_funds", "petty_cash_transactions", "cost_centers", "inventory_items", "inventory_movements",
  "users", "employee_contracts", "salary_history", "shift_sessions", "holidays", "channel_commission_rates", "gateway_transactions"];
const companyId = randomUUID();
const foreignCompany = randomUUID();
const branchId = randomUUID();
const hiddenBranch = randomUUID();
const foreignBranch = randomUUID();
const cc = randomUUID();
const foreignCc = randomUUID();
const fund = randomUUID();
const foreignFund = randomUUID();
const item = randomUUID();
const input = { companyId, branchId, scope: { kind: "ALL" as const },
  startDate: "2026-10-01", endDate: "2026-10-31", pageSize: 1 };
let created = false;

describe("FC-03 — P&L detail on isolated Postgres", () => {
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
    await pool.query(`INSERT INTO companies (id, name, costing_method) VALUES ($1, 'Sintética', 'LAST_PRICE'), ($2, 'Ajena', 'LAST_PRICE')`, [companyId, foreignCompany]);
    await pool.query(`INSERT INTO inventory_items (id, company_id, name, unit, last_cost, average_cost)
      VALUES ($1, $2, 'Insumo sintético', 'UNIT', 1, 2)`, [item, companyId]);
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

  it.each(["sales", "operatingExpenses", "pettyCash", "foodCost", "waste", "labor", "commissions", "operatingProfit"] as const)("denies foreign and hidden branches for %s", async line => {
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

  it("reproduces consumption/waste and aggregate rounding across single-row pages", async () => {
    await pool.query(`INSERT INTO inventory_movements (branch_id, item_id, type, quantity_change, performed_by, timestamp) VALUES
      ($1,$2,'USAGE',-0.5,'synthetic','2026-10-10'), ($1,$2,'USAGE',-0.5,'synthetic','2026-10-11'),
      ($1,$2,'WASTE',-1,'synthetic','2026-10-12'), ($1,$2,'WASTE',-1,'synthetic','2026-10-13'),
      ($1,$2,'RECEIVING',100,'synthetic','2026-10-09'), ($1,$2,'TRANSFER',-999,'synthetic','2026-10-14'),
      ($1,$2,'USAGE',-999,'synthetic','2026-11-01'), ($3,$2,'RECEIVING',2,'synthetic','2026-10-09')`, [branchId, item, hiddenBranch]);
    const pnl = (await getPnLByBranch(companyId, input.startDate, input.endDate)).find(b => b.branchId === branchId)!;
    for (const line of ["foodCost", "waste"] as const) {
      const first = await getPnlDetail({ ...input, line, page: 1 });
      const second = await getPnlDetail({ ...input, line, page: 2 });
      expect(first).toMatchObject({ totalCount: 2, totalCents: pnl[line].cents,
        source: pnl[line].source, coveragePercent: pnl[line].coveragePercent, valuation: "CURRENT_ITEM_COST", basis: "CONSUMPTION" });
      expect(first.items[0].cents + second.items[0].cents).toBe(pnl[line].cents);
      expect(await getPnlDetail({ ...input, line, page: 3 })).toMatchObject({ totalCents: pnl[line].cents, items: [] });
    }
    expect(pnl.foodCost.cents).toBe(1); // .5 + .5 rounds once, not twice
    expect(pnl.waste.cents).toBe(2);
  });

  it("labels the purchases proxy and missing waste without making another consumption", async () => {
    const pnl = (await getPnLByBranch(companyId, input.startDate, input.endDate)).find(b => b.branchId === hiddenBranch)!;
    expect(await getPnlDetail({ ...input, branchId: hiddenBranch, line: "foodCost" }))
      .toMatchObject({ totalCount: 1, totalCents: 2, source: "DERIVED", coveragePercent: pnl.foodCost.coveragePercent, basis: "PURCHASES" });
    expect(await getPnlDetail({ ...input, branchId: hiddenBranch, line: "waste" }))
      .toMatchObject({ totalCount: 0, totalCents: 0, source: "NO_DATA", items: [] });
  });

  it("explains a sector estimate separately from documents and preserves no-data", async () => {
    const period = { startDate: "2026-10-01", endDate: "2026-10-01" };
    // Sales exist on October 1, with no movements that day; December has neither.
    const noData = await getPnlDetail({ ...input, startDate: "2026-12-01", endDate: "2026-12-01", line: "foodCost" });
    expect(noData).toMatchObject({ totalCents: 0, source: "NO_DATA", items: [], calculation: null });
    const estimate = await getPnlDetail({ ...input, ...period, line: "foodCost" });
    expect(estimate).toMatchObject({ totalCents: 2457, source: "SECTOR_DEFAULT", totalCount: 0,
      coveragePercent: 0, items: [], calculation: { cents: 2457 } });
    const pnl = (await getPnLByBranch(companyId, period.startDate, period.endDate)).find(b => b.branchId === branchId)!;
    expect(estimate.totalCents).toBe(pnl.foodCost.cents);
  });

  it("preserves measured zero consumption when only waste exists", async () => {
    const period = { startDate: "2026-10-12", endDate: "2026-10-13" };
    expect(await getPnlDetail({ ...input, ...period, line: "foodCost" }))
      .toMatchObject({ totalCents: 0, totalCount: 0, source: "MEASURED", coveragePercent: 100, items: [] });
  });

  it("matches company and branch costing methods, current costs, fallbacks and missing costs", async () => {
    try {
      await pool.query(`UPDATE companies SET costing_method = 'AVERAGE_COST' WHERE id = $1`, [companyId]);
      expect(await getPnlDetail({ ...input, line: "foodCost" })).toMatchObject({ totalCents: 2, source: "MEASURED" });
      await pool.query(`UPDATE branches SET costing_method = 'LAST_COST' WHERE id = $1`, [branchId]);
      expect(await getPnlDetail({ ...input, line: "foodCost" })).toMatchObject({ totalCents: 1, source: "MEASURED" });
      await pool.query(`UPDATE branches SET costing_method = NULL WHERE id = $1`, [branchId]);
      await pool.query(`UPDATE inventory_items SET average_cost = NULL WHERE id = $1`, [item]);
      const pnl = (await getPnLByBranch(companyId, input.startDate, input.endDate)).find(b => b.branchId === branchId)!;
      expect(await getPnlDetail({ ...input, line: "foodCost" }))
        .toMatchObject({ totalCents: pnl.foodCost.cents, source: pnl.foodCost.source, coveragePercent: pnl.foodCost.coveragePercent });
      expect(pnl.foodCost.source).toBe("DERIVED");
      expect(await getPnlDetail({ ...input, line: "waste" })).toMatchObject({ totalCents: 2, source: "MEASURED" });
      await pool.query(`UPDATE inventory_items SET last_cost = NULL WHERE id = $1`, [item]);
      expect(await getPnlDetail({ ...input, line: "foodCost" }))
        .toMatchObject({ totalCents: 0, source: "MEASURED", uncostedLines: 4 });
    } finally {
      await pool.query(`UPDATE inventory_items SET last_cost = 1, average_cost = 2 WHERE id = $1`, [item]);
      await pool.query(`UPDATE branches SET costing_method = NULL WHERE id = $1`, [branchId]);
      await pool.query(`UPDATE companies SET costing_method = 'LAST_PRICE' WHERE id = $1`, [companyId]);
    }
  });

  it("blocks inconsistent cross-company inventory references instead of exposing item data", async () => {
    const foreignItem = randomUUID(), movement = randomUUID();
    await pool.query(`INSERT INTO inventory_items (id, company_id, name, unit, last_cost)
      VALUES ($1,$2,'SECRET ITEM','UNIT',99999)`, [foreignItem, foreignCompany]);
    try {
      await pool.query(`INSERT INTO inventory_movements (id, branch_id, item_id, type, quantity_change, performed_by, timestamp)
        VALUES ($1,$2,$3,'USAGE',-1,'synthetic','2026-10-01')`, [movement, branchId, foreignItem]);
      await expect(getPnlDetail({ ...input, line: "foodCost" })).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await pool.query(`DELETE FROM inventory_movements WHERE id = $1`, [movement]);
      await pool.query(`DELETE FROM inventory_items WHERE id = $1`, [foreignItem]);
    }
  });

  it("explains real contracts, attendance and salary history without exposing employees", async () => {
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, name, company_id, branch_id, created_at, updated_at)
      VALUES ($1,'fixture@example.invalid','PRIVATE EMPLOYEE',$2,$3,now(),now())`, [userId, companyId, branchId]);
    await pool.query(`INSERT INTO employee_contracts
      (user_id, company_id, branch_id, contract_number, start_date, base_salary, work_days,
       work_start_time, work_end_time, break_duration_minutes, created_by)
      VALUES ($1,$2,$3,'PRIVATE CONTRACT','2026-10-01',8000,ARRAY[1,2,3,4,5], '08:00','16:00',0,'synthetic')`,
    [userId, companyId, branchId]);
    const period = { startDate: '2026-10-05', endDate: '2026-10-06' };
    const theoretical = await getPnlDetail({ ...input, ...period, line: 'labor' });
    expect(theoretical).toMatchObject({ totalCents: 16000, source: 'DERIVED', coveragePercent: 0,
      totalCount: 0, items: [], calculation: { headcount: 1 } });
    await pool.query(`INSERT INTO salary_history (user_id,new_salary,change_type,effective_date,approved_by)
      VALUES ($1,10000,'ADJUSTMENT','2026-10-06','synthetic')`, [userId]);
    await pool.query(`INSERT INTO shift_sessions (user_id,branch_id,status,started_at,total_work_minutes) VALUES
      ($1,$2,'COMPLETED','2026-10-05 14:00:00',480),
      ($1,$2,'COMPLETED','2026-10-06 14:00:00',540),
      ($1,$2,'ACTIVE','2026-10-06 16:00:00',999),
      ($1,$2,'COMPLETED','2026-11-01 14:00:00',999)`, [userId, branchId]);
    const detail = await getPnlDetail({ ...input, ...period, line: 'labor' });
    const pnl = (await getPnLByBranch(companyId, period.startDate, period.endDate)).find(b => b.branchId === branchId)!;
    expect(detail).toMatchObject({ totalCents: 20500, source: 'MEASURED', coveragePercent: 100,
      items: [], calculation: { components: [ { cents: 18000 }, { cents: 2500 } ] } });
    expect(detail.totalCents).toBe(pnl.labor.cents);
    expect(JSON.stringify(detail)).not.toMatch(/PRIVATE|example.invalid|synthetic/);
  });

  it("explains measured and estimated commissions with effective rates and uncovered sales", async () => {
    const period = { startDate: '2026-10-20', endDate: '2026-10-21' };
    await pool.query(`INSERT INTO channel_commission_rates (company_id,channel,rate_bps,vat_bps,effective_from) VALUES
      ($1,'rappi',1000,1600,'2026-10-01'),($1,'rappi',2000,1600,'2026-10-21'),
      ($2,'rappi',9999,1600,'2026-10-01')`, [companyId, foreignCompany]);
    await pool.query(`INSERT INTO daily_sales_cuts
      (company_id,branch_id,business_date,shift,channel,total_sales,card_sales,commission_cents,aggregator_sales,source) VALUES
      ($1,$2,'2026-10-20','COMPLETO','TOTAL',20000,10000,300,'{"rappi":10000,"uber":5000}','MANUAL_FORM'),
      ($1,$2,'2026-10-21','COMPLETO','TOTAL',10000,0,NULL,'{"rappi":10000}','MANUAL_FORM')`, [companyId, branchId]);
    const detail = await getPnlDetail({ ...input, ...period, line: 'commissions' });
    const pnl = (await getPnLByBranch(companyId, period.startDate, period.endDate)).find(b => b.branchId === branchId)!;
    expect(detail).toMatchObject({ totalCents: 3780, source: 'ESTIMATED', items: [], totalCount: 0,
      calculation: { coveredSalesCents: 30000, uncoveredSalesCents: 5000,
        components: [ { key: 'rappi', cents: 3480, rateBps: null }, { key: 'tpv', cents: 300, measuredCents: 300 } ] } });
    expect(detail.totalCents).toBe(pnl.commissions!.cents);
    expect(detail.coveragePercent).toBe(pnl.commissions!.coveragePercent);
  });

  it("bridges actual P&L lines including negative profit and preserves missing sales", async () => {
    const detail = await getPnlDetail({ ...input, line: 'operatingProfit' });
    const pnl = (await getPnLByBranch(companyId, input.startDate, input.endDate)).find(b => b.branchId === branchId)!;
    expect(detail).toMatchObject({ totalCents: pnl.operatingProfit.cents, source: pnl.operatingProfit.source,
      coveragePercent: pnl.operatingProfit.coveragePercent, totalCount: 0, items: [] });
    if (detail.basis !== 'CALCULATION') throw new Error('Expected calculation');
    expect(detail.calculation.components.reduce((sum, c) => sum + c.cents, 0)).toBe(detail.totalCents);
    const loss = await getPnlDetail({ ...input, startDate: '2026-10-01', endDate: '2026-10-06', line: 'operatingProfit' });
    expect(loss.totalCents).toBeLessThan(0);
    const empty = await getPnlDetail({ ...input, startDate: '2026-12-01', endDate: '2026-12-01', line: 'operatingProfit' });
    expect(empty).toMatchObject({ totalCents: 0, source: 'NO_DATA', calculation: { components: [] } });
  });
});
