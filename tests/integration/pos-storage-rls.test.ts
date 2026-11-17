import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, dailySalesCuts } from "@/lib/db/schema";

const catalog = sql`select relrowsecurity,relforcerowsecurity,
  has_table_privilege('pulso_app',c.oid,'SELECT') as can_select,
  has_table_privilege('pulso_app',c.oid,'UPDATE') as can_update,
  has_column_privilege('pulso_app','public.daily_sales_cuts','raw_file_url','SELECT') as read_key,
  has_column_privilege('pulso_app','public.daily_sales_cuts','raw_file_url','UPDATE') as write_key,
  (select count(*) from pg_policy p where p.polrelid=c.oid) as policies
  from pg_class c where c.oid='public.daily_sales_cuts'::regclass`;
let baseline: unknown[] = [];

beforeAll(async () => {
  const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync(".env")).DATABASE_URL));
  expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
  const role = await db.execute(sql`select rolbypassrls, rolsuper from pg_roles where rolname='pulso_app'`);
  expect(role.rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
  baseline = (await db.execute(catalog)).rows;
  console.log("POS RLS baseline:", JSON.stringify(baseline));
});
afterAll(async () => { if (baseline.length) expect((await db.execute(catalog)).rows).toEqual(baseline); });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function fixture(check: (tx: Tx, scope: { company: string[]; branch: string[]; cut: string[] }) => Promise<void>, allowBranchUpdate = false) {
  const ids = (count: number) => Array.from({ length: count }, () => randomUUID());
  const scope = { company: ids(2), branch: ids(3), cut: ids(3) };
  const rollback = new Error("POS RLS fixture rollback");
  try {
    await db.transaction(async tx => {
      await tx.insert(companies).values(scope.company.map(id => ({ id, name: "Synthetic POS RLS company" })));
      await tx.insert(branches).values(scope.branch.map((id, index) => ({ id,
        companyId: scope.company[index === 2 ? 1 : 0], name: "Synthetic POS RLS branch" })));
      await tx.insert(dailySalesCuts).values(scope.cut.map((id, index) => ({ id,
        companyId: scope.company[index === 2 ? 1 : 0], branchId: scope.branch[index], businessDate: "2026-11-17",
        shift: "COMPLETO" as const, channel: "TOTAL" as const, source: "MANUAL_FORM" as const, totalSales: 10000 })));
      // La candidata se prueba únicamente dentro del rollback de este fixture.
      await tx.execute(sql.raw(readFileSync("drizzle/0155_pos_storage_rls.sql", "utf8")));
      if (allowBranchUpdate) await tx.execute(sql.raw("GRANT UPDATE (branch_id) ON public.daily_sales_cuts TO pulso_app"));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(sql`select set_config('app.current_company_id','',true),set_config('app.current_branch_id','',true)`);
      const runtime = await tx.execute(sql`select current_user as name,rolbypassrls,rolsuper
        from pg_roles where rolname=current_user`);
      expect(runtime.rows).toEqual([{ name: "pulso_app", rolbypassrls: false, rolsuper: false }]);
      await check(tx, scope);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    expect(await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, scope.company))).toEqual([]);
  }
}

it("pulso_app no puede leer cortes sin contexto de empresa", async () => {
  await fixture(async (tx, scope) => {
    // Solo se seleccionan UUID de este fixture; nunca se leen otros datos del branch.
    expect(await tx.select({ id: dailySalesCuts.id }).from(dailySalesCuts)
      .where(inArray(dailySalesCuts.id, scope.cut))).toEqual([]);
  });
});

async function context(tx: Tx, company: string, branch = "") {
  await tx.execute(sql`select set_config('app.current_company_id',${company},true),set_config('app.current_branch_id',${branch},true)`);
}
async function denied(tx: Tx, operation: () => Promise<unknown>) {
  await tx.execute(sql.raw("SAVEPOINT pos_denied"));
  let code: string | undefined;
  try { await operation(); } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    code = failure.cause?.code ?? failure.code;
  }
  await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT pos_denied"));
  expect(code).toBe("42501");
}

it("limita la lectura a empresa y sucursal incluso sin filtros de tenant en SQL", async () => {
  await fixture(async (tx, scope) => {
    const read = () => tx.select({ id: dailySalesCuts.id }).from(dailySalesCuts).where(inArray(dailySalesCuts.id, scope.cut));
    await context(tx, scope.company[0]);
    expect((await read()).map(row => row.id).sort()).toEqual(scope.cut.slice(0, 2).sort());
    await context(tx, scope.company[0], scope.branch[0]);
    expect(await read()).toEqual([{ id: scope.cut[0] }]);
    await context(tx, scope.company[0], scope.branch[2]);
    expect(await read()).toEqual([]);
  });
});

it("permite vincular metadata propia, bloquea otra sucursal/empresa y no concede editar ventas", async () => {
  await fixture(async (tx, scope) => {
    await context(tx, scope.company[0], scope.branch[0]);
    const link = (id: string) => tx.update(dailySalesCuts).set({ rawFileUrl: "synthetic-pos-key", validationNotes: "fixture", updatedAt: new Date() })
      .where(eq(dailySalesCuts.id, id)).returning({ id: dailySalesCuts.id });
    expect(await link(scope.cut[0])).toEqual([{ id: scope.cut[0] }]);
    expect(await link(scope.cut[1])).toEqual([]);
    expect(await link(scope.cut[2])).toEqual([]);
    await denied(tx, () => tx.update(dailySalesCuts).set({ totalSales: 0 }).where(eq(dailySalesCuts.id, scope.cut[0])));
  });
});

it("WITH CHECK impide cruzar una sucursal de otra empresa aunque se conceda temporalmente esa columna", async () => {
  await fixture(async (tx, scope) => {
    await context(tx, scope.company[0]);
    await denied(tx, () => tx.update(dailySalesCuts).set({ branchId: scope.branch[2] }).where(eq(dailySalesCuts.id, scope.cut[0])));
  }, true);
});
