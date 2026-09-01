/**
 * Verificación de la base móvil y la alerta de tendencia (Fase 2).
 *
 *   npx tsx scripts/verify-base-movil-recurrentes.ts
 *
 * Lo que se comprueba es el cambio de referencia: un servicio medido deja de
 * juzgarse contra el número que alguien capturó y pasa a juzgarse contra su
 * propio historial. Un solo `base_amount_cents` no puede describir el consumo
 * eléctrico de un restaurante, y ensanchar la tolerancia hasta que calle el
 * verano deja de detectar fugas — por eso la tendencia se mira aparte.
 *
 * Complementa `verify-tolerancia-recurrentes.ts`, que cubre las Fases 0 y 1.
 *
 * Todo lo sembrado lleva `[E2E] base movil` en el título, el folio o el nombre
 * y se borra al final, incluso si un caso falla.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { branches, invoices, recurringContracts, suppliers, users } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { TreasuryService } from "@/lib/services/treasury-service";
import { detectViolations, type Violation } from "@/lib/services/control-interno-service";
import { addCalendarDays, localDateString } from "@/lib/workflows/today";

const MARCA = "[E2E] base movil";

/** Las fechas son relativas a hoy: las ventanas del servicio también lo son. */
const HOY = localDateString(new Date(), null);
const dias = (n: number) => addCalendarDays(HOY, -n);

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
  const sucursales = await db.select().from(branches).limit(2);
  if (sucursales.length === 0) throw new Error("No hay sucursales. Corre `pnpm seed`.");
  const [sucA, sucB] = sucursales;
  const companyId = sucA.companyId;

  const [autor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.companyId, companyId))
    .limit(1);
  const userId = autor?.id ?? "";

  console.log(`Sucursal A: ${sucA.name}${sucB ? ` · Sucursal B: ${sucB.name}` : ""}\n`);
  await limpiar(companyId);

  // -------------------------------------------------------------------------
  console.log("1. El servicio medido se juzga contra su historial, no contra la base");
  // -------------------------------------------------------------------------
  // Base capturada de $10,000, pero el consumo real ronda los $20,000. Ese
  // desfase es justo lo que pasa cuando alguien captura el recibo de un mes
  // flojo y nunca lo vuelve a tocar.
  const cfe = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "CFE historial",
    tipo: "SERVICIO_BASICO", base: 1_000_000, arriba: 20, abajo: 20,
  });
  for (const [i, d] of [300, 270, 240].entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: cfe.supplierId, contratoId: cfe.id,
      total: 2_000_000, etiqueta: `hist-${i}`, fecha: dias(d) });
  }

  // $21,000 es +110% sobre la base capturada —excepción segura antes— pero
  // sólo +5% sobre la mediana de sus propios recibos.
  await factura({ companyId, branchId: sucA.id, supplierId: cfe.supplierId, contratoId: cfe.id,
    total: 2_100_000, etiqueta: "dentro-mediana", fecha: dias(10) });
  let v = await detectViolations(companyId);
  check(
    "un recibo normal deja de ser excepción aunque duplique la base capturada",
    !v.some((x) => esDe(x, "dentro-mediana")),
  );

  // $26,000 = +30% sobre la mediana, más allá del 20% configurado.
  await factura({ companyId, branchId: sucA.id, supplierId: cfe.supplierId, contratoId: cfe.id,
    total: 2_600_000, etiqueta: "fuera-mediana", fecha: dias(5) });
  v = await detectViolations(companyId);
  const desviado = v.find((x) => esDe(x, "fuera-mediana"));
  check("un recibo fuera de rango sí se detecta contra la mediana", desviado !== undefined);
  check(
    "y el hallazgo declara que la referencia es la mediana móvil",
    (desviado?.detail ?? "").includes("mediana de sus"),
  );
  check(
    "contra la referencia calculada, no contra la base capturada",
    (desviado?.detail ?? "").includes("$20000.00 MXN"),
    desviado?.detail.slice(0, 120),
  );

  // -------------------------------------------------------------------------
  console.log("\n2. Un contrato pactado NO usa base móvil");
  // -------------------------------------------------------------------------
  // La renta tiene importe pactado: desviarse es un error de facturación, no
  // una temporada. Si usara la mediana de sus recibos, un recibo de $53,000
  // contra una mediana de $100,000 no diría nada.
  const renta = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Renta pactada",
    tipo: "RENTA", base: 5_000_000, arriba: 5, abajo: null,
  });
  for (const [i, d] of [300, 270, 240].entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: renta.supplierId, contratoId: renta.id,
      total: 10_000_000, etiqueta: `renta-hist-${i}`, fecha: dias(d) });
  }
  await factura({ companyId, branchId: sucA.id, supplierId: renta.supplierId, contratoId: renta.id,
    total: 5_300_000, etiqueta: "renta-hoy", fecha: dias(5) });
  v = await detectViolations(companyId);
  const rentaHallazgo = v.find((x) => esDe(x, "renta-hoy"));
  check("la renta sigue midiéndose contra su monto pactado", rentaHallazgo !== undefined);
  check(
    "y el hallazgo lo declara así",
    (rentaHallazgo?.detail ?? "").includes("monto base capturado en el contrato"),
  );

  // -------------------------------------------------------------------------
  console.log("\n3. Sin historial suficiente se usa la base, y se dice");
  // -------------------------------------------------------------------------
  const nuevo = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Agua sin historia",
    tipo: "SERVICIO_BASICO", base: 500_000, arriba: 10, abajo: null,
  });
  // Sólo dos recibos previos: por debajo del mínimo de tres.
  for (const [i, d] of [200, 170].entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: nuevo.supplierId, contratoId: nuevo.id,
      total: 1_200_000, etiqueta: `nuevo-hist-${i}`, fecha: dias(d) });
  }
  await factura({ companyId, branchId: sucA.id, supplierId: nuevo.supplierId, contratoId: nuevo.id,
    total: 600_000, etiqueta: "nuevo-hoy", fecha: dias(5) });
  v = await detectViolations(companyId);
  const sinHistoria = v.find((x) => esDe(x, "nuevo-hoy"));
  check("con menos de 3 recibos previos se juzga contra la base capturada", sinHistoria !== undefined);
  check(
    "y el hallazgo declara que la referencia es la capturada",
    (sinHistoria?.detail ?? "").includes("monto base capturado en el contrato"),
  );

  // -------------------------------------------------------------------------
  console.log("\n4. La mediana resiste el recibo de ajuste que el promedio no");
  // -------------------------------------------------------------------------
  // Recibos de $10,000, $10,000 y $40,000: la mediana es $10,000, el promedio
  // $20,000. Con el promedio, un recibo de $14,000 pasaría inadvertido.
  const outlier = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "CFE con ajuste",
    tipo: "SERVICIO_BASICO", base: 900_000, arriba: 20, abajo: null,
  });
  for (const [i, [d, monto]] of ([[300, 1_000_000], [270, 1_000_000], [240, 4_000_000]] as const).entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: outlier.supplierId, contratoId: outlier.id,
      total: monto, etiqueta: `out-hist-${i}`, fecha: dias(d) });
  }
  await factura({ companyId, branchId: sucA.id, supplierId: outlier.supplierId, contratoId: outlier.id,
    total: 1_400_000, etiqueta: "post-ajuste", fecha: dias(5) });
  v = await detectViolations(companyId);
  const trasAjuste = v.find((x) => esDe(x, "post-ajuste"));
  check("un recibo de ajuste al cuádruple no arrastra la referencia", trasAjuste !== undefined);
  check(
    "la referencia sigue siendo la mediana, no el promedio",
    (trasAjuste?.detail ?? "").includes("$10000.00 MXN"),
    trasAjuste?.detail.slice(0, 120),
  );

  // -------------------------------------------------------------------------
  console.log("\n5. La referencia está congelada: sólo cuentan los recibos previos");
  // -------------------------------------------------------------------------
  // Llega un recibo POSTERIOR y descomunal. El hallazgo de "fuera-mediana" no
  // puede cambiar de número: releerlo un mes después tiene que decir lo mismo.
  await factura({ companyId, branchId: sucA.id, supplierId: cfe.supplierId, contratoId: cfe.id,
    total: 9_000_000, etiqueta: "posterior", fecha: dias(1) });
  v = await detectViolations(companyId);
  const relectura = v.find((x) => esDe(x, "fuera-mediana"));
  check(
    "un recibo posterior no mueve la referencia de un hallazgo anterior",
    (relectura?.detail ?? "").includes("$20000.00 MXN"),
    relectura?.detail.slice(0, 120),
  );

  // -------------------------------------------------------------------------
  console.log("\n6. Un contrato corporativo no mezcla sucursales");
  // -------------------------------------------------------------------------
  if (!sucB) {
    check("hay una segunda sucursal con la que probar la separación", false, "sólo hay una sucursal en la empresa");
  } else {
    const corp = await contrato({
      companyId, userId, branchId: null, nombre: "Internet cadena",
      tipo: "SERVICIO_BASICO", base: 300_000, arriba: 20, abajo: null,
    });
    // Local chico y local grande bajo el MISMO contrato corporativo.
    for (const [i, d] of [300, 270, 240].entries()) {
      await factura({ companyId, branchId: sucA.id, supplierId: corp.supplierId, contratoId: corp.id,
        total: 1_000_000, etiqueta: `corp-a-${i}`, fecha: dias(d) });
      await factura({ companyId, branchId: sucB.id, supplierId: corp.supplierId, contratoId: corp.id,
        total: 4_000_000, etiqueta: `corp-b-${i}`, fecha: dias(d) });
    }
    // $13,000 en el local chico: +30% sobre SU mediana de $10,000. Si mezclara
    // las dos sucursales la mediana sería $25,000 y esto no diría nada.
    await factura({ companyId, branchId: sucA.id, supplierId: corp.supplierId, contratoId: corp.id,
      total: 1_300_000, etiqueta: "corp-juzgada", fecha: dias(5) });
    v = await detectViolations(companyId);
    const corpHallazgo = v.find((x) => esDe(x, "corp-juzgada"));
    check("la sucursal chica se compara contra su propio historial", corpHallazgo !== undefined);
    check(
      "la referencia es la de su sucursal, no la mezcla de la cadena",
      (corpHallazgo?.detail ?? "").includes("$10000.00 MXN"),
      corpHallazgo?.detail.slice(0, 120),
    );
    check(
      "y el hallazgo se atribuye a la sucursal de la factura",
      corpHallazgo?.branchName === sucA.name,
      corpHallazgo?.branchName,
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n7. La subida sostenida se ve aunque ningún recibo rebase su tolerancia");
  // -------------------------------------------------------------------------
  // Tolerancia de 100%: por diseño, ninguna factura suelta puede generar
  // sobrecosto. Lo único que puede delatar la fuga es la pendiente.
  const fuga = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Agua con fuga",
    tipo: "SERVICIO_BASICO", base: 1_000_000, arriba: 100, abajo: null,
  });
  for (const [i, [d, monto]] of ([[300, 1_000_000], [270, 1_000_000], [240, 1_000_000],
                                  [60, 1_300_000], [40, 1_300_000], [20, 1_300_000]] as const).entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: fuga.supplierId, contratoId: fuga.id,
      total: monto, etiqueta: `fuga-${i}`, fecha: dias(d) });
  }
  v = await detectViolations(companyId);
  const tendencia = v.find(
    (x) => x.type === "CONTRACT_TREND_RISING" && x.description.includes("Agua con fuga"),
  );
  check("una subida sostenida de +30% genera hallazgo de tendencia", tendencia !== undefined);
  check(
    "aunque ninguna factura individual haya generado sobrecosto",
    !v.some((x) => x.type === "CONTRACT_VARIANCE_EXCEEDED" && /fuga-[0-9]/.test(x.detail)),
  );
  check(
    "el hallazgo no cuelga de una factura: es un patrón",
    tendencia?.expenseId === null,
  );
  check("su severidad es MEDIUM con +30%", tendencia?.severity === "MEDIUM", tendencia?.severity);

  // -------------------------------------------------------------------------
  console.log("\n8. Un solo recibo alto no es tendencia");
  // -------------------------------------------------------------------------
  // Bloque reciente [$10,000, $13,000, $14,000]: la mediana sube 30%, pero uno
  // de los tres sigue al nivel previo. Es un pico, y de eso ya se encarga la
  // desviación por factura.
  const pico = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "CFE con pico",
    tipo: "SERVICIO_BASICO", base: 1_000_000, arriba: 100, abajo: null,
  });
  for (const [i, [d, monto]] of ([[300, 1_000_000], [270, 1_000_000], [240, 1_000_000],
                                  [60, 1_000_000], [40, 1_300_000], [20, 1_400_000]] as const).entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: pico.supplierId, contratoId: pico.id,
      total: monto, etiqueta: `pico-${i}`, fecha: dias(d) });
  }
  v = await detectViolations(companyId);
  check(
    "sin que TODOS los recibos recientes suban, no hay tendencia",
    !v.some((x) => x.type === "CONTRACT_TREND_RISING" && x.description.includes("CFE con pico")),
  );
}

