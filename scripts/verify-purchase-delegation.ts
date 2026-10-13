/**
 * C16.3 — recorrido de compras con dos empresas contra la base real.
 *
 * Lo que las pruebas unitarias no pueden mostrar: que las consultas preguntan a
 * Postgres de verdad y que el recorrido completo se comporta como dice el
 * contrato cuando hay dos empresas en la misma base.
 *
 * Se siembra lo mínimo —dos empresas, dos sucursales cada una, un proveedor y un
 * artículo— y se recorre: solicitud → orden en borrador → aprobación → emisión,
 * comprobando en cada paso el rechazo y la razón. Al final se borra todo lo
 * sembrado y se verifica que no quedó nada.
 *
 * Uso: `npx tsx scripts/verify-purchase-delegation.ts`
 */

import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import type { ApiError as ApiErrorTipo } from "@/lib/api/error";
import type { PurchaseOrderService as ServicioOC } from "@/lib/services/purchase-order-service";
import type { evaluarDelegacion as EvaluarDelegacion } from "@/lib/purchasing/delegation-policy";

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

const MARCA = "C16.3 verificación";
const SUFIJO = Date.now().toString(36);

let fallos = 0;
let comprobaciones = 0;

/** Tipos de lo que se importa dentro de `main`. */
type Esquema = typeof import("@/lib/db/schema");
type Base = typeof import("@/lib/db")["db"];

async function cargarDependencias() {
  const { db } = await import("@/lib/db");
  const esquema: Esquema = await import("@/lib/db/schema");
  const { PurchaseOrderService } = await import("@/lib/services/purchase-order-service");
  const politica = await import("@/lib/purchasing/delegation-policy");
  const { ApiError } = await import("@/lib/api/error");
  return { db, esquema, PurchaseOrderService, ...politica, ApiError };
}

