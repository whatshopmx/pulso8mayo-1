/**
 * Verificación de los contratos recurrentes en el flujo de efectivo (Fase 3).
 *
 *   npx tsx scripts/verify-recurrentes-flujo-efectivo.ts
 *
 * Lo que se comprueba es que la obligación recurrente se vea ANTES de llegar.
 * Hasta la Fase 2, las salidas del proyector a 30 días venían sólo de gastos
 * operativos, órdenes de compra y facturas: la nómina se proyectaba desde
 * contratos, pero la renta, la luz y el agua no. La obligación era invisible
 * para "¿me alcanza?" hasta que alguien capturaba el recibo — que en un
 * servicio de monto variable es justo cuando ya no se puede hacer nada.
 *
 * Y se comprueba lo contrario con el mismo cuidado: que nada se cuente dos
 * veces. Proyectar y cobrar el mismo recibo miente al alza, que es la dirección
 * peligrosa — hace creer que hay menos dinero del que hay.
 *
 * Todo lo sembrado lleva `[E2E] proyeccion` y se borra al final.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import {
  branches,
  invoices,
  operatingExpenses,
  payees,
  recurringContracts,
  suppliers,
  users,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { TreasuryService } from "@/lib/services/treasury-service";
import { getCashFlowProjection } from "@/lib/services/cash-flow-service";
import { occurrencesBetween } from "@/lib/services/recurring-contract-projection";
import { addCalendarDays, localDateString } from "@/lib/workflows/today";

const MARCA = "[E2E] proyeccion";
const VENTANA = 30;

const HOY = localDateString(new Date(), null);
const dias = (n: number) => addCalendarDays(HOY, n);
/** Un vencimiento cómodamente dentro de la ventana de 30 días. */
const VENCE = dias(5);
/** Mes del vencimiento, que es el período que la supresión mira. */
const PERIODO = VENCE.slice(0, 7);

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

  console.log(`Sucursal A: ${sucA.name}${sucB ? ` · B: ${sucB.name}` : ""}`);
  console.log(`Ventana: ${VENTANA} días · vencimiento sembrado ${VENCE} (período ${PERIODO})\n`);
  await limpiar(companyId);

  // -------------------------------------------------------------------------
  console.log("0. El generador de ocurrencias");
  // -------------------------------------------------------------------------
  // Pura, sin base de datos: es la parte que decide qué días cae el pago.
  check(
    "un contrato mensual con vencimiento en la ventana produce una ocurrencia",
    occurrencesBetween(VENCE, "MONTHLY", HOY, dias(29)).length === 1,
  );
  check(
    "un vencimiento viejo se adelanta hasta la ventana, no se pierde",
    occurrencesBetween(addCalendarDays(VENCE, -365), "MONTHLY", HOY, dias(29)).length === 1,
  );
  check(
    "un contrato anual cuyo vencimiento cae fuera no produce ninguna",
    occurrencesBetween(dias(200), "ANNUAL", HOY, dias(29)).length === 0,
  );
  check(
    "una periodicidad quincenal produce dos en 30 días",
    occurrencesBetween(dias(2), "BIWEEKLY", HOY, dias(29)).length === 2,
  );
  check(
    "el 31 de enero + 1 mes se recorta a febrero, no desborda a marzo",
    occurrencesBetween("2027-01-31", "MONTHLY", "2027-02-01", "2027-02-28")[0] === "2027-02-28",
    occurrencesBetween("2027-01-31", "MONTHLY", "2027-02-01", "2027-02-28")[0],
  );
  check(
    "un contrato terminado deja de producir ocurrencias",
    occurrencesBetween(VENCE, "MONTHLY", HOY, dias(29), dias(1)).length === 0,
  );

  // -------------------------------------------------------------------------
  console.log("\n1. La renta aparece en el calendario antes de que llegue el recibo");
  // -------------------------------------------------------------------------
  const renta = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Renta local",
    tipo: "RENTA", base: 5_000_000, frecuencia: "MONTHLY", vence: VENCE,
  });
  let p = await getCashFlowProjection(companyId, VENTANA);
  const partidaRenta = recurrente(p, "Renta local");
  check("un contrato de renta se proyecta como egreso", partidaRenta !== undefined);
  check("con su propia fuente, no confundido con un gasto capturado",
    partidaRenta?.source === "RECURRING_CONTRACT");
  check("por su monto pactado", partidaRenta?.amountCents === 5_000_000,
    String(partidaRenta?.amountCents));
  check("y NO marcado como estimado: la renta sí está pactada",
    partidaRenta?.isEstimated === false);
  check("cae en la fecha de vencimiento del contrato", partidaRenta?.date === VENCE,
    partidaRenta?.date);
  check(
    "y suma en el egreso proyectado de ese día, no sólo en la lista",
    (p.days.find((d) => d.date === VENCE)?.projectedOutflowCents ?? 0) >= 5_000_000,
  );

  // -------------------------------------------------------------------------
  console.log("\n2. Un servicio medido se proyecta con su historial, y se marca estimado");
  // -------------------------------------------------------------------------
  const cfe = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "CFE medido",
    tipo: "SERVICIO_BASICO", base: 1_000_000, frecuencia: "MONTHLY", vence: VENCE,
  });
  // Tres períodos previos de $20,000: la base capturada de $10,000 quedó vieja.
  for (const [i, d] of [-100, -70, -40].entries()) {
    await factura({ companyId, branchId: sucA.id, supplierId: cfe.supplierId,
      contratoId: cfe.id, total: 2_000_000, etiqueta: `cfe-h${i}`, fecha: dias(d) });
  }
  p = await getCashFlowProjection(companyId, VENTANA);
  const partidaCfe = recurrente(p, "CFE medido");
  check("se proyecta con la mediana de sus períodos, no con la base capturada",
    partidaCfe?.amountCents === 2_000_000, String(partidaCfe?.amountCents));
  check("y se marca estimado", partidaCfe?.isEstimated === true);

  // -------------------------------------------------------------------------
  console.log("\n3. Un servicio medido sin historia usa la base, pero sigue siendo estimado");
  // -------------------------------------------------------------------------
  await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Agua nueva",
    tipo: "SERVICIO_BASICO", base: 300_000, frecuencia: "MONTHLY", vence: VENCE,
  });
  p = await getCashFlowProjection(companyId, VENTANA);
  const partidaAgua = recurrente(p, "Agua nueva");
  check("sin historia se proyecta con el monto capturado",
    partidaAgua?.amountCents === 300_000, String(partidaAgua?.amountCents));
  check("y aun así se marca estimado: nadie pactó cuánta agua se va a consumir",
    partidaAgua?.isEstimated === true);

  // -------------------------------------------------------------------------
  console.log("\n4. Lo ya capturado apaga la proyección: nada se cuenta dos veces");
  // -------------------------------------------------------------------------
  const internet = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Internet ya facturado",
    tipo: "SERVICIO_BASICO", base: 200_000, frecuencia: "MONTHLY", vence: VENCE,
  });
  p = await getCashFlowProjection(companyId, VENTANA);
  check("antes de la factura, el contrato se proyecta",
    recurrente(p, "Internet ya facturado") !== undefined);

  await factura({ companyId, branchId: sucA.id, supplierId: internet.supplierId,
    contratoId: internet.id, total: 210_000, etiqueta: "internet-real",
    fecha: `${PERIODO}-03` });
  p = await getCashFlowProjection(companyId, VENTANA);
  check("con la factura del período capturada, ya no se proyecta",
    recurrente(p, "Internet ya facturado") === undefined);
  check("y el período suprimido se declara en vez de desaparecer",
    p.recurringProjection.suppressedCount >= 1,
    String(p.recurringProjection.suppressedCount));

  // -------------------------------------------------------------------------
  console.log("\n5. Un gasto operativo capturado también apaga el período");
  // -------------------------------------------------------------------------
  const limpieza = await contrato({
    companyId, userId, branchId: sucA.id, nombre: "Limpieza ya gastada",
    tipo: "MANTENIMIENTO", base: 150_000, frecuencia: "MONTHLY", vence: VENCE,
    conContraparte: true,
  });
  p = await getCashFlowProjection(companyId, VENTANA);
  check("antes del gasto, el contrato se proyecta",
    recurrente(p, "Limpieza ya gastada") !== undefined);

  await db.insert(operatingExpenses).values({
    companyId,
    branchId: sucA.id,
    payeeId: limpieza.payeeId!,
    category: "MANTENIMIENTO",
    amount: 155_000,
    description: `${MARCA} limpieza del mes`,
    status: "APPROVED",
    requestedBy: userId,
    dueDate: `${PERIODO}-04`,
  });
  p = await getCashFlowProjection(companyId, VENTANA);
  check("con el gasto del período capturado, ya no se proyecta",
    recurrente(p, "Limpieza ya gastada") === undefined);

  // -------------------------------------------------------------------------
  console.log("\n6. Un contrato corporativo proyecta el período completo, no una sucursal");
  // -------------------------------------------------------------------------
  if (!sucB) {
    check("hay una segunda sucursal con la que probar el corporativo", false,
      "sólo hay una sucursal en la empresa");
  } else {
    const corp = await contrato({
      companyId, userId, branchId: null, nombre: "Internet cadena",
      tipo: "SERVICIO_BASICO", base: 100_000, frecuencia: "MONTHLY", vence: VENCE,
    });
    // Cada período son DOS recibos que salen de la cuenta juntos: $10,000 del
    // local chico y $40,000 del grande. La mediana de recibos sueltos daría
    // $25,000 y subestimaría el egreso a la mitad.
    for (const [i, d] of [-100, -70, -40].entries()) {
      await factura({ companyId, branchId: sucA.id, supplierId: corp.supplierId,
        contratoId: corp.id, total: 1_000_000, etiqueta: `corp-a${i}`, fecha: dias(d) });
      await factura({ companyId, branchId: sucB.id, supplierId: corp.supplierId,
        contratoId: corp.id, total: 4_000_000, etiqueta: `corp-b${i}`, fecha: dias(d) });
    }
    p = await getCashFlowProjection(companyId, VENTANA);
    const partidaCorp = recurrente(p, "Internet cadena");
    check("se proyecta la suma del período, no la mediana de recibos sueltos",
      partidaCorp?.amountCents === 5_000_000, String(partidaCorp?.amountCents));
  }

  // -------------------------------------------------------------------------
  console.log("\n7. Se pueden apagar");
  // -------------------------------------------------------------------------
  const conRecurrentes = await getCashFlowProjection(companyId, VENTANA);
  const sinRecurrentes = await getCashFlowProjection(companyId, VENTANA, undefined, {
    includeRecurringContracts: false,
  });
  check("apagados, ninguna partida recurrente entra",
    sinRecurrentes.outflowItems.every((i) => i.source !== "RECURRING_CONTRACT"));
  check("y la proyección lo declara para que la pantalla pueda decirlo",
    sinRecurrentes.recurringProjection.included === false);
  check("el resto de los egresos no cambia",
    totalSinRecurrentes(conRecurrentes) === totalSinRecurrentes(sinRecurrentes),
    `${totalSinRecurrentes(conRecurrentes)} vs ${totalSinRecurrentes(sinRecurrentes)}`);
  check("y el total con recurrentes es mayor: la obligación pesa",
    total(conRecurrentes) > total(sinRecurrentes));
  check("el resumen cuadra con las partidas emitidas",
    conRecurrentes.recurringProjection.totalCents ===
      conRecurrentes.outflowItems
        .filter((i) => i.source === "RECURRING_CONTRACT")
        .reduce((s, i) => s + i.amountCents, 0));
}

