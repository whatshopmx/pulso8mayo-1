import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount, updateAccount } from "@/lib/services/accounting/account-service";
import { createDraft, getJournal, publishDraft } from "@/lib/services/accounting/journal-service";
import { createRule, getRule, listRules, previewRule } from "@/lib/services/accounting/mapping-service";
import { createOpening, getOpening } from "@/lib/services/accounting/opening-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc08_${randomUUID().replaceAll("-", "")}`;
const role = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), quietCompany = randomUUID();
const actorId = randomUUID(), foreignActor = randomUUID(), quietActor = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
const foreign = { companyId: foreignCompany, actorId: foreignActor, role: "OWNER" as const };
let created = false, roleCreated = false, counter = 0;
const nextCode = (prefix: string) => `${prefix}${(++counter).toString().padStart(3, "0")}`;
const account = (code: string, extra = {}) => ({ code, name: `Cuenta ${code}`, kind: "ASSET" as const,
  normalBalance: "DEBIT" as const, validFrom: "2026-01-01", ...extra });
const source = (eventType: string) => ({ type: "TEST", id: randomUUID(), version: 1, eventType });

let cashAccount: string, incomeAccount: string, payableAccount: string;

beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  let verified = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const value = parse(readFileSync(file)).DATABASE_URL;
    if (!value) continue;
    const operative = new URL(value);
    verified = true;
    if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
      && target.pathname === operative.pathname) throw new Error("La base de pruebas coincide con la operativa.");
  }
  if (!verified) throw new Error("Falta DATABASE_URL en .env/.env.local para comprobar el aislamiento.");
  await pool.query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const table of ["companies", "users", "cost_centers", "company_bank_accounts", "branches", "financial_periods"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  await pool.query(`INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena'),($3,'Silenciosa')`,
    [companyId, foreignCompany, quietCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at) VALUES
    ($1,'owner@fixture.invalid','OWNER',$4,now(),now()),($2,'foreign@fixture.invalid','OWNER',$5,now(),now()),
    ($3,'quiet@fixture.invalid','OWNER',$6,now(),now())`,
  [actorId, foreignActor, quietActor, companyId, foreignCompany, quietCompany]);
  await pool.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${role}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules"]) {
    // Substitute only schema/role identifiers; all runtime privileges come from the migration.
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`)
      .replaceAll("rolname = 'pulso_app'", `rolname = '${role}'`).replaceAll("TO pulso_app", `TO "${role}"`);
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  state.db = drizzle(pool, { schema });
}, 60000);
afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${role}"`);
  } finally { await pool.end(); }
});

