/**
 * Verificación de las tolerancias configurables en contratos recurrentes.
 *
 *   npx tsx scripts/verify-tolerancia-recurrentes.ts
 *
 * Lo que se comprueba es lo que estaba roto: la tolerancia era inalcanzable
 * desde la aplicación (siempre 10%) y la desviación sólo se miraba hacia
 * arriba, así que un servicio de monto variable —luz, agua— producía excepción
 * cada temporada alta y ninguna señal cuando el recibo venía anormalmente bajo.
 *
 * Todo lo sembrado lleva `[E2E]` en el título o el folio y se borra al final,
 * incluso si un caso falla.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { branches, invoices, recurringContracts, suppliers, users } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { TreasuryService } from "@/lib/services/treasury-service";
import { detectViolations } from "@/lib/services/control-interno-service";

const MARCA = "[E2E] tolerancia";

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

  console.log(`Sucursal: ${branch.name} · Proveedor: ${proveedor.name}\n`);
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
  // $12,500 sobre base de $10,000 = +25%. Con el viejo 10% fijo esto salía
  // como sobrecosto cada verano; con la tolerancia real de CFE al 35%, no.
  await sembrarFactura(companyId, branch.id, proveedor.id, 1_250_000, "verano");
  let v = await detectViolations(companyId, branch.id);
  // La aserción se acota al contrato de CFE por su título. No basta filtrar por
  // el folio: `detectViolations` compara cada factura contra TODOS los
  // contratos del mismo proveedor sin acotar por período ni por contrato, así
  // que esta misma factura también se mide contra los otros dos contratos
  // sembrados y dispara sobrecostos que no son los que aquí se prueban. Ese
  // cruce es un defecto real, anotado en tasks/todo-gastos-recurrentes-variables.md;
  // mientras siga ahí, un caso que no se acote mide el defecto y no el cambio.
  check(
    "+25% con tolerancia de 35% NO genera excepción",
    !v.some((x) => x.type === "CONTRACT_VARIANCE_EXCEEDED" && esDe(x, "CFE Condesa", "verano")),
  );

  // $14,000 = +40%, sí rebasa el 35%.
  await sembrarFactura(companyId, branch.id, proveedor.id, 1_400_000, "fuga");
  v = await detectViolations(companyId, branch.id);
  check(
    "+40% con tolerancia de 35% SÍ genera excepción",
    v.some((x) => x.type === "CONTRACT_VARIANCE_EXCEEDED" && esDe(x, "CFE Condesa", "fuga")),
  );

  // -------------------------------------------------------------------------
  console.log("\n3. El recibo anormalmente bajo ahora se ve");
  // -------------------------------------------------------------------------
  // $6,000 sobre base de $10,000 = −40%, más allá del −30% configurado.
  await sembrarFactura(companyId, branch.id, proveedor.id, 600_000, "estimada");
  v = await detectViolations(companyId, branch.id);
  const bajo = v.find((x) => x.type === "CONTRACT_VARIANCE_BELOW" && esDe(x, "CFE Condesa", "estimada"));
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
  await sembrarFactura(companyId, branch.id, proveedor.id, 1_000_000, "renta-baja");
  v = await detectViolations(companyId, branch.id);
  const rentaBaja = v.filter(
    (x) => x.type === "CONTRACT_VARIANCE_BELOW" && esDe(x, "Renta local", "renta-baja"),
  );
  check("sin tolerancia inferior configurada no se alerta por debajo", rentaBaja.length === 0);
}

/** `true` si el hallazgo es del contrato y la factura indicados. */
function esDe(v: { description: string; detail: string }, titulo: string, folio: string): boolean {
  return v.description.includes(titulo) && v.detail.includes(folio);
}

async function sembrarFactura(
  companyId: string,
  branchId: string,
  supplierId: string,
  total: number,
  etiqueta: string,
) {
  await db.insert(invoices).values({
    companyId,
    branchId,
    supplierId,
    uuid: `${MARCA}-${etiqueta}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    folio: `${MARCA}-${etiqueta}`,
    // `fecha` es NOT NULL y es texto en el esquema; va en 2029 por la misma
    // razón que el resto: el seed ocupa 2026 y no debe mezclarse.
    fecha: "2029-07-15",
    // RFC de prueba del SAT para persona moral: la tabla los exige NOT NULL y
    // usar uno real de un proveedor del seed mezclaria datos de prueba con los
    // suyos.
    rfcEmisor: "EKU9003173C9",
    rfcReceptor: "EKU9003173C9",
    subtotal: Math.round(total / 1.16),
    total,
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
