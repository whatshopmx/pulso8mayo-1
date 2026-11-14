import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { capturePayrollRunIn, capturePayrollPaymentIn } from "@/lib/services/accounting/payroll-adapter";
import { capturePettyCashOutflowIn } from "@/lib/services/accounting/petty-cash-adapter";
import { ensureRecognitionIn } from "@/lib/services/accounting/expense-adapter";
import { retryAccountingEvent } from "@/lib/services/accounting/event-service";
import { reverseJournal } from "@/lib/services/accounting/journal-service";
import { loadPayrollPaymentSnapshot } from "@/lib/treasury/payroll-payment-source";
import { openFund, registerOutflow, replenishFund } from "@/lib/services/petty-cash-service";
import { TreasuryService } from "@/lib/services/treasury-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;

const namespace = `fc15petty_${randomUUID().replaceAll("-", "")}`;
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
const actorId = randomUUID();
const employeeId = randomUUID();
const branchId = randomUUID();
const bankId = randomUUID();
const costCenterId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
const accounts: Record<string, string> = {};
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

  for (const table of [
    "companies",
    "users",
    "branches",
    "cost_centers",
    "company_bank_accounts",
    "financial_periods",
    "tenant_operating_config",
    "operating_expenses",
    "petty_cash_funds",
    "petty_cash_transactions",
    "payment_runs",
    "payment_run_items",
    "payroll_runs",
    "payroll_payslips",
  ]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY(id)`);
  }

  await pool.query("ALTER TABLE payment_runs DROP COLUMN IF EXISTS source_bank_account_id");
  await pool.query("ALTER TABLE payment_run_items DROP COLUMN IF EXISTS payroll_snapshot CASCADE");
  await pool.query("ALTER TABLE operating_expenses DROP COLUMN IF EXISTS voucher_reference CASCADE");
  await pool.query(
    "ALTER TABLE petty_cash_transactions DROP COLUMN IF EXISTS voucher_reference CASCADE, DROP COLUMN IF EXISTS tax_amount CASCADE, DROP COLUMN IF EXISTS business_date CASCADE, DROP COLUMN IF EXISTS payment_run_item_id CASCADE",
  );
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_fund_branch_unique ON petty_cash_funds (company_id, branch_id)");

  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Synthetic FC15'),($2,'Foreign FC15')", [
    companyId,
    foreignCompany,
  ]);
  await pool.query(
    `INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
     VALUES($1,'fc15-owner@fixture.invalid','OWNER',$3,NULL,now(),now()),
           ($2,'fc15-emp@fixture.invalid','EMPLEADO',$3,$4,now(),now())`,
    [actorId, employeeId, companyId, branchId],
  );
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Sucursal Centro','CEN','OWNED')", [
    branchId,
    companyId,
  ]);
  await pool.query(
    "INSERT INTO cost_centers(id,company_id,code,name,active,created_at,updated_at) VALUES($1,$2,'CC-LIMPIEZA','Insumos Limpieza',true,now(),now())",
    [costCenterId, companyId],
  );
  await pool.query(
    "INSERT INTO tenant_operating_config(id,company_id,petty_cash_limit_cents,created_at,updated_at) VALUES($1,$2,500000,now(),now())",
    [randomUUID(), companyId],
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
    "0146_fc15_payroll_snapshot",
    "0147_fc15_payroll_facts",
    "0148_fc15_petty_cash",
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

  state.db = drizzle(pool, { schema });

  for (const [role, kind] of Object.entries({
    PAYROLL_EXPENSE: "EXPENSE",
    PAYROLL_PAYABLE: "LIABILITY",
    PAYROLL_DEDUCTIONS: "LIABILITY",
    TIPS_PAYABLE: "LIABILITY",
    PAYMENT_SOURCE: "ASSET",
    PETTY_CASH: "ASSET",
    EXPENSE: "EXPENSE",
    COST_CENTER_EXPENSE: "EXPENSE",
    RECOVERABLE_TAX: "ASSET",
    PAYABLE: "LIABILITY",
  })) {
    accounts[role] = (
      await createAccount(ctx, {
        code: role,
        name: role,
        kind: kind as "EXPENSE" | "LIABILITY" | "ASSET",
        normalBalance: kind === "LIABILITY" ? "CREDIT" : "DEBIT",
        validFrom: "2026-01-01",
      })
    ).id;
  }

  for (const eventType of [
    "PAYROLL_RECOGNIZED",
    "PAYROLL_PAID",
    "PETTY_CASH_EXPENSE",
    "PETTY_CASH_REPLENISHED",
    "EXPENSE_RECOGNIZED",
  ]) {
    await createRule(ctx, {
      code: eventType,
      name: eventType,
      eventType,
      effectiveFrom: "2026-01-01",
      entries: Object.entries(accounts)
        .filter(([role]) => role !== "COST_CENTER_EXPENSE")
        .map(([role, accountId]) => ({ role, accountId })),
    });
  }

  await pool.query(
    `INSERT INTO company_bank_accounts(id,company_id,label,account_number,account_last_four,
      account_fingerprint,bank_code,bank_name,registered_by)
     VALUES($1,$2,'Banco Operativo','fixture-encrypted','5678','fixture-5678','012','BBVA',$3)`,
    [bankId, companyId, actorId],
  );
  await pool.query(
    "INSERT INTO accounting_source_links(company_id,account_id,bank_account_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4)",
    [companyId, accounts.PAYMENT_SOURCE, bankId, actorId],
  );
  await pool.query(
    "INSERT INTO accounting_source_links(company_id,account_id,cost_center_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4)",
    [companyId, accounts.COST_CENTER_EXPENSE, costCenterId, actorId],
  );
}, 120000);

beforeEach(() => vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try {
    if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`);
  } finally {
    await pool.end();
  }
});

