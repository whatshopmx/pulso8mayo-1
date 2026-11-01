import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createDraft, publishDraft, getJournal, listJournals, reverseJournal } from "@/lib/services/accounting/journal-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc07_${randomUUID().replaceAll("-", "")}`;
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

const branchA = randomUUID(), branchB = randomUUID(), managerId = randomUUID(), adminId = randomUUID();
const manager = { companyId, actorId: managerId, role: "GERENTE" as const };
const capturer = { companyId, actorId: adminId, role: "ADMIN" as const };
let debit: string, credit: string;
beforeAll(async () => {
  await pool.query("INSERT INTO branches(id,company_id,name,code) VALUES ($1,$3,'Centro','A'),($2,$3,'Norte','B')", [branchA,branchB,companyId]);
  await pool.query(`INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at) VALUES
    ($1,'manager@fixture.invalid','GERENTE',$3,$4,now(),now()),($2,'capturer@fixture.invalid','ADMIN',$3,null,now(),now())`,
  [managerId,adminId,companyId,branchA]);
  debit = (await createAccount(ctx, account("DEBIT"))).id;
  credit = (await createAccount(ctx, account("CREDIT"))).id;
});
const input = (branchId: string | null = branchA) => ({ accountingDate: "2026-10-15", branchId, description: "Gasto sintético",
  lines: [{ accountId: debit, debitCents: 20000 }, { accountId: credit, creditCents: 20000 }] });
const publish = (id: string) => publishDraft(ctx, id, { expectedVersion: 1, reason: "Revisión de documentos" });

