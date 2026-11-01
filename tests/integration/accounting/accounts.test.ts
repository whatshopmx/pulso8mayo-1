import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount, updateAccount, linkSource, listAccounts, listSourceLinks } from "@/lib/services/accounting/account-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc05_${randomUUID().replaceAll("-", "")}`;
const role = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), foreignActor = randomUUID();
const centerId = randomUUID(), foreignCenter = randomUUID();
const ctx = { companyId, actorId, role: "ADMIN" as const };
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
  for (const table of ["companies", "users", "cost_centers", "company_bank_accounts"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  await pool.query(`INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')`, [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at) VALUES
    ($1,'admin@fixture.invalid','ADMIN',$3,now(),now()),($2,'foreign@fixture.invalid','ADMIN',$4,now(),now())`,
  [actorId, foreignActor, companyId, foreignCompany]);
  await pool.query(`INSERT INTO cost_centers (id,company_id,code,name,accounting_line) VALUES
    ($1,$2,'4103','Electricidad','OPEX-LUZ'),($3,$4,'4103','Ajeno','PRIVATE LINE')`, [centerId, companyId, foreignCenter, foreignCompany]);
  await pool.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${role}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards"]) {
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

async function bank(purpose: "RECEPCION" | "DISPERSION" | "MIXTO", company = companyId, currency = "MXN", active = true) {
  const id = randomUUID();
  await pool.query(`INSERT INTO company_bank_accounts
    (id,company_id,label,account_number,account_last_four,account_fingerprint,bank_code,bank_name,registered_by,purpose,currency,active)
    VALUES ($1,$2,'PRIVATE LABEL','PRIVATE CIPHERTEXT','0001',$3,'012','PRIVATE BANK',$4,$5,$6,$7)`,
  [id, company, randomUUID(), company === companyId ? actorId : foreignActor, purpose, currency, active]);
  return id;
}

async function runtimeService<T>(operation: () => Promise<T>) {
  const client = await pool.connect(), previous = state.db;
  try {
    await client.query(`SET ROLE "${role}"`);
    state.db = drizzle(client, { schema });
    return await operation();
  } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
}

describe("FC-05 — integridad, permisos y catálogos reutilizados", () => {
  it("requires an authorized active actor in the same company", async () => {
    for (const actorRole of ["GERENTE", "EMPLEADO", "READONLY"] as const) {
      await expect(createAccount({ ...ctx, role: actorRole }, account("DENIED"))).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(createAccount({ ...ctx, actorId: foreignActor }, account("DENIED"))).rejects.toMatchObject({ statusCode: 403 });
    await expect(createAccount({ ...ctx, companyId: "" }, account("DENIED"))).rejects.toMatchObject({ statusCode: 400 });
    await pool.query("UPDATE users SET active=false WHERE id=$1", [actorId]);
    try { await expect(createAccount(ctx, account("DENIED"))).rejects.toMatchObject({ statusCode: 403 }); }
    finally { await pool.query("UPDATE users SET active=true WHERE id=$1", [actorId]); }
  });

  it("validates account kinds, contra-account nature and effective dates", async () => {
    for (const kind of ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const) {
      expect(await createAccount(ctx, account(`TYPE-${kind}`, { kind, normalBalance: "CREDIT" })))
        .toMatchObject({ kind, normalBalance: "CREDIT" });
    }
    await expect(createAccount(ctx, account("BAD CODE"))).rejects.toMatchObject({ statusCode: 400 });
    await expect(createAccount(ctx, account("ZERO-DATE", { validFrom: "0000-01-01" }))).rejects.toMatchObject({ statusCode: 400 });
    const dated = await createAccount(ctx, account("DATED"));
    await expect(updateAccount(ctx, dated.id, { validTo: "2026-09-30" })).rejects.toMatchObject({ statusCode: 409 });
    expect(await updateAccount(ctx, dated.id, { validTo: "2026-12-31", active: false })).toMatchObject({ active: false, validTo: "2026-12-31" });
  });

  it("prevents duplicates under simultaneous creation", async () => {
    const results = await Promise.allSettled([createAccount(ctx, account("SAME")), createAccount(ctx, account(" same "))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
  });

  it("scopes stable pages and updates without revealing another company's account", async () => {
    const first = await listAccounts(ctx, { pageSize: 1 });
    const second = await listAccounts(ctx, { page: 2, pageSize: 1 });
    expect(first.hasMore).toBe(true); expect(first.items[0].id).not.toBe(second.items[0].id);
    expect((await listAccounts(ctx, { page: 10000 })).items).toEqual([]);
    const foreign = await createAccount({ companyId: foreignCompany, actorId: foreignActor, role: "ADMIN" }, account("SCOPE-FOREIGN"));
    await expect(updateAccount(ctx, foreign.id, { name: "Hidden" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(createAccount(ctx, account("FOREIGN-PARENT", { parentId: foreign.id }))).rejects.toMatchObject({ statusCode: 404 });
    expect((await listAccounts(ctx, { pageSize: 100 })).items.every(row => row.companyId === companyId)).toBe(true);
  });

  it("rejects hierarchy cycles, incompatible parents and identity rewrites in the database", async () => {
    const root = await createAccount(ctx, account("ROOT", { postable: false }));
    const child = await createAccount(ctx, account("CHILD", { parentId: root.id, postable: false }));
    const leaf = await createAccount(ctx, account("LEAF", { parentId: child.id }));
    await expect(updateAccount(ctx, root.id, { parentId: leaf.id })).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateAccount(ctx, root.id, { postable: true })).rejects.toMatchObject({ statusCode: 409 });
    await expect(createAccount(ctx, account("WRONG-PARENT", { parentId: leaf.id }))).rejects.toMatchObject({ statusCode: 409 });
    await expect(createAccount(ctx, account("WRONG-KIND", { parentId: root.id, kind: "EXPENSE" }))).rejects.toMatchObject({ statusCode: 409 });
    await expect(scoped(companyId, client => client.query("UPDATE accounting_accounts SET code='OTHER' WHERE id=$1", [leaf.id])))
      .rejects.toMatchObject({ code: "23514" });
    const a = await createAccount(ctx, account("BATCH-A", { postable: false }));
    const b = await createAccount(ctx, account("BATCH-B", { postable: false }));
    await expect(scoped(companyId, client => client.query(`UPDATE accounting_accounts
      SET parent_id=CASE WHEN id=$1 THEN $2::uuid ELSE $1::uuid END WHERE id IN ($1,$2)`, [a.id, b.id])))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("reuses a cost center, preserves accountingLine and replaces only its current link", async () => {
    const first = await createAccount(ctx, account("EXP-A", { kind: "EXPENSE" }));
    const second = await createAccount(ctx, account("EXP-B", { kind: "EXPENSE" }));
    const link = await linkSource(ctx, { accountId: first.id, costCenterId: centerId });
    const replaced = await linkSource(ctx, { accountId: second.id, costCenterId: centerId });
    expect(replaced).toMatchObject({ id: link.id, accountId: second.id, companyId, createdBy: actorId });
    expect((await pool.query("SELECT accounting_line FROM cost_centers WHERE id=$1", [centerId])).rows[0].accounting_line).toBe("OPEX-LUZ");
    await expect(pool.query("UPDATE cost_centers SET company_id=$1 WHERE id=$2", [foreignCompany, centerId]))
      .rejects.toMatchObject({ code: "23503" });
  });

  it("links every existing bank purpose without copying sensitive fields", async () => {
    const target = await createAccount(ctx, account("BANK"));
    for (const purpose of ["RECEPCION", "DISPERSION", "MIXTO"] as const) {
      const bankId = await bank(purpose);
      expect(await linkSource(ctx, { accountId: target.id, bankAccountId: bankId })).toMatchObject({ bankAccountId: bankId, companyId });
      expect((await pool.query("SELECT purpose FROM company_bank_accounts WHERE id=$1", [bankId])).rows[0].purpose).toBe(purpose);
    }
    const links = await listSourceLinks(ctx, { pageSize: 100 });
    expect(JSON.stringify(links)).not.toMatch(/PRIVATE|accountNumber|account_number|clabe|bankName|bank_name/);
    expect(links.items.every(link => link.companyId === companyId)).toBe(true);
  });

  it("denies foreign sources/accounts, incomplete links, inactive and non-MXN sources", async () => {
    const target = await createAccount(ctx, account("LINK-TARGET"));
    const foreign = await createAccount({ companyId: foreignCompany, actorId: foreignActor, role: "ADMIN" }, account("FOREIGN-LINK"));
    await expect(linkSource(ctx, { accountId: foreign.id, costCenterId: centerId })).rejects.toMatchObject({ statusCode: 404 });
    const foreignBank = await bank("MIXTO", foreignCompany);
    await expect(linkSource(ctx, { accountId: target.id, costCenterId: foreignCenter })).rejects.toMatchObject({ statusCode: 404 });
    await expect(linkSource(ctx, { accountId: target.id, bankAccountId: foreignBank })).rejects.toMatchObject({ statusCode: 404 });
    await expect(linkSource(ctx, { accountId: target.id } as Parameters<typeof linkSource>[1])).rejects.toMatchObject({ statusCode: 400 });
    const foreignCurrency = await bank("RECEPCION", companyId, "USD");
    const inactive = await bank("DISPERSION", companyId, "MXN", false);
    for (const bankAccountId of [foreignCurrency, inactive]) {
      await expect(linkSource(ctx, { accountId: target.id, bankAccountId })).rejects.toMatchObject({ statusCode: 409 });
    }
    const expense = await createAccount(ctx, account("NOT-BANK", { kind: "EXPENSE" }));
    await expect(linkSource(ctx, { accountId: expense.id, bankAccountId: await bank("MIXTO") })).rejects.toMatchObject({ statusCode: 409 });
    for (const extra of [{ active: false }, { postable: false }]) {
      const invalid = await createAccount(ctx, account(`LINK-${extra.active === false ? "INACTIVE" : "SUMMARY"}`, extra));
      await expect(linkSource(ctx, { accountId: invalid.id, costCenterId: centerId })).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it("enforces fail-closed tenant RLS for a NOBYPASSRLS runtime role", async () => {
    const missing = await scoped(null, client => client.query("SELECT company_id FROM accounting_accounts"), true);
    expect(missing.rows).toEqual([]);
    const visible = await scoped(foreignCompany, client => client.query("SELECT company_id FROM accounting_accounts"), true);
    expect(visible.rows.length).toBeGreaterThan(0);
    expect(visible.rows.every(row => row.company_id === foreignCompany)).toBe(true);
    await expect(scoped(foreignCompany, client => client.query(`INSERT INTO accounting_accounts
      (company_id,code,name,kind,normal_balance,valid_from,created_by,updated_by)
      VALUES ($1,'ILLEGAL','Illegal','ASSET','DEBIT','2026-10-01',$2,$2)`, [companyId, actorId]), true))
      .rejects.toMatchObject({ code: "42501" });
    expect((await scoped(foreignCompany, client => client.query("UPDATE accounting_accounts SET name='HIDDEN' WHERE company_id=$1", [companyId]), true)).rowCount).toBe(0);
    expect((await scoped(null, client => client.query("SELECT * FROM accounting_source_links"), true)).rows).toEqual([]);
    await expect(scoped(companyId, client => client.query("SELECT account_number FROM company_bank_accounts"), true))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("runs the complete service as runtime using only migration-provisioned privileges", async () => {
    const bankAccountId = await bank("MIXTO");
    await runtimeService(async () => {
      const target = await createAccount(ctx, account("RUNTIME"));
      expect(await linkSource(ctx, { accountId: target.id, bankAccountId })).toMatchObject({ accountId: target.id, bankAccountId });
      expect(await linkSource(ctx, { accountId: target.id, costCenterId: centerId })).toMatchObject({ costCenterId: centerId });
      expect(await updateAccount(ctx, target.id, { name: "Actualizada" })).toMatchObject({ name: "Actualizada" });
      expect((await listAccounts(ctx, { pageSize: 100 })).items.some(row => row.id === target.id)).toBe(true);
      expect((await listSourceLinks(ctx, { pageSize: 100 })).items.every(row => row.companyId === companyId)).toBe(true);
    });
  });

  it("serializes concurrent reparenting and rejects unsupported stale-snapshot isolation", async () => {
    const a = await createAccount(ctx, account("RACE-A", { postable: false }));
    const b = await createAccount(ctx, account("RACE-B", { postable: false }));
    const one = await pool.connect(), two = await pool.connect();
    try {
      for (const client of [one, two]) {
        await client.query("BEGIN"); await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
      }
      const pid = (await two.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      await one.query("UPDATE accounting_accounts SET parent_id=$1 WHERE id=$2", [b.id, a.id]);
      const pending = two.query("UPDATE accounting_accounts SET parent_id=$1 WHERE id=$2", [a.id, b.id])
        .then(() => ({ error: null }), (error: { code: string }) => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 10 && !waiting; attempt++) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) waiting", [pid])).rows[0].waiting;
      }
      expect(waiting).toBe(true);
      await one.query("COMMIT"); expect((await pending).error).toMatchObject({ code: "23514" });
    } finally { await one.query("ROLLBACK"); await two.query("ROLLBACK"); one.release(); two.release(); }
    await expect(scoped(companyId, client => client.query("UPDATE accounting_accounts SET name='RR' WHERE id=$1", [a.id]), false, "REPEATABLE READ"))
      .rejects.toMatchObject({ code: "0A000" });
  });
});

describe("FC-05 — cuentas y vínculos en Postgres aislado", () => {
  it("preserves QSR classification and creates normalized company-scoped codes", async () => {
    const first = await createAccount(ctx, account(" 1100 "));
    expect(first).toMatchObject({ companyId, code: "1100", normalBalance: "DEBIT", kind: "ASSET", active: true });
    await expect(createAccount(ctx, account("1100"))).rejects.toMatchObject({ statusCode: 409 });
    const other = await createAccount({ companyId: foreignCompany, actorId: foreignActor, role: "ADMIN" }, account("1100"));
    expect(other.companyId).toBe(foreignCompany);
    expect((await pool.query(`SELECT accounting_line FROM cost_centers WHERE id=$1`, [centerId])).rows[0].accounting_line).toBe("OPEX-LUZ");
  });
});