it("excludes draft/estimated payroll, recognizes confirmed payroll once, and settles net payable without repeating labor expense", async () => {
  const draftRunId = randomUUID();
  const draftSlipId = randomUUID();
  await pool.query(
    "INSERT INTO payroll_runs(id,company_id,period_start,period_end,status) VALUES($1,$2,'2026-10-01','2026-10-15','DRAFT')",
    [draftRunId, companyId],
  );
  await pool.query(
    `INSERT INTO payroll_payslips(id,run_id,user_id,cfdi_uuid,cfdi_status,base_salary_cents,
      propinas_cents,total_percepciones_cents,total_deducciones_cents)
     VALUES($1,$2,$3,NULL,'PENDING',95000,0,95000,12000)`,
    [draftSlipId, draftRunId, employeeId],
  );

  await expect(
    withCompanyContext({ companyId, actorId }, tx =>
      capturePayrollRunIn(tx, companyId, actorId, draftRunId),
    ),
  ).rejects.toThrow(/completada/i);

  const confirmedRunId = randomUUID();
  const confirmedSlipId = randomUUID();
  await pool.query(
    "INSERT INTO payroll_runs(id,company_id,period_start,period_end,status) VALUES($1,$2,'2026-10-01','2026-10-15','COMPLETED')",
    [confirmedRunId, companyId],
  );
  await pool.query(
    `INSERT INTO payroll_payslips(id,run_id,user_id,cfdi_uuid,cfdi_status,base_salary_cents,
      propinas_cents,total_percepciones_cents,total_deducciones_cents)
     VALUES($1,$2,$3,$4,'TIMBRADO',12000,0,12000,2500)`,
    [confirmedSlipId, confirmedRunId, employeeId, randomUUID()],
  );

  const recognized = await withCompanyContext({ companyId, actorId }, tx =>
    capturePayrollRunIn(tx, companyId, actorId, confirmedRunId),
  );
  expect(recognized).toHaveLength(1);
  expect(recognized[0].journal).not.toBeNull();

  const paymentOutcome = await withCompanyContext({ companyId, actorId }, async tx => {
    const snapshot = await loadPayrollPaymentSnapshot(tx, companyId, confirmedRunId);
    expect(snapshot.netCents).toBe(9500);
    const [run] = await tx
      .insert(schema.paymentRuns)
      .values({
        companyId,
        title: "Dispersion Nomina Q1 Oct",
        runDate: new Date("2026-10-16T12:00:00Z"),
        sourceBankAccountId: bankId,
        sourceAccount: "fixture-5678",
        preparedBy: actorId,
      })
      .returning();
    const [item] = await tx
      .insert(schema.paymentRunItems)
      .values({
        paymentRunId: run.id,
        itemType: "PAYROLL",
        referenceId: confirmedRunId,
        amountCents: snapshot.netCents,
        payrollSnapshot: snapshot,
        settlementStatus: "CONFIRMED",
        settledAt: new Date("2026-10-16T12:00:00Z"),
        settledBy: actorId,
        settlementReference: "SPEI-NOMINA-OCT15",
      })
      .returning();
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return capturePayrollPaymentIn(tx, companyId, actorId, item.id);
  });
  expect(paymentOutcome[0].journal).not.toBeNull();

  const payrollLines = (
    await pool.query(
      `SELECT l.memo, sum(l.debit_cents)::int AS debit, sum(l.credit_cents)::int AS credit
       FROM accounting_journal_lines l
       JOIN accounting_journals j ON j.id = l.journal_id
       WHERE j.source_type IN ('PAYROLL_PAYSLIP', 'PAYROLL_PAYMENT')
       GROUP BY l.memo
       ORDER BY l.memo`,
    )
  ).rows;
  expect(payrollLines).toEqual([
    { memo: "PAYROLL:PAYMENT_SOURCE", debit: 0, credit: 9500 },
    { memo: "PAYROLL:PAYROLL_DEDUCTIONS", debit: 0, credit: 2500 },
    { memo: "PAYROLL:PAYROLL_EXPENSE", debit: 12000, credit: 0 },
    { memo: "PAYROLL:PAYROLL_PAYABLE", debit: 9500, credit: 9500 },
  ]);
});

