// Prueba de facturación CFDI 4.0 con FiscalAPI sobre órdenes de compra y
// gastos operativos reales de Pulso, usando el ambiente de pruebas (gratis).
//
// Uso:
//   npx tsx scripts/test-fiscalapi.ts --dry-run          # sin credenciales:
//       arma los CFDI desde la BD y verifica totales localmente.
//   npx tsx scripts/test-fiscalapi.ts --live             # timbra en sandbox
//   npx tsx scripts/test-fiscalapi.ts --live --limit 5
//   npx tsx scripts/test-fiscalapi.ts --live --po <uuid> --expense <uuid>
//
// Requisitos del ambiente live (una sola vez):
//   1. Cuenta en https://test.fiscalapi.com (confirmar correo).
//   2. Suscripción de prueba con la tarjeta de prueba
//      (4242 4242 4242 4242) y compra de timbres de prueba (costo $0).
//   3. .env con FISCALAPI_API_KEY y FISCALAPI_TENANT.
//
// Datos fiscales usados para timbrar: personas y CSD de prueba oficiales del
// SAT (docs.fiscalapi.com/testing-data). Ningún RFC real participa.

import "dotenv/config";

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  getFiscalApiClient,
  getFiscalApiConfig,
  isFiscalApiConfigured,
} from "@/lib/fiscal/fiscalapi";
import {
  buildExpenseCfdi,
  buildPurchaseOrderCfdi,
  listStampableExpenses,
  listStampablePurchaseOrders,
  stampExpenseInvoice,
  stampPurchaseOrderInvoice,
  StampedCfdi,
} from "@/lib/services/fiscal-invoicing-service";
import { DEFAULT_TEST_RECIPIENT } from "@/lib/fiscal/fiscalapi";
import { resolveTestPerson } from "@/lib/fiscal/sat-test-data";

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 3 : 3;
const poIdx = args.indexOf("--po");
const expIdx = args.indexOf("--expense");
const ONLY_PO = poIdx >= 0 ? args[poIdx + 1] : null;
const ONLY_EXPENSE = expIdx >= 0 ? args[expIdx + 1] : null;

function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

/** Marca los emisores que entraron por respaldo (su proveedor no tenía RFC de prueba). */
function etiquetaEmisor(rfc: string | undefined, matched?: boolean): string {
  if (!rfc) return "—";
  return matched ? rfc : `${rfc}*`;
}

