import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { payrollRuns, payrollPayslips } from "@/lib/db/schema";

describe("AGU-03B.2 — almacenamiento aditivo en Postgres embebido", () => {
  const pg = new PGlite();
  const db = drizzle(pg);
  beforeAll(async () => {
    await pg.exec(`
      CREATE TABLE payroll_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        period_start date NOT NULL, period_end date NOT NULL, status text NOT NULL DEFAULT 'DRAFT',
        aguinaldo_fiscal_year integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE payroll_payslips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES payroll_runs(id),
        user_id text NOT NULL, base_salary_cents integer NOT NULL DEFAULT 0, propinas_cents integer NOT NULL DEFAULT 0,
        holiday_pay_cents integer NOT NULL DEFAULT 0, overtime_pay_cents integer NOT NULL DEFAULT 0,
        aguinaldo_cents integer NOT NULL DEFAULT 0, total_percepciones_cents integer NOT NULL DEFAULT 0,
        total_deducciones_cents integer NOT NULL DEFAULT 0, cfdi_uuid text, cfdi_status text, sello_digital text,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      INSERT INTO payroll_runs (id, company_id, period_start, period_end) VALUES
        ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '2026-01-01', '2026-12-31');
      INSERT INTO payroll_payslips (run_id, user_id) VALUES
        ('00000000-0000-4000-8000-000000000001', 'historico'),
        ('00000000-0000-4000-8000-000000000001', 'historico');
    `);
  }, 60000);
  afterAll(async () => pg.close());

  it("expone snapshots tipados en las tablas y unicidad sólo para nuevos recibos de aguinaldo", () => {
    expect(getTableConfig(payrollRuns).columns.map((c) => c.name)).toContain("aguinaldo_snapshot");
    expect(getTableConfig(payrollPayslips).columns.map((c) => c.name)).toContain("aguinaldo_snapshot");
  });

  it("aplica el SQL generado sin DROP, preserva duplicados históricos y rechaza nuevos duplicados con snapshot", async () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const tag = journal.entries.find((entry: { tag: string }) => entry.tag.endsWith("_aguinaldo_snapshot"))?.tag;
    expect(tag).toBeDefined();
    const migration = readFileSync(`drizzle/${tag}.sql`, "utf8");
    expect(migration).not.toMatch(/\bDROP\b/i);
    await pg.exec(migration);
    const historic = await pg.query<{ total: number; snapshots: number }>("SELECT count(*)::int total, count(aguinaldo_snapshot)::int snapshots FROM payroll_payslips");
    expect(historic.rows[0]).toEqual({ total: 2, snapshots: 0 });
    const runId = "00000000-0000-4000-8000-000000000001";
    const values = { runId, userId: "nuevo", aguinaldoSnapshot: { version: 1 } as typeof payrollPayslips.$inferInsert.aguinaldoSnapshot };
    await db.insert(payrollPayslips).values(values);
    await expect(db.insert(payrollPayslips).values(values)).rejects.toThrow();
    // Los recibos ordinarios/legacy quedan fuera del índice parcial.
    await db.insert(payrollPayslips).values({ runId, userId: "historico" });
  });
});
