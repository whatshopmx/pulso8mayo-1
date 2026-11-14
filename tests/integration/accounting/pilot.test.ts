import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount, linkSource } from "@/lib/services/accounting/account-service";
import { createOpening } from "@/lib/services/accounting/opening-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { recordAccountingEventIn } from "@/lib/services/accounting/event-store";
import {
  dueAccountingEvents,
  processAccountingEvent,
  recoverMissingAccountingEvents,
  retryAccountingEvent,
} from "@/lib/services/accounting/event-service";
import {
  activateCompanyPilot,
  disableCompanyPilot,
  getCompanyPilotStatus,
  measureCompanyPilotMetrics,
  previewCompanyOpening,
} from "@/lib/services/accounting/activation-service";
import { withCompanyContext } from "@/lib/db/tenant-context";

const state = vi.hoisted(() => ({
  db: null as unknown,
  branchA: "00000000-0000-4000-8000-000000000401",
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/services/pnl-service", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/services/pnl-service")>();
  return {
    ...actual,
    getPnLByBranch: vi.fn(async () => [
      {
        branchId: state.branchA,
        branchName: "Sucursal Norte",
        sales: { cents: 15000, source: "MEASURED", note: "test", coveragePercent: 100 },
        foodCost: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        waste: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        labor: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        operatingExpenses: { cents: 5000, source: "MEASURED", note: "test", coveragePercent: 100 },
        commissions: { cents: 0, source: "NO_DATA", note: "test", coveragePercent: 0 },
        operatingProfit: { cents: 10000, source: "MEASURED", note: "test", coveragePercent: 100 },
        weakestLine: "MEASURED",
      },
    ]),
  };
});
neonConfig.webSocketConstructor = ws;

