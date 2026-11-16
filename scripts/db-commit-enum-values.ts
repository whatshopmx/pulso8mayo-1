/**
 * Confirma por adelantado los valores nuevos de enums declarados en las
 * migraciones (`ALTER TYPE … ADD VALUE`).
 *
 * `drizzle-kit migrate` aplica todas las migraciones pendientes en UNA
 * transacción. Postgres no permite usar un valor de enum agregado dentro de la
 * misma transacción (error 55P04 "unsafe use of new value"), así que una
 * migración que agrega un valor y otra posterior que lo usa (p. ej. 0144 →
 * 0145) fallan juntas. Este script ejecuta cada `ADD VALUE` en autocommit,
 * con `IF NOT EXISTS`, antes de migrar. Es idempotente: las migraciones
 * vuelven a declarar el valor y no pasa nada.
 *
 * Uso: pnpm exec tsx scripts/db-commit-enum-values.ts && pnpm db:migrate
 */
import { config } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

config({ path: ".env" });

const ADD_VALUE = /ALTER\s+TYPE\s+("?[\w.]+"?(?:\."?\w+"?)?)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?('(?:[^']|'')+')((?:\s+(?:BEFORE|AFTER)\s+'(?:[^']|'')+')?)/gi;

export async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (o MIGRATION_DATABASE_URL) en .env");

  const dir = path.resolve("drizzle");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const statements: string[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    for (const m of sql.matchAll(ADD_VALUE)) {
      statements.push(`ALTER TYPE ${m[1]} ADD VALUE IF NOT EXISTS ${m[2]}${m[3] ?? ""}`);
    }
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  let applied = 0;
  let skipped = 0;
  try {
    for (const statement of [...new Set(statements)]) {
      try {
        await client.query(statement); // autocommit: el valor queda confirmado
        applied++;
      } catch (err) {
        const code = (err as { code?: string }).code;
        // 42704: el tipo aún no existe (lo crea una migración pendiente, que
        // ya incluye el valor). 42710/55P04 no deberían ocurrir con IF NOT EXISTS.
        if (code === "42704") { skipped++; continue; }
        throw new Error(`Falló: ${statement}\n${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`Valores de enum confirmados: ${applied} (omitidos por tipo inexistente: ${skipped}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
