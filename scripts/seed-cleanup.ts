import "dotenv/config";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { COMPANY_ID } from "./seed-constants";

export async function assertDemoDatabase(): Promise<void> {
  const otherCompanies = await db.execute(sql`SELECT id FROM companies WHERE id <> ${COMPANY_ID} LIMIT 1`);
  const otherUsers = await db.execute(sql`SELECT id FROM users WHERE company_id IS DISTINCT FROM ${COMPANY_ID}::uuid LIMIT 1`);
  if (otherCompanies.rows.length || otherUsers.rows.length) {
    throw new Error("La base contiene empresas o usuarios ajenos al demo. Usa una base dedicada; no se borró nada.");
  }
}

export async function cleanupAll(): Promise<void> {
  // Sólo tablas de la aplicación. Verificar el esquema antes de borrar evita
  // dejar el demo vacío cuando falta una migración.
  const tables = Object.values(schema).filter((value) => is(value, PgTable));
  const expected = tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns.map((column) => `${config.name}.${column.name}`);
  });
  const result = await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  `);
  const actual = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = expected.filter((entry) => !actual.has(entry));
  if (missing.length) throw new Error(`Aplica las migraciones antes del seed. Faltan: ${missing.join(", ")}`);
  await assertDemoDatabase();
  const names = [...new Set(tables.map((table) => getTableConfig(table).name))];
  await db.execute(sql`TRUNCATE TABLE ${sql.join(names.map((name) => sql.identifier(name)), sql`, `)} CASCADE`);
  console.log(`Reinicio completo: ${names.length} tablas demo (incluye sesiones y credenciales).`);
}
