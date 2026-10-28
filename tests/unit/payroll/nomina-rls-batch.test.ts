import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OPS-02.nomina.E — contrato estático del lote 0123.
 *
 * La prueba de runtime aplica el SQL real en un esquema privado; ésta fija las
 * garantías que no dependen de la base: cobertura de las cuatro tablas, forma
 * del rechazo por defecto, coherencia padre/hija y ausencia de operaciones
 * destructivas o credenciales en el historial.
 */

const MIGRATION = "drizzle/0123_rls_nomina.sql";
const JOURNAL = "drizzle/meta/_journal.json";
const TABLES = [
  "payroll_runs",
  "payroll_payslips",
  "payroll_aguinaldo_dispersiones",
  "cfdi_nomina_timbrados",
] as const;
const CONTEXT = "NULLIF(current_setting('app.current_company_id', true), '')::uuid";

const sql = readFileSync(MIGRATION, "utf8");
/** El SQL sin comentarios: las garantías se evalúan sobre lo que se ejecuta. */
const statements = sql.replace(/--[^\n]*/g, "");
const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as {
  entries: Array<{ idx: number; tag: string; breakpoints: boolean }>;
};

describe("OPS-02.nomina.E — migración 0123 de RLS de nómina", () => {
  it("está inventariada en el journal con el siguiente índice", () => {
    const entry = journal.entries.find((item) => item.tag === "0123_rls_nomina");
    expect(entry).toMatchObject({ idx: 123, breakpoints: true });
    expect(journal.entries.at(-1)?.tag).toBe("0123_rls_nomina");
  });

  it("habilita RLS en las cuatro tablas del lote y en ninguna otra", () => {
    const enabled = [...sql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g)].map(
      (match) => match[1],
    );
    expect(enabled.sort()).toEqual([...TABLES].sort());
    expect(statements).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });

  it("crea una política por tabla con rechazo por defecto", () => {
    const policies = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON "([^"]+)"/g)].map(
      (match) => ({ name: match[1], table: match[2] }),
    );
    expect(policies).toHaveLength(TABLES.length);
    expect(policies.map((policy) => policy.table).sort()).toEqual([...TABLES].sort());
    expect(new Set(policies.map((policy) => policy.name)).size).toBe(TABLES.length);

    const usingClauses = sql.match(/USING \(/g) ?? [];
    const checkClauses = sql.match(/WITH CHECK \(/g) ?? [];
    expect(usingClauses).toHaveLength(TABLES.length);
    expect(checkClauses).toHaveLength(TABLES.length);
    // Cada política lee el contexto de la transacción, no un company_id de entrada.
    for (const table of TABLES) {
      const start = sql.indexOf(`CREATE POLICY "${table}_tenant_isolation"`);
      const next = sql.indexOf("CREATE POLICY", start + 1);
      const block = sql.slice(start, next === -1 ? undefined : next);
      expect(block).toContain(CONTEXT);
    }
  });

  it("aísla recibos por la corrida padre y valida cambios de run_id", () => {
    const policy = sql.slice(
      sql.indexOf('CREATE POLICY "payroll_payslips_tenant_isolation"'),
      sql.indexOf('CREATE POLICY "payroll_aguinaldo_dispersiones_tenant_isolation"'),
    );
    expect(policy).toContain('FROM "payroll_runs" r');
    expect(policy).toContain('r.id = "payroll_payslips"."run_id"');
    expect(policy.match(/WITH CHECK/g)).toHaveLength(1);
    // Sin company_id propio: no debe inventarse una columna que la tabla no tiene.
    expect(policy).not.toMatch(/payroll_payslips\.["\s]*company_id/);
  });

  it("exige coherencia entre la dispersión y su corrida cuando run_id no es NULL", () => {
    const policy = sql.slice(
      sql.indexOf('CREATE POLICY "payroll_aguinaldo_dispersiones_tenant_isolation"'),
      sql.indexOf('CREATE POLICY "cfdi_nomina_timbrados_tenant_isolation"'),
    );
    expect(policy).toContain('"payroll_aguinaldo_dispersiones"."run_id" IS NULL');
    expect(policy).toContain('FROM "payroll_runs" r');
    expect(policy.match(/WITH CHECK/g)).toHaveLength(1);
  });

  it("otorga DML a pulso_app sólo si el rol ya existe y sin sembrar credenciales", () => {
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app')");
    for (const table of TABLES) {
      expect(sql).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "pulso_app";`,
      );
    }
    expect(statements).not.toMatch(/\b(CREATE|ALTER)\s+ROLE\b/i);
    expect(statements).not.toMatch(/PASSWORD/i);
    expect(statements).not.toMatch(/\bSUPERUSER\b/i);
  });

  it("no contiene operaciones destructivas ni toca otras tablas", () => {
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bALTER\s+TABLE\b.*\b(COLUMN|CONSTRAINT)\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+"?[a-z_]+"?\s+SET\b/i);
  });
});