/** Partida recurrente sembrada, por el título de su contrato. */
function recurrente(p: Awaited<ReturnType<typeof getCashFlowProjection>>, titulo: string) {
  return p.outflowItems.find(
    (i) => i.source === "RECURRING_CONTRACT" && i.description.includes(`${MARCA} ${titulo}`),
  );
}

const total = (p: Awaited<ReturnType<typeof getCashFlowProjection>>) =>
  p.outflowItems.reduce((s, i) => s + i.amountCents, 0);

const totalSinRecurrentes = (p: Awaited<ReturnType<typeof getCashFlowProjection>>) =>
  p.outflowItems
    .filter((i) => i.source !== "RECURRING_CONTRACT")
    .reduce((s, i) => s + i.amountCents, 0);

/** Contrato con proveedor propio, para que ninguna deducción cruce contratos. */
async function contrato(input: {
  companyId: string;
  userId: string;
  branchId: string | null;
  nombre: string;
  tipo: string;
  base: number;
  frecuencia: string;
  vence: string;
  /** Crea contraparte y la liga al proveedor, para probar el apagado por gasto. */
  conContraparte?: boolean;
}) {
  let payeeId: string | null = null;
  if (input.conContraparte) {
    const [pay] = await db
      .insert(payees)
      .values({ companyId: input.companyId, name: `${MARCA} ${input.nombre}` })
      .returning({ id: payees.id });
    payeeId = pay.id;
  }

  const [proveedor] = await db
    .insert(suppliers)
    .values({
      companyId: input.companyId,
      name: `${MARCA} ${input.nombre}`,
      active: true,
      payeeId,
    })
    .returning({ id: suppliers.id });

  const c = await TreasuryService.createRecurringContract({
    companyId: input.companyId,
    branchId: input.branchId,
    supplierId: proveedor.id,
    title: `${MARCA} ${input.nombre}`,
    contractType: input.tipo,
    baseAmountCents: input.base,
    // `start_date` es la fecha del próximo vencimiento, así la rotula el alta.
    startDate: new Date(`${input.vence}T12:00:00Z`),
    userId: input.userId,
    paymentFrequency: input.frecuencia,
  });
  return { id: c.id, supplierId: proveedor.id, payeeId };
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
    // RFC de prueba del SAT para persona moral: la tabla los exige NOT NULL.
    rfcEmisor: "EKU9003173C9",
    rfcReceptor: "EKU9003173C9",
    subtotal: Math.round(input.total / 1.16),
    total: input.total,
  });
}

async function limpiar(companyId: string) {
  const like = `%${MARCA}%`;
  await db
    .delete(operatingExpenses)
    .where(and(eq(operatingExpenses.companyId, companyId), sql`${operatingExpenses.description} LIKE ${like}`));
  await db
    .delete(invoices)
    .where(and(eq(invoices.companyId, companyId), sql`${invoices.folio} LIKE ${like}`));
  await db
    .delete(recurringContracts)
    .where(and(eq(recurringContracts.companyId, companyId), sql`${recurringContracts.title} LIKE ${like}`));
  await db
    .delete(suppliers)
    .where(and(eq(suppliers.companyId, companyId), sql`${suppliers.name} LIKE ${like}`));
  // Las contrapartes al final: los proveedores y los gastos las referencian.
  await db
    .delete(payees)
    .where(and(eq(payees.companyId, companyId), sql`${payees.name} LIKE ${like}`));
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
