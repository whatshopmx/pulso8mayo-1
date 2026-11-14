import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createDraft, publishDraft } from "@/lib/services/accounting/journal-service";
import * as pnlSnapshotService from "@/lib/services/pnl-snapshot-service";
import {
  closeAccountingPeriod,
  getPeriodCloseBlockers,
  listPeriodCloseVersions,
  reopenAccountingPeriod,
} from "@/lib/services/accounting/close-service";

const state = vi.hoisted(() => ({
  db: null as unknown,
  branchId: "00000000-0000-4000-8000-000000000101",
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
        branchId: state.branchId,
        branchName: "Sucursal Norte",
        sales: { cents: 10000, source: "MEASURED", note: "test", coveragePercent: 100 },
        foodCost: { cents: 2000, source: "MEASURED", note: "test", coveragePercent: 100 },
        waste: { cents: 0, source: "MEASURED", note: "test", coveragePercent: 100 },
        labor: { cents: 1500, source: "MEASURED", note: "test", coveragePercent: 100 },
        operatingExpenses: { cents: 1000, source: "MEASURED", note: "test", coveragePercent: 100 },
        commissions: { cents: 0, source: "NO_DATA", note: "test", coveragePercent: 0 },
        operatingProfit: { cents: 5500, source: "MEASURED", note: "test", coveragePercent: 100 },
        weakestLine: "MEASURED",
      },
    ]),
  };
});
neonConfig.webSocketConstructor = ws;

const namespace = `fc16close_${randomUUID().replaceAll("-", "")}`;
const runtimeRole = `${namespace}_app`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 6,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 10000,
  options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000`,
});

const companyId = randomUUID();
const foreignCompany = randomUUID();
const ownerId = randomUUID();
const adminId = randomUUID();
const managerId = randomUUID();
const employeeId = randomUUID();
const branchId = state.branchId;
const itemId = randomUUID();

const ownerCtx = { companyId, actorId: ownerId, role: "OWNER" as const };
const adminCtx = { companyId, actorId: adminId, role: "ADMIN" as const };
const managerCtx = { companyId, actorId: managerId, role: "GERENTE" as const };
const employeeCtx = { companyId, actorId: employeeId, role: "EMPLEADO" as const };
const foreignCtx = { companyId: foreignCompany, actorId: ownerId, role: "OWNER" as const };

let cashAccountId = "";
let revenueAccountId = "";
let expenseAccountId = "";
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

  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Synthetic FC16'),($2,'Foreign FC16')", [
    companyId,
    foreignCompany,
  ]);
  await pool.query(
    `INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
     VALUES($1,'fc16-owner@fixture.invalid','OWNER',$5,NULL,now(),now()),
           ($2,'fc16-admin@fixture.invalid','ADMIN',$5,NULL,now(),now()),
           ($3,'fc16-mgr@fixture.invalid','GERENTE',$5,$6,now(),now()),
           ($4,'fc16-emp@fixture.invalid','EMPLEADO',$5,$6,now(),now())`,
    [ownerId, adminId, managerId, employeeId, companyId, branchId],
  );
  await pool.query(
    "INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Sucursal Norte','NOR','OWNED')",
    [branchId, companyId],
  );
  await pool.query(
    "INSERT INTO inventory_items(id,company_id,name,unit,created_at,updated_at) VALUES($1,$2,'Harina','kg',now(),now())",
    [itemId, companyId],
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

  await pool.query(`GRANT SELECT, INSERT, UPDATE ON "${namespace}".financial_periods TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE ON "${namespace}".pnl_snapshots TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE ON "${namespace}".accounting_inventory_valuations TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT ON "${namespace}".inventory_movements TO "${runtimeRole}"`);
  await pool.query(`GRANT SELECT ON "${namespace}".operating_expenses TO "${runtimeRole}"`);

  state.db = drizzle(pool, { schema });

  cashAccountId = (
    await createAccount(ownerCtx, {
      code: "1010",
      name: "Caja General",
      kind: "ASSET",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
  revenueAccountId = (
    await createAccount(ownerCtx, {
      code: "4010",
      name: "Ventas",
      kind: "INCOME",
      normalBalance: "CREDIT",
      validFrom: "2026-01-01",
    })
  ).id;
  expenseAccountId = (
    await createAccount(ownerCtx, {
      code: "5010",
      name: "Gastos Operativos",
      kind: "EXPENSE",
      normalBalance: "DEBIT",
      validFrom: "2026-01-01",
    })
  ).id;
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE accounting_period_closes, accounting_events, accounting_inventory_valuations, inventory_movements,
              accounting_journal_lines, accounting_journals, pnl_snapshots, financial_periods RESTART IDENTITY CASCADE`,
  );
  await pool.query(
    `INSERT INTO financial_periods(id, company_id, year, month, status)
     VALUES ($1, $2, 2026, 3, 'OPEN'), ($3, $2, 2026, 4, 'OPEN'), ($4, $2, 2026, 5, 'OPEN')`,
    [randomUUID(), companyId, randomUUID(), randomUUID()],
  );
});

