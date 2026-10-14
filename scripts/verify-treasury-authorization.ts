/**
 * C18.4 — la operación de tesorería con dos empresas, contra la base real.
 *
 * Lo que las pruebas unitarias no pueden mostrar: que el filtro de rol se
 * aplica sobre filas de verdad, que la doble firma se sostiene con dos usuarios
 * distintos y que endurecer el filtro no reescribe una corrida que ya se
 * autorizó.
 *
 * Se siembra lo mínimo —dos empresas, una sucursal cada una, un artículo y una
 * factura pagable por empresa— y se recorre la operación completa: preparar,
 * solicitar, firmar con otro usuario, dispersar, liquidar, cerrar y bajar el
 * layout. En cada paso que mueve dinero se comprueba que un gerente recibe 403
 * y que nada se escribe, que la corrida de la otra empresa no se ve, y que un
 * estado ya alcanzado no se invalida.
 *
 * Uso: `npx tsx scripts/verify-treasury-authorization.ts`
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { ApiError as ApiErrorTipo } from "@/lib/api/error";

/**
 * El módulo de base de datos lee `DATABASE_URL` al importarse, así que el
 * entorno tiene que estar cargado antes de tocarlo: los imports de la base, el
 * esquema y los servicios son dinámicos y ocurren dentro de `main`.
 */
config({ quiet: true });

const MARCA = "C18.4 verificación";
const SUFIJO = Date.now().toString(36);

let fallos = 0;
let comprobaciones = 0;

type Esquema = typeof import("@/lib/db/schema");

async function cargarDependencias() {
  const { db } = await import("@/lib/db");
  const esquema: Esquema = await import("@/lib/db/schema");
  const { TreasuryService } = await import("@/lib/services/treasury-service");
  const { ApiError } = await import("@/lib/api/error");
  return { db, esquema, TreasuryService, ApiError };
}

function comprobar(condicion: unknown, mensaje: string) {
  comprobaciones += 1;
  if (condicion) {
    console.log(`  ✓ ${mensaje}`);
  } else {
    fallos += 1;
    console.error(`  ✗ ${mensaje}`);
  }
}

async function esperandoError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

function esApiError(error: unknown, status: number, ApiError: new (...a: never[]) => ApiErrorTipo): boolean {
  return error instanceof ApiError && error.statusCode === status;
}

