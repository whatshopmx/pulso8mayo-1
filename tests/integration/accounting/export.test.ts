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
import { closeAccountingPeriod, reopenAccountingPeriod } from "@/lib/services/accounting/close-service";
import {
  exportCloseCsv,
  exportClosePdf,
  sanitizeCsvText,
} from "@/lib/services/accounting/export-service";

const state = vi.hoisted(() => ({
  db: null as unknown,
  branchA: "00000000-0000-4000-8000-000000000301",
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/services/pnl-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/pnl-service")>();
  return {
    ...actual,
    getPnLByBranch: vi.fn(async () => [
      {
        branchId: state.branchA,
        branchName: "Sucursal Norte",
        sales: { cents: 10000, source: "MEASURED", note: "test", coveragePercent: 100 },
        foodCost: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        waste: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        labor: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        operatingExpenses: { cents: 2500, source: "MEASURED", note: "test", coveragePercent: 100 },
        commissions: { cents: 0, source: "NO_DATA", note: "test", coveragePercent: 0 },
        operatingProfit: { cents: 7500, source: "MEASURED", note: "test", coveragePercent: 100 },
        weakestLine: "MEASURED",
      },
    ]),
  };
});
neonConfig.webSocketConstructor = ws;

const namespace = `fc19export_${randomUUID().replaceAll("-", "")}`;
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
const branchB = randomUUID();

const ownerCtx = { companyId, actorId: ownerId, role: "OWNER" as const };
const managerCtx = { companyId, actorId: managerId, role: "GERENTE" as const };
const employeeCtx = { companyId, actorId: employeeId, role: "EMPLEADO" as const };
const foreignCtx = { companyId: foreignCompany, actorId: foreignOwnerId, role: "OWNER" as const };

let cashId = "";
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
    "pnl_snapshots",
    "operating_expenses",
    "payment_runs",
    "payment_run_items",
    "daily_sales_cuts",
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
  await pool.query("ALTER TABLE operating_expenses DROP COLUMN IF EXISTS voucher_reference CASCADE");
  await pool.query(
    `CREATE UNIQUE INDEX pnl_snapshots_branch_period_idx ON "${namespace}".pnl_snapshots (branch_id, period_start, period_end)`,
  );
  await pool.query(
    `CREATE UNIQUE INDEX financial_periods_company_year_month_idx ON "${namespace}".financial_periods (company_id, year, month)`,
  );

  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Synthetic FC19'),($2,'Foreign FC19')", [
    companyId,
    foreignCompany,
  ]);
  await pool.query(
    `INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
     VALUES($1,'fc19-owner@fixture.invalid','OWNER',$5,NULL,now(),now()),
           ($2,'fc19-mgr@fixture.invalid','GERENTE',$5,$7,now(),now()),
           ($3,'fc19-emp@fixture.invalid','EMPLEADO',$5,$7,now(),now()),
           ($4,'fc19-foreign@fixture.invalid','OWNER',$6,NULL,now(),now())`,
    [ownerId, managerId, employeeId, foreignOwnerId, companyId, foreignCompany, branchA],
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
    "0142_fc14_inventory_valuation",
    "0149_fc16_period_close",
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

  await pool.query(`GRANT SELECT ON "${namespace}".companies TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT ON "${namespace}".branches TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE ON "${namespace}".financial_periods TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE ON "${namespace}".pnl_snapshots TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT ON "${namespace}".accounting_inventory_valuations TO "${runtimeRole}"`);

  state.db = drizzle(pool, { schema });

  cashId = (
    await createAccount(ownerCtx, {
      code: "1010",
      name: "Caja",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
  revenueId = (
    await createAccount(ownerCtx, {
      code: "4010",
      name: "Ventas",
      kind: "INCOME",
      normalBalance: "CREDIT",
      validFrom: "2026-01-01",
    })
  ).id;
  expenseId = (
    await createAccount(ownerCtx, {
      code: "5010",
      name: "Gastos",
      kind: "EXPENSE",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
}, 120000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE accounting_period_closes, accounting_events, accounting_journal_lines, accounting_journals, pnl_snapshots, financial_periods RESTART IDENTITY CASCADE`,
  );
  await pool.query(
    `INSERT INTO financial_periods(id, company_id, year, month, status)
     VALUES ($1, $2, 2026, 3, 'OPEN'), ($3, $2, 2026, 4, 'OPEN')`,
    [randomUUID(), companyId, randomUUID()],
  );
});

afterAll(async () => {
  if (created) await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`).catch(() => {});
  if (roleCreated) await pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => {});
  await pool.end();
});

it("reproduces exact close totals, re-exports superseded v1 after v2 close, and generates valid PDF", async () => {
  const d1 = await createDraft(ownerCtx, {
    accountingDate: "2026-03-10",
    description: "Venta base marzo",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 10000, creditCents: 0 },
      { accountId: revenueId, debitCents: 0, creditCents: 10000 },
    ],
  });
  await publishDraft(ownerCtx, d1.id, { expectedVersion: d1.version, reason: "Venta base" });

  await closeAccountingPeriod(ownerCtx, { year: 2026, month: 3 });

  await reopenAccountingPeriod(ownerCtx, {
    year: 2026,
    month: 3,
    reason: "Ajuste autorizado posterior al primer cierre",
  });

  const d2 = await createDraft(ownerCtx, {
    accountingDate: "2026-03-20",
    description: "Gasto de ajuste v2",
    branchId: branchA,
    lines: [
      { accountId: expenseId, debitCents: 2500, creditCents: 0 },
      { accountId: cashId, debitCents: 0, creditCents: 2500 },
    ],
  });
  await publishDraft(ownerCtx, d2.id, { expectedVersion: d2.version, reason: "Ajuste v2" });
  await closeAccountingPeriod(ownerCtx, { year: 2026, month: 3 });

  // Re-export superseded v1 -> must reproduce 100.00 and 1 journal only
  const csvV1 = await exportCloseCsv(ownerCtx, { year: 2026, month: 3, version: 1 });
  expect(csvV1.filename).toBe("expediente-cierre-2026-03-v1.csv");
  expect(csvV1.content).toContain("Periodo,2026-03");
  expect(csvV1.content).toContain("Version,v1");
  expect(csvV1.content).toContain("Estado,SUPERSEDED");
  expect(csvV1.content).toContain("Polizas,1");
  expect(csvV1.content).toContain("TotalCargosMXN,100.00");
  expect(csvV1.content).toContain("Venta base marzo");
  expect(csvV1.content).not.toContain("Gasto de ajuste v2");

  // Active v2 -> must reproduce 125.00 and 2 journals
  const csvV2 = await exportCloseCsv(ownerCtx, { year: 2026, month: 3 });
  expect(csvV2.filename).toBe("expediente-cierre-2026-03-v2.csv");
  expect(csvV2.content).toContain("Estado,ACTIVE");
  expect(csvV2.content).toContain("Polizas,2");
  expect(csvV2.content).toContain("TotalCargosMXN,125.00");
  expect(csvV2.content).toContain("Gasto de ajuste v2");

  // PDF binary output
  const pdfV1 = await exportClosePdf(ownerCtx, { year: 2026, month: 3, version: 1 });
  expect(pdfV1.filename).toBe("expediente-cierre-2026-03-v1.pdf");
  expect(pdfV1.buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  expect(pdfV1.buffer.length).toBeGreaterThan(500);
});

it("neutralizes CSV formula injection and enforces role, branch, and cross-tenant boundaries", async () => {
  expect(sanitizeCsvText("=cmd|' /C calc'!A0")).toBe(`"'=cmd|' /C calc'!A0"`);
  expect(sanitizeCsvText("+SUM(1,2)")).toBe(`"'+SUM(1,2)"`);
  expect(sanitizeCsvText("-1+1")).toBe(`"'-1+1"`);
  expect(sanitizeCsvText("@IMPORTXML()")).toBe(`"'@IMPORTXML()"`);
  expect(sanitizeCsvText("\t=1+1")).toBe(`"'\t=1+1"`);

  const dA = await createDraft(ownerCtx, {
    accountingDate: "2026-04-05",
    description: "=cmd|' /C calc'!A0",
    branchId: branchA,
    lines: [
      { accountId: cashId, debitCents: 5000, creditCents: 0, memo: "@IMPORTXML()" },
      { accountId: revenueId, debitCents: 0, creditCents: 5000, memo: "+1+1" },
    ],
  });
  await publishDraft(ownerCtx, dA.id, { expectedVersion: dA.version, reason: "Sucursal A" });

  const dB = await createDraft(ownerCtx, {
    accountingDate: "2026-04-06",
    description: "Secreto sucursal B",
    branchId: branchB,
    lines: [
      { accountId: cashId, debitCents: 8000, creditCents: 0 },
      { accountId: revenueId, debitCents: 0, creditCents: 8000 },
    ],
  });
  await publishDraft(ownerCtx, dB.id, { expectedVersion: dB.version, reason: "Sucursal B" });

  // Branch manager exports own branch -> sees branchA neutralized formulas, never branchB
  const mgrCsv = await exportCloseCsv(managerCtx, { year: 2026, month: 4 });
  expect(mgrCsv.content).toContain(`"'=cmd|' /C calc'!A0"`);
  expect(mgrCsv.content).toContain(`"'@IMPORTXML()"`);
  expect(mgrCsv.content).toContain(`"'+1+1"`);
  expect(mgrCsv.content).not.toContain("Secreto sucursal B");

  // Branch manager cannot export branchB
  await expect(
    exportCloseCsv(managerCtx, { year: 2026, month: 4, branchId: branchB }),
  ).rejects.toMatchObject({ statusCode: 403 });

  // Employee cannot export
  await expect(
    exportCloseCsv(employeeCtx, { year: 2026, month: 4 }),
  ).rejects.toMatchObject({ statusCode: 403 });

  // Foreign tenant cannot export company's data
  const foreignCsv = await exportCloseCsv(foreignCtx, { year: 2026, month: 4 });
  expect(foreignCsv.content).toContain("Polizas,0");
  expect(foreignCsv.content).not.toContain("Secreto sucursal B");
});
