import { readFileSync } from "node:fs";
import type { Pool } from "@neondatabase/serverless";

export const NOMINA_RLS_TABLES = [
  "payroll_runs", "payroll_payslips", "payroll_aguinaldo_dispersiones", "cfdi_nomina_timbrados",
] as const;

/** Aplica el lote publicado sólo a las cuatro copias de un esquema de prueba. */
export async function applyNominaRlsBatch(pool: Pool, namespace: string) {
  if (!/^nomina_[a-z]_[a-f0-9]{32}$/.test(namespace)) {
    throw new Error("El lote de aceptación exige un esquema privado nomina_<letra>_<uuid>.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Sin public en el search_path: una copia ausente debe fallar, nunca
    // resolver una tabla operativa. pg_catalog se añade implícitamente.
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    const copies = (await client.query(`SELECT tablename FROM pg_tables
      WHERE schemaname=$1 AND tablename=ANY($2::text[])`, [namespace, [...NOMINA_RLS_TABLES]])).rows;
    if (copies.length !== NOMINA_RLS_TABLES.length) throw new Error("Faltan copias privadas del lote de nómina.");
    for (const statement of readFileSync("drizzle/0123_rls_nomina.sql", "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
