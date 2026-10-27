import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

neonConfig.webSocketConstructor = ws;
const namespace = `ops01_${randomUUID().replaceAll("-", "")}`;
const restored = `${namespace}_restored`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, allowExitOnIdle: true,
  connectionTimeoutMillis: 15000 });
const tables = ["payroll_runs", "payroll_payslips"] as const;
let created = false;

describe("OPS-01: respaldo/restauración lógica del lote 0122 en Postgres aislado", () => {
  beforeAll(async () => {
    const target = new URL(process.env.TEST_DATABASE_URL!);
    for (const file of [".env", ".env.local"]) {
      if (!existsSync(file)) continue;
      const url = parse(readFileSync(file)).DATABASE_URL;
      if (!url) continue;
      const operative = new URL(url);
      if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
        && target.pathname === operative.pathname) throw new Error("La base aislada coincide con la operativa.");
    }
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    await pool.query(`CREATE SCHEMA "${restored}"`);
    for (const table of tables) {
      await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING ALL)`);
      // Sólo sobre la copia VACÍA y privada, para reproducir el estado anterior
      // a 0122 incluso cuando la base de pruebas ya tenga esa migración.
      await pool.query(`ALTER TABLE "${namespace}".${table} DROP COLUMN IF EXISTS aguinaldo_snapshot`);
      await pool.query(`CREATE TABLE "${restored}".${table} (LIKE "${namespace}".${table} INCLUDING ALL)`);
    }
  });

  afterAll(async () => {
    if (created) {
      await pool.query(`DROP SCHEMA IF EXISTS "${restored}" CASCADE`);
      await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    }
    await pool.end();
  });

  it("0122 conserva históricos; el respaldo restaura IDs/importes y el índice protege sólo recibos nuevos", async () => {
    const companyA = randomUUID(); const companyB = randomUUID();
    const runA = randomUUID(); const runB = randomUUID();
    await pool.query(`INSERT INTO "${namespace}".payroll_runs
      (id,company_id,period_start,period_end,status,aguinaldo_fiscal_year) VALUES
      ($1,$2,'2025-01-01','2025-12-31','COMPLETED',2025), ($3,$4,'2025-01-01','2025-12-31','COMPLETED',2025)`,
    [runA, companyA, runB, companyB]);
    // Duplicados históricos permitidos: el índice nuevo no debe invalidarlos.
    await pool.query(`INSERT INTO "${namespace}".payroll_payslips
      (run_id,user_id,aguinaldo_cents,total_percepciones_cents,total_deducciones_cents,cfdi_status) VALUES
      ($1,'legacy-a',900000,900000,119731,'TIMBRADO'), ($1,'legacy-a',900000,900000,119731,'TIMBRADO'),
      ($2,'legacy-b',450000,450000,20000,'TIMBRADO')`, [runA, runB]);

    // Respaldo lógico completo de las dos tablas del lote, sólo datos sintéticos.
    const backup: Record<string, unknown[]> = {};
    for (const table of tables) {
      backup[table] = (await pool.query(`SELECT row_to_json(t) AS data FROM "${namespace}".${table} t ORDER BY id`)).rows.map((row) => row.data);
    }
    const archive = JSON.stringify(backup);
    expect(archive.length).toBeGreaterThan(0);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO "${namespace}", public`);
      for (const statement of readFileSync("drizzle/0122_aguinaldo_snapshot.sql", "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }

    const decoded = JSON.parse(archive) as Record<string, unknown[]>;
    for (const table of tables) {
      const migrated = (await pool.query(`SELECT row_to_json(t) AS data FROM "${namespace}".${table} t ORDER BY id`)).rows
        .map((row) => { const { aguinaldo_snapshot, ...legacy } = row.data; expect(aguinaldo_snapshot).toBeNull(); return legacy; });
      expect(migrated).toEqual(backup[table]);
      await pool.query(`INSERT INTO "${restored}".${table} SELECT * FROM json_populate_recordset(NULL::"${restored}".${table}, $1::json)`,
        [JSON.stringify(decoded[table])]);
      const recovered = (await pool.query(`SELECT row_to_json(t) AS data FROM "${restored}".${table} t ORDER BY id`)).rows.map((row) => row.data);
      expect(recovered).toEqual(backup[table]);
    }
    expect((await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND column_name='aguinaldo_snapshot'`, [restored])).rows).toHaveLength(0);
    const insert = `INSERT INTO "${namespace}".payroll_payslips
      (run_id,user_id,aguinaldo_cents,total_percepciones_cents,total_deducciones_cents,aguinaldo_snapshot)
      VALUES ($1,'nuevo',900000,900000,119731,'{"version":1}'::jsonb)`;
    await pool.query(insert, [runA]);
    await expect(pool.query(insert, [runA])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query(insert, [runB])).resolves.toMatchObject({ rowCount: 1 });
  });
});