it("excludes fund opening from replenishment accounting, posts petty cash expense, and replenishes cash without creating expense", async () => {
  const fund = await openFund({
    companyId,
    branchId,
    openedBy: actorId,
    fundAmountCents: 300000,
  });
  expect(fund.currentBalance).toBe(300000);

  const openingEvents = (
    await pool.query(
      "SELECT count(*)::int AS n FROM accounting_events WHERE source_type IN ('PETTY_CASH_OUT','PETTY_CASH_REPLENISHMENT')",
    )
  ).rows[0].n;
  expect(openingEvents).toBe(0);

  await expect(
    replenishFund({
      companyId,
      branchId,
      registeredBy: actorId,
      amountCents: 1000,
      notes: "Apertura del fondo de caja chica",
    }),
  ).rejects.toThrow(/apertura o reapertura está reservado/i);

  const outflow = await registerOutflow({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 1160,
    taxCents: 160,
    voucherReference: "  cfdi:550e8400-e29b-41d4-a716-446655440099 ",
    businessDate: "2026-10-25",
    concept: "Compra urgente de hielo",
    category: "OTROS",
  });
  expect(outflow.newBalanceCents).toBe(300000 - 1160);

  const outflowEvent = (
    await pool.query("SELECT id, status, journal_id FROM accounting_events WHERE source_id = $1", [
      outflow.transaction.id,
    ])
  ).rows[0];
  expect(outflowEvent).toMatchObject({ status: "POSTED", journal_id: expect.any(String) });

  const outflowLines = (
    await pool.query(
      "SELECT memo, debit_cents::int AS debit, credit_cents::int AS credit FROM accounting_journal_lines WHERE journal_id = $1 ORDER BY memo",
      [outflowEvent.journal_id],
    )
  ).rows;
  expect(outflowLines).toEqual([
    { memo: "PETTY_CASH:EXPENSE", debit: 1000, credit: 0 },
    { memo: "PETTY_CASH:PETTY_CASH", debit: 0, credit: 1160 },
    { memo: "PETTY_CASH:RECOVERABLE_TAX", debit: 160, credit: 0 },
  ]);

  // Outflow with cost center maps to COST_CENTER_EXPENSE and preserves costCenterId
  const ccOutflow = await registerOutflow({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 500,
    taxCents: 0,
    costCenterId,
    voucherReference: "FOLIO-TICKET-CC-001",
    businessDate: "2026-10-25",
    concept: "Detergente cocina",
    category: "MANTENIMIENTO",
  });
  const ccEvent = (
    await pool.query("SELECT journal_id FROM accounting_events WHERE source_id = $1", [ccOutflow.transaction.id])
  ).rows[0];
  const ccLines = (
    await pool.query(
      "SELECT account_id, cost_center_id, memo, debit_cents::int AS debit, credit_cents::int AS credit FROM accounting_journal_lines WHERE journal_id = $1 ORDER BY memo",
      [ccEvent.journal_id],
    )
  ).rows;
  expect(ccLines).toEqual([
    {
      account_id: accounts.COST_CENTER_EXPENSE,
      cost_center_id: costCenterId,
      memo: "PETTY_CASH:EXPENSE",
      debit: 500,
      credit: 0,
    },
    {
      account_id: accounts.PETTY_CASH,
      cost_center_id: null,
      memo: "PETTY_CASH:PETTY_CASH",
      debit: 0,
      credit: 500,
    },
  ]);

  // Replenishment linked to a PENDING treasury item stays PENDING until treasury confirms settlement, then posts without creating EXPENSE
  const [reimbRun] = await pool
    .query(
      `INSERT INTO payment_runs(id,company_id,title,run_date,status,source_bank_account_id,source_account,prepared_by)
       VALUES($1,$2,'Reposicion Caja Chica','2026-10-26T12:00:00Z','APPROVED',$3,'fixture-5678',$4)
       RETURNING id`,
      [randomUUID(), companyId, bankId, actorId],
    )
    .then(r => r.rows);
  const [reimbItem] = await pool
    .query(
      `INSERT INTO payment_run_items(id,payment_run_id,item_type,reference_id,amount_cents,settlement_status)
       VALUES($1,$2,'PETTY_CASH_REIMBURSEMENT',$3,1660,'PENDING')
       RETURNING id`,
      [randomUUID(), reimbRun.id, fund.id],
    )
    .then(r => r.rows);

  const replenished = await replenishFund({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 1660,
    paymentRunItemId: reimbItem.id,
    businessDate: "2026-10-26",
    notes: "Reposicion semanal de caja chica",
  });
  expect(replenished.newBalanceCents).toBe(300000);

  const pendingReplenishEvent = (
    await pool.query("SELECT status, journal_id, last_error FROM accounting_events WHERE source_id = $1", [
      replenished.transaction.id,
    ])
  ).rows[0];
  expect(pendingReplenishEvent).toMatchObject({
    status: "PENDING",
    journal_id: null,
    last_error: expect.stringMatching(/confirmada.*tesorería/i),
  });

  await TreasuryService.settlePaymentRunItem({
    paymentRunId: reimbRun.id,
    itemId: reimbItem.id,
    companyId,
    settlementStatus: "CONFIRMED",
    userId: actorId,
    actorRole: "OWNER",
    reference: "SPEI-REPOSICION-1660",
  });

  const postedReplenishEvent = (
    await pool.query("SELECT status, journal_id FROM accounting_events WHERE source_id = $1", [
      replenished.transaction.id,
    ])
  ).rows[0];
  expect(postedReplenishEvent).toMatchObject({
    status: "POSTED",
    journal_id: expect.any(String),
  });

  const replenishLines = (
    await pool.query(
      `SELECT l.memo, a.kind, l.debit_cents::int AS debit, l.credit_cents::int AS credit
       FROM accounting_journal_lines l
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.journal_id = $1
       ORDER BY l.memo`,
      [postedReplenishEvent.journal_id],
    )
  ).rows;
  expect(replenishLines).toEqual([
    { memo: "PETTY_CASH:PAYMENT_SOURCE", kind: "ASSET", debit: 0, credit: 1660 },
    { memo: "PETTY_CASH:PETTY_CASH", kind: "ASSET", debit: 1660, credit: 0 },
  ]);
});

