/**
 * Diagnóstico R2 parte 2: clasifica los patrones de evidence_url en BD.
 * Uso: npx tsx --env-file=.env scripts/diag-r2-data.ts
 */
import { db } from "../lib/db";
import { inventoryWaste, workflowInstanceSteps } from "../lib/db/schema";
import { isNotNull } from "drizzle-orm";

function classify(url: string): string {
  if (url.includes("r2.dev")) return "R2 public (r2.dev)";
  if (url.includes("pulso.ejemplo")) return "FAKE seed data (pulso.ejemplo)";
  if (url.startsWith("/uploads") || url.includes("localhost")) return "LOCAL fallback";
  if (url.startsWith("http")) {
    const host = new URL(url).host;
    return `OTHER http: ${host}`;
  }
  return "bare key";
}

async function main() {
  const steps = await db
    .select({ url: workflowInstanceSteps.evidenceUrl })
    .from(workflowInstanceSteps)
    .where(isNotNull(workflowInstanceSteps.evidenceUrl));

  const counts = new Map<string, number>();
  const samples = new Map<string, string>();
  for (const s of steps) {
    if (!s.url) continue;
    const c = classify(s.url);
    counts.set(c, (counts.get(c) ?? 0) + 1);
    if (!samples.has(c)) samples.set(c, s.url);
  }

  console.log(`=== workflow_instance_steps: ${steps.length} pasos con evidence_url ===`);
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
    console.log(`          ej: ${samples.get(k)?.slice(0, 100)}`);
  }

  const waste = await db
    .select({ ev: inventoryWaste.evidenceUrl })
    .from(inventoryWaste)
    .where(isNotNull(inventoryWaste.evidenceUrl));
  console.log(`\n=== inventory_waste con evidence_url: ${waste.length} ===`);

  // ¿Alguna URL apunta al bucket público configurado?
  const pub = process.env.R2_PUBLIC_URL ?? "";
  const anyR2 = steps.some((s) => s.url?.includes("r2.dev")) || waste.some((w) => w.ev?.includes("r2.dev"));
  console.log(`\nR2_PUBLIC_URL configurado: ${pub}`);
  console.log(`¿Existe ALGUNA evidencia subida a R2 en BD? ${anyR2 ? "SÍ" : "NO"}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
