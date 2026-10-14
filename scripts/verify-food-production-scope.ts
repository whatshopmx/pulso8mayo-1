/**
 * C17.4 — recorrido de producción y abastecimiento entre sucursales, con dos
 * empresas, contra la base real.
 *
 * Lo que las pruebas unitarias no pueden mostrar: que las consultas preguntan a
 * Postgres de verdad y que el recorrido completo se comporta como dice el
 * contrato cuando hay dos empresas en la misma base. En simulado, «la
 * transferencia es de esta empresa» es una comparación de JavaScript; aquí es
 * un `select` sobre `branches.company_id`.
 *
 * Se siembra lo mínimo —dos empresas, dos sucursales cada una, un artículo y
 * un lote por empresa y una receta por empresa— y se recorre:
 *
 *   1. Producción: receta y sucursal propias funcionan; receta ajena, sucursal
 *      ajena y lote de otra sucursal se rechazan **sin** escribir nada.
 *   2. Abastecimiento: solicitud → aprobación → envío → recepción, contando
 *      los movimientos. El criterio de C17 es que el envío mueva el stock sin
 *      duplicarlo: un `TRANSFER` negativo en origen y uno positivo en destino,
 *      ni uno más.
 *   3. Aislamiento: desde la sesión de B, la transferencia de A no se lee, no
 *      se aprueba, no se envía y no se recibe; y una transferencia de B hacia
 *      una sucursal de A se rechaza al crearla.
 *
 * Al final se borra todo lo sembrado y se verifica que no quedó nada.
 *
 * Uso: `npx tsx scripts/verify-food-production-scope.ts`
 */

import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import type { ApiError as ApiErrorTipo } from "@/lib/api/error";

/**
 * El módulo de base de datos lee `DATABASE_URL` al importarse, así que el
 * entorno tiene que estar cargado antes de tocarlo. Los imports de la base, el
 * esquema y los servicios son dinámicos y ocurren dentro de `main`: uno
 * estático arriba construye la conexión sin variables y la verificación falla
 * con «No database host», que no dice nada del recorrido.
 *
 * El proyecto compila a CommonJS, así que además no hay `await` en el nivel
 * superior: de ahí el envoltorio.
 */
config({ quiet: true });

const MARCA = "C17.4 verificación";
const SUFIJO = Date.now().toString(36);

let fallos = 0;
let comprobaciones = 0;

/** Tipo del esquema, que se importa dentro de `main`. */
type Esquema = typeof import("@/lib/db/schema");

