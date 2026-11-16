import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, recipes, salesEntries } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const migration = "drizzle/0143_inv01c_recovery_review.sql";
const hashes = { proposal: "a".repeat(64), state: "b".repeat(64) };
async function context(tx: Tx, company = "", branch = "") {
  await tx.execute(sql`SELECT set_config('app.current_company_id',${company},true), set_config('app.current_branch_id',${branch},true)`);
}
async function rejected(tx: Tx, code: string, action: () => Promise<unknown>) {
  await tx.execute(sql.raw("SAVEPOINT recovery_rejected"));
  let actual: string | undefined;
  try { await action(); } catch (error) { const e = error as { code?: string; cause?: { code?: string } }; actual = e.cause?.code ?? e.code; }
  await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT recovery_rejected"));
  expect(actual).toBe(code);
}
async function probe(check: (tx: Tx, f: { company: string[]; branch: string[]; sale: string[]; proposal: string[] }) => Promise<void>) {
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const f = { company: ids(2), branch: ids(3), sale: ids(3), proposal: ids(3) };
  await expect(db.transaction(async tx => {
    // DDL et fixtures revertidos juntos: no aplicación persistente en entorno alguno.
    for (const statement of readFileSync(migration, "utf8").split("--> statement-breakpoint").filter(s => s.trim()))
      await tx.execute(sql.raw(statement));
    await tx.insert(companies).values(f.company.map(id => ({ id, name: "Recovery persistence synthetic" })));
    await tx.insert(branches).values(f.branch.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: "Recovery synthetic branch" })));
    const recipe = ids(2);
    await tx.insert(recipes).values(recipe.map((id, i) => ({ id, companyId: f.company[i], name: "Recovery synthetic recipe" })));
    await tx.insert(salesEntries).values(f.sale.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], branchId: f.branch[i],
      recipeId: recipe[i === 2 ? 1 : 0], quantitySold: "2", saleDate: new Date("2026-11-01"), totalRevenue: 0 })));
    for (let i = 0; i < 3; i++) {
      const companyId = f.company[i === 2 ? 1 : 0];
      await context(tx, companyId, f.branch[i]);
      const payload = { identity: { companyId, branchId: f.branch[i] }, legacy: { id: f.sale[i] },
        requestedBy: "synthetic-requester", idempotencyKey: f.proposal[i], reason: "Recovered with historical source",
        evidence: [{ purpose: "SALE" }, { purpose: "RECIPE_VERSION" }, { purpose: "NO_PRIOR_CONSUMPTION" }] };
      await tx.execute(sql`INSERT INTO sale_recovery_proposals
        (id,company_id,branch_id,legacy_sale_id,idempotency_key,proposal_hash,state_hash,requested_by,reason,proposal,created_at)
        VALUES (${f.proposal[i]},${companyId},${f.branch[i]},${f.sale[i]},${f.proposal[i]},${hashes.proposal},${hashes.state},
          'synthetic-requester',${payload.reason},${JSON.stringify(payload)}::jsonb,'2026-11-13T00:00:00Z')`);
    }
    await check(tx, f);
    throw new Error("recovery persistence rollback esperado");
  })).rejects.toThrow("recovery persistence rollback esperado");
  const tables = await db.execute(sql`SELECT to_regclass('public.sale_recovery_proposals') AS proposal, to_regclass('public.sale_recovery_decisions') AS decision`);
  expect(tables.rows[0]).toEqual({ proposal: null, decision: null });
}
async function decide(tx: Tx, proposalId: string, overrides: { hash?: string; actor?: string; requester?: string; company?: string; branch?: string; decision?: string; role?: string; at?: string } = {}) {
  return tx.execute(sql`INSERT INTO sale_recovery_decisions
    (proposal_id,company_id,branch_id,proposal_hash,state_hash,requested_by,decision,decided_by,approver_role,decided_at)
    SELECT id,coalesce(${overrides.company ?? null}::uuid,company_id),coalesce(${overrides.branch ?? null}::uuid,branch_id),
      ${overrides.hash ?? hashes.proposal},state_hash,${overrides.requester ?? "synthetic-requester"},
      ${overrides.decision ?? "APPROVED"},${overrides.actor ?? "synthetic-reviewer"},${overrides.role ?? "ADMIN"},
      ${overrides.at ?? "2026-11-13T01:00:00Z"}::timestamptz
    FROM sale_recovery_proposals WHERE id=${proposalId} RETURNING id,decision`);
}

