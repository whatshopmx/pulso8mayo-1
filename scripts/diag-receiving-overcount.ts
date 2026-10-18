/**
 * REC-03 — Diagnóstico y corrección de saldos históricos por el doble
 * incremento de recepción (H01).
 *
 * Hasta REC-01 cada recepción creaba el lote con `current_quantity = qty` y
 * ADEMÁS registraba un movimiento `RECEIVING` con `+qty`, así que el saldo del
 * lote quedó `qty` unidades por encima de la suma de su ledger. Ese excedente
 * es exactamente el `qty` recibido.
 *
 * Este script compara, para cada lote nacido en una recepción
 * (`supplier_batch_info->>'receivingReportId'` presente), el saldo observado
 * contra la suma de sus movimientos y clasifica la diferencia:
 *
 * - ATTRIBUTABLE: delta > 0 y delta == suma de movimientos RECEIVING. La causa
 *   es el doble incremento y se puede corregir con exactitud.
 * - AMBIGUOUS: hay delta pero no cuadra con las recepciones registradas (hubo
 *   transferencias, mermas o ajustes posteriores que impiden atribuirlo).
 * - NO_HISTORY: no hay movimiento RECEIVING que explique el saldo.
 *
 * Política de corrección (--apply): NUNCA reescribir movimientos originales ni
 * dividir todos los saldos entre dos. Sólo los ATTRIBUTABLE reciben un
 * movimiento `ADJUSTMENT` de `-delta` —trazable y con marcador— que baja el
 * saldo observado hasta su ledger. La operación es idempotente: si el lote ya
 * tiene el movimiento marcador, se omite. Los AMBIGUOUS se reportan para conteo
 * físico (INV-03), no se tocan.
 *
 * SOLO LECTURA por defecto:
 *
 *   npx tsx scripts/diag-receiving-overcount.ts
 *
 * Corrección (requiere actor y confirmación explícita; un lote a la vez, en su
 * propia transacción):
 *
 *   npx tsx scripts/diag-receiving-overcount.ts --apply --actor=<uuid> --yes
 */
import { config } from "dotenv";
import pg from "pg";
import {
  classifyReceivingDelta,
  type ReceivingDeltaClass,
} from "../lib/inventory/receiving-overcount";

config({ path: ".env" });

const MARKER = "[REC-03/H01] ajuste por doble incremento de recepción";
const EPS = 0.00005;


interface BatchRow {
  batch_id: string;
  branch_id: string;
  item_id: string;
  status: string;
  current_quantity: string;
  ledger: string;
  receiving_qty: string;
  receiving_count: string;
  delta: number;
  classification: ReceivingDeltaClass;
}