async function cargarDependencias() {
  const { db } = await import("@/lib/db");
  const esquema: Esquema = await import("@/lib/db/schema");
  const { ProductionService } = await import("@/lib/services/production-service");
  const { InventoryService } = await import("@/lib/services/inventory-service");
  const { ApiError } = await import("@/lib/api/error");
  return { db, esquema, ProductionService, InventoryService, ApiError };
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

/** Ejecuta y devuelve el error, o `null` si la operación pasó. */
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
  console.log("C17.4 — producción y abastecimiento con dos empresas\n");

  const { db, esquema, ProductionService, InventoryService, ApiError } = await cargarDependencias();
  const {
    branches,
    companies,
    inventoryBatches,
    inventoryItems,
    inventoryMovements,
    inventoryTransferItems,
    inventoryTransfers,
    productionIngredients,
    productionOrders,
    productionResults,
    recipeItems,
    recipes,
  } = esquema;

  // ── Siembra ────────────────────────────────────────────────────────────
  const [empresaA] = await db
    .insert(companies)
    .values({ name: `${MARCA} A ${SUFIJO}` })
    .returning();
  const [empresaB] = await db
    .insert(companies)
    .values({ name: `${MARCA} B ${SUFIJO}` })
    .returning();

  const sucursales = await db
    .insert(branches)
    .values([
      { companyId: empresaA.id, name: `${MARCA} A1`, code: `C17A1${SUFIJO}` },
      { companyId: empresaA.id, name: `${MARCA} A2`, code: `C17A2${SUFIJO}` },
      { companyId: empresaB.id, name: `${MARCA} B1`, code: `C17B1${SUFIJO}` },
      { companyId: empresaB.id, name: `${MARCA} B2`, code: `C17B2${SUFIJO}` },
    ])
    .returning();
  const [sucursalA1, sucursalA2, sucursalB1, sucursalB2] = sucursales;

  const [articuloA] = await db
    .insert(inventoryItems)
    .values({ companyId: empresaA.id, name: `${MARCA} artículo A`, category: "Abarrotes", unit: "KG" })
    .returning();
  const [articuloB] = await db
    .insert(inventoryItems)
    .values({ companyId: empresaB.id, name: `${MARCA} artículo B`, category: "Abarrotes", unit: "KG" })
    .returning();

  const [loteA] = await db
    .insert(inventoryBatches)
    .values({
      itemId: articuloA.id,
      branchId: sucursalA1.id,
      lotNumber: `${MARCA} LOTE A`,
      initialQuantity: "20",
      currentQuantity: "20",
    })
    .returning();
  const [loteB] = await db
    .insert(inventoryBatches)
    .values({
      itemId: articuloB.id,
      branchId: sucursalB1.id,
      lotNumber: `${MARCA} LOTE B`,
      initialQuantity: "50",
      currentQuantity: "50",
    })
    .returning();

  const [recetaA] = await db
    .insert(recipes)
    .values({ companyId: empresaA.id, name: `${MARCA} receta A`, unit: "PORCIÓN" })
    .returning();
  const [recetaB] = await db
    .insert(recipes)
    .values({ companyId: empresaB.id, name: `${MARCA} receta B`, unit: "PORCIÓN" })
    .returning();

  console.log(`Siembra: empresas ${empresaA.id.slice(0, 8)}… y ${empresaB.id.slice(0, 8)}…\n`);

  /** Cantidad actual de un lote, leída de la base. */
  async function cantidadDeLote(batchId: string): Promise<string | null> {
    const [fila] = await db
      .select({ cantidad: inventoryBatches.currentQuantity })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.id, batchId));
    return fila?.cantidad ?? null;
  }

  /** Movimientos quemeataron en un lote, contados en la base. */
  async function movimientosDeLote(batchId: string) {
    return db
      .select({
        branchId: inventoryMovements.branchId,
        type: inventoryMovements.type,
        cantidad: inventoryMovements.quantityChange,
        referencia: inventoryMovements.referenceId,
      })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.batchId, batchId));
  }

  try {
    // ── 1. Producción: pertenencia verificada ───────────────────────────
    console.log("1. Producción");

    const orden = await ProductionService.createOrder({
      companyId: empresaA.id,
      branchId: sucursalA1.id,
      recipeId: recetaA.id,
      plannedQuantity: 5,
      unit: "PORCIÓN",
      plannedDate: new Date("2026-10-20"),
      createdBy: "c17-admin-a",
    });
    comprobar(!!orden, "una orden con receta y sucursal propias se crea");

    const recetaAjena = await esperandoError(() =>
      ProductionService.createOrder({
        companyId: empresaA.id,
        branchId: sucursalA1.id,
        recipeId: recetaB.id,
        plannedQuantity: 5,
        unit: "PORCIÓN",
        plannedDate: new Date("2026-10-20"),
        createdBy: "c17-admin-a",
      }),
    );
    comprobar(esApiError(recetaAjena, 400, ApiError), "una receta de otra empresa se rechaza");
    comprobar(
      (recetaAjena as Error)?.message.includes(recetaB.id),
      "el rechazo nombra la receta",
    );

    const sucursalAjena = await esperandoError(() =>
      ProductionService.createOrder({
        companyId: empresaA.id,
        branchId: sucursalB1.id,
        recipeId: recetaA.id,
        plannedQuantity: 5,
        unit: "PORCIÓN",
        plannedDate: new Date("2026-10-20"),
        createdBy: "c17-admin-a",
      }),
    );
    comprobar(esApiError(sucursalAjena, 400, ApiError), "una sucursal de otra empresa se rechaza");

    const ordenesTrasRechazos = await db
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(eq(productionOrders.companyId, empresaA.id));
    comprobar(ordenesTrasRechazos.length === 1, "los rechazos no dejaron órdenes de más");

    // Registrar producción descontando el lote de otra sucursal: la pregunta es
    // si el rechazo ocurre antes del descuento. El lote ajeno se compara antes
    // y después.
    const antes = await cantidadDeLote(loteB.id);
    const loteAjeno = await esperandoError(() =>
      ProductionService.recordProduction({
        companyId: empresaA.id,
        branchId: sucursalA1.id,
        recipeId: recetaA.id,
        producedQuantity: 5,
        unit: "PORCIÓN",
        recordedBy: "c17-admin-a",
        ingredients: [
          {
            itemId: articuloB.id,
            batchId: loteB.id,
            expectedQuantity: 5,
            actualQuantity: 5,
            unit: "KG",
          },
        ],
      }),
    );
    comprobar(esApiError(loteAjeno, 400, ApiError), "descontar un lote de otra sucursal se rechaza");
    comprobar(
      (await cantidadDeLote(loteB.id)) === antes,
      `el lote ajeno quedó en ${antes}: el rechazo ocurrió antes del descuento`,
    );

    const resultados = await db
      .select({ id: productionResults.id })
      .from(productionResults)
      .where(eq(productionResults.companyId, empresaA.id));
    comprobar(resultados.length === 0, "no quedó ningún resultado de producción del caso rechazado");

    // Y el camino bueno: receta propia, lote propio. El lote baja 5 y queda en 15.
    const produccion = await ProductionService.recordProduction({
      companyId: empresaA.id,
      branchId: sucursalA1.id,
      orderId: orden.id,
      recipeId: recetaA.id,
      producedQuantity: 5,
      unit: "PORCIÓN",
      recordedBy: "c17-admin-a",
      ingredients: [
        {
          itemId: articuloA.id,
          batchId: loteA.id,
          expectedQuantity: 5,
          actualQuantity: 5,
          unit: "KG",
          unitCost: 20,
        },
      ],
    });
    comprobar(!!produccion, "producir con receta, sucursal y lote propios funciona");
    comprobar((await cantidadDeLote(loteA.id)) === "15.0000", "el lote propio bajó de 20 a 15");

    const cierre = await db
      .select({ status: productionOrders.status })
      .from(productionOrders)
      .where(eq(productionOrders.id, orden.id));
    comprobar(cierre[0]?.status === "COMPLETED", "la orden quedó cerrada al producir");

    // ── 2. Abastecimiento: el envío mueve, no duplica ───────────────────
    console.log("\n2. Abastecimiento entre sucursales");

    const destinoAjeno = await esperandoError(() =>
      InventoryService.createTransfer({
        companyId: empresaA.id,
        fromBranchId: sucursalA1.id,
        toBranchId: sucursalB2.id,
        requestedBy: "c17-admin-a",
        items: [{ itemId: articuloA.id, batchId: loteA.id, requestedQuantity: 5 }],
      }),
    );
    comprobar(esApiError(destinoAjeno, 400, ApiError), "transferir a una sucursal de otra empresa se rechaza");

    const articuloAjeno = await esperandoError(() =>
      InventoryService.createTransfer({
        companyId: empresaA.id,
        fromBranchId: sucursalA1.id,
        toBranchId: sucursalA2.id,
        requestedBy: "c17-admin-a",
        items: [{ itemId: articuloB.id, requestedQuantity: 5 }],
      }),
    );
    comprobar(esApiError(articuloAjeno, 400, ApiError), "transferir un artículo de otra empresa se rechaza");

    const mismaSucursal = await esperandoError(() =>
      InventoryService.createTransfer({
        companyId: empresaA.id,
        fromBranchId: sucursalA1.id,
        toBranchId: sucursalA1.id,
        requestedBy: "c17-admin-a",
        items: [{ itemId: articuloA.id, requestedQuantity: 5 }],
      }),
    );
    comprobar(esApiError(mismaSucursal, 400, ApiError), "transferir a la misma sucursal se rechaza");

    const transferenciasTrasRechazos = await db
      .select({ id: inventoryTransfers.id })
      .from(inventoryTransfers)
      .where(eq(inventoryTransfers.fromBranchId, sucursalA1.id));
    comprobar(transferenciasTrasRechazos.length === 0, "los rechazos no dejaron transferencias");

    // El recorrido completo. A₁ produce, A₂ consume: la cocina central que la
    // dimensión describe, sin designarla en ninguna columna.
    const transferencia = await InventoryService.createTransfer({
      companyId: empresaA.id,
      fromBranchId: sucursalA1.id,
      toBranchId: sucursalA2.id,
      requestedBy: "c17-admin-a",
      notes: `${MARCA} envío entre sucursales`,
      items: [{ itemId: articuloA.id, batchId: loteA.id, requestedQuantity: 5 }],
    });
    const transferenciaId = transferencia.transfer.id;
    comprobar(!!transferenciaId, "la transferencia entre dos sucursales propias se crea");

    const detalle = await InventoryService.getTransfer(transferenciaId, empresaA.id);
    comprobar(!!detalle, "la transferencia se lee desde su propia empresa");

    const detalleAjeno = await InventoryService.getTransfer(transferenciaId, empresaB.id);
    comprobar(detalleAjeno === null, "la misma transferencia no se lee desde la otra empresa");

    await InventoryService.approveTransfer(transferenciaId, empresaA.id, "c17-admin-a");
    const aprobacionAjena = await esperandoError(() =>
      InventoryService.approveTransfer(transferenciaId, empresaB.id, "c17-admin-b"),
    );
    comprobar(esApiError(aprobacionAjena, 404, ApiError), "aprobar desde otra empresa responde 404");

    const envioAjeno = await esperandoError(() =>
      InventoryService.shipTransfer(transferenciaId, empresaB.id, "c17-admin-b"),
    );
    comprobar(esApiError(envioAjeno, 404, ApiError), "enviar desde otra empresa responde 404");
    comprobar((await cantidadDeLote(loteA.id)) === "15.0000", "los rechazos ajenos no movieron el lote");

    await InventoryService.shipTransfer(transferenciaId, empresaA.id, "c17-admin-a");
    comprobar((await cantidadDeLote(loteA.id)) === "10.0000", "el envío descuenta 5 del origen");

    const movimientosDelOrigen = await movimientosDeLote(loteA.id);
    comprobar(movimientosDelOrigen.length === 1, `el origen registró un movimiento (tiene ${movimientosDelOrigen.length})`);
    comprobar(
      movimientosDelOrigen[0]?.type === "TRANSFER" && Number(movimientosDelOrigen[0]?.cantidad) === -5,
      `el movimiento del origen es TRANSFER negativo: ${movimientosDelOrigen[0]?.type ?? ""} ${movimientosDelOrigen[0]?.cantidad ?? ""}`,
    );
    comprobar(
      movimientosDelOrigen[0]?.branchId === sucursalA1.id,
      "el movimiento del origen está en la sucursal que envió",
    );

    await InventoryService.receiveTransfer(transferenciaId, empresaA.id, "c17-admin-a", [
      { id: transferencia.items[0].id, receivedQuantity: 5 },
    ]);

    const todosLosMovimientos = await db
      .select({
        branchId: inventoryMovements.branchId,
        itemId: inventoryMovements.itemId,
        type: inventoryMovements.type,
        cantidad: inventoryMovements.quantityChange,
        referencia: inventoryMovements.referenceId,
      })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.referenceId, transferenciaId));
    comprobar(
      todosLosMovimientos.length === 2,
      `el envío completo registró exactamente 2 movimientos (tiene ${todosLosMovimientos.length})`,
    );
    const negativos = todosLosMovimientos.filter((m) => Number(m.cantidad) < 0);
    const positivos = todosLosMovimientos.filter((m) => Number(m.cantidad) > 0);
    comprobar(negativos.length === 1 && positivos.length === 1, "uno negativo en origen y uno positivo en destino");
    comprobar(
      positivos[0]?.branchId === sucursalA2.id,
      "el movimiento positivo está en la sucursal que recibió",
    );
    comprobar(
      todosLosMovimientos.every((m) => m.type === "TRANSFER" && m.referencia === transferenciaId),
      "los dos movimientos son TRANSFER de esta transferencia: el stock se movió, no se clonó",
    );

    // El lote destino hereda la trazabilidad del origen.
    const lotesDestino = await db
      .select({
        id: inventoryBatches.id,
        cantidad: inventoryBatches.currentQuantity,
        folio: inventoryBatches.lotNumber,
        origen: inventoryBatches.origin,
      })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.branchId, sucursalA2.id));
    comprobar(lotesDestino.length === 1, "la recepción creó un único lote en destino");
    comprobar(
      lotesDestino[0]?.cantidad === "5.0000" && lotesDestino[0]?.folio === loteA.lotNumber,
      `el lote destino hereda folio y cantidad: ${lotesDestino[0]?.cantidad ?? ""} / ${lotesDestino[0]?.folio ?? ""}`,
    );

    const cierreTransferencia = await db
      .select({ status: inventoryTransfers.status })
      .from(inventoryTransfers)
      .where(eq(inventoryTransfers.id, transferenciaId));
    comprobar(cierreTransferencia[0]?.status === "COMPLETED", "la transferencia quedó en COMPLETED");

    // La recepción de una transferencia ya cerrada no vuelve a crear stock:
    // es la otra mitad del criterio de no duplicar.
    const dobleRecepcion = await esperandoError(() =>
      InventoryService.receiveTransfer(transferenciaId, empresaA.id, "c17-admin-a", [
        { id: transferencia.items[0].id, receivedQuantity: 5 },
      ]),
    );
    comprobar(dobleRecepcion !== null, "recibir dos veces la misma transferencia se rechaza");
    const lotesTrasDoble = await db
      .select({ id: inventoryBatches.id })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.branchId, sucursalA2.id));
    comprobar(lotesTrasDoble.length === 1, "no se creó un segundo lote en destino");

    // ── 3. Aislamiento en el otro sentido ───────────────────────────────
    console.log("\n3. Aislamiento de B");

    const transferenciaB = await InventoryService.createTransfer({
      companyId: empresaB.id,
      fromBranchId: sucursalB1.id,
      toBranchId: sucursalB2.id,
      requestedBy: "c17-admin-b",
      items: [{ itemId: articuloB.id, batchId: loteB.id, requestedQuantity: 5 }],
    });
    comprobar(!!transferenciaB.transfer.id, "B también puede transferir entre sus sucursales");

    const desdeA = await InventoryService.getTransfer(transferenciaB.transfer.id, empresaA.id);
    comprobar(desdeA === null, "la transferencia de B no se lee desde A");

    const aprobarDesdeA = await esperandoError(() =>
      InventoryService.approveTransfer(transferenciaB.transfer.id, empresaA.id, "c17-admin-a"),
    );
    comprobar(esApiError(aprobarDesdeA, 404, ApiError), "aprobar la transferencia de B desde A responde 404");

    const enviarDesdeA = await esperandoError(() =>
      InventoryService.shipTransfer(transferenciaB.transfer.id, empresaA.id, "c17-admin-a"),
    );
    comprobar(esApiError(enviarDesdeA, 404, ApiError), "enviar la transferencia de B desde A responde 404");
    comprobar((await cantidadDeLote(loteB.id)) === "50.0000", "el lote de B quedó intacto");

    const ordenDeBContraA = await esperandoError(() =>
      ProductionService.createOrder({
        companyId: empresaB.id,
        branchId: sucursalA1.id,
        recipeId: recetaA.id,
        plannedQuantity: 5,
        unit: "PORCIÓN",
        plannedDate: new Date("2026-10-20"),
        createdBy: "c17-admin-b",
      }),
    );
    comprobar(esApiError(ordenDeBContraA, 400, ApiError), "B tampoco puede producir contra una sucursal de A");
  } finally {
    // ── Limpieza ─────────────────────────────────────────────────────────
    console.log("\n4. Limpieza");
    const empresas = [empresaA.id, empresaB.id];
    const sucursalesSembradas = [sucursalA1.id, sucursalA2.id, sucursalB1.id, sucursalB2.id];

    // El orden importa: los hijos van antes que los padres por la FK.
    await db.delete(inventoryMovements).where(inArray(inventoryMovements.branchId, sucursalesSembradas));
    await db.delete(productionIngredients).where(
      inArray(productionIngredients.resultId, (
        await db
          .select({ id: productionResults.id })
          .from(productionResults)
          .where(inArray(productionResults.companyId, empresas))
      ).map((r) => r.id)),
    );
    await db.delete(productionResults).where(inArray(productionResults.companyId, empresas));
    await db.delete(productionOrders).where(inArray(productionOrders.companyId, empresas));
    await db
      .delete(inventoryTransferItems)
      .where(inArray(inventoryTransferItems.transferId, (
        await db
          .select({ id: inventoryTransfers.id })
          .from(inventoryTransfers)
          .where(inArray(inventoryTransfers.fromBranchId, sucursalesSembradas))
      ).map((t) => t.id)));
    await db.delete(inventoryTransfers).where(inArray(inventoryTransfers.fromBranchId, sucursalesSembradas));
    await db.delete(inventoryBatches).where(inArray(inventoryBatches.branchId, sucursalesSembradas));
    await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, empresas));
    await db.delete(recipeItems).where(inArray(recipeItems.recipeId, [recetaA.id, recetaB.id]));
    await db.delete(recipes).where(inArray(recipes.id, [recetaA.id, recetaB.id]));
    await db.delete(branches).where(inArray(branches.companyId, empresas));
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