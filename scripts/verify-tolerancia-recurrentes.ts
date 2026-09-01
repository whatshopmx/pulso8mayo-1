/**
 * Verificación de la detección de desviaciones en contratos recurrentes.
 *
 *   npx tsx scripts/verify-tolerancia-recurrentes.ts
 *
 * Cubre dos arreglos:
 *
 * - **Fase 0 (tolerancias).** La tolerancia era inalcanzable desde la
 *   aplicación —siempre 10%— y la desviación sólo se miraba hacia arriba, así
 *   que un servicio de monto variable producía excepción cada temporada alta y
 *   ninguna señal cuando el recibo venía anormalmente bajo.
 * - **Fase 1 (acotar la detección).** Cada factura se cruzaba contra TODOS los
 *   contratos del proveedor, sin período ni sucursal: con dos contratos del
 *   mismo arrendador toda factura disparaba sobrecosto contra el de base menor,
 *   y un recibo viejo seguía apareciendo como excepción abierta para siempre.
 *
 * Todo lo sembrado lleva `[E2E]` en el título, el folio o el nombre y se borra
 * al final, incluso si un caso falla.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { branches, invoices, recurringContracts, suppliers, users } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { TreasuryService } from "@/lib/services/treasury-service";
import { detectViolations, type Violation } from "@/lib/services/control-interno-service";
import { CONTRACT_VARIANCE_WINDOW_DAYS } from "@/lib/services/recurring-contract-variance";
import { addCalendarDays, localDateString } from "@/lib/workflows/today";

const MARCA = "[E2E] tolerancia";

/**
 * Las fechas se calculan contra hoy y no se escriben a mano: la ventana de
 * detección es relativa al día en que corre el script, así que una constante
 * literal deja de estar dentro de la ventana con sólo esperar unos meses.
 */
