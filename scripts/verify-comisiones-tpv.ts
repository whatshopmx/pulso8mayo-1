/**
 * Verificación de la Fase 4 (comisiones por canal y conciliación TPV) contra la
 * DB de desarrollo real, sin servidor ni Inngest.
 *
 * Llama a los servicios directo, siembra todo con el marcador `[E2E]` en las
 * notas y lo borra al final — incluso si un caso falla. Se corre con:
 *
 *   npx tsx scripts/verify-comisiones-tpv.ts
 *
 * No es un spec de Playwright a propósito: lo que hay que verificar aquí es
 * aritmética de dinero y resolución de vigencias, y montar un navegador para
 * comprobar que 27.50% de $10,000 son $2,750 sólo agrega formas de fallar que
 * no tienen que ver con lo que se está probando.
 *
 * Las fechas de negocio van en 2027 a propósito: el seed ocupa julio y agosto de
 * 2026, y calcular sobre un rango compartido sumaría los cortes sembrados a los
 * de la prueba. Un caso que sólo pasa en una DB recién sembrada no verifica
 * nada — verifica el estado de la DB.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import {
  branches,
  channelCommissionRates,
  dailySalesCuts,
  pnlSnapshots,
  users,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  getCommissionsByBranch,
  resolveRateBps,
  upsertCommissionRate,
} from "@/lib/services/commission-service";
import { getPnLByBranch } from "@/lib/services/pnl-service";
import { freezePnLPeriod, getPnLSnapshots } from "@/lib/services/pnl-snapshot-service";
import { weakestOf } from "@/lib/services/pnl-types";
import { computeTpvVariance } from "@/lib/sales/cash-variance";
import { commissionOf } from "@/lib/services/commission-types";

const MARCA = "[E2E] verify-comisiones";

let ok = 0;
let fail = 0;

function check(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) {
    ok += 1;
    console.log(`  ✓ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function main() {
  const [branch] = await db.select().from(branches).limit(1);
  if (!branch) throw new Error("No hay sucursales en la DB de desarrollo. Corre `pnpm seed`.");
  const companyId = branch.companyId;
  const branchId = branch.id;
  console.log(`Sucursal de prueba: ${branch.name} (${branchId})\n`);

  await limpiar(companyId, branchId);

  // -------------------------------------------------------------------------
  console.log("1. Resolución de tarifa por fecha del corte (no por fecha de consulta)");
  // -------------------------------------------------------------------------
  const vigencias = [
    { effectiveFrom: "2026-01-01", rateBps: 2500 },
    { effectiveFrom: "2026-06-01", rateBps: 2750 },
  ];
  check("antes de la primera vigencia no hay tarifa", resolveRateBps(vigencias, "2025-12-31") === null);
  check("en la primera vigencia rige 25.00%", resolveRateBps(vigencias, "2026-03-15") === 2500);
  check("el día que arranca la segunda rige 27.50%", resolveRateBps(vigencias, "2026-06-01") === 2750);
  check("después de la segunda sigue 27.50%", resolveRateBps(vigencias, "2026-08-20") === 2750);

  // -------------------------------------------------------------------------
  console.log("\n2. Cálculo con tarifa conocida");
  // -------------------------------------------------------------------------
  // Se da de alta por la vía real (`upsertCommissionRate`) y no con un INSERT
  // directo: así el script también verifica la validación de bps y de canal.
  const [autor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.companyId, companyId))
    .limit(1);

  for (const tarifa of [
    { channel: "rappi", rateBps: 2750 },
    { channel: "tpv", rateBps: 300 },
  ]) {
    await upsertCommissionRate({
      companyId,
      channel: tarifa.channel,
      rateBps: tarifa.rateBps,
      effectiveFrom: "2027-07-01",
      notes: MARCA,
      createdBy: autor?.id ?? null,
    });
  }

  // Re-capturar la misma (canal, fecha) corrige en vez de duplicar.
  await upsertCommissionRate({
    companyId,
    channel: "tpv",
    rateBps: 300,
    effectiveFrom: "2027-07-01",
    notes: MARCA,
    createdBy: autor?.id ?? null,
  });
  const vigentes = await db
    .select()
    .from(channelCommissionRates)
    .where(
      and(
        eq(channelCommissionRates.companyId, companyId),
        eq(channelCommissionRates.channel, "tpv"),
        eq(channelCommissionRates.effectiveFrom, "2027-07-01"),
      ),
    );
  check("re-capturar la misma vigencia corrige, no duplica", vigentes.length === 1);

  // Corte con Rappi $10,000 bruto, tarjeta $10,000, efectivo $5,000 y Uber $4,000.
  await insertarCorte({
    companyId,
    branchId,
    businessDate: "2027-08-10",
    cashSales: 500_000,
    cardSales: 1_000_000,
    aggregatorSales: { rappi: 1_000_000, uber: 400_000 },
  });

  let porSucursal = await getCommissionsByBranch(companyId, "2027-08-01", "2027-08-31");
  let fila = porSucursal.find((r) => r.branchId === branchId)!;
  const rappi = fila.channels.find((c) => c.channel === "rappi");
  const tpv = fila.channels.find((c) => c.channel === "tpv");

  check(
    "Rappi: 27.50% de $10,000 = $2,750",
    rappi?.commissionCents === commissionOf(1_000_000, 2750) && rappi?.commissionCents === 275_000,
    `${(rappi?.commissionCents ?? 0) / 100} MXN`,
  );
  check("TPV: 3.00% de $10,000 = $300", tpv?.commissionCents === 30_000);
  check(
    "Uber sin tarifa se OMITE del desglose",
    !fila.channels.some((c) => c.channel === "uber"),
  );
  check(
    "la venta de Uber cuenta como sin cubrir",
    fila.uncoveredSalesCents === 400_000,
    `${fila.uncoveredSalesCents / 100} MXN`,
  );
  check(
    "mostrador sin tarifa NO cuenta como sin cubrir (el efectivo no cobra comisión)",
    fila.uncoveredSalesCents === 400_000 && !fila.channels.some((c) => c.channel === "mostrador"),
  );
  check("el renglón es ESTIMATED, nunca MEASURED", fila.source === "ESTIMATED");
  check(
    "cobertura = venta valuada / venta comisionable",
    fila.coveragePercent === Math.round((2_000_000 / 2_400_000) * 100),
    `${fila.coveragePercent}%`,
  );

  // -------------------------------------------------------------------------
  console.log("\n3. La tarifa se resuelve por la fecha del corte");
  // -------------------------------------------------------------------------
  // Un corte ANTERIOR a la vigencia de la tarifa no se valúa.
  await insertarCorte({
    companyId,
    branchId,
    businessDate: "2027-06-10",
    cardSales: 1_000_000,
    aggregatorSales: { rappi: 1_000_000 },
  });
  const junio = (await getCommissionsByBranch(companyId, "2027-06-01", "2027-06-30")).find(
    (r) => r.branchId === branchId,
  )!;
  check(
    "corte previo a la vigencia: sin estimar, no valuado con la tarifa de hoy",
    junio.channels.length === 0 && junio.source === "NO_DATA",
    `sin cubrir ${junio.uncoveredSalesCents / 100} MXN`,
  );

  // -------------------------------------------------------------------------
  console.log("\n4. Conciliación TPV (varianza y signo)");
  // -------------------------------------------------------------------------
  check(
    "tarjeta $10,000, depósito $9,700, comisión $300 → varianza 0",
    computeTpvVariance({ cardSales: 1_000_000, tpvDepositCents: 970_000, commissionCents: 30_000 })
      ?.varianceCents === 0,
  );
  const menor = computeTpvVariance({
    cardSales: 1_000_000,
    tpvDepositCents: 950_000,
    commissionCents: 30_000,
  })!;
  check(
    "con depósito de $9,500 → varianza negativa (alerta)",
    menor.varianceCents === -20_000 && menor.direction === "faltante",
    `${menor.varianceCents / 100} MXN`,
  );
  check(
    "sin depósito capturado NO hay varianza (null ≠ 0)",
    computeTpvVariance({ cardSales: 1_000_000, tpvDepositCents: null, commissionCents: 30_000 }) ===
      null,
  );
  check(
    "sin comisión capturada la varianza se marca como incompleta",
    computeTpvVariance({ cardSales: 1_000_000, tpvDepositCents: 970_000, commissionCents: null })
      ?.commissionCaptured === false,
  );

  // -------------------------------------------------------------------------
  console.log("\n5. La comisión conciliada desplaza a la estimada");
  // -------------------------------------------------------------------------
  await insertarCorte({
    companyId,
    branchId,
    businessDate: "2027-08-11",
    shift: "VESPERTINO",
    cardSales: 1_000_000,
    commissionCents: 27_000, // la terminal cobró $270, no los $300 de la tarifa
    tpvDepositCents: 973_000,
  });
  porSucursal = await getCommissionsByBranch(companyId, "2027-08-11", "2027-08-11");
  fila = porSucursal.find((r) => r.branchId === branchId)!;
  const tpvConciliado = fila.channels.find((c) => c.channel === "tpv")!;
  check(
    "el importe capturado gana sobre la tarifa",
    tpvConciliado.commissionCents === 27_000 && tpvConciliado.measuredCents === 27_000,
    `${tpvConciliado.commissionCents / 100} MXN, no los 300 de la tarifa`,
  );
  check("con todo conciliado el renglón es MEASURED", fila.source === "MEASURED");

  // -------------------------------------------------------------------------
  console.log("\n6. Renglón del P&L");
  // -------------------------------------------------------------------------
  const pnl = await getPnLByBranch(companyId, "2027-08-01", "2027-08-31");
  const rama = pnl.find((b) => b.branchId === branchId)!;
  check("el P&L trae el renglón de comisiones", rama.commissions !== undefined);
  check(
    "con tarifas configuradas el renglón es ESTIMATED",
    rama.commissions?.source === "ESTIMATED",
    rama.commissions?.source,
  );
  check(
    "el desglose por canal viaja con el renglón",
    (rama.commissionsByChannel?.length ?? 0) >= 2,
    (rama.commissionsByChannel ?? []).map((c) => `${c.channel}:${c.cents / 100}`).join(" "),
  );
  check(
    "weakestLine considera el renglón nuevo",
    // El invariante, no el síntoma: `weakestLine` es la peor procedencia del
    // P&L, así que no puede ser más fuerte que la del renglón de comisiones.
    weakestOf(rama.weakestLine, rama.commissions!.source) === rama.weakestLine,
    `weakestLine = ${rama.weakestLine}, comisiones = ${rama.commissions?.source}`,
  );
  check(
    "un P&L cuyo renglón más débil son las comisiones lo declara así",
    weakestOf("MEASURED", "MEASURED", "MEASURED", "MEASURED", "ESTIMATED") === "ESTIMATED",
  );
  const sumaCanales = (rama.commissionsByChannel ?? []).reduce((s, c) => s + c.cents, 0);
  check(
    "el importe del renglón es la suma del desglose",
    sumaCanales === rama.commissions?.cents,
    `${sumaCanales / 100} MXN`,
  );

  // -------------------------------------------------------------------------
  console.log("\n7. Congelar el período y releerlo");
  // -------------------------------------------------------------------------
  await freezePnLPeriod(companyId, "2027-08-01", "2027-08-31");
  const congelados = await getPnLSnapshots(companyId, {
    branchId,
    from: "2027-08-31",
    to: "2027-08-31",
  });
  const snap = congelados.find((r) => r.periodStart === "2027-08-01");
  check("el snapshot conserva el importe de comisiones", snap?.commissionCents === 332_000, `${(snap?.commissionCents ?? 0) / 100} MXN`);
  check(
    "el desglose por canal sobrevive al congelado",
    (snap?.lines.commissionsByChannel?.length ?? 0) >= 2,
  );
  check(
    "la procedencia del renglón se congela con el importe",
    snap?.lines.commissions?.source === "ESTIMATED",
  );

  // Un snapshot anterior a la Fase 4 no tiene la columna. Se simula poniéndola
  // en NULL: la lectura debe devolver `null`, no 0 — un cero afirmaría que ese
  // período no pagó comisiones.
  await db
    .update(pnlSnapshots)
    .set({ commissionCents: null })
    .where(
      and(
        eq(pnlSnapshots.branchId, branchId),
        eq(pnlSnapshots.periodStart, "2027-08-01"),
        eq(pnlSnapshots.periodEnd, "2027-08-31"),
      ),
    );
  const viejo = (
    await getPnLSnapshots(companyId, { branchId, from: "2027-08-31", to: "2027-08-31" })
  ).find((r) => r.periodStart === "2027-08-01");
  check(
    "un snapshot anterior al renglón se relee como null, no como cero",
    viejo?.commissionCents === null,
    String(viejo?.commissionCents),
  );

  // Sin tarifas: NO_DATA, no cero.
  await db
    .delete(channelCommissionRates)
    .where(
      and(
        eq(channelCommissionRates.companyId, companyId),
        sql`${channelCommissionRates.notes} LIKE '%[E2E]%'`,
      ),
    );
  const pnlSinTarifas = await getPnLByBranch(companyId, "2027-08-10", "2027-08-10");
  const ramaSin = pnlSinTarifas.find((b) => b.branchId === branchId)!;
  check(
    "sin tarifas configuradas el renglón es NO_DATA, no cero",
    ramaSin.commissions?.source === "NO_DATA" && ramaSin.commissions?.percentOfSales === null,
    ramaSin.commissions?.source,
  );
}

async function insertarCorte(v: {
  companyId: string;
  branchId: string;
  businessDate: string;
  shift?: "MATUTINO" | "VESPERTINO" | "COMPLETO";
  cashSales?: number;
  cardSales?: number;
  aggregatorSales?: Record<string, number>;
  commissionCents?: number;
  tpvDepositCents?: number;
}) {
  const total =
    (v.cashSales ?? 0) +
    (v.cardSales ?? 0) +
    Object.values(v.aggregatorSales ?? {}).reduce((s, n) => s + n, 0);
  await db.insert(dailySalesCuts).values({
    companyId: v.companyId,
    branchId: v.branchId,
    businessDate: v.businessDate,
    shift: v.shift ?? "MATUTINO",
    channel: "TOTAL",
    totalSales: total,
    cashSales: v.cashSales ?? null,
    cardSales: v.cardSales ?? null,
    aggregatorSales: v.aggregatorSales ?? null,
    commissionCents: v.commissionCents ?? null,
    tpvDepositCents: v.tpvDepositCents ?? null,
    source: "MANUAL_FORM",
    status: "VALIDATED",
    validationNotes: MARCA,
  });
}

async function limpiar(companyId: string, branchId: string) {
  await db
    .delete(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, companyId),
        eq(dailySalesCuts.branchId, branchId),
        sql`${dailySalesCuts.validationNotes} LIKE '%[E2E]%'`,
      ),
    );
  await db
    .delete(channelCommissionRates)
    .where(
      and(
        eq(channelCommissionRates.companyId, companyId),
        sql`${channelCommissionRates.notes} LIKE '%[E2E]%'`,
      ),
    );
  // Los snapshots no tienen dónde llevar la marca `[E2E]`, así que se borran
  // por el período de prueba, que es de 2027 y no existe en el seed.
  await db
    .delete(pnlSnapshots)
    .where(
      and(eq(pnlSnapshots.companyId, companyId), sql`${pnlSnapshots.periodStart} >= '2027-01-01'`),
    );
}

main()
  .then(async () => {
    const [branch] = await db.select().from(branches).limit(1);
    if (branch) await limpiar(branch.companyId, branch.id);
    console.log(`\n${ok} checks pasados, ${fail} fallidos.`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("\nError:", err);
    const [branch] = await db.select().from(branches).limit(1);
    if (branch) await limpiar(branch.companyId, branch.id).catch(() => {});
    process.exit(1);
  });