afterAll(async () => {
  if (created) await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`).catch(() => {});
  if (roleCreated) await pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => {});
  await pool.end();
});

it("serializes concurrent close and journal publication without inconsistent cuts", async () => {
  const initialDraft = await createDraft(ownerCtx, {
    accountingDate: "2026-03-10",
    description: "Venta inicial marzo",
    lines: [
      { accountId: cashAccountId, debitCents: 10000, creditCents: 0 },
      { accountId: revenueAccountId, debitCents: 0, creditCents: 10000 },
    ],
  });
  await publishDraft(ownerCtx, initialDraft.id, { expectedVersion: initialDraft.version, reason: "Cierre inicial" });

  // Case A: publishDraft wins lock 505 -> publishes aprilDraft -> closeAccountingPeriod wins lock 505 next -> closes with journalCount=1 and totalDebitCents=7500.
  // Case B: closeAccountingPeriod wins lock 505 first -> sees aprilDraft is DRAFT -> rejects close with 409 (DRAFT_JOURNALS), so period stays OPEN and publishDraft succeeds cleanly!
  // Neither case produces a CLOSED period missing a POSTED journal!
  const aprilDraft = await createDraft(ownerCtx, {
    accountingDate: "2026-04-12",
    description: "Póliza concurrente abril",
    lines: [
      { accountId: cashAccountId, debitCents: 7500, creditCents: 0 },
      { accountId: revenueAccountId, debitCents: 0, creditCents: 7500 },
    ],
  });

  const [closeOutcome, publishOutcome] = await Promise.allSettled([
    closeAccountingPeriod(ownerCtx, { year: 2026, month: 4 }),
    publishDraft(ownerCtx, aprilDraft.id, { expectedVersion: aprilDraft.version, reason: "Publicación concurrente" }),
  ]);

  expect(publishOutcome.status).toBe("fulfilled");

  if (closeOutcome.status === "fulfilled") {
    expect(closeOutcome.value.close.journalCount).toBe(1);
    expect(closeOutcome.value.close.totalDebitCents).toBe(7500);
    expect(closeOutcome.value.period.status).toBe("CLOSED");
  } else {
    expect((closeOutcome.reason as { statusCode?: number }).statusCode).toBe(409);
    const [period] = await (state.db as ReturnType<typeof drizzle<typeof schema>>)
      .select()
      .from(schema.financialPeriods)
      .where(and(eq(schema.financialPeriods.companyId, companyId), eq(schema.financialPeriods.year, 2026), eq(schema.financialPeriods.month, 4)));
    expect(period.status).toBe("OPEN");
  }

  // Delete draft in March? No, March had no draft. Let's also verify March closes cleanly with 10000 cents.
  const marchClose = await closeAccountingPeriod(ownerCtx, { year: 2026, month: 3 });
  expect(marchClose.close.journalCount).toBe(1);
  expect(marchClose.close.totalDebitCents).toBe(10000);
});

it("blocks close when pending drafts, events, or unvalued inventory movements exist and posts cleanly once cleared", async () => {
  const draft = await createDraft(ownerCtx, {
    accountingDate: "2026-05-05",
    description: "Borrador pendiente mayo",
    lines: [
      { accountId: expenseAccountId, debitCents: 3000, creditCents: 0 },
      { accountId: cashAccountId, debitCents: 0, creditCents: 3000 },
    ],
  });

  const pendingEventId = randomUUID();
  await pool.query(
    `INSERT INTO accounting_events(id, company_id, branch_id, source_type, source_id, event_type, source_version, actor_id, accounting_date, status, attempts)
     VALUES ($1, $2, $3, 'OPERATING_EXPENSE', $4, 'EXPENSE_RECOGNIZED', 1, $5, '2026-05-06', 'PENDING', 1)`,
    [pendingEventId, companyId, branchId, randomUUID(), ownerId],
  );

  const movementId = randomUUID();
  await pool.query(
    `INSERT INTO inventory_movements(id, branch_id, item_id, type, quantity_change, performed_by, timestamp)
     VALUES ($1, $2, $3, 'USAGE', '-2.0000', $4, '2026-05-07T12:00:00Z')`,
    [movementId, branchId, itemId, ownerId],
  );

  const blockers = await getPeriodCloseBlockers(ownerCtx, { year: 2026, month: 5 });
  expect(blockers.map((b) => b.code)).toEqual([
    "DRAFT_JOURNALS",
    "PENDING_EVENTS",
    "PENDING_INVENTORY_VALUATIONS",
  ]);
  expect(blockers[0].message).toContain("1 póliza(s) en borrador");
  expect(blockers[1].message).toContain("1 evento(s) contable(s) pendiente(s)");
  expect(blockers[2].message).toContain("1 movimiento(s) de inventario sin costo valorado");

  await expect(closeAccountingPeriod(ownerCtx, { year: 2026, month: 5 })).rejects.toMatchObject({
    statusCode: 409,
    details: expect.objectContaining({
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "DRAFT_JOURNALS" }),
        expect.objectContaining({ code: "PENDING_EVENTS" }),
        expect.objectContaining({ code: "PENDING_INVENTORY_VALUATIONS" }),
      ]),
    }),
  });

  // Resolve all 3 blockers
  await publishDraft(ownerCtx, draft.id, { expectedVersion: draft.version, reason: "Liberar borrador" });
  await pool.query(`TRUNCATE accounting_events, accounting_inventory_valuations, inventory_movements CASCADE`);

  const closed = await closeAccountingPeriod(ownerCtx, { year: 2026, month: 5 });
  expect(closed.close.version).toBe(1);
  expect(closed.close.status).toBe("ACTIVE");
  expect(closed.close.journalCount).toBe(1);
  expect(closed.period.status).toBe("CLOSED");
  expect(closed.period.closeVersion).toBe(1);

  const snapshots = await pool.query(
    `SELECT accounting_close_id, close_version FROM pnl_snapshots WHERE company_id = $1`,
    [companyId],
  );
  expect(snapshots.rows.length).toBeGreaterThan(0);
  for (const row of snapshots.rows) {
    expect(row.accounting_close_id).toBe(closed.close.id);
    expect(row.close_version).toBe(1);
  }

  // Subsequent draft creation/publication in the closed period is rejected
  await expect(
    createDraft(ownerCtx, {
      accountingDate: "2026-05-15",
      description: "Intento tardío",
      lines: [
        { accountId: cashAccountId, debitCents: 100, creditCents: 0 },
        { accountId: revenueAccountId, debitCents: 0, creditCents: 100 },
      ],
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

it("rolls back financial period close completely if P&L snapshot generation fails", async () => {
  const draft = await createDraft(ownerCtx, {
    accountingDate: "2026-03-11",
    description: "Póliza para probar rollback",
    lines: [
      { accountId: cashAccountId, debitCents: 4000, creditCents: 0 },
      { accountId: revenueAccountId, debitCents: 0, creditCents: 4000 },
    ],
  });
  await publishDraft(ownerCtx, draft.id, { expectedVersion: draft.version, reason: "Póliza base" });

  const spy = vi
    .spyOn(pnlSnapshotService, "freezePnLPeriodIn")
    .mockRejectedValueOnce(new Error("Synthetic snapshot failure"));

  await expect(closeAccountingPeriod(ownerCtx, { year: 2026, month: 3 })).rejects.toMatchObject({
    statusCode: 500,
  });
  spy.mockRestore();

  const periodRes = await pool.query(
    `SELECT status, close_version FROM financial_periods WHERE company_id = $1 AND year = 2026 AND month = 3`,
    [companyId],
  );
  expect(periodRes.rows[0].status).toBe("OPEN");
  expect(periodRes.rows[0].close_version).toBe(0);

  const closesRes = await pool.query(
    `SELECT id FROM accounting_period_closes WHERE company_id = $1 AND year = 2026 AND month = 3`,
    [companyId],
  );
  expect(closesRes.rows).toHaveLength(0);
});

it("enforces role and reason on reopen, preserves superseded close versions, and blocks cross-tenant access under NOBYPASSRLS", async () => {
  const d1 = await createDraft(ownerCtx, {
    accountingDate: "2026-03-15",
    description: "Ingreso base",
    lines: [
      { accountId: cashAccountId, debitCents: 12000, creditCents: 0 },
      { accountId: revenueAccountId, debitCents: 0, creditCents: 12000 },
    ],
  });
  await publishDraft(ownerCtx, d1.id, { expectedVersion: d1.version, reason: "Ingreso base" });

  const v1 = await closeAccountingPeriod(ownerCtx, { year: 2026, month: 3 });
  expect(v1.close.version).toBe(1);
  expect(v1.close.totalDebitCents).toBe(12000);

  // Non-privileged roles cannot reopen
  await expect(
    reopenAccountingPeriod(adminCtx, { year: 2026, month: 3, reason: "Ajuste fiscal urgente" }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    reopenAccountingPeriod(managerCtx, { year: 2026, month: 3, reason: "Ajuste fiscal urgente" }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    reopenAccountingPeriod(employeeCtx, { year: 2026, month: 3, reason: "Ajuste fiscal urgente" }),
  ).rejects.toMatchObject({ statusCode: 403 });

  // Short reason rejected
  await expect(
    reopenAccountingPeriod(ownerCtx, { year: 2026, month: 3, reason: "fix" }),
  ).rejects.toMatchObject({ statusCode: 400 });

  // OWNER reopens with valid reason
  const reopened = await reopenAccountingPeriod(ownerCtx, {
    year: 2026,
    month: 3,
    reason: "Factura de proveedor recibida fuera de corte",
  });
  expect(reopened.period.status).toBe("OPEN");
  expect(reopened.supersededClose.status).toBe("SUPERSEDED");
  expect(reopened.supersededClose.reopenReason).toBe("Factura de proveedor recibida fuera de corte");

  // Superseded close cannot be deleted or mutated in SQL
  await expect(
    pool.query(`DELETE FROM accounting_period_closes WHERE id = $1`, [v1.close.id]),
  ).rejects.toThrow();
  await expect(
    pool.query(`UPDATE accounting_period_closes SET total_debit_cents = 999 WHERE id = $1`, [
      v1.close.id,
    ]),
  ).rejects.toThrow();

  // Post adjustment journal and close again -> version 2
  const d2 = await createDraft(ownerCtx, {
    accountingDate: "2026-03-20",
    description: "Ajuste post-reapertura",
    lines: [
      { accountId: expenseAccountId, debitCents: 2500, creditCents: 0 },
      { accountId: cashAccountId, debitCents: 0, creditCents: 2500 },
    ],
  });
  await publishDraft(ownerCtx, d2.id, { expectedVersion: d2.version, reason: "Ajuste post-reapertura" });

  const v2 = await closeAccountingPeriod(ownerCtx, { year: 2026, month: 3 });
  expect(v2.close.version).toBe(2);
  expect(v2.close.status).toBe("ACTIVE");
  expect(v2.close.journalCount).toBe(2);
  expect(v2.close.totalDebitCents).toBe(14500);

  const versions = await listPeriodCloseVersions(ownerCtx, { year: 2026, month: 3 });
  expect(versions).toHaveLength(2);
  expect(versions[0].version).toBe(2);
  expect(versions[0].status).toBe("ACTIVE");
  expect(versions[0].totalDebitCents).toBe(14500);
  expect(versions[1].version).toBe(1);
  expect(versions[1].status).toBe("SUPERSEDED");
  expect(versions[1].totalDebitCents).toBe(12000);
  expect(versions[1].reopenReason).toBe("Factura de proveedor recibida fuera de corte");

  // Cross-tenant isolation under NOBYPASSRLS
  const foreignRows = await withCompanyContext({ companyId: foreignCompany }, async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return tx.select().from(schema.accountingPeriodCloses);
  });
  expect(foreignRows).toHaveLength(0);

  const ownRows = await withCompanyContext({ companyId }, async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return tx.select().from(schema.accountingPeriodCloses);
  });
  expect(ownRows).toHaveLength(2);
});
