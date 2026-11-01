import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount, updateAccount } from "@/lib/services/accounting/account-service";
import { createDraft, updateDraft, publishDraft, deleteDraft, getJournal, listJournals } from "@/lib/services/accounting/journal-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc06_${randomUUID().replaceAll("-", "")}`;
const role = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), foreignActor = randomUUID();
const centerId = randomUUID(), foreignCenter = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
const account = (code: string, extra = {}) => ({ code, name: `Cuenta ${code}`, kind: "ASSET" as const,
  normalBalance: "DEBIT" as const, validFrom: "2026-10-01", ...extra });
let created = false, roleCreated = false;

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
  await pool.query(`INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')`, [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at) VALUES
    ($1,'admin@fixture.invalid','OWNER',$3,now(),now()),($2,'foreign@fixture.invalid','OWNER',$4,now(),now())`,
  [actorId, foreignActor, companyId, foreignCompany]);
  await pool.query(`INSERT INTO cost_centers (id,company_id,code,name,accounting_line) VALUES
    ($1,$2,'4103','Electricidad','OPEX-LUZ'),($3,$4,'4103','Ajeno','PRIVATE LINE')`, [centerId, companyId, foreignCenter, foreignCompany]);
  await pool.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${role}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals", "0128_fc06_journal_guards", "0129_fc07_review"]) {
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

async function draft(extra = {}) {
  const debit = await createAccount(ctx, account(`D-${randomUUID().slice(0, 8)}`));
  const credit = await createAccount(ctx, account(`C-${randomUUID().slice(0, 8)}`));
  const input = { accountingDate: "2026-10-15", description: "Gasto sintético", lines: [
    { accountId: debit.id, debitCents: 12345 }, { accountId: credit.id, creditCents: 12345 },
  ], ...extra };
  return { journal: await createDraft(ctx, input), input, debit, credit };
}
const postSql = `UPDATE accounting_journals SET status='POSTED',number=99999,
  posted_by=$2,posted_at=now(),posting_reason='Revisión contable sintética',version=version+1 WHERE id=$1`;

describe("FC-06 — transactional journals", () => {
  it("publishes exact cents and makes headers and lines immutable", async () => {
    const { journal } = await draft();
    expect(await publishDraft(ctx, journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" })).toMatchObject({ status: "POSTED", version: 2, postedBy: actorId });
    expect((await getJournal(ctx, journal.id)).totals).toEqual({ debitCents: 12345, creditCents: 12345, balanced: true });
    await expect(deleteDraft(ctx, journal.id, { expectedVersion: 2 })).rejects.toMatchObject({ statusCode: 409 });
    for (const query of ["DELETE FROM accounting_journals WHERE id=$1",
      "UPDATE accounting_journals SET description='Changed',version=version+1 WHERE id=$1",
      "DELETE FROM accounting_journal_lines WHERE journal_id=$1",
      "UPDATE accounting_journal_lines SET debit_cents=1 WHERE journal_id=$1 AND debit_cents>0"]) {
      await expect(scoped(companyId, c => c.query(query, [journal.id]), true)).rejects.toMatchObject({ code: "23514" });
    }
  });
  it("rejects imbalance in service and SQL and preserves the draft", async () => {
    const { journal, input } = await draft();
    await updateDraft(ctx, journal.id, { ...input, expectedVersion: 1,
      lines: [input.lines[0], { ...input.lines[1], creditCents: 12344 }] });
    await expect(publishDraft(ctx, journal.id, { expectedVersion: 2, reason: "Revisión contable sintética" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(scoped(companyId, c => c.query(postSql, [journal.id, actorId]), true)).rejects.toMatchObject({ code: "23514" });
    expect(await getJournal(ctx, journal.id)).toMatchObject({ status: "DRAFT", number: null, version: 2 });
  });
  it("rolls back header and lines when the replacement fails", async () => {
    const { journal, input } = await draft();
    await expect(updateDraft(ctx, journal.id, { ...input, description: "Must roll back", expectedVersion: 1,
      lines: [input.lines[0], { accountId: randomUUID(), creditCents: 12345 }] })).rejects.toMatchObject({ statusCode: 409 });
    expect(await getJournal(ctx, journal.id)).toMatchObject({ description: input.description, version: 1,
      lines: [{ accountId: input.lines[0].accountId }, { accountId: input.lines[1].accountId }] });
  });
  it("enforces optimistic versions and source uniqueness under concurrency", async () => {
    const { journal, input } = await draft();
    const edits = await Promise.allSettled([1, 2].map(n => updateDraft(ctx, journal.id,
      { ...input, description: `Edit ${n}`, expectedVersion: 1 })));
    expect(edits.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(edits.find(r => r.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    const source = { type: "TEST", id: randomUUID(), version: 1, eventType: "RECOGNIZED" };
    const creates = await Promise.allSettled([createDraft(ctx, { ...input, source }), createDraft(ctx, { ...input, source })]);
    expect(creates.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("serializes concurrent publication with one winner and distinct folios", async () => {
    const a = await draft(), b = await draft();
    const attempts = await Promise.allSettled([publishDraft(ctx, a.journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" }),
      publishDraft(ctx, a.journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" }), publishDraft(ctx, b.journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" })]);
    const posted = attempts.filter(r => r.status === "fulfilled");
    expect(posted).toHaveLength(2);
    expect(new Set(posted.map(r => r.value.number)).size).toBe(2);
  });
  it("rejects invalid cents, overflowing totals and expired accounts", async () => {
    const { journal, input, debit } = await draft();
    for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(createDraft(ctx, { ...input, lines: [{ accountId: debit.id, debitCents: amount }] }))
        .rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(createDraft(ctx, { ...input, lines: [
      { accountId: debit.id, debitCents: Number.MAX_SAFE_INTEGER }, { accountId: debit.id, debitCents: 1 },
    ] })).rejects.toMatchObject({ statusCode: 400 });
    await updateAccount(ctx, debit.id, { validTo: "2026-10-14" });
    await expect(publishDraft(ctx, journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(scoped(companyId, c => c.query(postSql, [journal.id, actorId]), true)).rejects.toMatchObject({ code: "23514" });
  });
  it("cannot move a posted line into an editable draft", async () => {
    const a = await draft(), b = await draft();
    await publishDraft(ctx, a.journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" });
    await expect(scoped(companyId, c => c.query(`UPDATE accounting_journal_lines SET journal_id=$2,line_number=line_number+10
      WHERE journal_id=$1`, [a.journal.id, b.journal.id]), true)).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects invalid branch on initial insertion", async () => {
    await expect(draft({ branchId: randomUUID() })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("waits for an uncommitted line change before validating publication", async () => {
    const { journal } = await draft();
    const writer = await pool.connect();
    let posting: Promise<unknown> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
      await writer.query("UPDATE accounting_journal_lines SET credit_cents=12346 WHERE journal_id=$1 AND credit_cents>0", [journal.id]);
      posting = publishDraft(ctx, journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" }).then(
        result => ({ result }), error => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 30 && !waiting; attempt++) {
        const result = await pool.query(`SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND NOT granted AND objid =
          (hashtextextended($1,505) & 4294967295)::oid) AS waiting`, [companyId]);
        waiting = result.rows[0].waiting;
      }
      expect(waiting).toBe(true);
      await writer.query("COMMIT");
      expect(await posting).toMatchObject({ error: { statusCode: 409 } });
      expect(await getJournal(ctx, journal.id)).toMatchObject({ status: "DRAFT", totals: { balanced: false } });
    } finally { await writer.query("ROLLBACK"); writer.release(); await posting; }
  });

  it("enforces SQL overflow and rejects stale-snapshot isolation", async () => {
    const { journal } = await draft();
    await scoped(companyId, async c => {
      await c.query("UPDATE accounting_journal_lines SET debit_cents=9007199254740991 WHERE journal_id=$1 AND debit_cents>0", [journal.id]);
      await c.query("UPDATE accounting_journal_lines SET credit_cents=9007199254740991 WHERE journal_id=$1 AND credit_cents>0", [journal.id]);
      await c.query(`INSERT INTO accounting_journal_lines(company_id,journal_id,line_number,account_id,debit_cents,credit_cents)
        SELECT company_id,journal_id,line_number+10,account_id,CASE WHEN debit_cents>0 THEN 1 ELSE 0 END,
        CASE WHEN credit_cents>0 THEN 1 ELSE 0 END FROM accounting_journal_lines WHERE journal_id=$1`, [journal.id]);
    });
    await expect(scoped(companyId, c => c.query(postSql, [journal.id, actorId]), true)).rejects.toMatchObject({ code: "23514" });
    await expect(scoped(companyId, c => c.query("UPDATE accounting_journals SET version=version+1 WHERE id=$1", [journal.id]),
      true, "REPEATABLE READ")).rejects.toMatchObject({ code: "0A000" });
  });
  it("blocks creation and publication in an already closed period", async () => {
    const { journal, input } = await draft({ accountingDate: "2026-11-15" });
    await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,11,'CLOSED')", [companyId]);
    await expect(createDraft(ctx, input)).rejects.toMatchObject({ statusCode: 409 });
    await expect(publishDraft(ctx, journal.id, { expectedVersion: 1, reason: "Revisión contable sintética" })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("enforces tenant isolation, actor and conservative company scope", async () => {
    const { journal } = await draft();
    const other = { companyId: foreignCompany, actorId: foreignActor, role: "OWNER" as const };
    await expect(getJournal(other, journal.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await listJournals(other)).items).toEqual([]);
    await expect(getJournal({ ...ctx, actorId: foreignActor }, journal.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(listJournals({ ...ctx, role: "GERENTE" })).rejects.toMatchObject({ statusCode: 403 });
    expect((await scoped(null, c => c.query("SELECT id FROM accounting_journals"), true)).rows).toEqual([]);
    expect((await scoped(foreignCompany, c => c.query("SELECT id FROM accounting_journals WHERE id=$1", [journal.id]), true)).rows).toEqual([]);
  });
  it("runs the lifecycle with provisioned runtime privileges", async () => {
    const client = await pool.connect(), previous = state.db;
    try {
      await client.query(`SET ROLE "${role}"`);
      state.db = drizzle(client, { schema });
      const { journal, input } = await draft();
      await updateDraft(ctx, journal.id, { ...input, expectedVersion: 1, description: "Runtime" });
      expect(await publishDraft(ctx, journal.id, { expectedVersion: 2, reason: "Revisión contable sintética" })).toMatchObject({ status: "POSTED" });
      const removable = await createDraft(ctx, input);
      await deleteDraft(ctx, removable.id, { expectedVersion: 1 });
      await expect(getJournal(ctx, removable.id)).rejects.toMatchObject({ statusCode: 404 });
    } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
  });
});


