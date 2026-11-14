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
import { getRealizedCashFlow } from "@/lib/services/accounting/cash-flow-service";
import { getPnlToCashBridge } from "@/lib/services/accounting/pnl-bridge-service";
import * as pnlService from "@/lib/services/pnl-service";

const state = vi.hoisted(() => ({
  db: null as unknown,
  branchId: "00000000-0000-4000-8000-000000000201",
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
    getPnLByBranch: vi.fn(async () => []),
  };
});
neonConfig.webSocketConstructor = ws;

const namespace = `fc18cashflow_${randomUUID().replaceAll("-", "")}`;
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
const branchId = state.branchId;

const ownerCtx = { companyId, actorId: ownerId, role: "OWNER" as const };
const foreignCtx = { companyId: foreignCompany, actorId: foreignOwnerId, role: "OWNER" as const };

let bankId = "";
let pettyCashId = "";
let receivableId = "";
let equipmentId = "";
let payableId = "";
let equityId = "";
let salesId = "";
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

  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Synthetic FC18'),($2,'Foreign FC18')", [
    companyId,
    foreignCompany,
  ]);
  await pool.query(
    `INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
     VALUES($1,'fc18-owner@fixture.invalid','OWNER',$3,NULL,now(),now()),
           ($2,'fc18-foreign@fixture.invalid','OWNER',$4,NULL,now(),now())`,
    [ownerId, foreignOwnerId, companyId, foreignCompany],
  );
  await pool.query(
    `INSERT INTO branches(id,company_id,name,code,ownership_type)
     VALUES($1,$2,'Sucursal Centro','CEN','OWNED')`,
    [branchId, companyId],
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

  bankId = (
    await createAccount(ownerCtx, {
      code: "1020",
      name: "Banco BBVA",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
  pettyCashId = (
    await createAccount(ownerCtx, {
      code: "1010",
      name: "Caja Chica",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
  receivableId = (
    await createAccount(ownerCtx, {
      code: "1210",
      name: "Adquirente por Cobrar",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
  equipmentId = (
    await createAccount(ownerCtx, {
      code: "1510",
      name: "Equipo de Cocina",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
  payableId = (
    await createAccount(ownerCtx, {
      code: "2010",
      name: "Proveedores",
      kind: "LIABILITY",
      normalBalance: "CREDIT",
      validFrom: "2026-01-01",
    })
  ).id;
  equityId = (
    await createAccount(ownerCtx, {
      code: "3010",
      name: "Capital Social",
      kind: "EQUITY",
      normalBalance: "CREDIT",
      validFrom: "2026-01-01",
    })
  ).id;
  salesId = (
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
      name: "Gastos Operativos",
      kind: "EXPENSE",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
}, 120000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE accounting_events, accounting_journal_lines, accounting_journals RESTART IDENTITY CASCADE`,
  );
  vi.mocked(pnlService.getPnLByBranch).mockResolvedValue([]);
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
  lines: { accountId: string; debitCents: number; creditCents: number }[];
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

it("classifies operating/investing/financing flows, excludes internal transfers, and reconciles opening/closing cash", async () => {
  // Opening cash before June: 100,000 cents
  await postJournal({
    date: "2026-05-25",
    description: "Saldo inicial banco",
    lines: [
      { accountId: bankId, debitCents: 100000, creditCents: 0 },
      { accountId: equityId, debitCents: 0, creditCents: 100000 },
    ],
  });

  // Operating inflow (+50,000)
  await postJournal({
    date: "2026-06-05",
    description: "Venta contado junio",
    branchId,
    lines: [
      { accountId: bankId, debitCents: 50000, creditCents: 0 },
      { accountId: salesId, debitCents: 0, creditCents: 50000 },
    ],
  });

  // Operating outflow (-15,000)
  await postJournal({
    date: "2026-06-08",
    description: "Pago de servicios",
    branchId,
    lines: [
      { accountId: expenseId, debitCents: 15000, creditCents: 0 },
      { accountId: bankId, debitCents: 0, creditCents: 15000 },
    ],
  });

  // Internal transfer Bank -> Petty Cash (10,000) — MUST be excluded
  await postJournal({
    date: "2026-06-10",
    description: "Reposición caja chica",
    branchId,
    lines: [
      { accountId: pettyCashId, debitCents: 10000, creditCents: 0 },
      { accountId: bankId, debitCents: 0, creditCents: 10000 },
    ],
  });

  // Investing outflow (-20,000)
  await postJournal({
    date: "2026-06-15",
    description: "Compra de horno",
    branchId,
    lines: [
      { accountId: equipmentId, debitCents: 20000, creditCents: 0 },
      { accountId: bankId, debitCents: 0, creditCents: 20000 },
    ],
  });

  // Financing inflow (+30,000)
  await postJournal({
    date: "2026-06-20",
    description: "Aportación de socios",
    lines: [
      { accountId: bankId, debitCents: 30000, creditCents: 0 },
      { accountId: equityId, debitCents: 0, creditCents: 30000 },
    ],
  });

  const flow = await getRealizedCashFlow(ownerCtx, {
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  expect(flow.openingCashCents).toBe(100000);
  expect(flow.operating.inflowsCents).toBe(50000);
  expect(flow.operating.outflowsCents).toBe(15000);
  expect(flow.operating.netCents).toBe(35000);
  expect(flow.investing.outflowsCents).toBe(20000);
  expect(flow.investing.netCents).toBe(-20000);
  expect(flow.financing.inflowsCents).toBe(30000);
  expect(flow.financing.netCents).toBe(30000);
  expect(flow.netCashFlowCents).toBe(45000);
  expect(flow.closingCashCents).toBe(145000);
  expect(flow.cashChangeCents).toBe(45000);
  expect(flow.reconcilesWithCashBalances).toBe(true);

  expect(flow.excludedTransfers.count).toBe(1);
  expect(flow.excludedTransfers.totalAmountCents).toBe(10000);
  expect(flow.excludedTransfers.items[0].description).toBe("Reposición caja chica");

  // Cross-tenant isolation under NOBYPASSRLS
  const foreignFlow = await getRealizedCashFlow(foreignCtx, {
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });
  expect(foreignFlow.cashAccountIds).toHaveLength(0);
  expect(foreignFlow.netCashFlowCents).toBe(0);
});

it("explains P&L vs realized cash differences by source, timing (next-month settlement), and estimation", async () => {
  // July: sale recognized on card (+40,000) to receivable, settled in August (+38,000 cash + 2,000 fee)
  await postJournal({
    date: "2026-07-29",
    description: "Venta tarjeta julio",
    branchId,
    lines: [
      { accountId: receivableId, debitCents: 40000, creditCents: 0 },
      { accountId: salesId, debitCents: 0, creditCents: 40000 },
    ],
  });

  // July accrued expense not yet paid (-5,000)
  await postJournal({
    date: "2026-07-30",
    description: "Factura proveedor pendiente",
    branchId,
    lines: [
      { accountId: expenseId, debitCents: 5000, creditCents: 0 },
      { accountId: payableId, debitCents: 0, creditCents: 5000 },
    ],
  });

  // Pending event in July (FUENTE)
  await pool.query(
    `INSERT INTO accounting_events(id, company_id, branch_id, source_type, source_id, event_type, source_version, actor_id, accounting_date, status, attempts)
     VALUES ($1, $2, $3, 'OPERATING_EXPENSE', $4, 'EXPENSE_RECOGNIZED', 1, $5, '2026-07-31', 'PENDING', 1)`,
    [randomUUID(), companyId, branchId, randomUUID(), ownerId],
  );

  // Operational P&L with an ESTIMATED commission (-3,000) and MEASURED sales (+40,000) and expenses (-5,000) -> 32,000
  vi.mocked(pnlService.getPnLByBranch).mockResolvedValueOnce([
    {
      branchId,
      branchName: "Sucursal Centro",
      sales: { cents: 40000, source: "MEASURED", note: "POS", coveragePercent: 100 },
      foodCost: { cents: 0, source: "MEASURED", note: "OK", coveragePercent: 100 },
      waste: { cents: 0, source: "MEASURED", note: "OK", coveragePercent: 100 },
      labor: { cents: 0, source: "MEASURED", note: "OK", coveragePercent: 100 },
      operatingExpenses: { cents: 5000, source: "MEASURED", note: "OK", coveragePercent: 100 },
      commissions: { cents: 3000, source: "ESTIMATED", note: "Tarifa canal", coveragePercent: 100 },
      operatingProfit: { cents: 32000, source: "ESTIMATED", note: "Mix", coveragePercent: 100 },
      weakestLine: "ESTIMATED",
    } as never,
  ]);

  const julyBridge = await getPnlToCashBridge(ownerCtx, {
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    branchId,
  });

  expect(julyBridge.operationalOperatingProfitCents).toBe(32000);
  expect(julyBridge.accountingNetIncomeCents).toBe(35000); // +40k - 5k
  expect(julyBridge.operatingCashFlowCents).toBe(0); // nothing settled in cash in July!
  expect(julyBridge.unexplainedAccountingToCashCents).toBe(0);

  expect(julyBridge.items.some((i) => i.category === "ESTIMACION" && i.amountCents === -3000)).toBe(true);
  expect(julyBridge.items.some((i) => i.category === "FECHA" && i.code === "TIMING_UNCOLLECTED_INCOME" && i.amountCents === -40000)).toBe(true);
  expect(julyBridge.items.some((i) => i.category === "FECHA" && i.code === "TIMING_UNPAID_EXPENSES" && i.amountCents === 5000)).toBe(true);
  expect(julyBridge.items.some((i) => i.category === "FUENTE" && i.code === "SOURCE_PENDING_EVENTS")).toBe(true);

  // August: next-month settlement arrives (+38,000 cash + 2,000 fee vs 40,000 receivable)
  await postJournal({
    date: "2026-08-02",
    description: "Liquidación adquirente ventas julio",
    branchId,
    lines: [
      { accountId: bankId, debitCents: 38000, creditCents: 0 },
      { accountId: expenseId, debitCents: 2000, creditCents: 0 },
      { accountId: receivableId, debitCents: 0, creditCents: 40000 },
    ],
  });

  const augustBridge = await getPnlToCashBridge(ownerCtx, {
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    branchId,
  });
  expect(augustBridge.accountingNetIncomeCents).toBe(-2000); // only the 2,000 fee
  expect(augustBridge.operatingCashFlowCents).toBe(38000); // +38,000 cash received!
  expect(augustBridge.unexplainedAccountingToCashCents).toBe(0);
  expect(
    augustBridge.items.some(
      (i) => i.category === "FECHA" && i.code === "TIMING_PRIOR_SETTLEMENTS_COLLECTED" && i.amountCents === 40000,
    ),
  ).toBe(true);
});