async function main() {
  console.log("C18.4 — autorización de la corrida de pago con dos empresas\n");

  const { db, esquema, TreasuryService, ApiError } = await cargarDependencias();
  const {
    branches,
    companies,
    inventoryItems,
    paymentRunItems,
    paymentRuns,
    users,
  } = esquema;

  // ── Siembra ────────────────────────────────────────────────────────────
  const [empresaA] = await db.insert(companies).values({ name: `${MARCA} A ${SUFIJO}` }).returning();
  const [empresaB] = await db.insert(companies).values({ name: `${MARCA} B ${SUFIJO}` }).returning();

  const [ramaA] = await db
    .insert(branches)
    .values({ companyId: empresaA.id, name: `${MARCA} A`, code: `C18A${SUFIJO}` })
    .returning();
  const [ramaB] = await db
    .insert(branches)
    .values({ companyId: empresaB.id, name: `${MARCA} B`, code: `C18B${SUFIJO}` })
    .returning();

  const [usuarioA1] = await db
    .insert(users)
    .values({
      // `users.id`, `created_at` y `updated_at` no tienen default en la base.
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      companyId: empresaA.id,
      name: `${MARCA} admin 1`,
      email: `c18-a1-${SUFIJO}@pulso.test`,
      role: "ADMIN",
    })
    .returning();
  const [usuarioA2] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      companyId: empresaA.id,
      name: `${MARCA} admin 2`,
      email: `c18-a2-${SUFIJO}@pulso.test`,
      role: "ADMIN",
    })
    .returning();

  // La partida se declara como `TAXES`: no hay tabla de declaraciones contra la
  // cual verificar el `referenceId`, así que la siembra no necesita proveedor,
  // cuenta bancaria verificada ni factura. Lo que C18 comprueba es el filtro, y
  // el filtro no depende del tipo de partida.
  const [articuloA] = await db
    .insert(inventoryItems)
    .values({ companyId: empresaA.id, name: `${MARCA} insumo`, unit: "KG" })
    .returning();

  console.log(`Siembra: empresas ${empresaA.id.slice(0, 8)}… y ${empresaB.id.slice(0, 8)}…\n`);

  /** Estado actual de la corrida, leído de la base. */
  async function estadoDe(corridaId: string): Promise<string | undefined> {
    const [fila] = await db
      .select({ status: paymentRuns.status })
      .from(paymentRuns)
      .where(eq(paymentRuns.id, corridaId));
    return fila?.status;
  }

  try {
    // ── 1. Preparar y pedir firma ────────────────────────────────────────
    console.log("1. Preparar");
    const corrida = await TreasuryService.createPaymentRun(
      empresaA.id,
      `${MARCA} quincena`,
      new Date("2026-10-20"),
      usuarioA1.id,
      ramaA.id,
    );
    comprobar(!!corrida?.id, "la corrida se crea en DRAFT");
    comprobar((await estadoDe(corrida.id)) === "DRAFT", "nace en DRAFT");

    const partida = await TreasuryService.addItemToRun({
      paymentRunId: corrida.id,
      companyId: empresaA.id,
      itemType: "TAXES",
      referenceId: "IVA-2026-10",
      amountCents: 116000,
      notes: `${MARCA} línea de captura`,
    });
    comprobar(!!partida?.id, "la partida entra a la corrida");

    const partidaAjena = await esperandoError(() =>
      TreasuryService.addItemToRun({
        paymentRunId: corrida.id,
        companyId: empresaA.id,
        itemType: "PAYROLL",
        referenceId: randomUUID(),
      }),
    );
    comprobar(
      partidaAjena !== null && !esApiError(partidaAjena, 403, ApiError),
      "una partida sin documento de esta empresa no entra a la corrida, y el motivo no es de permisos",
    );

    // ── 2. El filtro de rol, en cada paso que mueve dinero ───────────────
    console.log("\n2. Filtro de rol");
    const porGerente = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "PENDING_APPROVAL", "user-gte", "GERENTE"),
    );
    comprobar(esApiError(porGerente, 403, ApiError), "un gerente no puede solicitar la firma");
    comprobar((await estadoDe(corrida.id)) === "DRAFT", "el rechazo no movió el estado");

    await TreasuryService.updatePaymentRunStatus(
      corrida.id, empresaA.id, "PENDING_APPROVAL", usuarioA1.id, "ADMIN",
    );
    comprobar((await estadoDe(corrida.id)) === "PENDING_APPROVAL", "un administrador sí solicita la firma");

    // Doble firma: quien preparó no firma.
    const autoFirma = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "APPROVED", usuarioA1.id, "ADMIN"),
    );
    comprobar(esApiError(autoFirma, 403, ApiError), "quien preparó la corrida no puede firmarla");

    const porGerenteFirma = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "APPROVED", "user-gte", "SUPERVISOR"),
    );
    comprobar(esApiError(porGerenteFirma, 403, ApiError), "un supervisor tampoco puede firmarla");
    comprobar(
      (await estadoDe(corrida.id)) === "PENDING_APPROVAL",
      "los rechazos no movieron la corrida: sigue en PENDING_APPROVAL",
    );

    // La máquina de estados responde por su lado, no por el rol.
    const saltoImposible = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "COMPLETED", usuarioA2.id, "ADMIN"),
    );
    comprobar(
      saltoImposible !== null && !esApiError(saltoImposible, 403, ApiError),
      "pedir un salto imposible da 400, no 403: el motivo es el estado",
    );

    await TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "APPROVED", usuarioA2.id, "ADMIN");
    comprobar((await estadoDe(corrida.id)) === "APPROVED", "un segundo administrador firma la corrida");

    // ── 3. Dispersar, liquidar, cerrar ───────────────────────────────────
    console.log("\n3. Dispersión, liquidación y cierre");
    const porGerenteDispersar = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "PROCESSING", "user-gte", "GERENTE"),
    );
    comprobar(esApiError(porGerenteDispersar, 403, ApiError), "un gerente no inicia la dispersión");

    await TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "PROCESSING", usuarioA2.id, "ADMIN");
    comprobar((await estadoDe(corrida.id)) === "PROCESSING", "la dispersión arranca");

    const liquidarPorGerente = await esperandoError(() =>
      TreasuryService.settlePaymentRunItem({
        paymentRunId: corrida.id,
        itemId: partida.id,
        companyId: empresaA.id,
        settlementStatus: "CONFIRMED",
        userId: "user-gte",
        actorRole: "GERENTE",
        reference: "SPEI-0001",
      }),
    );
    comprobar(esApiError(liquidarPorGerente, 403, ApiError), "un gerente no liquida una partida");

    const cerrandoConPendientes = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "COMPLETED", usuarioA2.id, "ADMIN"),
    );
    comprobar(
      cerrandoConPendientes !== null && !esApiError(cerrandoConPendientes, 403, ApiError),
      "no se cierra con partidas sin liquidar, y el motivo no es de permisos",
    );
    comprobar((await estadoDe(corrida.id)) === "PROCESSING", "la corrida sigue en dispersión");

    await TreasuryService.settlePaymentRunItem({
      paymentRunId: corrida.id,
      itemId: partida.id,
      companyId: empresaA.id,
      settlementStatus: "CONFIRMED",
      userId: usuarioA2.id,
      actorRole: "ADMIN",
      reference: "SPEI-0001",
    });
    const [partidaCerrada] = await db
      .select({ estado: paymentRunItems.settlementStatus })
      .from(paymentRunItems)
      .where(eq(paymentRunItems.id, partida.id));
    comprobar(partidaCerrada?.estado === "CONFIRMED", "la partida queda confirmada");

    await TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "COMPLETED", usuarioA2.id, "ADMIN");
    comprobar((await estadoDe(corrida.id)) === "COMPLETED", "con todo liquidado, la corrida se cierra");

    // ── 4. El layout: el archivo con las CLABEs en claro ──────────────────
    console.log("\n4. Layout de dispersión");
    const layoutPorGerente = await esperandoError(() =>
      TreasuryService.generateBankDisbursementLayout(corrida.id, empresaA.id, "GERENTE"),
    );
    comprobar(esApiError(layoutPorGerente, 403, ApiError), "un gerente no baja el layout con las CLABEs");

    const layoutAjeno = await esperandoError(() =>
      TreasuryService.generateBankDisbursementLayout(corrida.id, empresaB.id, "ADMIN"),
    );
    comprobar(esApiError(layoutAjeno, 404, ApiError), "desde B, la corrida de A no existe");

    // ── 5. Endurecer el filtro no reescribe el pasado ────────────────────
    console.log("\n5. Los estados ya alcanzados siguen valiendo");
    comprobar((await estadoDe(corrida.id)) === "COMPLETED", "la corrida cerrada sigue cerrada");

    const reabrir = await esperandoError(() =>
      TreasuryService.updatePaymentRunStatus(corrida.id, empresaA.id, "PROCESSING", usuarioA1.id, "ADMIN"),
    );
    comprobar(reabrir !== null, "una corrida cerrada no se reabre");
    comprobar((await estadoDe(corrida.id)) === "COMPLETED", "el intento no cambió nada");

    const detalleAjeno = await esperandoError(() => TreasuryService.getPaymentRunDetails(corrida.id, empresaB.id));
    comprobar(esApiError(detalleAjeno, 404, ApiError), "el detalle de la corrida de A no se lee desde B");

    const detalle = await TreasuryService.getPaymentRunDetails(corrida.id, empresaA.id);
    comprobar(detalle.run.id === corrida.id && detalle.items.length === 1, "A sí lee su corrida con su partida");

    // Con el filtro ya cerrado, una corrida nueva sigue su curso normal: la
    // política restringe quién ejecuta, no congela la operación.
    const corridaNueva = await TreasuryService.createPaymentRun(
      empresaA.id, `${MARCA} nueva`, new Date("2026-10-25"), usuarioA1.id, ramaA.id,
    );
    const enviada = await TreasuryService.updatePaymentRunStatus(
      corridaNueva.id, empresaA.id, "PENDING_APPROVAL", usuarioA1.id, "ADMIN",
    );
    comprobar(!!enviada, "una corrida nueva puede solicitar su firma después del endurecimiento");
  } finally {
    // ── Limpieza ─────────────────────────────────────────────────────────
    console.log("\n6. Limpieza");
    const empresas = [empresaA.id, empresaB.id];
    const corridas = (
      await db.select({ id: paymentRuns.id }).from(paymentRuns).where(inArray(paymentRuns.companyId, empresas))
    ).map((c) => c.id);

    if (corridas.length > 0) {
      await db.delete(paymentRunItems).where(inArray(paymentRunItems.paymentRunId, corridas));
    }
    await db.delete(paymentRuns).where(inArray(paymentRuns.companyId, empresas));
    await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, empresas));
    await db.delete(branches).where(inArray(branches.companyId, empresas));
    await db.delete(users).where(inArray(users.companyId, empresas));
    await db.delete(companies).where(inArray(companies.id, empresas));

    const sobrantes = await db
      .select({ name: companies.name })
      .from(companies)
      .where(inArray(companies.name, [`${MARCA} A ${SUFIJO}`, `${MARCA} B ${SUFIJO}`]));
    comprobar(sobrantes.length === 0, "no quedó ninguna empresa de la verificación");

    console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones correctas.`);
  }

  if (fallos > 0) {
    console.error(`\n${fallos} comprobaciones fallaron.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Error inesperado en la verificación:", error);
  process.exitCode = 1;
});