function printRow(cols: Array<string | number>, widths: number[]) {
  const line = cols.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log("  " + line);
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" FiscalAPI · facturación de prueba (OCs y gastos operativos)");
  console.log("═══════════════════════════════════════════════════════════");

  const config = getFiscalApiConfig();
  const dryRun = !LIVE || !isFiscalApiConfigured();

  if (!dryRun && config) {
    console.log(`\n Ambiente : ${config.apiUrl}`);
    console.log(` Tenant   : ${config.tenant.slice(0, 6)}…`);
  } else if (LIVE) {
    console.log(
      "\n ⚠  FISCALAPI_API_KEY / FISCALAPI_TENANT ausentes: cayendo a --dry-run.\n" +
        "   Alta gratis en https://test.fiscalapi.com → suscripción de prueba con\n" +
        "   tarjeta 4242 4242 4242 4242 → Developers » API Keys."
    );
  } else {
    console.log("\n Modo dry-run: se arman y validan los CFDI sin llamar a FiscalAPI.");
  }

  // --- Empresa de trabajo -------------------------------------------------
  const [company] = await db.select().from(companies).limit(1);
  if (!company) {
    console.error("\n ✗ No hay empresas en la BD. Corre scripts/seed-demo-data.ts primero.");
    process.exit(1);
  }
  console.log(`\n Empresa  : ${company.name}`);

  // --- Documentos origen --------------------------------------------------
  const pos = ONLY_PO ? [{ id: ONLY_PO, poNumber: ONLY_PO }] : await listStampablePurchaseOrders(company.id, LIMIT);
  const gastos = ONLY_EXPENSE
    ? [{ id: ONLY_EXPENSE, description: ONLY_EXPENSE, category: "N/A" as never }]
    : await listStampableExpenses(company.id, LIMIT);

  console.log(` OCs a procesar    : ${pos.length}`);
  console.log(` Gastos a procesar : ${gastos.length}`);

  if (pos.length === 0 && gastos.length === 0) {
    console.error(
      "\n ✗ No hay OCs aprobadas ni gastos aprobados/pagados para facturar.\n" +
        "   Genera datos con scripts/seed-demo-data.ts o crea documentos en el dashboard."
    );
    process.exit(1);
  }

  // --- Verificación de autenticación (sólo live) ---------------------------
  if (!dryRun) {
    try {
      const client = getFiscalApiClient();
      const ping = await client.catalogs.searchCatalog("SatUnitMeasurements", "pieza", 1, 1);
      if (!ping.succeeded) throw new Error(ping.message || "catálogo no disponible");
      console.log("\n ✓ Autenticación FiscalAPI OK (catálogo SAT accesible)");
    } catch (error) {
      console.error(`\n ✗ La autenticación falló: ${(error as Error).message}`);
      console.error("   Revisa FISCALAPI_API_KEY, FISCALAPI_TENANT y la suscripción activa.");
      process.exit(2);
    }
  }

  // --- Construcción + verificación local de cada CFDI ---------------------
  interface PlanEntry {
    source: string;
    reference: string;
    issuerTin: string;
    matched: boolean;
    items: number;
    expectedTotal: number;
  }
  const plan: PlanEntry[] = [];
  const receptor = resolveTestPerson(process.env.FISCALAPI_COMPANY_TEST_TIN) ?? DEFAULT_TEST_RECIPIENT;

  console.log(
    `\n Emisor = proveedor/contraparte (RFC de prueba SAT con su propio CSD); ` +
      `\n receptor = la empresa Pulso como ${receptor.tin}. (* = respaldo, sin match en catálogo).`
  );

  console.log("\n── Construcción de comprobantes ──────────────────────────────");
  printRow(["Origen", "Referencia", "Emisor", "Part.", "Total esperado"], [7, 30, 15, 5, 15]);

  for (const po of pos) {
    try {
      const built = await buildPurchaseOrderCfdi(po.id);
      plan.push({
        source: "OC",
        reference: built.poNumber,
        issuerTin: built.issuer.tin,
        matched: built.issuerMatched,
        items: built.items.length,
        expectedTotal: built.expectedTotal,
      });
      printRow(
        ["OC", built.poNumber, etiquetaEmisor(built.issuer.tin, built.issuerMatched), built.items.length, money(built.expectedTotal)],
        [7, 30, 15, 5, 15]
      );
    } catch (error) {
      printRow(["OC", `${po.poNumber}: ${(error as Error).message}`.slice(0, 28), "—", "-", "-"], [7, 30, 15, 5, 15]);
    }
  }

  for (const gasto of gastos) {
    try {
      const built = await buildExpenseCfdi(gasto.id);
      plan.push({
        source: "GASTO",
        reference: built.description.slice(0, 40),
        issuerTin: built.issuer.tin,
        matched: built.issuerMatched,
        items: built.items.length,
        expectedTotal: built.expectedTotal,
      });
      printRow(
        ["GASTO", built.description.slice(0, 28), etiquetaEmisor(built.issuer.tin, built.issuerMatched), built.items.length, money(built.expectedTotal)],
        [7, 30, 15, 5, 15]
      );
    } catch (error) {
      printRow(["GASTO", `ERROR: ${(error as Error).message}`.slice(0, 28), "—", "-", "-"], [7, 30, 15, 5, 15]);
    }
  }

  if (dryRun) {
    console.log(
      "\n Dry-run completado: estructuras válidas y totales cuadrados por construcción.\n" +
        " Con credenciales, corre de nuevo con --live para timbrar en el sandbox."
    );
    return;
  }

  // --- Timbrado real en el sandbox ----------------------------------------
  console.log("\n── Timbrado en FiscalAPI (sandbox) ───────────────────────────");
  printRow(["Origen", "Referencia", "Emisor", "Estado", "UUID", "SAT"], [7, 22, 15, 10, 38, 10]);

  const resultados: StampedCfdi[] = [];
  const timbrar = async (fuente: () => Promise<StampedCfdi>, etiqueta: string) => {
    const r = await fuente();
    resultados.push(r);
    printRow(
      [
        etiqueta,
        r.reference.slice(0, 20),
        etiquetaEmisor(r.issuerTin, r.issuerMatched),
        r.status,
        (r.uuid ?? r.message?.slice(0, 36) ?? "").slice(0, 36),
        r.satStatus ?? "—",
      ],
      [7, 22, 15, 10, 38, 10]
    );
  };

  for (const po of pos) {
    await timbrar(() => stampPurchaseOrderInvoice(po.id), "OC");
  }
  for (const gasto of gastos) {
    await timbrar(() => stampExpenseInvoice(gasto.id), "GASTO");
  }

  // --- Resumen -------------------------------------------------------------
  const timbrados = resultados.filter((r) => r.status === "TIMBRADO");
  const conTotalesOk = timbrados.filter((r) => r.totalsMatch);
  const fallidos = resultados.filter((r) => r.status !== "TIMBRADO");

  console.log("\n── Resumen ───────────────────────────────────────────────────");
  console.log(` Timbrados            : ${timbrados.length}/${resultados.length}`);
  console.log(` Totales verificados  : ${conTotalesOk.length}/${timbrados.length}`);
  console.log(` Rechazados/errores   : ${fallidos.length}`);
  for (const f of fallidos) {
    console.log(`   · ${f.source} ${f.reference}: ${f.message?.slice(0, 90)}`);
  }

  // Reporte persistente para revisión posterior.
  const reportPath = path.join(process.cwd(), "scratch", "fiscalapi-test-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), resultados }, null, 2));
  console.log(`\n Reporte: ${reportPath}\n`);

  process.exitCode = fallidos.length > 0 ? 3 : 0;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(`\n ✗ Error fatal: ${error instanceof Error ? error.stack || error.message : error}`);
    process.exit(1);
  });