describe("INV-01.c.recovery.persistence: expediente inmutable y revisión aislada", () => {
  beforeAll(async () => {
    const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
    expect(host(process.env.TEST_DATABASE_URL!)).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(operational));
    const role = await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(existsSync(migration)).toBe(true);
  });
  it("sin contexto no lee y scope de empresa/sucursal filtra tablas sin WHERE", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await context(tx);
      expect((await tx.execute(sql`SELECT id FROM sale_recovery_proposals`)).rows).toEqual([]);
      await context(tx, f.company[0], f.branch[0]);
      expect((await tx.execute(sql`SELECT id FROM sale_recovery_proposals`)).rows).toEqual([{ id: f.proposal[0] }]);
      await context(tx, f.company[0]);
      expect((await tx.execute(sql`SELECT id FROM sale_recovery_proposals ORDER BY id`)).rows.map(r => r.id).sort()).toEqual(f.proposal.slice(0,2).sort());
      await context(tx, f.company[1], f.branch[2]);
      expect((await tx.execute(sql`SELECT id FROM sale_recovery_proposals`)).rows).toEqual([{ id: f.proposal[2] }]);
    });
  });
  it("habilita solo SELECT/INSERT con RLS forzada en ambas tablas", async () => {
    await probe(async tx => {
      const tables = await tx.execute(sql`SELECT relrowsecurity AS rls,relforcerowsecurity AS force FROM pg_class
        WHERE oid IN ('sale_recovery_proposals'::regclass,'sale_recovery_decisions'::regclass)`);
      expect(tables.rows).toEqual([{ rls: true, force: true },{ rls: true, force: true }]);
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      for (const table of ["sale_recovery_proposals", "sale_recovery_decisions"]) {
        const result = await tx.execute(sql`SELECT has_table_privilege(current_user,${table},'SELECT') AS read,
          has_table_privilege(current_user,${table},'INSERT') AS insert,
          has_table_privilege(current_user,${table},'UPDATE,DELETE,TRUNCATE') AS rewrite`);
        expect(result.rows[0]).toEqual({ read: true, insert: true, rewrite: false });
      }
    });
  });
  it("conserva aprobación/rechazo y restringe su lectura a la sucursal", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await context(tx, f.company[0], f.branch[0]);
      expect((await decide(tx, f.proposal[0])).rows[0].decision).toBe("APPROVED");
      await context(tx, f.company[0], f.branch[1]);
      expect((await decide(tx, f.proposal[1], { decision: "REJECTED" })).rows[0].decision).toBe("REJECTED");
      expect((await tx.execute(sql`SELECT decision FROM sale_recovery_decisions`)).rows).toEqual([{ decision: "REJECTED" }]);
      await context(tx, f.company[1], f.branch[2]);
      expect((await tx.execute(sql`SELECT id FROM sale_recovery_decisions`)).rows).toEqual([]);
    });
  });
  it("rechaza duplicar clave idempotente, omitir envelope o inventar hashes", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app")); await context(tx, f.company[0], f.branch[0]);
      const copy = (column: string, value: string) => tx.execute(sql`INSERT INTO sale_recovery_proposals
        (company_id,branch_id,legacy_sale_id,idempotency_key,proposal_hash,state_hash,requested_by,reason,proposal)
        SELECT company_id,branch_id,legacy_sale_id,idempotency_key,${column === "proposal_hash" ? sql`'fake'` : sql`proposal_hash`},state_hash,
          requested_by,reason,${column === "proposal" ? sql`'{}'::jsonb` : sql`proposal`} FROM sale_recovery_proposals WHERE id=${value}`);
      await rejected(tx, "23505", () => copy("", f.proposal[0]));
      await rejected(tx, "23514", () => copy("proposal", f.proposal[0]));
      await rejected(tx, "23514", () => copy("proposal_hash", f.proposal[0]));
    });
  });
  it("no acepta hashes/solicitante/scope distintos ni autoaprobación o rol insuficiente", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app")); await context(tx, f.company[0]);
      await rejected(tx, "23503", () => decide(tx, f.proposal[0], { hash: "c".repeat(64) }));
      await rejected(tx, "23503", () => decide(tx, f.proposal[0], { requester: "someone-else" }));
      await rejected(tx, "23503", () => decide(tx, f.proposal[0], { branch: f.branch[1] }));
      await rejected(tx, "42501", () => decide(tx, f.proposal[0], { company: f.company[1] }));
      await rejected(tx, "23514", () => decide(tx, f.proposal[0], { actor: "synthetic-requester" }));
      await rejected(tx, "23514", () => decide(tx, f.proposal[0], { role: "GERENTE" }));
      await rejected(tx, "23514", () => decide(tx, f.proposal[0], { at: "2026-11-12T00:00:00Z" }));
      await decide(tx, f.proposal[0]);
      await rejected(tx, "23505", () => decide(tx, f.proposal[0], { decision: "REJECTED" }));
    });
  });
  it("deniega escrituras laterales aunque el JSON declare la empresa propia", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app")); await context(tx, f.company[0], f.branch[0]);
      await rejected(tx, "42501", () => tx.execute(sql`INSERT INTO sale_recovery_proposals
        (company_id,branch_id,legacy_sale_id,idempotency_key,proposal_hash,state_hash,requested_by,reason,proposal)
        SELECT company_id,branch_id,${f.sale[2]}::uuid,idempotency_key,proposal_hash,state_hash,requested_by,reason,
          jsonb_set(proposal,'{legacy,id}',to_jsonb(${f.sale[2]}::text)) FROM sale_recovery_proposals WHERE id=${f.proposal[0]}`));
    });
  });
  it("no reescribe ni borra hechos con runtime o dueño ordinario", async () => {
    await probe(async (tx, f) => {
      await context(tx, f.company[0], f.branch[0]); await decide(tx, f.proposal[0]);
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      for (const table of ["sale_recovery_proposals","sale_recovery_decisions"]) {
        await rejected(tx,"42501",() => tx.execute(sql.raw(`DELETE FROM ${table}`)));
        await rejected(tx,"42501",() => tx.execute(sql.raw(`UPDATE ${table} SET proposal_hash=proposal_hash`)));
      }
      await tx.execute(sql.raw("RESET ROLE"));
      for (const table of ["sale_recovery_proposals","sale_recovery_decisions"]) {
        await rejected(tx,"23514",() => tx.execute(sql.raw(`DELETE FROM ${table}`)));
        await rejected(tx,"23514",() => tx.execute(sql.raw(`UPDATE ${table} SET proposal_hash=proposal_hash`)));
      }
    });
  });
});
