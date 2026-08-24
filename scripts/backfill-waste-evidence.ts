/**
 * Backfill de evidencia fotográfica en `inventory_waste` (Task 4,
 * plan-mermas-historial).
 *
 * El template de merma exige foto por SKU (`merma-evidence-{itemId}`), pero
 * `extractMermaFromInstance()` descartaba la URL al construir las filas: toda
 * merma de workflow anterior al fix quedó con `evidence_url` NULL aunque la
 * foto siga viva en los pasos de la instancia (NOM-251).
 *
 * Este script re-parsea esos pasos con `parseMermaSteps` —la MISMA función que
 * usa el extractor en producción, sin lógica paralela— y actualiza las filas.
 *
 * Propiedades:
 *  - **Idempotente**: sólo toca filas con `origin='workflow_merma'` y
 *    `evidence_url IS NULL`; el UPDATE re-verifica el NULL, así que relanzarlo
 *    no pisa valores nuevos ni duplica nada.
 *  - **Honesto**: si el paso no trae URL válida (o la instancia ya no tiene
 *    pasos), la fila se reporta como irrecuperable y queda NULL.
 *
 * Uso:
 *   npx tsx scripts/backfill-waste-evidence.ts            # simulación
 *   npx tsx scripts/backfill-waste-evidence.ts --apply    # escribe
 */
import "dotenv/config";
import { and, eq, isNull, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { inventoryWaste, workflowInstanceSteps } from "@/lib/db/schema";
import { parseMermaSteps } from "@/lib/services/merma-from-workflow";

const APPLY = process.argv.includes("--apply");

async function main() {
  // Sólo filas recuperables: origen workflow y sin evidencia.
  const rows = await db
    .select({
      id: inventoryWaste.id,
      itemId: inventoryWaste.itemId,
      workflowInstanceId: inventoryWaste.workflowInstanceId,
    })
    .from(inventoryWaste)
    .where(
      and(
        eq(inventoryWaste.origin, "workflow_merma"),
        isNull(inventoryWaste.evidenceUrl)
      )
    );

  const instanceIds = [
    ...new Set(rows.map((r) => r.workflowInstanceId).filter((v): v is string => Boolean(v))),
  ];

  if (rows.length === 0) {
    console.log("Nada que hacer: no hay mermas de workflow sin evidencia.");
    return;
  }

  // Pasos de todas las instancias involucradas, en una sola consulta.
  const steps = await db
    .select({
      stepId: workflowInstanceSteps.stepId,
      value: workflowInstanceSteps.value,
      instanceId: workflowInstanceSteps.instanceId,
    })
    .from(workflowInstanceSteps)
    .where(inArray(workflowInstanceSteps.instanceId, instanceIds));

  // parseMermaSteps es por-instancia (los stepIds se repiten entre instancias).
  const evidenceByRow = new Map<string, string>();
  const byInstance = new Map<string, typeof steps>();
  for (const s of steps) {
    const list = byInstance.get(s.instanceId) ?? [];
    list.push(s);
    byInstance.set(s.instanceId, list);
  }

  let irrecuperables = 0;
  for (const row of rows) {
    if (!row.workflowInstanceId) {
      irrecuperables++;
      continue;
    }
    const instanceSteps = byInstance.get(row.workflowInstanceId);
    if (!instanceSteps) {
      irrecuperables++;
      continue;
    }
    const parsed = parseMermaSteps(instanceSteps.map((s) => ({ stepId: s.stepId, value: s.value })));
    const url = parsed.get(row.itemId)?.evidenceUrl;
    if (url) {
      evidenceByRow.set(row.id, url);
    } else {
      irrecuperables++;
    }
  }

  console.log(
    `Filas candidatas: ${rows.length} · con URL recuperada: ${evidenceByRow.size} · irrecuperables: ${irrecuperables}`
  );
  for (const [id, url] of [...evidenceByRow.entries()].slice(0, 5)) {
    console.log(`  ejemplo ${id.slice(0, 8)}… → ${url.slice(0, 80)}`);
  }

  if (!APPLY) {
    console.log("Dry-run: no se escribió nada. Relanzá con --apply para aplicar.");
    return;
  }

  let actualizadas = 0;
  for (const [id, url] of evidenceByRow) {
    // Re-chequeo del NULL en el WHERE: otra ejecución concurrente (o un
    // extractor posterior) pudo llenar la columna entre el SELECT y acá.
    const res = await db
      .update(inventoryWaste)
      .set({ evidenceUrl: url })
      .where(and(eq(inventoryWaste.id, id), isNull(inventoryWaste.evidenceUrl)))
      .returning({ id: inventoryWaste.id });
    actualizadas += res.length;
  }
  console.log(`Actualizadas: ${actualizadas}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