const namespace = `fc20pilot_${randomUUID().replaceAll("-", "")}`;
const runtimeRole = `${namespace}_app`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 4,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 30000,
  options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000`,
});

const companyId = randomUUID();
const foreignCompany = randomUUID();
const ownerId = randomUUID();
const foreignOwnerId = randomUUID();
const managerId = randomUUID();
const employeeId = randomUUID();
const branchA = state.branchA;
const costCenterId = randomUUID();

const ownerCtx = { companyId, actorId: ownerId, role: "OWNER" as const };
const managerCtx = { companyId, actorId: managerId, role: "GERENTE" as const };
const employeeCtx = { companyId, actorId: employeeId, role: "EMPLEADO" as const };
const foreignCtx = { companyId: foreignCompany, actorId: foreignOwnerId, role: "OWNER" as const };

let cashAccountId = "";
let equityAccountId = "";
let expenseAccountId = "";
let payableAccountId = "";
let created = false;
let roleCreated = false;

beforeAll(async () => {
  const isolated = new URL(process.env.TEST_DATABASE_URL!);
  let checked = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const values = parse(readFileSync(file));
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      if (!values[key]) continue;
      checked = true;
      const operative = new URL(values[key]);
      if (
        isolated.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "") &&
        isolated.pathname === operative.pathname
      ) {
        throw new Error("La base aislada coincide con la operativa.");
      }
    }
  }
  if (!checked) throw new Error("No se pudo verificar el aislamiento.");

  await pool.query(`CREATE SCHEMA "${namespace}"`);
  created = true;
  await pool.query(
    `CREATE TYPE "${namespace}".expense_payment_method AS ENUM (${schema.expensePaymentMethodEnum.enumValues.map(v => `'${v}'`).join(",")})`,
  );
  await pool.query(
    `CREATE TYPE "${namespace}".terminal_acquirer AS ENUM (${schema.terminalAcquirerEnum.enumValues.map(v => `'${v}'`).join(",")})`,
  );

  for (const table of [
    "companies",
    "users",
    "branches",
    "cost_centers",
    "company_bank_accounts",
    "bank_transactions",
    "financial_periods",
    "pnl_snapshots",
    "operating_expenses",
    "payment_runs",
    "payment_run_items",
    "daily_sales_cuts",
    "gateway_transactions",
    "inventory_items",
    "inventory_batches",
    "inventory_transfers",
    "inventory_movements",
    "data_access_logs",
  ]) {
    await pool.query(
      `CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
    );
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY(id)`);
  }

  await pool.query("ALTER TABLE financial_periods DROP COLUMN IF EXISTS close_version, DROP COLUMN IF EXISTS reopened_at, DROP COLUMN IF EXISTS reopened_by, DROP COLUMN IF EXISTS reopen_reason");
  await pool.query("ALTER TABLE pnl_snapshots DROP COLUMN IF EXISTS accounting_close_id, DROP COLUMN IF EXISTS close_version");
  await pool.query("ALTER TABLE payment_runs DROP COLUMN IF EXISTS source_bank_account_id");
  await pool.query("ALTER TABLE operating_expenses ADD COLUMN IF NOT EXISTS voucher_reference text");
  await pool.query(`CREATE UNIQUE INDEX pnl_snapshots_branch_period_idx ON "${namespace}".pnl_snapshots (branch_id, period_start, period_end)`);
  await pool.query(`CREATE UNIQUE INDEX financial_periods_company_year_month_idx ON "${namespace}".financial_periods (company_id, year, month)`);

  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Pilot FC20'),($2,'Foreign FC20')", [
    companyId,
    foreignCompany,
  ]);
  await pool.query(
    `INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
     VALUES($1,'fc20-owner@fixture.invalid','OWNER',$5,NULL,now(),now()),
           ($2,'fc20-mgr@fixture.invalid','GERENTE',$5,$7,now(),now()),
           ($3,'fc20-emp@fixture.invalid','EMPLEADO',$5,$7,now(),now()),
           ($4,'fc20-foreign@fixture.invalid','OWNER',$6,NULL,now(),now())`,
    [ownerId, managerId, employeeId, foreignOwnerId, companyId, foreignCompany, branchA],
  );
  await pool.query(
    `INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Sucursal Norte','NOR','OWNED')`,
    [branchA, companyId],
  );
  await pool.query(
    `INSERT INTO cost_centers(id,company_id,code,name,accounting_line) VALUES($1,$2,'CC-OPS','Operacion','GASTOS_OPERATIVOS')`,
    [costCenterId, companyId],
  );

  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`);
  roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);

  for (const file of [
    "0124_fc05_tenant_keys",
    "0125_fc05_accounts",
    "0126_fc05_account_guards",
    "0127_fc06_journals",
    "0128_fc06_journal_guards",
    "0129_fc07_review",
    "0130_fc08_rules",
    "0131_fc09_expense_payments",
    "0132_fc09_treasury_source",
    "0133_fc10_accounting_events",
    "0134_fc11_sales",
    "0135_fc_preparation_permissions",
    "0136_fc12_settlements",
    "0149_fc16_period_close",
    "0150_fc20_company_activation",
  ]) {
    const sqlText = readFileSync(`drizzle/${file}.sql`, "utf8")
      .replaceAll('"public".', "")
      .replaceAll("public.", "");
    for (const stmt of sqlText.split("--> statement-breakpoint")) {
      if (stmt.trim()) await pool.query(stmt);
    }
  }

  await pool.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${namespace}" TO "${runtimeRole}"`);
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${namespace}" TO "${runtimeRole}"`);
  const runtimePool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 4,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 30000,
    options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000 -c role=${runtimeRole}`,
  });
  state.db = drizzle(runtimePool, { schema });

  const accCash = await createAccount(ownerCtx, {
    code: "1010", name: "Bancos", kind: "ASSET", normalBalance: "DEBIT", validFrom: "2026-01-01",
  });
  const accEquity = await createAccount(ownerCtx, {
    code: "3010", name: "Capital Inicial", kind: "EQUITY", normalBalance: "CREDIT", validFrom: "2026-01-01",
  });
  const accExp = await createAccount(ownerCtx, {
    code: "5010", name: "Gastos Operativos", kind: "EXPENSE", normalBalance: "DEBIT", validFrom: "2026-01-01",
  });
  const accPayable = await createAccount(ownerCtx, {
    code: "2010", name: "Proveedores", kind: "LIABILITY", normalBalance: "CREDIT", validFrom: "2026-01-01",
  });
  cashAccountId = accCash.id;
  equityAccountId = accEquity.id;
  expenseAccountId = accExp.id;
  payableAccountId = accPayable.id;
}, 120000);

beforeEach(() => {
  process.env.ACCOUNTING_POSTING_ENABLED = "1";
  process.env.ACCOUNTING_REVIEW_ENABLED = "1";
});

afterAll(async () => {
  if (created) await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`).catch(() => {});
  if (roleCreated) await pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => {});
  await pool.end().catch(() => {});
});

