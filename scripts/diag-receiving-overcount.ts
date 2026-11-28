/**
 * REC-03A — Revalidación por lote de la anomalía histórica de recepción (H01).
 *
 * Dry-run (por defecto, en transacción READ ONLY) sobre la base indicada
 * explícitamente con --url-env. Clasifica cada lote nacido en recepción con
 * saldo ≠ ledger como SUFFICIENT (ajuste exacto propuesto) o AMBIGUOUS
 * (retenido para conteo físico, sin cantidad propuesta). No asume cuántos lotes
 * hay ni fabrica saldos.
 *
 *   pnpm exec tsx scripts/diag-receiving-overcount.ts --url-env=TEST_DATABASE_URL [--company=<uuid>]
 *     [--fix-cutoff=<ISO>] [--out=<ruta.json>]
 *
 * Ajuste preparado (SOLO copia aislada; nunca contra el host de .env): aplica
 * los SUFFICIENT del dry-run, un lote por transacción, con actor y motivo, y
 * repite la revalidación bajo lock. La aplicación operativa es REC-03B.
 *
 *   pnpm exec tsx scripts/diag-receiving-overcount.ts --url-env=<COPIA> --apply --actor=<id> \
 *     --reason="<motivo>" --yes
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config, parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "../lib/db/schema";

config({ path: ".env" });
config({ path: ".env.test" });

interface Options {
  urlEnv?: string;
  companyId?: string;
  fixCutoff?: string;
  out?: string;
  apply: boolean;
  actor?: string;
  reason?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Options {
  const value = (name: string) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    urlEnv: value("url-env"),
    companyId: value("company"),
    fixCutoff: value("fix-cutoff"),
    out: value("out"),
    apply: argv.includes("--apply"),
    actor: value("actor"),
    reason: value("reason"),
    yes: argv.includes("--yes"),
  };
}

const hostOf = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");

/** Hosts operativos declarados en .env (aplicación y migración). */
function operationalHosts(): Set<string> {
  try {
    const env = parse(readFileSync(".env"));
    return new Set([env.DATABASE_URL, env.MIGRATION_DATABASE_URL].filter(Boolean).map(hostOf));
  } catch {
    return new Set();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.urlEnv) {
    console.error("Indica la base explícitamente: --url-env=<NOMBRE_DE_VARIABLE> (p.ej. TEST_DATABASE_URL).");
    process.exit(2);
  }
  const url = process.env[options.urlEnv];
  if (!url) {
    console.error(`La variable ${options.urlEnv} no está definida.`);
    process.exit(2);
  }
  const operational = operationalHosts().has(hostOf(url));
  if (options.apply) {
    if (operational) {
      console.error("REC-03A sólo prepara ajustes en copia aislada. La aplicación operativa es REC-03B " +
        "(conteo, actor, aprobación separada y respaldo del entorno).");
      process.exit(3);
    }
    if (!options.actor || !options.reason || !options.yes) {
      console.error("Para ajustar en la copia se requieren --actor, --reason y --yes.");
      process.exit(2);
    }
  }

  // El servicio importa `@/lib/db`, que lee DATABASE_URL al cargarse.
  process.env.DATABASE_URL = url;
  const { readReceivingOvercountRevalidation, applyReceivingOvercountAdjustment } =
    await import("../lib/services/receiving-overcount-service");

  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on("error", () => console.error("[rec-03a] pool error"));
  const database = drizzle(pool, { schema });
  try {
    const report = await database.transaction(
      tx => readReceivingOvercountRevalidation(tx, { companyId: options.companyId, fixCutoff: options.fixCutoff }),
      { accessMode: "read only" },
    );
    const target = { urlEnv: options.urlEnv, host: hostOf(url), database: new URL(url).pathname.slice(1), operational };
    const output = { ...report, target };
    if (options.out) writeFileSync(options.out, `${JSON.stringify(output, null, 2)}\n`);

    const { summary } = report;
    console.log(`REC-03A dry-run (${target.database} @ ${target.host}${operational ? ", operativo, sólo lectura" : ""})`);
    console.log(`Lotes de recepción con saldo ≠ ledger o ajuste previo: ${summary.candidates}`);
    console.log(`  SUFFICIENT (ajuste exacto propuesto): ${summary.sufficient}`);
    console.log(`  AMBIGUOUS (retenidos para conteo físico): ${summary.ambiguous}`);
    console.log(`  ALREADY_CORRECTED: ${summary.alreadyCorrected}`);
    console.log(`  Lotes sin recepción con saldo ≠ ledger (fuera de H01): ${summary.nonReceivingMismatches}`);
    if (report.batches.length > 0) {
      console.table(report.batches.map(row => ({
        batch: row.batchId.slice(0, 8), status: row.status, observed: row.observed, ledger: row.ledger,
        delta: row.delta, evidence: row.evidence, propuesto: row.proposedAdjustment, motivos: row.reasons.join(","),
      })));
    }
    if (!options.apply) {
      console.log("\nDry-run. Nada escrito.");
      return;
    }

    let applied = 0, already = 0, rejected = 0;
    for (const row of report.batches.filter(batch => batch.evidence === "SUFFICIENT")) {
      try {
        const result = await database.transaction(tx => applyReceivingOvercountAdjustment(tx, {
          batchId: row.batchId, expectedDelta: row.delta, actorId: options.actor!, reason: options.reason!,
          fixCutoff: options.fixCutoff,
        }));
        if (result.status === "APPLIED") { applied++; console.log(`Ajustado ${row.batchId}: ${result.before} → ${result.after}`); }
        else { already++; console.log(`Ya corregido ${row.batchId}`); }
      } catch (error) {
        rejected++;
        console.error(`Rechazado ${row.batchId}: ${(error as Error).message}`);
      }
    }
    console.log(`\nAplicados: ${applied}. Ya corregidos: ${already}. Rechazados: ${rejected}. AMBIGUOUS sin tocar: ${summary.ambiguous}.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
