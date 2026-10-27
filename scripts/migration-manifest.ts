/** OPS-01: diagnóstico de sólo lectura. Nunca ejecuta el migrador ni DDL. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

let stage = "argumentos/archivos";
interface ExpectedMigration { tag: string; when: number; hash: string; lineEndingHashes?: string[] }
interface AppliedMigration { id: number; created_at: string | null; hash: string }

export function classifyMigrations(expected: ExpectedMigration[], applied: AppliedMigration[]) {
  const latest = Math.max(0, ...applied.map((row) => Number(row.created_at)));
  const entries = expected.map((migration) => {
    const rows = applied.filter((row) => Number(row.created_at) === migration.when);
    const status = rows.length
      ? rows.every((row) => row.hash === migration.hash) ? "APPLIED"
        : rows.every((row) => migration.lineEndingHashes?.includes(row.hash)) ? "LINE_ENDINGS_DIFFER" : "HASH_MISMATCH"
      : migration.when <= latest ? "HISTORY_GAP" : "PENDING";
    return { ...migration, status };
  });
  const times = applied.map((row) => Number(row.created_at));
  const duplicateTimes = [...new Set(times.filter((time, i) => times.indexOf(time) !== i))];
  const unknownApplied = applied.filter((row) => !expected.some((migration) => migration.when === Number(row.created_at)));
  return { entries, duplicateTimes, unknownApplied,
    requiresReview: duplicateTimes.length > 0 || unknownApplied.length > 0
      || entries.some((entry) => !["APPLIED", "PENDING"].includes(entry.status)) };
}

async function main() {
  const { values } = parseArgs({ options: { "env-file": { type: "string" }, "url-key": { type: "string" } } });
  const file = values["env-file"];
  const key = values["url-key"];
  if (!file || !key || !["DATABASE_URL", "MIGRATION_DATABASE_URL", "TEST_DATABASE_URL"].includes(key)) {
    throw new Error("Usa --env-file <archivo> --url-key DATABASE_URL|MIGRATION_DATABASE_URL|TEST_DATABASE_URL.");
  }
  // La URL sólo procede del archivo/clave explícitos; nunca de un fallback.
  const connectionString = parse(readFileSync(file))[key];
  if (!connectionString) throw new Error("El archivo no contiene la clave de conexión elegida.");
  const target = new URL(connectionString);
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  const expected = journal.entries.map((entry, i) => {
    const lf = readFileSync(`drizzle/${entry.tag}.sql`, "utf8").replaceAll("\r\n", "\n");
    return { ...entry, hash: migrations[i].hash,
      lineEndingHashes: [lf, lf.replaceAll("\n", "\r\n")].map((sql) => createHash("sha256").update(sql).digest("hex")) };
  });
  const last = journal.entries.at(-1)!;
  const snapshot = JSON.parse(readFileSync(`drizzle/meta/${last.tag.split("_")[0]}_snapshot.json`, "utf8")) as {
    tables: Record<string, { name: string; columns: Record<string, { name: string }>; indexes: Record<string, { name: string }> }>;
  };
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 15000 });
  stage = "conexión";
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    stage = "identidad";
    const identity = (await client.query(`SELECT current_database() database, current_user role,
      current_setting('transaction_read_only') read_only`)).rows[0];
    stage = "journal";
    const journalExists = (await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') name")).rows[0].name;
    const applied = journalExists ? (await client.query("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows : [];
    stage = "columnas/índices";
    const columns = (await client.query(`SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)).rows;
    const indexes = (await client.query("SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'")).rows;
    const missingColumns: string[] = [];
    const missingIndexes: string[] = [];
    for (const table of Object.values(snapshot.tables)) {
      for (const column of Object.values(table.columns)) {
        if (!columns.some((row) => row.table_name === table.name && row.column_name === column.name)) missingColumns.push(`${table.name}.${column.name}`);
      }
      for (const index of Object.values(table.indexes)) {
        if (!indexes.some((row) => row.tablename === table.name && row.indexname === index.name)) missingIndexes.push(`${table.name}.${index.name}`);
      }
    }
    stage = "roles/políticas";
    const roles = (await client.query(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
      WHERE rolname IN (current_user, 'pulso_app') ORDER BY rolname`)).rows;
    const security = (await client.query(`SELECT c.relname table_name, pg_get_userbyid(c.relowner) owner,
      c.relrowsecurity rls, c.relforcerowsecurity force_rls,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) policy_count
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)).rows;
    const history = classifyMigrations(expected, applied);
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), target: { host: target.hostname, ...identity },
      journalExists: !!journalExists, history, comparison: { expectedSnapshot: last.tag, missingColumns, missingIndexes,
        scope: "Existencia de columnas e índices; no certifica tipos/defaults/FK/enums ni datos." }, roles, security,
      operationalChanges: false }, null, 2));
  } finally { client.release(); await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/migration-manifest.ts")) {
  main().catch((error: unknown) => {
    // Los errores del driver pueden contener URLs. No imprimirlos con secretos.
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN";
    console.error(`No se pudo preparar el manifiesto (${stage}; código ${/^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN"}). No se aplicaron migraciones.`);
    process.exitCode = 1;
  });
}