it("previews opening without publishing, blocks overlap, and skips historical facts on or before openingDate", async () => {
  // Insert a historical approved expense on 2026-04-30 (<= openingDate 2026-05-01)
  const histExpId = randomUUID();
  const expCategory = schema.operatingExpenseCategoryEnum.enumValues[0];
  await pool.query(
    `INSERT INTO operating_expenses (id, company_id, branch_id, cost_center_id, category, description, amount, business_date, status, requested_by, approved_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $6, 'Renta historica abril', 100000, '2026-04-30', 'APPROVED', $5, $5, now(), now())`,
    [histExpId, companyId, branchA, costCenterId, ownerId, expCategory],
  );

  // Unbalanced preview must fail readiness and never publish
  const badPreview = await previewCompanyOpening(ownerCtx, {
    openingDate: "2026-05-01",
    reason: "Vista previa inicial",
    lines: [
      { accountId: cashAccountId, debitCents: 100000, creditCents: 0 },
      { accountId: equityAccountId, debitCents: 0, creditCents: 90000 },
    ],
    documents: [{ label: "Balanza inicial", reference: "BAL-2026-05" }],
  });
  expect(badPreview.ready).toBe(false);
  expect(badPreview.published).toBe(false);
  expect(badPreview.blockers.some(b => b.includes("no cuadra"))).toBe(true);
  expect(badPreview.historicalExcluded.operatingExpenses).toBe(1);

  // Balanced preview is ready, still unpublished
  const openingInput = {
    openingDate: "2026-05-01",
    reason: "Apertura contable revisada mayo",
    lines: [
      { accountId: cashAccountId, debitCents: 100000, creditCents: 0 },
      { accountId: equityAccountId, debitCents: 0, creditCents: 100000 },
    ],
    documents: [{ label: "Balanza inicial", reference: "BAL-2026-05" }],
  };
  const okPreview = await previewCompanyOpening(ownerCtx, openingInput);
  expect(okPreview.ready).toBe(true);
  expect(okPreview.published).toBe(false);
  expect(okPreview.blockers).toHaveLength(0);

  // Cannot activate posting before opening is published
  await expect(activateCompanyPilot(ownerCtx, { mode: "COMPARISON", postingEnabled: true })).rejects.toThrow();

  // Publish opening after review, then activate in COMPARISON mode
  await createOpening(ownerCtx, openingInput);
  const activated = await activateCompanyPilot(ownerCtx, {
    mode: "COMPARISON",
    postingEnabled: true,
    reviewEnabled: true,
  });
  expect(activated.mode).toBe("COMPARISON");
  expect(activated.postingEnabled).toBe(true);
  expect(activated.openingDate).toBe("2026-05-01");

  // Historical expense <= openingDate must be ignored by both recordAccountingEventIn and recoverMissingAccountingEvents
  await withCompanyContext({ companyId, actorId: ownerId }, tx =>
    recordAccountingEventIn(tx, {
      companyId,
      branchId: branchA,
      sourceType: "OPERATING_EXPENSE",
      sourceId: histExpId,
      eventType: "EXPENSE_RECOGNIZED",
      actorId: ownerId,
      accountingDate: "2026-04-30",
    }),
  );
  const sweep = await recoverMissingAccountingEvents(companyId);
  expect(sweep.expenses).toBe(0);

  const metricsAfterHist = await measureCompanyPilotMetrics(ownerCtx, {
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });
  expect(metricsAfterHist.backlog.pendingCount).toBe(0);
  expect(metricsAfterHist.backlog.postedCount).toBe(0);
});

