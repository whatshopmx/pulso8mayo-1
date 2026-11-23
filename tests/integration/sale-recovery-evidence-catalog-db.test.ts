import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, branches, evidenceEntityTypeEnum } from "@/lib/db/schema";

const legacy = ["WORKFLOW_STEP","INCIDENT","DOCUMENT","EXPENSE","SERVICE_ORDER","WASTE","RECEIVING","GENERAL"];
const file = "drizzle/0144_inv01c_recovery_evidence_subject.sql";
const out = "tasks/evidencia/2026-11-11/INV-01.c.recovery.subject.schema";
describe("catálogo canónico de adjuntos de recuperación", () => {
  beforeAll(async () => {
    // Estas guardias preceden cualquier DDL/fixture. Nunca aplicar a DATABASE_URL operativo.
    expect(evidenceEntityTypeEnum.enumValues).toEqual([...legacy,"SALE_RECOVERY"]);
    const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
    expect(host(process.env.TEST_DATABASE_URL!)).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(host(operational)).not.toBe(host(process.env.TEST_DATABASE_URL!));
    const migration = readFileSync(file,"utf8");
    expect(migration.trim()).toBe('ALTER TYPE "public"."evidence_entity_type" ADD VALUE IF NOT EXISTS \'SALE_RECOVERY\';');
    const labels = async () => (await db.execute<{ label: string }>(sql`SELECT enumlabel AS label FROM pg_enum
      WHERE enumtypid='public.evidence_entity_type'::regtype ORDER BY enumsortorder`)).rows.map(row=>row.label);
    const before = await labels();
    expect(before.slice(0, legacy.length)).toEqual(legacy);
    if (before.length > legacy.length) expect(before[legacy.length]).toBe("SALE_RECOVERY");
    const [role] = (await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows;
    expect(role).toEqual({rolsuper:false,rolbypassrls:false});
    // ALTER TYPE aditivo debe confirmar su transacción antes de usar la etiqueta.
    // Solo esta sentencia; no db:migrate ni journal para migraciones 0140–0143 pendientes.
    await db.execute(sql.raw(migration));
    const after = await labels();
    expect(after.slice(0, legacy.length + 1)).toEqual([...legacy,"SALE_RECOVERY"]);
    mkdirSync(out,{recursive:true});
    writeFileSync(`${out}/isolated-ddl.json`,JSON.stringify({file,sha256:createHash("sha256").update(migration).digest("hex"),
      host:host(process.env.TEST_DATABASE_URL!),before,after,appliedTo:"isolated only",drizzleJournalWritten:false,
      operation:"ADD VALUE IF NOT EXISTS, committed; no data rewrite or grants",recordedAt:new Date().toISOString()},null,2)+"\n");
  });
  it("la migración aislada es repetible y conserva el orden del catálogo legacy", async () => {
    await db.execute(sql.raw(readFileSync(file,"utf8")));
    const result = await db.execute<{ label: string }>(sql`SELECT enumlabel AS label FROM pg_enum WHERE enumtypid='public.evidence_entity_type'::regtype ORDER BY enumsortorder`);
    expect(result.rows.map(row=>row.label).slice(0, legacy.length + 1)).toEqual([...legacy,"SALE_RECOVERY"]);
  });
  it("runtime registra y vuelve a leer SALE_RECOVERY sin reinterpretar sujetos anteriores", async () => {
    const companyId=randomUUID(), branchId=randomUUID(); const ids=Array.from({length:legacy.length+1},()=>randomUUID());
    await expect(db.transaction(async tx=>{
      await tx.insert(companies).values({id:companyId,name:"Synthetic recovery evidence catalog"});
      await tx.insert(branches).values({id:branchId,companyId,name:"Synthetic evidence branch"});
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(sql`SELECT set_config('app.current_company_id',${companyId},true),set_config('app.current_branch_id',${branchId},true)`);
      for(const [i,type] of [...legacy,"SALE_RECOVERY"].entries()){
        await tx.execute(sql`INSERT INTO evidence (id,company_id,branch_id,entity_type,entity_id,kind,url)
          VALUES (${ids[i]},${companyId},${branchId},${type}::evidence_entity_type,${randomUUID()},'FILE',${`companies/${companyId}/synthetic/${ids[i]}`})`);
      }
      const rows=await tx.execute<{ entity_type:string }>(sql`SELECT entity_type FROM evidence WHERE company_id=${companyId}`);
      expect(rows.rows.map(row=>row.entity_type).sort()).toEqual([...legacy,"SALE_RECOVERY"].sort());
      throw new Error("catalog fixtures rollback esperado");
    })).rejects.toThrow("catalog fixtures rollback esperado");
    expect((await db.execute(sql`SELECT id FROM evidence WHERE company_id=${companyId}`)).rows).toEqual([]);
    expect((await db.execute(sql`SELECT id FROM companies WHERE id=${companyId}`)).rows).toEqual([]);
  });
});
