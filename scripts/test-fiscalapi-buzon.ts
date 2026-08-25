// Prueba del BUZÓN fiscal (descarga masiva SAT) — el flujo realista multitenant:
//
//   PASO 1  Proveedor timbra hacia el RFC de Pulso (su CSD; en pruebas, los
//           CSD públicos de prueba del SAT: un proveedor real jamás comparte
//           el suyo — timbra desde su propio sistema).
//   PASO 2  Pulso se registra como receptor en su tenant FiscalAPI y sube SU
//           FIEL (e.firma ≠ CSD).
//   PASO 3  Regla de descarga "Recibidos" + solicitud al SAT de últimos N días.
//   PASO 4  Metadatos de lo recibido → conciliación contra OCs/gastos de la BD.
//
// Uso:
//   npx tsx scripts/test-fiscalapi-buzon.ts               # flujo completo
//   npx tsx scripts/test-fiscalapi-buzon.ts --sin-timbrar # sólo buzón+concilia
//   npx tsx scripts/test-fiscalapi-buzon.ts --dias 3      # ventana de descarga
//   npx tsx scripts/test-fiscalapi-buzon.ts --valores     # emisión por valores
//
// NOTA sandbox: el simulador de descarga masiva de FiscalAPI SÓLO refleja
// facturas creadas POR REFERENCIAS entre personas del tenant; las timbradas
// por valores nunca aparecen en los metadatos. Por eso el PASO 1 usa por
// defecto la simulación por referencias (total exacto de la OC); --valores
// conserva el camino de fiscal-invoicing-service para pruebas de timbrado.

import "dotenv/config";
import { db } from "@/lib/db";
import {
  companies,
  operatingExpenses,
  payees,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  asegurarFiel,
  asegurarPersonaReceptora,
  asegurarReglaDescarga,
  conciliar,
  esperarSolicitud,
  obtenerMetadatos,
  rfcReceptorPulso,
  simularEmisionGasto,
  simularEmisionProveedor,
  solicitarDescarga,
} from "@/lib/services/fiscal-buzon-service";
import {
  stampPurchaseOrderInvoice,
} from "@/lib/services/fiscal-invoicing-service";