describe("FC-07 — scope and review", () => {
  it("separates capture from publication and requires a real reason", async () => {
    const draft = await createDraft(capturer, input());
    await expect(publishDraft(capturer, draft.id, { expectedVersion: 1, reason: "Revisado por captura" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(publishDraft(ctx, draft.id, { expectedVersion: 1, reason: " " })).rejects.toMatchObject({ statusCode: 400 });
    await expect(scoped(companyId,c=>c.query(`UPDATE accounting_journals SET status='POSTED',number=998,
      posted_by=$2,posted_at=now(),version=version+1 WHERE id=$1`,[draft.id,actorId]),true)).rejects.toMatchObject({code:"23514"});
    expect(await publish(draft.id)).toMatchObject({ postingReason: "Revisión de documentos", postedBy: actorId });
  });
  it("derives branch scope from the active DB actor and filters before paging", async () => {
    const own = await createDraft(ctx, input()), other = await createDraft(ctx, input(branchB));
    await createDraft(ctx, input(null));
    const first = await listJournals(manager, { pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items.every(row => row.branchId === branchA)).toBe(true);
    expect(await getJournal(manager, own.id)).toMatchObject({ branchId: branchA });
    await expect(getJournal(manager, other.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(listJournals(manager, { branchId: branchB })).rejects.toMatchObject({ statusCode: 403 });
    await expect(createDraft(manager, input())).rejects.toMatchObject({ statusCode: 403 });
    await pool.query("UPDATE users SET branch_id=null WHERE id=$1", [managerId]);
    try { await expect(listJournals(manager)).rejects.toMatchObject({ statusCode: 403 }); }
    finally { await pool.query("UPDATE users SET branch_id=$2 WHERE id=$1", [managerId,branchA]); }
  });
  it("atomically reverses and creates a replacement while preserving the original", async () => {
    const original = await createDraft(ctx, input()); await publish(original.id);
    const before = await getJournal(ctx, original.id);
    const correction = await reverseJournal(ctx, original.id, { expectedVersion: 2, accountingDate: "2026-10-20",
      reason: "Corregir clasificación de gasto", replacement: { ...input(), accountingDate: "2026-10-20", description: "Gasto corregido" } });
    expect(correction.reversal).toMatchObject({ status: "POSTED", reversalOfId: original.id, postingReason: "Corregir clasificación de gasto" });
    expect(correction.replacement).toMatchObject({ status: "DRAFT", replacementOfId: original.id });
    const reversed = await getJournal(ctx, correction.reversal.id);
    expect(reversed.lines.map(line => [line.accountId,line.debitCents,line.creditCents]))
      .toEqual([[debit,0,20000],[credit,20000,0]]);
    const after = await getJournal(ctx, original.id);
    expect(after.lines).toEqual(before.lines);
    expect(after.postingReason).toBe(before.postingReason);
    expect(after.related).toEqual(expect.arrayContaining([expect.objectContaining({ id: correction.reversal.id }),
      expect.objectContaining({ id: correction.replacement!.id })]));
    await expect(reverseJournal(capturer, original.id, { expectedVersion: 2, accountingDate: "2026-10-20", reason: "No autorizado" }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it("allows just one reversal under concurrency and hides foreign originals", async () => {
    const draft = await createDraft(ctx, input()); await publish(draft.id);
    const payload = { expectedVersion: 2, accountingDate: "2026-10-21", reason: "Reversa por duplicidad" };
    const attempts = await Promise.allSettled([reverseJournal(ctx,draft.id,payload),reverseJournal(ctx,draft.id,payload)]);
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(attempts.find(r=>r.status==='rejected')).toMatchObject({ reason: { statusCode: 409 } });
    await expect(reverseJournal({ companyId: foreignCompany, actorId: foreignActor, role: "OWNER" }, draft.id,payload))
      .rejects.toMatchObject({ statusCode: 404 });
  });
  it("rolls back a reversal if its replacement fails and rejects altered SQL reversals", async () => {
    const draft = await createDraft(ctx, input()); await publish(draft.id);
    await expect(reverseJournal(ctx,draft.id,{ expectedVersion:2,accountingDate:"2026-10-21",reason:"Fechas distintas",
      replacement:input() })).rejects.toMatchObject({statusCode:400});
    await expect(reverseJournal(ctx,draft.id,{ expectedVersion: 2, accountingDate: "2026-10-21", reason: "Corrección incompleta",
      replacement: { ...input(), accountingDate:"2026-10-21", lines: [{ accountId: randomUUID(), debitCents: 20000 },{accountId: credit,creditCents:20000}] } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await getJournal(ctx,draft.id)).related).toEqual([]);
    await scoped(companyId, async c => {
      const result = await c.query(`INSERT INTO accounting_journals(company_id,accounting_date,description,reversal_of_id,created_by,updated_by,branch_id)
        VALUES ($1,'2026-10-21','Reversa inválida',$2,$3,$3,$4) RETURNING id`,[companyId,draft.id,actorId,branchA]);
      const id = result.rows[0].id;
      await c.query(`INSERT INTO accounting_journal_lines(company_id,journal_id,line_number,account_id,debit_cents,credit_cents)
        VALUES ($1,$2,1,$3,0,1),($1,$2,2,$4,1,0)`,[companyId,id,debit,credit]);
      await expect(c.query(`UPDATE accounting_journals SET status='POSTED',number=999,posting_reason='Reversa alterada',
        posted_by=$2,posted_at=now(),version=version+1 WHERE id=$1`,[id,actorId])).rejects.toMatchObject({ code: "23514" });
      // Rollback the deliberately invalid SQL transaction, including its draft.
      await c.query("ROLLBACK");
    });
  });
  it("rejects closed targets and persists no partial correction", async () => {
    const draft = await createDraft(ctx,input()); await publish(draft.id);
    await pool.query("INSERT INTO financial_periods(company_id,year,month,status) VALUES ($1,2026,11,'CLOSED')",[companyId]);
    await expect(reverseJournal(ctx,draft.id,{ expectedVersion:2,accountingDate:"2026-11-01",reason:"Reversa en mes cerrado" }))
      .rejects.toMatchObject({ statusCode:409 });
    expect((await getJournal(ctx,draft.id)).related).toEqual([]);
  });
});