/** `true` si el hallazgo salió de la factura con esa etiqueta de folio. */
function esDe(v: Pick<Violation, "detail">, etiqueta: string): boolean {
  return v.detail.includes(`${MARCA}-${etiqueta} del`);
}

/** Contrato con proveedor propio, para que ninguna deducción cruce contratos. */
async function contrato(input: {
  companyId: string;
  userId: string;
  branchId: string | null;
  nombre: string;
  tipo: string;
  base: number;
  arriba: number;
  abajo: number | null;
}) {
  const [proveedor] = await db
    .insert(suppliers)
    .values({ companyId: input.companyId, name: `${MARCA} ${input.nombre}`, active: true })
    .returning({ id: suppliers.id });

  const c = await TreasuryService.createRecurringContract({
    companyId: input.companyId,
    branchId: input.branchId,
    supplierId: proveedor.id,
    title: `${MARCA} ${input.nombre}`,
    contractType: input.tipo,
    baseAmountCents: input.base,
    startDate: new Date("2029-01-01"),
    userId: input.userId,
    varianceTolerancePercent: input.arriba,
    varianceToleranceBelowPercent: input.abajo,
  });
  return { id: c.id, supplierId: proveedor.id };
}

async function factura(input: {
  companyId: string;
  branchId: string;
  supplierId: string;
  contratoId: string;
  total: number;
  etiqueta: string;
  fecha: string;
}) {
  await db.insert(invoices).values({
    companyId: input.companyId,
    branchId: input.branchId,
    supplierId: input.supplierId,
    recurringContractId: input.contratoId,
    uuid: `${MARCA}-${input.etiqueta}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    folio: `${MARCA}-${input.etiqueta}`,
    fecha: input.fecha,
    // RFC de prueba del SAT para persona moral: la tabla los exige NOT NULL y
    // usar uno real mezclaría datos de prueba con los del seed.
    rfcEmisor: "EKU9003173C9",
    rfcReceptor: "EKU9003173C9",
    subtotal: Math.round(input.total / 1.16),
    total: input.total,
  });
}

async function limpiar(companyId: string) {
  const like = `%${MARCA}%`;
  await db
    .delete(invoices)
    .where(and(eq(invoices.companyId, companyId), sql`${invoices.folio} LIKE ${like}`));
  await db
    .delete(recurringContracts)
    .where(and(eq(recurringContracts.companyId, companyId), sql`${recurringContracts.title} LIKE ${like}`));
  // Los proveedores van al final: los contratos los referencian.
  await db
    .delete(suppliers)
    .where(and(eq(suppliers.companyId, companyId), sql`${suppliers.name} LIKE ${like}`));
}

main()
  .then(async () => {
    const [b] = await db.select().from(branches).limit(1);
    if (b) await limpiar(b.companyId);
    console.log(`\n${ok} checks pasados, ${fail} fallidos.`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("\nError:", err);
    const [b] = await db.select().from(branches).limit(1);
    if (b) await limpiar(b.companyId).catch(() => {});
    process.exit(1);
  });