it("blocks duplicate comprobantes across operating_expenses and petty_cash_transactions in both directions and recovers on rejection", async () => {
  // Direction 1: Approved operating expense exists first -> Petty cash outflow with same voucher stays PENDING
  const sharedVoucher1 = "RFC:EKU9003173C9 FOLIO:A-102";
  const expense1Id = randomUUID();
  await pool.query(
    `INSERT INTO operating_expenses(
      id,company_id,branch_id,category,amount,tax_amount,voucher_reference,description,
      business_date,status,requested_by,approved_by,created_at,updated_at
     ) VALUES($1,$2,$3,'OTROS',2320,320,$4,'Compra suministros A-102','2026-10-27','APPROVED',$5,$5,now(),now())`,
    [expense1Id, companyId, branchId, sharedVoucher1, actorId],
  );

  const exp1Result = await withCompanyContext({ companyId, actorId }, async tx => {
    const [expRow] = await tx
      .select()
      .from(schema.operatingExpenses)
      .where(eq(schema.operatingExpenses.id, expense1Id));
    return ensureRecognitionIn(tx, companyId, actorId, expRow);
  });
  expect(exp1Result.journal).not.toBeNull();

  const dupOutflow = await registerOutflow({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 2320,
    taxCents: 320,
    voucherReference: "  rfc:eku9003173c9   folio:a-102  ",
    businessDate: "2026-10-27",
    concept: "Intento de doble cobro en caja chica A-102",
    category: "OTROS",
    evidenceUrl: "https://cdn.example.invalid/receipts/a-102.pdf",
  });

  const dupOutflowEvent = (
    await pool.query("SELECT id, status, journal_id, last_error FROM accounting_events WHERE source_id = $1", [
      dupOutflow.transaction.id,
    ])
  ).rows[0];
  expect(dupOutflowEvent).toMatchObject({
    status: "PENDING",
    journal_id: null,
    last_error: expect.stringMatching(/comprobante.*duplicación/i),
  });

  // Direction 2: Petty cash outflow exists first -> Operating expense with same voucher stays PENDING
  const sharedVoucher2 = "CFDI:99999999-1111-4222-8333-444444444444";
  const validOutflow = await registerOutflow({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 1160,
    taxCents: 160,
    voucherReference: sharedVoucher2,
    businessDate: "2026-10-27",
    concept: "Gasto menor en caja chica",
    category: "OTROS",
  });
  const validOutflowEvent = (
    await pool.query("SELECT status, journal_id FROM accounting_events WHERE source_id = $1", [
      validOutflow.transaction.id,
    ])
  ).rows[0];
  expect(validOutflowEvent.status).toBe("POSTED");

  const expense2Id = randomUUID();
  await pool.query(
    `INSERT INTO operating_expenses(
      id,company_id,branch_id,category,amount,tax_amount,voucher_reference,description,
      business_date,status,requested_by,approved_by,created_at,updated_at
     ) VALUES($1,$2,$3,'OTROS',1160,160,$4,'Intento duplicado en gastos operativos','2026-10-27','APPROVED',$5,$5,now(),now())`,
    [expense2Id, companyId, branchId, sharedVoucher2.toLowerCase(), actorId],
  );

  const exp2Result = await withCompanyContext({ companyId, actorId }, async tx => {
    const [expRow] = await tx
      .select()
      .from(schema.operatingExpenses)
      .where(eq(schema.operatingExpenses.id, expense2Id));
    return ensureRecognitionIn(tx, companyId, actorId, expRow);
  });
  expect(exp2Result).toMatchObject({
    journal: null,
    reason: expect.stringMatching(/comprobante.*caja chica/i),
  });

  // Also test when an unposted operating_expenses row is REJECTED, the blocked petty cash outflow can be retried and posted
  const sharedVoucher3 = "CFDI:77777777-2222-4333-8444-555555555555";
  const expense3Id = randomUUID();
  await pool.query(
    `INSERT INTO operating_expenses(
      id,company_id,branch_id,category,amount,tax_amount,voucher_reference,description,
      business_date,status,requested_by,created_at,updated_at
     ) VALUES($1,$2,$3,'OTROS',580,80,$4,'Solicitud en espera de aprobacion','2026-10-28','PENDING_APPROVAL',$5,now(),now())`,
    [expense3Id, companyId, branchId, sharedVoucher3, actorId],
  );

  const heldOutflow = await registerOutflow({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 580,
    taxCents: 80,
    voucherReference: sharedVoucher3,
    businessDate: "2026-10-28",
    concept: "Pagado por caja chica mientras gasto estaba pendiente",
    category: "OTROS",
  });
  const heldEvent = (
    await pool.query("SELECT id, status, journal_id FROM accounting_events WHERE source_id = $1", [
      heldOutflow.transaction.id,
    ])
  ).rows[0];
  expect(heldEvent).toMatchObject({ status: "PENDING", journal_id: null });

  await pool.query("UPDATE operating_expenses SET status = 'REJECTED' WHERE id = $1", [expense3Id]);
  const recovered = await retryAccountingEvent(ctx, heldEvent.id);
  expect(recovered.journal).not.toBeNull();
});