const args = process.argv.slice(2);
const SIN_TIMBRAR = args.includes("--sin-timbrar");
const POR_VALORES = args.includes("--valores");
const gastoIdx = args.indexOf("--gasto");
const GASTO_ID = gastoIdx >= 0 ? args[gastoIdx + 1] : null;
const diasIdx = args.indexOf("--dias");
const DIAS = diasIdx >= 0 ? parseInt(args[diasIdx + 1], 10) || 2 : 2;

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" Buzón fiscal · facturas recibidas vía descarga masiva SAT");
  console.log("═══════════════════════════════════════════════════════════");

  const [company] = await db.select().from(companies).limit(1);
  if (!company) throw new Error("No hay empresas en la BD. Corre los seeds primero.");
  const receptor = rfcReceptorPulso();
  console.log(`\n Empresa receptora : ${company.name} (${receptor})`);

  // ── PASO 1 · lado del proveedor ──────────────────────────────────────────
  let uuidTimbrado: string | null = null;
  if (!SIN_TIMBRAR) {
    if (GASTO_ID) {
      // Gasto operativo: el payee (con RFC de prueba) es el emisor.
      const [gasto] = await db
        .select({
          id: operatingExpenses.id,
          description: operatingExpenses.description,
          amount: operatingExpenses.amount,
          payeeName: payees.name,
          tinPayee: payees.taxId,
        })
        .from(operatingExpenses)
        .innerJoin(payees, eq(operatingExpenses.payeeId, payees.id))
        .where(eq(operatingExpenses.id, GASTO_ID))
        .limit(1);
      if (!gasto?.tinPayee) {
        throw new Error(`Gasto ${GASTO_ID} no encontrado o sin payee con RFC (corre scripts/seed-gasto-demo.ts)`);
      }
      const r = await simularEmisionGasto(gasto);
      uuidTimbrado = r.uuid;
      console.log(`\n── PASO 1 · El payee emite su factura por el gasto ──`);
      console.log(` ✓ TIMBRADA por referencias · emisor=${r.issuerTin} (${gasto.payeeName}) · $${r.total} · UUID=${r.uuid}`);
    } else {
    // OCs timbrables cuyo proveedor tiene RFC (de prueba) asignado.
    const pos = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        subtotal: purchaseOrders.subtotal,
        taxAmount: purchaseOrders.taxAmount,
        supplierName: suppliers.name,
        taxId: suppliers.taxId,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          eq(purchaseOrders.companyId, company.id),
          inArray(purchaseOrders.status, ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "CLOSED"])
        )
      )
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(10);
    const target = pos.find((p) => p.poNumber === "PO-2026-0361") ?? pos[0];
    if (!target) throw new Error("No hay OCs con proveedor para simular la emisión.");

    if (!target.taxId) throw new Error(`Proveedor ${target.supplierName} sin RFC de prueba (corre seed-fiscalapi-test-rfcs.ts)`);

    console.log(`\n── PASO 1 · El proveedor emite su factura por ${target.poNumber} ──`);
    if (POR_VALORES) {
      // Camino clásico por valores (NO aparece en el buzón simulado).
      const r = await stampPurchaseOrderInvoice(target.id);
      if (r.status !== "TIMBRADO") throw new Error(`La emisión falló: ${r.message}`);
      uuidTimbrado = r.uuid;
      console.log(` ✓ TIMBRADA por valores · emisor=${r.issuerTin} · UUID=${r.uuid}`);
      console.log("   ⚠ el simulador sandbox no la mostrará en metadatos (sólo por referencias)");
    } else {
      const r = await simularEmisionProveedor(
        { poNumber: target.poNumber, subtotal: target.subtotal, taxAmount: target.taxAmount },
        target.taxId
      );
      uuidTimbrado = r.uuid;
      console.log(` ✓ TIMBRADA por referencias · emisor=${r.issuerTin} (${target.supplierName}) · $${r.total} · UUID=${r.uuid}`);
    }
    }
    console.log("   (en producción esto lo hace el sistema del proveedor con SU CSD)");
  } else {
    console.log("\n── PASO 1 omitido (--sin-timbrar) ──");
  }

  // ── PASO 2 · registro del receptor + FIEL ───────────────────────────────
  console.log("\n── PASO 2 · Pulso como receptor: persona + FIEL ──");
  const persona = await asegurarPersonaReceptora();
  console.log(` ✓ Persona: ${persona.id!.slice(0, 8)}… (${persona.tin ?? receptor})`);
  const fiel = await asegurarFiel(persona.id!);
  console.log(` ✓ e.firma/FIEL: ${fiel}`);

  // ── PASO 3 · regla + solicitud al SAT ───────────────────────────────────
  console.log("\n── PASO 3 · Regla 'Recibidos' y solicitud de descarga ──");
  const regla = await asegurarReglaDescarga(persona.id!);
  console.log(` ✓ Regla: ${regla.id.slice(0, 8)}… (${regla.descripcion})`);
  const sol = await solicitarDescarga(regla.id, DIAS);
  console.log(` ✓ Solicitud ${sol.id.slice(0, 8)}… lista (estado: ${sol.estado})`);
  if (!/TERMINADA|COMPLETADA/i.test(sol.estado)) {
    process.stdout.write(" Esperando al SAT ");
    const estadoFinal = await esperarSolicitud(sol.id, 150);
    console.log(`\n ✓ Estado final de la solicitud: ${estadoFinal}`);
    if (!/TERMINADA|COMPLETADA/i.test(estadoFinal)) {
      console.error(" ✗ La solicitud no terminó a tiempo; reintenta en unos minutos (--sin-timbrar).");
      process.exit(4);
    }
  }

  // ── PASO 4 · metadatos + conciliación ───────────────────────────────────
  console.log("\n── PASO 4 · Facturas recibidas en el buzón ──");
  const recibidas = await obtenerMetadatos(sol.id);
  if (recibidas.length === 0) {
    console.log(" (buzón vacío en esta ventana — el SAT puede tardar en indexar timbres recientes)");
  }
  for (const f of recibidas) {
    const marca = uuidTimbrado && f.uuid === uuidTimbrado ? " ← la que acabamos de emitir" : "";
    console.log(` • ${f.uuid?.slice(0, 8) ?? "—"}… | ${f.issuerTin ?? "?"} | $${f.total ?? "?"} | ${f.fecha?.slice(0, 19) ?? "?"}${marca}`);
  }

  console.log("\n── PASO 5 · Conciliación contra Pulso ──");
  const conciliadas = await conciliar(recibidas.filter((f) => f.total != null));
  for (const c of conciliadas) {
    const destino = c.ocCoincidente
      ? `OC: ${c.ocCoincidente}`
      : c.gastoCoincidente
        ? `gasto: ${c.gastoCoincidente}`
        : "sin match";
    console.log(
      ` • ${c.factura.issuerTin ?? "?"} $${c.factura.total?.toFixed(2)} → ` +
        `contraparte: ${c.contraparte ?? "desconocida"} · ${destino}`
    );
  }
  const reconocidas = conciliadas.filter((c) => c.contraparte).length;
  const matcheadas = conciliadas.filter((c) => c.ocCoincidente ?? c.gastoCoincidente).length;
  console.log(`\n Resumen: ${recibidas.length} factura(s) en el buzón · ${reconocidas} ligadas a proveedores · ${matcheadas} con OC conciliada\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n ✗ Error fatal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
