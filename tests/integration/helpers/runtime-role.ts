/**
 * Provisionamiento del rol de runtime para las pruebas de RLS (SEC-04/SEC-05).
 *
 * El rol vive sólo en la base aislada `.env.test`. En operación lo crea el
 * aprovisionador del entorno con la misma secuencia; la migración sólo otorga
 * privilegios si el rol ya existe, para no sembrar credenciales en el historial.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const RUNTIME_ROLE = "pulso_app";
export const RUNTIME_PASSWORD = "test-pulso-app";

/** URL del pool de runtime con el rol sin bypass. */
export function runtimeUrl(): string {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  base.username = RUNTIME_ROLE;
  base.password = RUNTIME_PASSWORD;
  return base.toString();
}

/**
 * Crea/actualiza `pulso_app` (LOGIN, NOBYPASSRLS, sin superuser ni CREATEROLE) y
 * le otorga USAGE del esquema más DML sobre las tablas del lote.
 */
export async function provisionRuntimeRole(tables: string[]): Promise<void> {
  const existing = await db.execute(
    sql`SELECT 1 FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`,
  );
  if (existing.rows.length === 0) {
    await db.execute(
      sql.raw(
        `CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${RUNTIME_PASSWORD}' NOBYPASSRLS NOSUPERUSER NOCREATEROLE`,
      ),
    );
  } else {
    await db.execute(
      sql.raw(`ALTER ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${RUNTIME_PASSWORD}'`),
    );
  }

  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA "public" TO "${RUNTIME_ROLE}"`));
  for (const table of tables) {
    await db.execute(
      sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "${RUNTIME_ROLE}"`),
    );
  }
}