interface Options {
  apply: boolean;
  actor?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Options {
  const actorArg = argv.find((a) => a.startsWith("--actor="));
  return {
    apply: argv.includes("--apply"),
    yes: argv.includes("--yes"),
    actor: actorArg ? actorArg.split("=")[1] : process.env.REC03_ACTOR,
  };
}

const DIAGNOSTIC_SQL = `
  SELECT
    b.id                                   AS batch_id,
    b.branch_id                            AS branch_id,
    b.item_id                              AS item_id,
    b.status                               AS status,
    b.current_quantity::text               AS current_quantity,
    COALESCE(m.ledger, 0)::text            AS ledger,
    COALESCE(m.receiving_qty, 0)::text     AS receiving_qty,
    COALESCE(m.receiving_count, 0)::text   AS receiving_count
  FROM inventory_batches b
  LEFT JOIN (
    SELECT
      batch_id,
      SUM(quantity_change)                                             AS ledger,
      SUM(CASE WHEN type = 'RECEIVING' THEN quantity_change ELSE 0 END) AS receiving_qty,
      COUNT(*) FILTER (WHERE type = 'RECEIVING')                        AS receiving_count
    FROM inventory_movements
    GROUP BY batch_id
  ) m ON m.batch_id = b.id
  WHERE b.supplier_batch_info->>'receivingReportId' IS NOT NULL
    AND ABS(b.current_quantity - COALESCE(m.ledger, 0)) > ${EPS}
  ORDER BY ABS(b.current_quantity - COALESCE(m.ledger, 0)) DESC
`;

async function readBatches(client: pg.Client): Promise<BatchRow[]> {
  const { rows } = await client.query(DIAGNOSTIC_SQL);
  return rows.map((r) => {
    const delta = Number(r.current_quantity) - Number(r.ledger);
    const receivingQty = Number(r.receiving_qty);
    const receivingCount = Number(r.receiving_count);
    return {
      ...r,
      delta,
      classification: classifyReceivingDelta({
        observed: Number(r.current_quantity),
        ledger: Number(r.ledger),
        receivingQuantity: receivingQty,
        receivingCount,
      }),
    };
  });
}

/** Corrección idempotente de un lote ATTRIBUTABLE, en su propia transacción. */
async function applyCorrection(client: pg.Client, row: BatchRow, actor: string): Promise<"applied" | "skipped"> {
  await client.query("BEGIN");
  try {
    // Bloquea el lote y comprueba que nadie corrigió ya.
    const { rows: locked } = await client.query(
      `SELECT id FROM inventory_batches WHERE id = $1 FOR UPDATE`,
      [row.batch_id]
    );
    if (locked.length === 0) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    const { rows: already } = await client.query(
      `SELECT 1 FROM inventory_movements
        WHERE batch_id = $1 AND type = 'ADJUSTMENT' AND reason = $2
        LIMIT 1`,
      [row.batch_id, MARKER]
    );
    if (already.length > 0) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    // Ledger y saldo reales bajo lock (por si algo cambió desde el diagnóstico).
    const { rows: current } = await client.query(
      `SELECT
         b.current_quantity::text AS current_quantity,
         COALESCE((SELECT SUM(quantity_change) FROM inventory_movements WHERE batch_id = b.id), 0)::text AS ledger
       FROM inventory_batches b WHERE b.id = $1`,
      [row.batch_id]
    );
    const delta = Number(current[0].current_quantity) - Number(current[0].ledger);
    if (!(delta > EPS)) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    await client.query(
      `INSERT INTO inventory_movements
         (branch_id, item_id, batch_id, type, quantity_change, reason, performed_by, reference_id, timestamp)
       VALUES ($1, $2, $3, 'ADJUSTMENT', $4, $5, $6, $7, now())`,
      [row.branch_id, row.item_id, row.batch_id, String(-delta), MARKER, actor, row.batch_id]
    );
    await client.query(
      `UPDATE inventory_batches SET current_quantity = current_quantity - $2, updated_at = now() WHERE id = $1`,
      [row.batch_id, String(delta)]
    );

    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.apply && (!options.actor || !options.yes)) {
    console.error("Para aplicar correcciones se requiere --actor=<userId> y --yes.");
    console.error("Sin ellos el script sólo diagnostica (dry-run).");
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const rows = await readBatches(client);
    const summary = {
      total: rows.length,
      attribUtable: rows.filter((r) => r.classification === "ATTRIBUTABLE").length,
      ambiguous: rows.filter((r) => r.classification === "AMBIGUOUS").length,
      noHistory: rows.filter((r) => r.classification === "NO_HISTORY").length,
    };

    console.log(`Lotes de recepción con saldo ≠ ledger: ${summary.total}`);
    console.log(`  ATTRIBUTABLE (corregibles con exactitud): ${summary.attribUtable}`);
    console.log(`  AMBIGUOUS (requieren conteo físico INV-03): ${summary.ambiguous}`);
    console.log(`  NO_HISTORY (sin movimiento RECEIVING): ${summary.noHistory}`);

    if (rows.length > 0) {
      console.table(
        rows.map((r) => ({
          batch: r.batch_id.slice(0, 8),
          status: r.status,
          observed: r.current_quantity,
          ledger: r.ledger,
          delta: r.delta,
          receiving: r.receiving_qty,
          clase: r.classification,
        }))
      );
    }

    if (!options.apply) {
      console.log("\nDry-run. Nada escrito. Para corregir los ATTRIBUTABLE:");
      console.log("  npx tsx scripts/diag-receiving-overcount.ts --apply --actor=<uuid> --yes");
      return;
    }

    let applied = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.classification !== "ATTRIBUTABLE") {
        console.log(`Omitido (${row.classification}) ${row.batch_id}`);
        skipped++;
        continue;
      }
      const result = await applyCorrection(client, row, options.actor!);
      if (result === "applied") {
        applied++;
        console.log(`Ajustado ${row.batch_id}: -${row.delta}`);
      } else {
        skipped++;
        console.log(`Omitido (ya corregido o sin delta) ${row.batch_id}`);
      }
    }
    console.log(`\nCorrecciones aplicadas: ${applied}. Omitidas: ${skipped}.`);
    console.log("Los AMBIGUOUS y NO_HISTORY quedan pendientes de conteo físico (INV-03).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