const HOY = localDateString(new Date(), null);
const EN_VENTANA = addCalendarDays(HOY, -20);
const FUERA_DE_VENTANA = addCalendarDays(HOY, -(CONTRACT_VARIANCE_WINDOW_DAYS + 30));

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
  if (!branch) throw new Error("No hay sucursales. Corre `pnpm seed`.");
  const companyId = branch.companyId;

  const [proveedor] = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.companyId, companyId))
    .limit(1);
  if (!proveedor) throw new Error("No hay proveedores. Corre `pnpm seed`.");

  const [autor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.companyId, companyId))
    .limit(1);

  console.log(`Sucursal: ${branch.name} · Proveedor: ${proveedor.name}`);
  console.log(`Ventana de detección: ${CONTRACT_VARIANCE_WINDOW_DAYS} días (desde ${addCalendarDays(HOY, -CONTRACT_VARIANCE_WINDOW_DAYS)})\n`);
  await limpiar(companyId);

  // -------------------------------------------------------------------------
  console.log("1. La tolerancia deja de ser siempre 10%");
  // -------------------------------------------------------------------------
  const cfe = await TreasuryService.createRecurringContract({
    companyId,
    branchId: branch.id,
    supplierId: proveedor.id,
    title: `${MARCA} CFE Condesa`,
    contractType: "SERVICIO_BASICO",
    baseAmountCents: 1_000_000, // $10,000 de base
    startDate: new Date("2029-01-01"),
    userId: autor?.id ?? "",
    paymentFrequency: "MONTHLY",
    varianceTolerancePercent: 35,
    varianceToleranceBelowPercent: 30,
  });
  check("se persiste la tolerancia superior capturada", cfe.varianceTolerancePercent === 35, `${cfe.varianceTolerancePercent}%`);
  check("se persiste la tolerancia inferior capturada", cfe.varianceToleranceBelowPercent === 30, `${cfe.varianceToleranceBelowPercent}%`);

  const renta = await TreasuryService.createRecurringContract({
    companyId,
    branchId: branch.id,
    supplierId: proveedor.id,
    title: `${MARCA} Renta local`,
    contractType: "RENTA",
    baseAmountCents: 5_000_000,
    startDate: new Date("2029-01-01"),
    userId: autor?.id ?? "",
    varianceTolerancePercent: 5,
    // Sin tolerancia inferior: una renta no baja sola.
  });
  check("omitir la inferior la deja en null (no alerta por debajo)", renta.varianceToleranceBelowPercent === null);
  check("la superior sin capturar sigue siendo 10 por omisión",
    (await TreasuryService.createRecurringContract({
      companyId,
      branchId: branch.id,
      supplierId: proveedor.id,
      title: `${MARCA} Software`,
      contractType: "SOFTWARE",
      baseAmountCents: 100_000,
      startDate: new Date("2029-01-01"),
      userId: autor?.id ?? "",
    })).varianceTolerancePercent === 10);

  // Validación de rango.
  let rechazado = false;
  try {
    await TreasuryService.createRecurringContract({
      companyId,
      branchId: branch.id,
      supplierId: proveedor.id,
      title: `${MARCA} invalido`,
      contractType: "RENTA",
      baseAmountCents: 100_000,
      startDate: new Date("2029-01-01"),
      userId: autor?.id ?? "",
      varianceToleranceBelowPercent: 150,
    });
  } catch {
    rechazado = true;
  }
  check("una tolerancia inferior de 150% se rechaza", rechazado);

  // -------------------------------------------------------------------------
  console.log("\n2. El recibo de temporada alta deja de ser excepción");
  // -------------------------------------------------------------------------
  // Las facturas se ligan a SU contrato (`recurringContractId`). Antes la única
  // llave era el proveedor y estas aserciones tenían que acotarse por título
  // para no medir el cruce contra los otros dos contratos sembrados; ahora el
  // acotado sobra, porque una factura se compara contra un solo contrato.

  // $12,500 sobre base de $10,000 = +25%. Con el viejo 10% fijo esto salía
  // como sobrecosto cada verano; con la tolerancia real de CFE al 35%, no.
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: proveedor.id, total: 1_250_000, etiqueta: "verano", contratoId: cfe.id });
  let v = await detectViolations(companyId, branch.id);
  check(
    "+25% con tolerancia de 35% NO genera excepción",
    !v.some((x) => x.type === "CONTRACT_VARIANCE_EXCEEDED" && esDe(x, "verano")),
  );

  // $14,000 = +40%, sí rebasa el 35%.
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: proveedor.id, total: 1_400_000, etiqueta: "fuga", contratoId: cfe.id });
  v = await detectViolations(companyId, branch.id);
  check(
    "+40% con tolerancia de 35% SÍ genera excepción",
    v.some((x) => x.type === "CONTRACT_VARIANCE_EXCEEDED" && esDe(x, "fuga")),
  );

  // -------------------------------------------------------------------------
  console.log("\n3. El recibo anormalmente bajo ahora se ve");
  // -------------------------------------------------------------------------
  // $6,000 sobre base de $10,000 = −40%, más allá del −30% configurado.
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: proveedor.id, total: 600_000, etiqueta: "estimada", contratoId: cfe.id });
  v = await detectViolations(companyId, branch.id);
  const bajo = v.find((x) => x.type === "CONTRACT_VARIANCE_BELOW" && esDe(x, "estimada"));
  check("−40% con tolerancia inferior de 30% genera hallazgo", bajo !== undefined);
  check(
    "el hallazgo es de tipo propio, no un sobrecosto con signo",
    bajo?.type === "CONTRACT_VARIANCE_BELOW",
  );
  check(
    "su severidad es menor que la de un sobrecosto (es dinero que llegará después)",
    bajo?.severity === "LOW" || bajo?.severity === "MEDIUM",
    bajo?.severity,
  );
  check(
    "el detalle explica la lectura estimada",
    (bajo?.detail ?? "").includes("lectura estimada"),
  );

  // Y en la renta, que no configuró tolerancia inferior, un recibo bajo NO
  // debe generar nada: es el comportamiento que tenían todos los contratos
  // antes de la columna, y no debe cambiar solo.
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: proveedor.id, total: 1_000_000, etiqueta: "renta-baja", contratoId: renta.id });
  v = await detectViolations(companyId, branch.id);
  check(
    "sin tolerancia inferior configurada no se alerta por debajo",
    v.filter((x) => x.type === "CONTRACT_VARIANCE_BELOW" && esDe(x, "renta-baja")).length === 0,
  );

  // -------------------------------------------------------------------------
  console.log("\n4. La detección está acotada (Fase 1)");
  // -------------------------------------------------------------------------
  // 4.1 Una factura se compara contra UN contrato, no contra todos los del
  // proveedor. Los tres contratos de arriba comparten proveedor y sucursal, y
  // sus bases son $10,000 / $50,000 / $1,000: antes, la factura "fuga" de
  // $14,000 disparaba sobrecosto también contra el de $1,000.
  v = await detectViolations(companyId, branch.id);
  const porFuga = v.filter((x) => x.type.startsWith("CONTRACT_VARIANCE") && esDe(x, "fuga"));
  check("una factura produce un solo hallazgo, no uno por contrato", porFuga.length === 1, `${porFuga.length}`);
  check(
    "y es contra el contrato al que la factura pertenece",
    porFuga[0]?.description.includes("CFE Condesa") === true,
    porFuga[0]?.description,
  );
  check(
    "el detalle declara el período de la factura",
    porFuga[0]?.detail.includes(EN_VENTANA) === true,
  );

  // 4.2 Fuera de la ventana no hay hallazgo: un recibo viejo dejaba de salir de
  // la lista sólo cuando cinco facturas más nuevas del mismo proveedor lo
  // empujaban, cosa que en un servicio bimestral tardaba casi un año.
  await sembrarFactura({
    companyId, branchId: branch.id, supplierId: proveedor.id,
    total: 1_400_000, etiqueta: "vieja", contratoId: cfe.id, fecha: FUERA_DE_VENTANA,
  });
  v = await detectViolations(companyId, branch.id);
  check(
    `una factura de hace ${CONTRACT_VARIANCE_WINDOW_DAYS + 30} días ya no se reporta`,
    !v.some((x) => esDe(x, "vieja")),
  );

  // 4.3 Sin contrato capturado se deduce por (proveedor, sucursal) cuando el
  // candidato es único — es la única forma de seguir viendo las facturas
  // anteriores a la columna.
  const unico = await sembrarProveedor(companyId, "Agua del Centro");
  await TreasuryService.createRecurringContract({
    companyId,
    branchId: branch.id,
    supplierId: unico.id,
    title: `${MARCA} Agua Condesa`,
    contractType: "SERVICIO_BASICO",
    baseAmountCents: 200_000,
    startDate: new Date("2029-01-01"),
    userId: autor?.id ?? "",
    varianceTolerancePercent: 20,
  });
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: unico.id, total: 400_000, etiqueta: "sin-liga" });
  v = await detectViolations(companyId, branch.id);
  const deducido = v.find((x) => esDe(x, "sin-liga"));
  check("con un solo contrato del proveedor la factura se deduce y sí se compara", deducido !== undefined);
  check(
    "y el hallazgo declara que el contrato fue deducido, no capturado",
    (deducido?.detail ?? "").includes("deducido"),
  );

  // 4.4 Ante empate no se elige. El proveedor del seed tiene tres contratos
  // `[E2E]` en esta sucursal: una factura suya sin contrato capturado no se
  // puede asignar, y no debe producir ningún hallazgo. Sin hallazgo es mejor
  // que con hallazgo falso, que es justo lo que hacía antes.
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: proveedor.id, total: 9_000_000, etiqueta: "ambigua" });
  v = await detectViolations(companyId, branch.id);
  check(
    "con varios contratos del proveedor y sin liga capturada, no se adivina",
    !v.some((x) => esDe(x, "ambigua")),
  );

  // 4.5 Un contrato corporativo (`branchId` null) sí se evalúa contra el recibo
  // de una sucursal, pero el hallazgo se atribuye a la sucursal DE LA FACTURA.
  // Antes decía "Corporativo / Cadena" para todas, que manda a revisar el
  // medidor equivocado.
  const corporativo = await sembrarProveedor(companyId, "Internet Corporativo");
  await TreasuryService.createRecurringContract({
    companyId,
    branchId: null,
    supplierId: corporativo.id,
    title: `${MARCA} Internet cadena`,
    contractType: "SERVICIO_BASICO",
    baseAmountCents: 300_000,
    startDate: new Date("2029-01-01"),
    userId: autor?.id ?? "",
    varianceTolerancePercent: 10,
  });
  await sembrarFactura({ companyId, branchId: branch.id, supplierId: corporativo.id, total: 600_000, etiqueta: "corporativa" });
  v = await detectViolations(companyId, branch.id);
  const corp = v.find((x) => esDe(x, "corporativa"));
  check("un contrato corporativo evalúa el recibo de la sucursal", corp !== undefined);
  check(
    "y el hallazgo nombra la sucursal de la factura, no 'Corporativo / Cadena'",
    corp?.branchName === branch.name,
    corp?.branchName,
  );
}