type Dependencias = Awaited<ReturnType<typeof cargarDependencias>>;

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
  console.log("C16.3 — recorrido de compras con dos empresas\n");

  const { db, esquema, PurchaseOrderService, evaluarDelegacion, reemplazarReglasDeDelegacion, ApiError } =
    await cargarDependencias();
  const {
    branches,
    companies,
    inventoryItems,
    purchaseOrderItems,
    purchaseOrders,
    requisitionItems,
    requisitions,
    suppliers,
    users,
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
      { companyId: empresaA.id, name: `${MARCA} A1`, code: `C16A1${SUFIJO}` },
      { companyId: empresaA.id, name: `${MARCA} A2`, code: `C16A2${SUFIJO}` },
      { companyId: empresaB.id, name: `${MARCA} B1`, code: `C16B1${SUFIJO}` },
    ])
    .returning();
  const [sucursalA1, sucursalA2, sucursalB1] = sucursales;

  const [proveedorA] = await db
    .insert(suppliers)
    .values({ companyId: empresaA.id, name: `${MARCA} proveedor A` })
    .returning();
  const [proveedorB] = await db
    .insert(suppliers)
    .values({ companyId: empresaB.id, name: `${MARCA} proveedor B` })
    .returning();

  const [articuloA] = await db
    .insert(inventoryItems)
    .values({
      companyId: empresaA.id,
      name: `${MARCA} artículo A`,
      category: "Abarrotes",
      unit: "UNIT",
    })
    .returning();
  const [articuloB] = await db
    .insert(inventoryItems)
    .values({ companyId: empresaB.id, name: `${MARCA} artículo B`, category: "Carnes", unit: "UNIT" })
    .returning();

  console.log(`Siembra: empresas ${empresaA.id.slice(0, 8)}… y ${empresaB.id.slice(0, 8)}…\n`);

  try {
    // ── 1. Sin controles: el permiso vigente decide, como antes ──────────
    console.log("1. Empresa sin controles configurados");
    const veredictoInicial = await evaluarDelegacion(empresaA.id, {
      action: "EMIT",
      role: "SUPERVISOR",
      branchId: sucursalA1.id,
      categories: ["Abarrotes"],
    });
    comprobar(veredictoInicial.allowed && veredictoInicial.basis === "sin_controles", "sin reglas se permite y la base es «sin controles»");

    const { po: ordenSinControles } = await PurchaseOrderService.createPO({
      companyId: empresaA.id,
      branchId: sucursalA1.id,
      supplierId: proveedorA.id,
      requestedBy: "c16-supervisor",
      actorRole: "SUPERVISOR",
      items: [{ itemId: articuloA.id, orderedQuantity: 3, unitCost: 100 }],
    });
    comprobar(!!ordenSinControles, "un supervisor puede crear la orden cuando no hay controles");

    // ── 2. Los controles se aplican a la solicitud ───────────────────────
    console.log("\n2. Controles de solicitud configurados");
    await reemplazarReglasDeDelegacion(empresaA.id, "REQUEST", [
      { action: "REQUEST", scope: "BRANCH", branchId: sucursalA1.id, requiredRole: "ADMIN" },
    ]);

    const porDebajo = await esperandoError(() =>
      PurchaseOrderService.createPO({
        companyId: empresaA.id,
        branchId: sucursalA1.id,
        supplierId: proveedorA.id,
        requestedBy: "c16-gerente",
        actorRole: "GERENTE",
        items: [{ itemId: articuloA.id, orderedQuantity: 1, unitCost: 100 }],
      }),
    );
    comprobar(esApiError(porDebajo, 403, ApiError), "un gerente por debajo del control recibe 403");
    comprobar(
      (porDebajo as Error).message.includes("ADMIN"),
      `el mensaje nombra el rol mínimo: «${(porDebajo as Error).message}»`,
    );

    const ordenesTrasRechazo = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.companyId, empresaA.id));
    comprobar(ordenesTrasRechazo.length === 1, "el rechazo no dejó una segunda orden escrita");

    // Con reglas configuradas, una sucursal que ninguna cubre no «conserva el
    // comportamiento previo»: se rechaza por hueco y el mensaje la nombra. Es
    // la diferencia entre no tener política y tener una incompleta.
    const sinCobertura = await esperandoError(() =>
      PurchaseOrderService.createPO({
        companyId: empresaA.id,
        branchId: sucursalA2.id,
        supplierId: proveedorA.id,
        requestedBy: "c16-gerente",
        actorRole: "GERENTE",
        items: [{ itemId: articuloA.id, orderedQuantity: 1, unitCost: 100 }],
      }),
    );
    comprobar(esApiError(sinCobertura, 403, ApiError), "una sucursal que ninguna regla cubre recibe 403");
    comprobar(
      (sinCobertura as Error).message.includes(sucursalA2.id),
      `el mensaje nombra la sucursal sin cobertura`,
    );

    // Una regla de empresa cierra el hueco y las dos sucursales vuelven a funcionar.
    await reemplazarReglasDeDelegacion(empresaA.id, "REQUEST", [
      { action: "REQUEST", scope: "COMPANY", requiredRole: "GERENTE" },
    ]);
    const otraSucursal = await PurchaseOrderService.createPO({
      companyId: empresaA.id,
      branchId: sucursalA2.id,
      supplierId: proveedorA.id,
      requestedBy: "c16-gerente",
      actorRole: "GERENTE",
      items: [{ itemId: articuloA.id, orderedQuantity: 1, unitCost: 100 }],
    });
    comprobar(!!otraSucursal.po, "una regla de empresa cubre las dos sucursales");
    await reemplazarReglasDeDelegacion(empresaA.id, "REQUEST", [
      { action: "REQUEST", scope: "BRANCH", branchId: sucursalA1.id, requiredRole: "ADMIN" },
    ]);

    const requisicion = await PurchaseOrderService.createRequisition({
      companyId: empresaA.id,
      branchId: sucursalA1.id,
      requestedBy: "c16-admin",
      actorRole: "ADMIN",
      items: [{ itemId: articuloA.id, requestedQuantity: 2 }],
    });
    comprobar(!!requisicion.requisition, "un admin que alcanza el control sí puede solicitar");

    // ── 3. Aislamiento por empresa en la escritura ───────────────────────
    console.log("\n3. Pertenencia verificada");
    const sucursalAjena = await esperandoError(() =>
      PurchaseOrderService.createPO({
        companyId: empresaA.id,
        branchId: sucursalB1.id,
        supplierId: proveedorA.id,
        requestedBy: "c16-admin",
        actorRole: "ADMIN",
        items: [{ itemId: articuloA.id, orderedQuantity: 1, unitCost: 100 }],
      }),
    );
    comprobar(sucursalAjena !== null, `una sucursal de otra empresa se rechaza: ${(sucursalAjena as Error)?.message}`);

    const articuloAjeno = await esperandoError(() =>
      PurchaseOrderService.createPO({
        companyId: empresaA.id,
        branchId: sucursalA1.id,
        supplierId: proveedorA.id,
        requestedBy: "c16-admin",
        actorRole: "ADMIN",
        items: [{ itemId: articuloB.id, orderedQuantity: 1, unitCost: 100 }],
      }),
    );
    comprobar(esApiError(articuloAjeno, 400, ApiError), "un artículo de otra empresa se rechaza");

    const proveedorAjeno = await esperandoError(() =>
      PurchaseOrderService.createPO({
        companyId: empresaA.id,
        branchId: sucursalA1.id,
        supplierId: proveedorB.id,
        requestedBy: "c16-admin",
        actorRole: "ADMIN",
        items: [{ itemId: articuloA.id, orderedQuantity: 1, unitCost: 100 }],
      }),
    );
    comprobar(
      proveedorAjeno !== null && /proveedor/i.test((proveedorAjeno as Error).message),
      "un proveedor de otra empresa se rechaza nombrándolo",
    );

    // Desde la sesión de B, una solicitud de A no debe convertirse: el servicio
    // la busca acotada por empresa y no la encuentra.
    const errorSolicitudAjena = await esperandoError(() =>
      PurchaseOrderService.createPO({
        companyId: empresaB.id,
        branchId: sucursalB1.id,
        supplierId: proveedorB.id,
        requestedBy: "c16-b",
        actorRole: "ADMIN",
        requisitionId: requisicion.requisition.id,
        items: [{ itemId: articuloB.id, orderedQuantity: 1, unitCost: 100 }],
      }),
    );
    comprobar(
      errorSolicitudAjena !== null && /solicitud/i.test((errorSolicitudAjena as Error).message),
      "una solicitud de A no se convierte desde B",
    );

    const estadoDeLaSolicitud = await db
      .select({ status: requisitions.status })
      .from(requisitions)
      .where(eq(requisitions.id, requisicion.requisition.id));
    comprobar(estadoDeLaSolicitud[0]?.status === "PENDING", "la solicitud sigue PENDING: nadie la convirtió");

    // ── 4. Emisión ───────────────────────────────────────────────────────
    console.log("\n4. Emisión");
    // La matriz (C16.1) es la que aprueba; aquí se deja la orden en APPROVED
    // para aislar la emisión, que es lo que cambió en C16.2.2.
    await db
      .update(purchaseOrders)
      .set({ status: "APPROVED" })
      .where(eq(purchaseOrders.id, ordenSinControles.id));

    await reemplazarReglasDeDelegacion(empresaA.id, "EMIT", [
      { action: "EMIT", scope: "BRANCH", branchId: sucursalA1.id, requiredRole: "ADMIN" },
    ]);

    const porDebajoEmision = await esperandoError(() =>
      PurchaseOrderService.sendPO(ordenSinControles.id, "c16-gerente", empresaA.id, "GERENTE"),
    );
    comprobar(esApiError(porDebajoEmision, 403, ApiError), "un gerente no puede emitir la orden de su sucursal");

    const trasRechazo = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, ordenSinControles.id));
    comprobar(trasRechazo[0]?.status === "APPROVED", "el rechazo no cambió el estado de la orden");

    const enviada = await PurchaseOrderService.sendPO(ordenSinControles.id, "c16-admin", empresaA.id, "ADMIN");
    comprobar(enviada.status === "SENT", "un admin que alcanza el control emite la orden");

    const ajena = await esperandoError(() =>
      PurchaseOrderService.sendPO(ordenSinControles.id, "c16-admin", empresaB.id, "ADMIN"),
    );
    comprobar(esApiError(ajena, 404, ApiError), "la orden de A no se encuentra desde la sesión de B");

    // ── 5. Reconfigurar no reescribe el pasado ───────────────────────────
    console.log("\n5. Reconfigurar no altera lo ya emitido");
    await reemplazarReglasDeDelegacion(empresaA.id, "EMIT", [
      { action: "EMIT", scope: "COMPANY", requiredRole: "OWNER" },
    ]);

    const despues = await db
      .select({ status: purchaseOrders.status, sentAt: purchaseOrders.sentAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, ordenSinControles.id));
    comprobar(despues[0]?.status === "SENT", "la orden emitida sigue enviada tras endurecer el control");
    comprobar(Boolean(despues[0]?.sentAt), "conserva la fecha de envío");

    const reglasDeB = await evaluarDelegacion(empresaB.id, {
      action: "EMIT",
      role: "SUPERVISOR",
      branchId: sucursalB1.id,
      categories: [],
    });
    comprobar(reglasDeB.allowed, "los controles de A no alcanzan a B: B sigue sin controles");
  } finally {
    // ── Limpieza ─────────────────────────────────────────────────────────
    console.log("\n6. Limpieza");
    // Los controles van primero: `purchase_delegation_rules` referencia a la
    // empresa y la FK impide borrar la compañía con filas de control.
    await reemplazarReglasDeDelegacion(empresaA.id, "REQUEST", []);
    await reemplazarReglasDeDelegacion(empresaA.id, "EMIT", []);
    await reemplazarReglasDeDelegacion(empresaB.id, "REQUEST", []);
    await reemplazarReglasDeDelegacion(empresaB.id, "EMIT", []);
    const ordenes = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.companyId, [empresaA.id, empresaB.id]));
    if (ordenes.length > 0) {
      await db
        .delete(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.poId, ordenes.map((o) => o.id)));
      await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, ordenes.map((o) => o.id)));
    }
    const solicitudes = await db
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(inArray(requisitions.companyId, [empresaA.id, empresaB.id]));
    if (solicitudes.length > 0) {
      await db
        .delete(requisitionItems)
        .where(inArray(requisitionItems.requisitionId, solicitudes.map((s) => s.id)));
      await db.delete(requisitions).where(inArray(requisitions.id, solicitudes.map((s) => s.id)));
    }
    await db.delete(suppliers).where(inArray(suppliers.companyId, [empresaA.id, empresaB.id]));
    await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, [empresaA.id, empresaB.id]));
    await db.delete(branches).where(inArray(branches.companyId, [empresaA.id, empresaB.id]));
    await db
      .delete(users)
      .where(inArray(users.companyId, [empresaA.id, empresaB.id]));
    await db.delete(companies).where(inArray(companies.id, [empresaA.id, empresaB.id]));

    // Los controles se borran con la misma función que los escribe: la tabla no
    // tiene cascada desde `companies` y una empresa sembrada con reglas dejaría

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