it("enforces period closure, manual reversal guard, source immutability triggers, and NOBYPASSRLS tenant isolation on petty cash", async () => {
  await pool.query("INSERT INTO financial_periods(id,company_id,year,month,status) VALUES($1,$2,2026,11,'CLOSED')", [
    randomUUID(),
    companyId,
  ]);

  const novOutflow = await registerOutflow({
    companyId,
    branchId,
    registeredBy: actorId,
    amountCents: 580,
    taxCents: 80,
    voucherReference: "CFDI:11112222-3333-4444-8555-666677778888",
    businessDate: "2026-11-05",
    concept: "Salida en periodo cerrado",
    category: "OTROS",
  });

  const closedCheck = await withCompanyContext({ companyId, actorId }, async tx => {
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return capturePettyCashOutflowIn(tx, companyId, actorId, novOutflow.transaction.id);
  });
  expect(closedCheck).toMatchObject({
    journal: null,
    reason: expect.stringMatching(/cerrado/i),
  });

  const novEvent = (
    await pool.query("SELECT id FROM accounting_events WHERE source_id = $1", [novOutflow.transaction.id])
  ).rows[0];
  await pool.query("UPDATE financial_periods SET status = 'OPEN' WHERE company_id = $1 AND year = 2026 AND month = 11", [
    companyId,
  ]);

  const retried = await retryAccountingEvent(ctx, novEvent.id);
  expect(retried.journal).not.toBeNull();

  // Manual generic reversal is blocked for petty cash journals
  await expect(
    reverseJournal(ctx, retried.journal!.id, {
      expectedVersion: 2,
      accountingDate: "2026-11-06",
      reason: "Reversa manual no permitida",
    }),
  ).rejects.toThrow(/revisar el movimiento y su comprobante/i);

  // Source immutability triggers prevent altering captured petty cash transaction or fund branch/company
  await expect(
    pool.query("UPDATE petty_cash_transactions SET amount = 999 WHERE id = $1", [novOutflow.transaction.id]),
  ).rejects.toThrow(/inmutable/i);
  await expect(
    pool.query("DELETE FROM petty_cash_transactions WHERE id = $1", [novOutflow.transaction.id]),
  ).rejects.toThrow(/inmutable/i);
  await expect(
    pool.query("UPDATE petty_cash_funds SET company_id = $1 WHERE id = $2", [
      foreignCompany,
      novOutflow.transaction.fundId,
    ]),
  ).rejects.toThrow(/conserva empresa y sucursal/i);

  // NOBYPASSRLS tenant isolation
  const foreignVisible = await withCompanyContext({ companyId: foreignCompany, actorId }, async tx => {
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return (await tx.execute(sql`SELECT count(*)::int AS n FROM accounting_petty_cash_facts`)).rows[0];
  });
  expect(foreignVisible).toEqual({ n: 0 });
});
