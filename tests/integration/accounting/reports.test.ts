import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createDraft, publishDraft } from "@/lib/services/accounting/journal-service";
import { getAccountLedger, getAccountingStatements } from "@/lib/services/accounting/report-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
neonConfig.webSocketConstructor = ws;

const namespace = `fc17reports_${randomUUID().replaceAll("-", "")}`;
const runtimeRole = `${namespace}_app`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 4,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 10000,
  options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000`,
});

const companyId = randomUUID();
const foreignCompany = randomUUID();
const ownerId = randomUUID();
const foreignOwnerId = randomUUID();
const managerId = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();

const ownerCtx = { companyId, actorId: ownerId, role: "OWNER" as const };
const managerCtx = { companyId, actorId: managerId, role: "GERENTE" as const };
const foreignCtx = { companyId: foreignCompany, actorId: foreignOwnerId, role: "OWNER" as const };

let cashId = "";
let equityId = "";
let revenueId = "";
let expenseId = "";
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
    `CREATE TYPE "${namespace}".expense_payment_method AS ENUM (${schema.expensePaymentMethodEnum.enumValues.map((v) => `'${v}'`).join(",")})`,
  );

  for (const table of [
    "companies",
    "users",
    "branches",
    "cost_centers",
    "company_bank_accounts",
    "financial_periods",
    "operating_expenses",
    "payment_runs",
    "payment_run_items",
    "daily_sales_cuts",
  ]) {
    await pool.query(
      `CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
    );
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY(id)`);
  }

  await pool.query("ALTER TABLE payment_runs DROP COLUMN IF EXISTS source_bank_account_id");
  await pool.query("ALTER TABLE operating_expenses DROP COLUMN IF EXISTS voucher_reference CASCADE");

  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Synthetic FC17'),($2,'Foreign FC17')", [
    companyId,
    foreignCompany,
  ]);
  await pool.query(
    `INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
     VALUES($1,'fc17-owner@fixture.invalid','OWNER',$4,NULL,now(),now()),
           ($2,'fc17-mgr@fixture.invalid','GERENTE',$4,$5,now(),now()),
           ($3,'fc17-foreign@fixture.invalid','OWNER',$6,NULL,now(),now())`,
    [ownerId, managerId, foreignOwnerId, companyId, branchA, foreignCompany],
  );
  await pool.query(
    `INSERT INTO branches(id,company_id,name,code,ownership_type)
     VALUES($1,$3,'Sucursal Norte','NOR','OWNED'),
           ($2,$3,'Sucursal Sur','SUR','OWNED')`,
    [branchA, branchB, companyId],
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
  ]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8")
      .replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`)
      .replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("rolname='pulso_app'", `rolname='${runtimeRole}'`)
      .replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await pool.query(statement);
    }
  }

  await pool.query(`GRANT SELECT ON "${namespace}".branches TO "${runtimeRole}"`);

  state.db = drizzle(pool, { schema });

  cashId = (
    await createAccount(ownerCtx, {
      code: "1010",
      name: "Caja y Bancos",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2025-01-01",
    })
  ).id;
  equityId = (
    await createAccount(ownerCtx, {
      code: "3010",
      name: "Capital Social",
      kind: "EQUITY",
      normalBalance: "CREDIT",
      validFrom: "2025-01-01",
    })
  ).id;
  revenueId = (
    await createAccount(ownerCtx, {
      code: "4010",
      name: "Ventas",
      kind: "INCOME",
      normalBalance: "CREDIT",
      validFrom: "2025-01-01",
    })
  ).id;
  expenseId = (
    await createAccount(ownerCtx, {
      code: "5010",
      name: "Gastos Generales",
      kind: "EXPENSE",
      normalBalance: "DEBIT",
      validFrom: "2025-01-01",
    })
  ).id;
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE accounting_journal_lines, accounting_journals RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  if (created) await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`).catch(() => {});
  if (roleCreated) await pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => {});
  await pool.end();
});

async function postJournal(params: {
  date: string;
  description: string;
  branchId?: string | null;
  lines: { accountId: string; debitCents: number; creditCents: number; memo?: string }[];
}) {
  const draft = await createDraft(ownerCtx, {
    accountingDate: params.date,
    description: params.description,
    branchId: params.branchId ?? null,
    lines: params.lines,
  });
  return publishDraft(ownerCtx, draft.id, {
    expectedVersion: draft.version,
    reason: params.description,
  });
}

it("explains closing balances from opening + movements and supports ledger drill-down", async () => {
  // 2025 prior year: Capital +100,000, Sales +50,000, Expense -20,000 => Net Income 2025 = +30,000
  await postJournal({
    date: "2025-12-10",
    description: "Aportación capital",
    branchId: null,
    lines: [
      { accountId: cashId, debitCents: 100000, creditCents: 0 },
      { accountId: equityId, debitCents: 0, creditCents: 100000 },
    ],
  });
  await postJournal({
    date: "2025-12-20",
    description: "Venta 2025",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 50000, creditCents: 0 },
      { accountId: revenueId, debitCents: 0, creditCents: 50000 },
    ],
  });
  await postJournal({
    date: "2025-12-22",
    description: "Gasto 2025",
    branchId: branchA,
    lines: [
      { accountId: expenseId, debitCents: 20000, creditCents: 0 },
      { accountId: cashId, debitCents: 0, creditCents: 20000 },
    ],
  });

  // 2026-01 before February: Sales +40,000
  await postJournal({
    date: "2026-01-15",
    description: "Venta enero 2026",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 40000, creditCents: 0 },
      { accountId: revenueId, debitCents: 0, creditCents: 40000 },
    ],
  });

  // 2026-02 inside period: Sales +25,000, Expense -10,000
  await postJournal({
    date: "2026-02-14",
    description: "Venta febrero 2026",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 25000, creditCents: 0, memo: "Turno matutino" },
      { accountId: revenueId, debitCents: 0, creditCents: 25000 },
    ],
  });
  await postJournal({
    date: "2026-02-18",
    description: "Gasto febrero 2026",
    branchId: branchA,
    lines: [
      { accountId: expenseId, debitCents: 10000, creditCents: 0 },
      { accountId: cashId, debitCents: 0, creditCents: 10000 },
    ],
  });

  // Draft in February must NOT appear in reports or ledger
  await createDraft(ownerCtx, {
    accountingDate: "2026-02-20",
    description: "Borrador no publicado",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 99999, creditCents: 0 },
      { accountId: revenueId, debitCents: 0, creditCents: 99999 },
    ],
  });

  const report = await getAccountingStatements(ownerCtx, {
    fromDate: "2026-02-01",
    toDate: "2026-02-28",
  });

  for (const row of report.trialBalance.rows) {
    expect(row.openingNetCents + row.periodNetCents).toBe(row.closingNetCents);
    expect(row.openingDebitCents + row.periodDebitCents).toBe(row.closingDebitCents);
    expect(row.openingCreditCents + row.periodCreditCents).toBe(row.closingCreditCents);
  }

  const cashRow = report.trialBalance.rows.find((r) => r.accountId === cashId)!;
  expect(cashRow.openingNetCents).toBe(170000); // 100k + 50k - 20k + 40k
  expect(cashRow.periodNetCents).toBe(15000); // +25k - 10k
  expect(cashRow.closingNetCents).toBe(185000);

  // Income Statement matches February independently: 25,000 - 10,000 = 15,000
  expect(report.incomeStatement.totalIncomeCents).toBe(25000);
  expect(report.incomeStatement.totalExpenseCents).toBe(10000);
  expect(report.incomeStatement.netIncomeCents).toBe(15000);

  // Balance Sheet includes prior-year retained earnings (30,000) + 2026 YTD result (40k + 25k - 10k = 55k)
  expect(report.balanceSheet.totalAssetsCents).toBe(185000);
  expect(report.balanceSheet.recordedEquityCents).toBe(100000);
  expect(report.balanceSheet.retainedEarningsPriorYearsCents).toBe(30000);
  expect(report.balanceSheet.currentYearNetIncomeCents).toBe(55000);
  expect(report.balanceSheet.totalEquityCents).toBe(185000);
  expect(report.balanceSheet.isBalanced).toBe(true);
  expect(report.balanceSheet.differenceCents).toBe(0);

  // Drill-down al mayor for Cash in February
  const ledger = await getAccountLedger(ownerCtx, {
    accountId: cashId,
    fromDate: "2026-02-01",
    toDate: "2026-02-28",
  });
  expect(ledger.openingBalanceCents).toBe(170000);
  expect(ledger.entries).toHaveLength(2);
  expect(ledger.entries[0].runningBalanceCents).toBe(195000);
  expect(ledger.entries[1].runningBalanceCents).toBe(185000);
  expect(ledger.closingBalanceCents).toBe(185000);
});

it("declares unassigned corporate entries on branch reports and enforces branch/tenant isolation", async () => {
  await postJournal({
    date: "2026-03-01",
    description: "Capital corporativo",
    branchId: null,
    lines: [
      { accountId: cashId, debitCents: 50000, creditCents: 0 },
      { accountId: equityId, debitCents: 0, creditCents: 50000 },
    ],
  });
  await postJournal({
    date: "2026-03-05",
    description: "Venta sucursal norte",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 12000, creditCents: 0 },
      { accountId: revenueId, debitCents: 0, creditCents: 12000 },
    ],
  });

  // Company-wide owner filtering by branchA sees explicit corporate declaration
  const branchReport = await getAccountingStatements(ownerCtx, {
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    branchId: branchA,
  });
  expect(branchReport.incomeStatement.netIncomeCents).toBe(12000);
  expect(branchReport.unassignedCorporate.declared).toBe(true);
  expect(branchReport.unassignedCorporate.journalCount).toBe(1);
  expect(branchReport.unassignedCorporate.declaration).toContain("branch_id IS NULL");
  expect(branchReport.unassignedCorporate.accounts.length).toBeGreaterThan(0);

  // Branch manager cannot query branchB
  await expect(
    getAccountingStatements(managerCtx, {
      fromDate: "2026-03-01",
      toDate: "2026-03-31",
      branchId: branchB,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });

  // Branch manager querying own branch sees declaration without leaking corporate account lines
  const managerReport = await getAccountingStatements(managerCtx, {
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
  });
  expect(managerReport.period.branchId).toBe(branchA);
  expect(managerReport.unassignedCorporate.declared).toBe(true);
  expect(managerReport.unassignedCorporate.accounts).toHaveLength(0);

  // Foreign tenant sees empty data
  const foreignReport = await getAccountingStatements(foreignCtx, {
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
  });
  expect(foreignReport.trialBalance.rows).toHaveLength(0);
  expect(foreignReport.unassignedCorporate.journalCount).toBe(0);
});
