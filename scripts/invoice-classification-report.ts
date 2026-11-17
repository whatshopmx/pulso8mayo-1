/**
 * Reporte y clasificación histórica de CFDI (T12).
 *
 *   npx tsx scripts/invoice-classification-report.ts --company <uuid>
 *   npx tsx scripts/invoice-classification-report.ts --company <uuid> --apply --actor <uuid> --reason "..."
 *
 * Por omisión es un reporte de SOLO LECTURA: cuenta e importes por destino,
 * propuestas, conflictos y el impacto esperado en la elegibilidad de compra.
 * Nada se escribe hasta que alguien revisa el reporte y pide `--apply`.
 *
 * Con `--apply` el backfill escribe únicamente la metadata de clasificación
 * (destino, actor, fecha, motivo y procedencia) de los documentos con
 * propuesta inequívoca. No crea gastos, no mueve pagos ni pólizas, no borra
 * documentos y no toca los que quedan «Por clasificar».
 */
import "dotenv/config";
import { backfillInvoiceClassification, getInvoiceClassificationReport, type ClassificationReport } from "@/lib/services/invoice-classification-service";

const args = process.argv.slice(2);
const valor = (nombre: string) => {
  const index = args.indexOf(`--${nombre}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const existe = (nombre: string) => args.includes(`--${nombre}`);

const companyId = valor("company");
if (!companyId) {
  console.error("Uso: npx tsx scripts/invoice-classification-report.ts --company <uuid> [--apply --actor <uuid> --reason <motivo>] [--limit <n>] [--json]");
  process.exit(2);
}
const aplicar = existe("apply");
const actorId = valor("actor");
const reason = valor("reason");
if (aplicar && (!actorId || !reason)) {
  console.error("Con --apply hacen falta --actor y --reason.");
  process.exit(2);
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

function imprimir(reporte: ClassificationReport) {
  console.log(`\nEmpresa: ${reporte.companyId}`);
  console.log(`Modo: ${reporte.mode === "APPLIED" ? "APLICADO" : "SIMULACIÓN (sin escrituras)"}`);
  console.log(`Documentos revisados: ${reporte.totals.invoices} · ${money(reporte.totals.amountCents)}`);
  if (reporte.scope.truncated) {
    console.log(`AVISO: el alcance se cortó en ${reporte.scope.limit} documentos, no cubre toda la empresa.`);
    console.log("Repite con --limit mayor antes de aplicar.");
  }
  console.log("\nPor destino actual:");
  for (const [destino, bucket] of Object.entries(reporte.byDestination)) {
    console.log(`  ${destino.padEnd(20)} ${String(bucket.count).padStart(5)}  ${money(bucket.amountCents)}`);
  }
  console.log("\nPropuestas:");
  console.log(`  Compra de inventario ${String(reporte.proposals.byDestination.INVENTORY_PURCHASE.count).padStart(5)}  ${money(reporte.proposals.byDestination.INVENTORY_PURCHASE.amountCents)}`);
  console.log(`  Gasto operativo       ${String(reporte.proposals.byDestination.OPERATING_EXPENSE.count).padStart(5)}  ${money(reporte.proposals.byDestination.OPERATING_EXPENSE.amountCents)}`);
  console.log(`  Total propuestas      ${String(reporte.proposals.count).padStart(5)}  ${money(reporte.proposals.amountCents)}`);
  console.log(`\nSin evidencia suficiente (siguen «Por clasificar»): ${reporte.pending.count} · ${money(reporte.pending.amountCents)}`);
  console.log(`Conflictos (requieren revisión): ${reporte.conflicts.count} · ${money(reporte.conflicts.amountCents)}`);
  for (const [motivo, count] of Object.entries(reporte.conflicts.reasons)) console.log(`  - ${motivo}: ${count}`);
  console.log("\nImpacto en la elegibilidad de compra (deuda por CFDI):");
  console.log(`  Antes:  ${money(reporte.balanceImpact.standaloneBeforeCents)}`);
  console.log(`  Después: ${money(reporte.balanceImpact.standaloneAfterCents)}`);
  console.log(`  Diferencia: ${money(reporte.balanceImpact.deltaCents)} · documentos afectados: ${reporte.balanceImpact.affectedInvoices}`);
  if (reporte.mode === "APPLIED") {
    console.log(`\nClasificados: ${reporte.applied.count} · omitidos: ${reporte.applied.skipped}`);
  }
}

async function main() {
  const reporte = aplicar
    ? await backfillInvoiceClassification(companyId, { actorId: actorId!, reason: reason!, dryRun: false })
    : await getInvoiceClassificationReport(companyId, { limit: valor("limit") ? Number(valor("limit")) : undefined });

  if (existe("json")) console.log(JSON.stringify(reporte, null, 2));
  else imprimir(reporte);

  if (!aplicar && reporte.proposals.count > 0) {
    console.log("\nRevisa el reporte antes de aplicar. Usa --apply --actor <uuid> --reason <motivo>.");
  }
  if (reporte.scope.truncated) {
    console.error("El reporte está incompleto: no se aplicó ni se recomienda aplicar este alcance.");
    process.exitCode = 3;
  }
}

main().catch((error: unknown) => {
  // Solo el mensaje: ni credenciales ni detalles de conexión en la salida.
  console.error(error instanceof Error ? error.message : "No se pudo generar el reporte.");
  process.exitCode = 1;
});