async function scoped<T>(company: string | null, operation: (client: PoolClient) => Promise<T>, runtime = false,
  isolation: "READ COMMITTED" | "REPEATABLE READ" = "READ COMMITTED") {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    if (runtime) await client.query(`SET LOCAL ROLE "${role}"`);
    if (company) await client.query("SELECT set_config('app.current_company_id',$1,true)", [company]);
    const result = await operation(client);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

describe("FC-08 — opening and recognition rules", () => {
  it("keeps one immutable version per rule with an advancing effective date", async () => {
    cashAccount = (await createAccount(ctx, account(nextCode("RC")))).id;
    incomeAccount = (await createAccount(ctx, account(nextCode("RI"), { kind: "INCOME", normalBalance: "CREDIT" }))).id;
    payableAccount = (await createAccount(ctx, account(nextCode("RP"), { kind: "LIABILITY", normalBalance: "CREDIT" }))).id;
    const first = await createRule(ctx, { code: "CASH_SALE", name: "Venta de contado", eventType: "CASH_SALE",
      effectiveFrom: "2026-01-01", entries: [{ role: "CASH", accountId: cashAccount },
        { role: "INCOME", accountId: incomeAccount }] });
    expect(first.rule.version).toBe(1);
    expect((await getRule(ctx, first.rule.id)).entries.map(entry => entry.role)).toEqual(["CASH", "INCOME"]);

    // A fact cannot be captured twice without superseding the current version.
    await expect(createRule(ctx, { code: "CASH_SALE", name: "Venta de contado", eventType: "CASH_SALE",
      effectiveFrom: "2026-02-01", entries: [{ role: "CASH", accountId: cashAccount }] }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(createRule(ctx, { code: "CASH_SALE", name: "Venta de contado", eventType: "CASH_SALE",
      effectiveFrom: "2026-01-01", supersedesId: first.rule.id, entries: [{ role: "CASH", accountId: cashAccount }] }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(createRule(ctx, { code: "CASH_SALE", name: "Venta de contado", eventType: "CASH_SALE",
      effectiveFrom: "2025-12-31", supersedesId: first.rule.id, entries: [{ role: "CASH", accountId: cashAccount }] }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(createRule(ctx, { code: "OTHER_CODE", name: "Otra", eventType: "CASH_SALE",
      effectiveFrom: "2026-06-20", supersedesId: first.rule.id, entries: [{ role: "CASH", accountId: cashAccount }] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(createRule(ctx, { code: "CASH_SALE", name: "Venta de contado", eventType: "CASH_SALE",
      effectiveFrom: "2026-06-20", supersedesId: first.rule.id,
      entries: [{ role: "CASH", accountId: cashAccount }, { role: "CASH", accountId: incomeAccount }] }))
      .rejects.toMatchObject({ statusCode: 400 });

    const second = await createRule(ctx, { code: "CASH_SALE", name: "Venta con IVA", eventType: "CASH_SALE",
      effectiveFrom: "2026-06-20", supersedesId: first.rule.id, notes: "Agrega la cuenta de impuesto",
      entries: [{ role: "CASH", accountId: cashAccount }, { role: "INCOME", accountId: incomeAccount }] });
    expect(second.rule).toMatchObject({ version: 2, supersedesId: first.rule.id });
    // Skipping a version or superseding an older one is rejected by the database.
    await expect(createRule(ctx, { code: "CASH_SALE", name: "Salto", eventType: "CASH_SALE",
      effectiveFrom: "2026-09-01", supersedesId: first.rule.id, entries: [{ role: "CASH", accountId: cashAccount }] }))
      .rejects.toMatchObject({ statusCode: 409 });
    const third = await createRule(ctx, { code: "CASH_SALE", name: "Venta con IVA", eventType: "CASH_SALE",
      effectiveFrom: "2026-09-01", supersedesId: second.rule.id,
      entries: [{ role: "CASH", accountId: cashAccount }, { role: "INCOME", accountId: incomeAccount }] });
    expect(third.rule.version).toBe(3);

    // History is append-only: no update or delete, not even through SQL.
    for (const query of ["UPDATE accounting_rules SET name='Cambiado' WHERE id=$1",
      "DELETE FROM accounting_rules WHERE id=$1", "UPDATE accounting_rule_entries SET role='OTRO' WHERE rule_id=$1",
      "DELETE FROM accounting_rule_entries WHERE rule_id=$1"]) {
      await expect(scoped(companyId, c => c.query(query, [first.rule.id]))).rejects.toMatchObject({ code: "23514" });
    }

    const listed = await listRules(ctx, { eventType: "CASH_SALE", pageSize: 2 });
    expect(listed.items.map(rule => rule.version)).toEqual([3, 2]);
    expect(listed.hasMore).toBe(true);
  });

  it("rejects rule entries whose account is not usable at the effective date", async () => {
    const parent = await createAccount(ctx, account(nextCode("RA"), { postable: false, active: true }));
    const frozen = await createAccount(ctx, account(nextCode("RB"), { active: false }));
    const later = await createAccount(ctx, account(nextCode("RL"), { validFrom: "2026-07-01" }));
    for (const accountId of [parent.id, frozen.id, later.id]) {
      await expect(createRule(ctx, { code: nextCode("BAD"), name: "Cuenta no usable", eventType: "BAD_ACCOUNT",
        effectiveFrom: "2026-01-01", entries: [{ role: "CASH", accountId }] }))
        .rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it("previews the version effective at the date with its blockers", async () => {
    const missing = await previewRule(ctx, { eventType: "CASH_SALE", date: "2025-12-31" });
    expect(missing.rule).toBeNull();
    expect(missing.blockers.map(blocker => blocker.code)).toEqual(["RULE_MISSING"]);
    expect((await previewRule(ctx, { eventType: "CASH_SALE", date: "2026-02-01" })).rule?.version).toBe(1);
    expect((await previewRule(ctx, { eventType: "CASH_SALE", date: "2026-07-01" })).rule?.version).toBe(2);
    const current = await previewRule(ctx, { eventType: "CASH_SALE", date: "2026-10-15" });
    expect(current.rule?.version).toBe(3);
    expect(current.blockers).toEqual([]);
    expect(current.entries).toHaveLength(2);
  });

  it("freezes the resolved rule when publishing a fact and blocks without one", async () => {
    const debit = await createAccount(ctx, account(nextCode("JD")));
    const credit = await createAccount(ctx, account(nextCode("JC"), { kind: "INCOME", normalBalance: "CREDIT" }));
    const lines = [{ accountId: debit.id, debitCents: 5000 }, { accountId: credit.id, creditCents: 5000 }];
    const fact = source("EXPENSE_RECOGNIZED");

    const orphan = await createDraft(ctx, { accountingDate: "2026-10-15", description: "Gasto sin regla", source: fact, lines });
    await expect(publishDraft(ctx, orphan.id, { expectedVersion: 1, reason: "Revisión contable sintética" }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("regla vigente") });
    expect((await getJournal(ctx, orphan.id)).status).toBe("DRAFT");

    const rule = await createRule(ctx, { code: "EXPENSE_RECOGNIZED", name: "Gasto reconocido", eventType: "EXPENSE_RECOGNIZED",
      effectiveFrom: "2026-01-01", entries: [{ role: "EXPENSE", accountId: cashAccount }] });
    const posted = await publishDraft(ctx, orphan.id, { expectedVersion: 1, reason: "Revisión contable sintética" });
    expect(posted).toMatchObject({ status: "POSTED", ruleId: rule.rule.id, ruleVersion: 1 });

    // A rule from another company, a mismatched fact or a future version never reaches the draft.
    await expect(createDraft(ctx, { accountingDate: "2026-10-15", description: "Regla ajena",
      source: source("EXPENSE_RECOGNIZED"), ruleId: randomUUID(), lines })).rejects.toMatchObject({ statusCode: 404 });
    await expect(createDraft(ctx, { accountingDate: "2026-10-15", description: "Hecho distinto",
      source: source("PAYROLL"), ruleId: rule.rule.id, lines })).rejects.toMatchObject({ statusCode: 400 });
    const future = (await listRules(ctx, { eventType: "CASH_SALE" })).items[0];
    await expect(createDraft(ctx, { accountingDate: "2026-08-01", description: "Regla futura",
      source: source("CASH_SALE"), ruleId: future.id, lines })).rejects.toMatchObject({ statusCode: 409 });

    // A retired version stops the posting with its own reason.
    const retired = await createRule(ctx, { code: "PAYROLL", name: "Nómina retirada", eventType: "PAYROLL",
      effectiveFrom: "2026-10-01", active: false, entries: [{ role: "WAGE", accountId: cashAccount }] });
    const payroll = await createDraft(ctx, { accountingDate: "2026-10-15", description: "Nómina", source: source("PAYROLL"), lines });
    await expect(publishDraft(ctx, payroll.id, { expectedVersion: 1, reason: "Revisión contable sintética" }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("retirada") });
    expect((await previewRule(ctx, { eventType: "PAYROLL", date: "2026-10-15" })).blockers.map(blocker => blocker.code))
      .toEqual(["RULE_RETIRED"]);
    expect(retired.rule.active).toBe(false);

    // An account that stops being usable blocks too, and the preview says which role.
    const supplier = await createRule(ctx, { code: "SUPPLIER_INVOICE", name: "Factura de proveedor",
      eventType: "SUPPLIER_INVOICE", effectiveFrom: "2026-01-01", entries: [{ role: "PAYABLE", accountId: payableAccount }] });
    const invoice = await createDraft(ctx, { accountingDate: "2026-10-15", description: "Factura", source: source("SUPPLIER_INVOICE"), lines });
    await updateAccount(ctx, payableAccount, { active: false });
    const blocked = await previewRule(ctx, { eventType: "SUPPLIER_INVOICE", date: "2026-10-15" });
    expect(blocked.blockers).toMatchObject([{ code: "ACCOUNT_INACTIVE", role: "PAYABLE" }]);
    await expect(publishDraft(ctx, invoice.id, { expectedVersion: 1, reason: "Revisión contable sintética" }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("inactiva") });
    await updateAccount(ctx, payableAccount, { active: true });
    expect(await publishDraft(ctx, invoice.id, { expectedVersion: 1, reason: "Revisión contable sintética" }))
      .toMatchObject({ status: "POSTED", ruleId: supplier.rule.id, ruleVersion: 1 });
  });

  it("creates one balanced opening with documents and freezes it", async () => {
    const debit = await createAccount(ctx, account(nextCode("OD")));
    const credit = await createAccount(ctx, account(nextCode("OC"), { kind: "EQUITY", normalBalance: "CREDIT" }));
    const input = { openingDate: "2026-06-01", memo: "Corte inicial", reason: "Acta de apertura 2026",
      lines: [{ accountId: debit.id, debitCents: 250000 }, { accountId: credit.id, creditCents: 250000 }],
      documents: [{ label: "Balance inicial", reference: "ACTA-2026-01", amountCents: 250000 }] };

    const createdOpening = await createOpening(ctx, input);
    expect(createdOpening.journal).toMatchObject({ status: "POSTED", accountingDate: "2026-06-01" });
    expect(createdOpening.opening).toMatchObject({ openingDate: "2026-06-01", memo: "Corte inicial" });

    const stored = await getOpening(ctx);
    expect(stored).toMatchObject({ documents: [{ label: "Balance inicial", reference: "ACTA-2026-01" }],
      journal: { status: "POSTED" }, totals: { debitCents: 250000, creditCents: 250000, balanced: true } });
    expect(stored!.lines).toHaveLength(2);

    await expect(createOpening(ctx, { ...input, openingDate: "2026-07-01" }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("apertura") });
    await expect(createOpening(ctx, { ...input, openingDate: "2026-07-01",
      lines: [{ accountId: debit.id, debitCents: 1 }, { accountId: credit.id, creditCents: 2 }] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(createOpening(ctx, { ...input, openingDate: "2026-07-01", documents: [] }))
      .rejects.toMatchObject({ statusCode: 400 });

    // The opening is frozen: no edit, no delete, and nothing may be dated on or before it.
    for (const query of ["UPDATE accounting_openings SET memo='Otro' WHERE id=$1",
      "DELETE FROM accounting_openings WHERE id=$1"]) {
      await expect(scoped(companyId, c => c.query(query, [createdOpening.opening.id]))).rejects.toMatchObject({ code: "23514" });
    }
    for (const date of ["2026-06-01", "2026-05-31"]) {
      await expect(createDraft(ctx, { accountingDate: date, description: "Antes de la apertura",
        lines: [{ accountId: debit.id, debitCents: 100 }, { accountId: credit.id, creditCents: 100 }] }))
        .rejects.toMatchObject({ statusCode: 409 });
    }
    const after = await createDraft(ctx, { accountingDate: "2026-06-02", description: "Después de la apertura",
      lines: [{ accountId: debit.id, debitCents: 100 }, { accountId: credit.id, creditCents: 100 }] });
    expect(await publishDraft(ctx, after.id, { expectedVersion: 1, reason: "Revisión contable sintética" }))
      .toMatchObject({ status: "POSTED" });
  });

  it("refuses an opening that overlaps posted history", async () => {
    const debit = await createAccount(foreign, account(nextCode("FD")));
    const credit = await createAccount(foreign, account(nextCode("FC"), { kind: "EQUITY", normalBalance: "CREDIT" }));
    const lines = [{ accountId: debit.id, debitCents: 1000 }, { accountId: credit.id, creditCents: 1000 }];
    const history = await createDraft(foreign, { accountingDate: "2026-06-01", description: "Historial previo", lines });
    await publishDraft(foreign, history.id, { expectedVersion: 1, reason: "Revisión contable sintética" });
    await expect(createOpening(foreign, { openingDate: "2026-06-01", reason: "Apertura tardía", lines,
      documents: [{ label: "Balance", reference: "ACTA-9" }] }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("solapamiento") });
    expect(await getOpening(foreign)).toBeNull();
  });

  it("requires at least one supporting document at commit", async () => {
    const journalId = randomUUID(), openingId = randomUUID();
    await expect(scoped(quietCompany, async c => {
      await c.query(`INSERT INTO accounting_journals (id,company_id,accounting_date,description,currency,
        source_type,source_id,source_version,created_by,updated_by)
        VALUES ($1,$2,'2026-06-01','Apertura sin documentos','MXN','OPENING',$3,1,$4,$4)`,
      [journalId, quietCompany, openingId, quietActor]);
      await c.query(`INSERT INTO accounting_openings (id,company_id,journal_id,opening_date,memo,created_by)
        VALUES ($1,$2,$3,'2026-06-01','Sin respaldo',$4)`, [openingId, quietCompany, journalId, quietActor]);
    })).rejects.toMatchObject({ code: "23514" });
    expect((await scoped(quietCompany, c => c.query("SELECT count(*)::int AS n FROM accounting_openings"), true))
      .rows[0].n).toBe(0);
  });

  it("isolates companies, permissions and missing tenant context", async () => {
    // A rule cannot borrow an account from another company: the entry guard rejects it first.
    await expect(createRule(foreign, { code: "FOREIGN", name: "Ajena", eventType: "CASH_SALE", effectiveFrom: "2026-01-01",
      entries: [{ role: "CASH", accountId: cashAccount }] })).rejects.toMatchObject({ statusCode: 409,
      message: expect.stringContaining("cuentas") });
    await expect(getRule(foreign, (await listRules(ctx)).items[0].id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await listRules(foreign)).items).toEqual([]);
    expect((await previewRule(foreign, { eventType: "CASH_SALE", date: "2026-07-01" })).rule).toBeNull();

    await expect(createRule({ ...ctx, actorId: foreignActor }, { code: "STOLEN", name: "Actor ajeno",
      eventType: "CASH_SALE", effectiveFrom: "2026-01-01", entries: [{ role: "CASH", accountId: cashAccount }] }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(listRules({ ...ctx, role: "GERENTE" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(createOpening({ ...ctx, role: "GERENTE" }, { openingDate: "2026-07-01", reason: "Sin permiso",
      lines: [], documents: [{ label: "Balance", reference: "ACTA-X" }] })).rejects.toMatchObject({ statusCode: 403 });

    expect((await scoped(null, c => c.query("SELECT id FROM accounting_rules"), true)).rows).toEqual([]);
    expect((await scoped(null, c => c.query("SELECT id FROM accounting_openings"), true)).rows).toEqual([]);
    expect((await scoped(quietCompany, c => c.query("SELECT id FROM accounting_openings"), true)).rows).toEqual([]);
    expect((await scoped(foreignCompany, c => c.query("SELECT id FROM accounting_rules WHERE code='CASH_SALE'"), true)).rows)
      .toEqual([]);

    // The runtime role may read and append rules, never rewrite the history.
    const [rule] = (await listRules(ctx, { eventType: "CASH_SALE" })).items;
    const opening = await getOpening(ctx);
    for (const [query, id] of [["UPDATE accounting_rules SET name='X' WHERE id=$1", rule.id],
      ["DELETE FROM accounting_rules WHERE id=$1", rule.id],
      ["DELETE FROM accounting_openings WHERE id=$1", opening!.opening.id]] as const) {
      await expect(scoped(companyId, c => c.query(query, [id]), true)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("runs the rule and opening surface with provisioned runtime privileges", async () => {
    const client = await pool.connect(), previous = state.db;
    try {
      await client.query(`SET ROLE "${role}"`);
      state.db = drizzle(client, { schema });
      const fourth = await createRule(ctx, { code: "CASH_SALE", name: "Venta con IVA", eventType: "CASH_SALE",
        effectiveFrom: "2026-11-01", supersedesId: (await listRules(ctx, { eventType: "CASH_SALE" })).items[0].id,
        entries: [{ role: "CASH", accountId: cashAccount }] });
      expect(fourth.rule.version).toBe(4);
      expect((await previewRule(ctx, { eventType: "CASH_SALE", date: "2026-11-15" })).rule?.version).toBe(4);
      expect((await getOpening(ctx))?.documents).toHaveLength(1);

      const debit = await createAccount(ctx, account(nextCode("TD")));
      const credit = await createAccount(ctx, account(nextCode("TC"), { kind: "INCOME", normalBalance: "CREDIT" }));
      const journal = await createDraft(ctx, { accountingDate: "2026-12-01", description: "Venta de contado",
        source: source("CASH_SALE"), lines: [{ accountId: debit.id, debitCents: 100 }, { accountId: credit.id, creditCents: 100 }] });
      expect(await publishDraft(ctx, journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" }))
        .toMatchObject({ status: "POSTED", ruleId: fourth.rule.id, ruleVersion: 4 });
    } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
  });
});
