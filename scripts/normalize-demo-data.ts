/**
 * Normaliza los datos del demo sin volver a sembrar (idempotente).
 *
 * Dos correcciones de contrato que el seed histórico dejó mal:
 *
 * 1. URLs de evidencia ficticias (`https://pulso.ejemplo/...` y `local://...`).
 *    Se reescriben a los ocho assets reales de `public/demo-evidence/`, tanto en
 *    `workflow_instance_steps.evidence_url` (fuente legacy que aún lee la
 *    ejecución) como en la tabla canónica `evidence.url`.
 * 2. Confianza de la IA en escala porcentual (60–100) cuando el contrato
 *    EVI-01 es fracción 0–1. Sólo convierte valores > 1 y ≤ 100; volver a
 *    correrlo no cambia nada.
 *
 * Uso:
 *   npx tsx scripts/normalize-demo-data.ts
 *
 * No toca montos, timbrados ni nóminas. Se puede ejecutar varias veces.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { evidence, workflowInstanceSteps } from "@/lib/db/schema";
import { like, or, sql } from "drizzle-orm";

const DEMO_EVIDENCE_COUNT = 8;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function demoEvidenceUrl(original: string): string {
  const index = (hashString(original) % DEMO_EVIDENCE_COUNT) + 1;
  return `/demo-evidence/evidencia-${String(index).padStart(2, "0")}.png`;
}

function isFictitious(url: string | null): url is string {
  if (!url) return false;
  return url.startsWith("https://pulso.ejemplo/") || url.startsWith("local://");
}

async function normalizeStepUrls(): Promise<number> {
  const rows = await db
    .select({
      id: workflowInstanceSteps.id,
      evidenceUrl: workflowInstanceSteps.evidenceUrl,
      value: workflowInstanceSteps.value,
    })
    .from(workflowInstanceSteps)
    .where(
      or(
        like(workflowInstanceSteps.evidenceUrl, "https://pulso.ejemplo/%"),
        like(workflowInstanceSteps.evidenceUrl, "local://%")
      )
    );

  let updated = 0;
  for (const row of rows) {
    if (!isFictitious(row.evidenceUrl)) continue;
    const next = demoEvidenceUrl(row.evidenceUrl);
    const value = row.value === row.evidenceUrl ? next : row.value;
    await db
      .update(workflowInstanceSteps)
      .set({ evidenceUrl: next, value })
      .where(sql`${workflowInstanceSteps.id} = ${row.id}`);
    updated++;
  }
  return updated;
}

async function normalizeCanonicalEvidenceUrls(): Promise<number> {
  const rows = await db
    .select({ id: evidence.id, url: evidence.url })
    .from(evidence)
    .where(
      or(
        like(evidence.url, "https://pulso.ejemplo/%"),
        like(evidence.url, "local://%")
      )
    );

  let updated = 0;
  for (const row of rows) {
    if (!isFictitious(row.url)) continue;
    await db
      .update(evidence)
      .set({ url: demoEvidenceUrl(row.url) })
      .where(sql`${evidence.id} = ${row.id}`);
    updated++;
  }
  return updated;
}

async function normalizeConfidence(): Promise<void> {
  // jsonb_set preserva el resto del dictamen (`passed`, `notes`, `score`).
  const result = await db.execute(sql`
    UPDATE workflow_instance_steps
    SET ai_analysis = jsonb_set(
      ai_analysis,
      '{confidence}',
      to_jsonb(((ai_analysis ->> 'confidence')::numeric / 100.0)),
      true
    )
    WHERE ai_analysis IS NOT NULL
      AND ai_analysis ? 'confidence'
      AND (ai_analysis ->> 'confidence') ~ '^[0-9]+(\\.[0-9]+)?$'
      AND (ai_analysis ->> 'confidence')::numeric > 1
      AND (ai_analysis ->> 'confidence')::numeric <= 100
  `);
  const affected = (result as { rowCount?: number }).rowCount ?? 0;
  console.log(`Confianza normalizada a fracción 0–1: ${affected} pasos.`);
}

async function main() {
  console.log("=== Normalización de datos del demo ===");

  const steps = await normalizeStepUrls();
  console.log(`URLs de evidencia en pasos: ${steps} actualizadas.`);

  const canonical = await normalizeCanonicalEvidenceUrls();
  console.log(`URLs en la tabla canónica evidence: ${canonical} actualizadas.`);

  await normalizeConfidence();

  console.log("Listo. El script es idempotente: una segunda corrida no cambia filas.");
}

main().catch((error) => {
  console.error("Falló la normalización:", error);
  process.exitCode = 1;
});