it("recovers after failure, measures backlog/differences, and stops new events on disable without deleting evidence", async () => {
  // Post-opening expense on 2026-05-10
  const postExpId = randomUUID();
  const expCategory = schema.operatingExpenseCategoryEnum.enumValues[0];
  await pool.query(
    `INSERT INTO operating_expenses (id, company_id, branch_id, cost_center_id, category, description, amount, tax_amount, business_date, status, requested_by, approved_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $6, 'Compra insumos mayo', 5000, 0, '2026-05-10', 'APPROVED', $5, $5, now(), now())`,
    [postExpId, companyId, branchA, costCenterId, ownerId, expCategory],
  );

  // Recovery sweep captures the post-opening expense into accounting_events
  const sweep1 = await recoverMissingAccountingEvents(companyId);
  expect(sweep1.expenses).toBe(1);

  const eventsBefore = await withCompanyContext({ companyId }, tx =>
    tx.select().from(schema.accountingEvents).where(eq(schema.accountingEvents.companyId, companyId)),
  );
  expect(eventsBefore).toHaveLength(1);
  const eventId = eventsBefore[0].id;

  // Attempt posting before rule/link exist -> stays PENDING with attempts=1 & lastError
  const failedAttempt = await processAccountingEvent(companyId, eventId);
  expect(failedAttempt.journal).toBeNull();
  expect(failedAttempt.reason).toBeTruthy();

  const metricsFailed = await measureCompanyPilotMetrics(ownerCtx, {
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });
  expect(metricsFailed.backlog.pendingCount).toBe(1);
  expect(metricsFailed.backlog.failedCount).toBe(1);
  expect(metricsFailed.backlog.recentErrors.length).toBeGreaterThan(0);
  expect(metricsFailed.differences.operationalOperatingProfitCents).toBe(10000);

  // Configure rule + source link, then retry -> POSTED
  await linkSource(ownerCtx, { costCenterId, accountId: expenseAccountId });
  await createRule(ownerCtx, {
    code: "EXPENSE_RECOGNIZED",
    name: "Regla gasto operativo",
    eventType: "EXPENSE_RECOGNIZED",
    effectiveFrom: "2026-05-01",
    entries: [
      { role: "EXPENSE", accountId: expenseAccountId },
      { role: "PAYABLE", accountId: payableAccountId },
    ],
  });
  const recovered = await retryAccountingEvent(ownerCtx, eventId);
  expect(recovered.journal?.id).toBeTruthy();

  const metricsRecovered = await measureCompanyPilotMetrics(ownerCtx, {
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });
  expect(metricsRecovered.backlog.pendingCount).toBe(0);
  expect(metricsRecovered.backlog.failedCount).toBe(0);
  expect(metricsRecovered.backlog.postedCount).toBe(1);

  // Deactivate pilot: stops new events WITHOUT deleting existing journals or outbox evidence
  const disabled = await disableCompanyPilot(ownerCtx, { reason: "Retroceso controlado de prueba FC-20" });
  expect(disabled.mode).toBe("DISABLED");
  expect(disabled.postingEnabled).toBe(false);

  const statusAfterDisable = await getCompanyPilotStatus(ownerCtx);
  expect(statusAfterDisable.mode).toBe("DISABLED");
  expect(statusAfterDisable.postingEnabled).toBe(false);

  const newExpId = randomUUID();
  await pool.query(
    `INSERT INTO operating_expenses (id, company_id, branch_id, cost_center_id, category, description, amount, business_date, status, requested_by, approved_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $6, 'Gasto tras desactivar', 3000, '2026-05-12', 'APPROVED', $5, $5, now(), now())`,
    [newExpId, companyId, branchA, costCenterId, ownerId, expCategory],
  );
  const sweepAfterDisable = await recoverMissingAccountingEvents(companyId);
  expect(sweepAfterDisable.expenses).toBe(0);
  expect(await dueAccountingEvents(companyId)).toHaveLength(0);

  // Evidence from before deactivation remains intact
  const eventsAfterDisable = await withCompanyContext({ companyId }, tx =>
    tx.select().from(schema.accountingEvents).where(eq(schema.accountingEvents.companyId, companyId)),
  );
  expect(eventsAfterDisable).toHaveLength(1);
  expect(eventsAfterDisable[0].status).toBe("POSTED");

  // Role & cross-tenant isolation checks
  await expect(activateCompanyPilot(managerCtx, { mode: "ACTIVE", postingEnabled: true })).rejects.toThrow();
  await expect(disableCompanyPilot(employeeCtx, { reason: "No autorizado" })).rejects.toThrow();
  const foreignMetrics = await measureCompanyPilotMetrics(foreignCtx, {
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });
  expect(foreignMetrics.backlog.postedCount).toBe(0);
  expect(foreignMetrics.activation.mode).toBe("DISABLED");
});
