import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, evidence } from "@/lib/db/schema";
import { provisionRuntimeRole } from "./helpers/runtime-role";

/** SEC-00: datos sintéticos dentro de una transacción siempre revertida. */
describe("SEC-00: arnés con dos empresas y dos sucursales por empresa", () => {
  beforeAll(async () => {
    await provisionRuntimeRole(["evidence"]);
    // PostgreSQL 18 no concede SET ROLE por tener CREATEROLE. El dueño de
    // fixtures puede asumir el rol limitado; no se otorga acceso inverso.
    await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
  });

  async function probe(check: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ids: string[], branchIds: string[]) => Promise<void>) {
    const ids = [randomUUID(), randomUUID()];
    const branchIds = Array.from({ length: 4 }, () => randomUUID());
    await expect(db.transaction(async tx => {
      await tx.insert(companies).values(ids.map((id, i) => ({ id, name: `SEC00 sintética ${i}` })));
      await tx.insert(branches).values(branchIds.map((id, i) => ({ id, companyId: ids[Math.floor(i / 2)], name: `SEC00 sucursal ${i}` })));
      await tx.insert(evidence).values(branchIds.map((branchId, i) => ({ companyId: ids[Math.floor(i / 2)], branchId, entityType: "GENERAL" as const, entityId: randomUUID(), kind: "PHOTO" as const, url: `sec00/synthetic/${i}.jpg` })));
      const owner = await tx.select({ id: evidence.id }).from(evidence).where(inArray(evidence.companyId, ids));
      expect(owner).toHaveLength(4);
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await check(tx, ids, branchIds);
      throw new Error("SEC00 rollback esperado");
    })).rejects.toThrow("SEC00 rollback esperado");
    expect(await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, ids))).toHaveLength(0);
    expect(await db.select({ id: evidence.id }).from(evidence).where(inArray(evidence.companyId, ids))).toHaveLength(0);
    return ids;
  }

  it("distingue dueño y runtime NOBYPASSRLS, no superuser ni propietario", async () => {
    await probe(async tx => {
      const result = await tx.execute(sql`SELECT current_user AS role, r.rolbypassrls, r.rolsuper,
        pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls
        FROM pg_roles r CROSS JOIN pg_class c
        WHERE r.rolname=current_user AND c.oid='public.evidence'::regclass`);
      expect(result.rows).toEqual([expect.objectContaining({ role: "pulso_app", rolbypassrls: false, rolsuper: false, rls: true })]);
      expect(result.rows[0].owner).not.toBe("pulso_app");
    });
  });

  it("reutiliza contexto local entre empresas sin devolver filas ajenas", async () => {
    await probe(async (tx, ids) => {
      for (const id of [ids[0], ids[1], ids[0]]) {
        await tx.execute(sql`SELECT set_config('app.current_company_id', ${id}, true)`);
        const visible = await tx.select({ companyId: evidence.companyId }).from(evidence);
        expect(visible).toHaveLength(2);
        expect(visible.every(row => row.companyId === id)).toBe(true);
      }
      const foreign = await tx.select({ id: evidence.id }).from(evidence).where(eq(evidence.companyId, ids[1]));
      expect(foreign).toHaveLength(0);
    });
  });

  it("rechaza insert ajeno y no modifica ni elimina evidencia de la otra empresa", async () => {
    await probe(async (tx, ids, branchIds) => {
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${ids[0]}, true)`);
      await tx.execute(sql.raw("SAVEPOINT forbidden_insert"));
      let code: string | undefined;
      try {
        await tx.insert(evidence).values({ companyId: ids[1], branchId: branchIds[2], entityType: "GENERAL", entityId: randomUUID(), kind: "PHOTO", url: "sec00/forbidden.jpg" });
      } catch (error) {
        const failure = error as { code?: string; cause?: { code?: string } };
        code = failure.cause?.code || failure.code;
      }
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT forbidden_insert"));
      expect(code).toBe("42501");
      expect(await tx.update(evidence).set({ url: "sec00/changed.jpg" }).where(eq(evidence.companyId, ids[1])).returning({ id: evidence.id })).toHaveLength(0);
      expect(await tx.delete(evidence).where(eq(evidence.companyId, ids[1])).returning({ id: evidence.id })).toHaveLength(0);
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${ids[1]}, true)`);
      const untouched = await tx.select({ url: evidence.url }).from(evidence);
      expect(untouched.map(row => row.url).sort()).toEqual(["sec00/synthetic/2.jpg", "sec00/synthetic/3.jpg"]);
    });
  });

  it("sin contexto no lee; una escritura propia autorizada también se revierte", async () => {
    const ids = await probe(async (tx, companyIds, branchIds) => {
      await tx.execute(sql`SELECT set_config('app.current_company_id', '', true)`);
      expect(await tx.select({ id: evidence.id }).from(evidence)).toHaveLength(0);
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyIds[0]}, true)`);
      expect(await tx.insert(evidence).values({ companyId: companyIds[0], branchId: branchIds[0], entityType: "GENERAL", entityId: randomUUID(), kind: "PHOTO", url: "sec00/own.jpg" }).returning({ id: evidence.id })).toHaveLength(1);
    });
    expect(await db.select({ id: branches.id }).from(branches).where(inArray(branches.companyId, ids))).toHaveLength(0);
    const settings = await db.execute(sql`SELECT nullif(current_setting('app.current_company_id', true), '') AS company, current_user AS role`);
    expect(settings.rows[0].company).toBeNull();
    expect(settings.rows[0].role).not.toBe("pulso_app");
  });
});