/** `true` si el hallazgo salió de la factura con esa etiqueta de folio. */
function esDe(v: Pick<Violation, "detail">, etiqueta: string): boolean {
  return v.detail.includes(`${MARCA}-${etiqueta}`);
}

async function sembrarProveedor(companyId: string, nombre: string) {
  const [s] = await db
    .insert(suppliers)
    .values({ companyId, name: `${MARCA} ${nombre}`, active: true })
    .returning({ id: suppliers.id });
  return s;
}

async function sembrarFactura(input: {
  companyId: string;
  branchId: string;
  supplierId: string;
  total: number;
  etiqueta: string;
  /** Contrato al que pertenece. Omitirlo prueba la deducción por proveedor. */
  contratoId?: string;
  /** `YYYY-MM-DD`. Por omisión, dentro de la ventana de detección. */
  fecha?: string;
}) {
  await db.insert(invoices).values({
    companyId: input.companyId,
    branchId: input.branchId,
    supplierId: input.supplierId,
    recurringContractId: input.contratoId ?? null,
    uuid: `${MARCA}-${input.etiqueta}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    folio: `${MARCA}-${input.etiqueta}`,
    // `fecha` es NOT NULL y es texto en el esquema.
    fecha: input.fecha ?? EN_VENTANA,
    // RFC de prueba del SAT para persona moral: la tabla los exige NOT NULL y
    // usar uno real de un proveedor del seed mezclaria datos de prueba con los
    // suyos.
    rfcEmisor: "EKU9003173C9",
    rfcReceptor: "EKU9003173C9",
    subtotal: Math.round(input.total / 1.16),
    total: input.total,
  });
}

async function limpiar(companyId: string) {
  await db
    .delete(invoices)
    .where(and(eq(invoices.companyId, companyId), sql`${invoices.folio} LIKE '%[E2E] tolerancia%'`));
  await db
    .delete(recurringContracts)
    .where(
      and(
        eq(recurringContracts.companyId, companyId),
        sql`${recurringContracts.title} LIKE '%[E2E] tolerancia%'`,
      ),
    );
  // Los proveedores van al final: los contratos los referencian.
  await db
    .delete(suppliers)
    .where(and(eq(suppliers.companyId, companyId), sql`${suppliers.name} LIKE '%[E2E] tolerancia%'`));
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
