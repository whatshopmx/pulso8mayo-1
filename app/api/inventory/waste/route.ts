import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  inventoryWaste,
  inventoryWasteReasonEnum,
  inventoryBatches,
  inventoryItems,
  inventoryMovements,
  branches,
} from "@/lib/db/schema";
import { AuditService } from "@/lib/services/audit-service";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { enforceBranchScope, resolveBranchScope } from "@/lib/branch-scope";
import { formatQty } from "@/lib/utils";

type WasteReason = (typeof inventoryWasteReasonEnum.enumValues)[number];

/**
 * Códigos de error estables del módulo de mermas. La UI (T6) se apoya en
 * `error.details.code` — nunca en substrings del mensaje — así que estos
 * strings son contrato entre la API y el formulario.
 */
export const WASTE_ERROR_CODES = {
  /** Se intentó dar de baja más cantidad de la que queda en el lote. */
  OVER_QUANTITY: "OVER_QUANTITY",
  /** El lote no existe o no pertenece al tenant — 404 a propósito (no filtrar). */
  BATCH_NOT_FOUND: "BATCH_NOT_FOUND",
  /** Usuario con rol de sucursal (GERENTE/SUPERVISOR) escribiendo en otra. */
  BRANCH_FORBIDDEN: "BRANCH_FORBIDDEN",
} as const;

/**
 * GET /api/inventory/waste — historial de mermas del tenant.
 *
 * `branchId` (query) pasa por `enforceBranchScope`: GERENTE/SUPERVISOR quedan
 * clavados a su sucursal; ADMIN/SUPER_ADMIN pueden pedir cualquiera del tenant.
 * Un `branchId` de otro tenant es 404, no 403, para no filtrar existencia.
 */
export const GET = withTenantAuth(async (req: NextRequest, { auth }) => {
  const { searchParams } = new URL(req.url);
  const requestedBranchId = searchParams.get("branchId");

  const tenantBranchIds = (
    await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.companyId, auth.tenantId))
  ).map((b) => b.id);

  if (requestedBranchId && !tenantBranchIds.includes(requestedBranchId)) {
    throw ApiError.notFound("Sucursal no encontrada");
  }

  const alcance = resolveBranchScope(
    auth.user.role as never,
    auth.user.branchId,
    requestedBranchId
  );

  // Un rol de sucursal SIN sucursal asignada no ve las mermas del grupo: antes
  // ese caso caía en el mismo `null` que "todas" y se saltaba el filtro. El POST
  // de esta misma ruta ya cerraba por su cuenta (línea ~159); esto arregla solo
  // la lectura.
  if (alcance.kind === "NONE") {
    return ApiHandler.success({ waste: [] });
  }

  const effectiveBranchId = alcance.kind === "BRANCH" ? alcance.branchId : null;

  const conditions = [eq(inventoryWaste.companyId, auth.tenantId)];
  if (effectiveBranchId) {
    conditions.push(eq(inventoryWaste.branchId, effectiveBranchId));
  }

  const rows = await db
    .select({
      waste: inventoryWaste,
      item: {
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        unit: inventoryItems.unit,
      },
      batch: {
        id: inventoryBatches.id,
        lotNumber: inventoryBatches.lotNumber,
        expirationDate: inventoryBatches.expirationDate,
      },
    })
    .from(inventoryWaste)
    .leftJoin(inventoryItems, eq(inventoryWaste.itemId, inventoryItems.id))
    .leftJoin(inventoryBatches, eq(inventoryWaste.batchId, inventoryBatches.id))
    .where(and(...conditions))
    .orderBy(desc(inventoryWaste.recordedAt));

  // `quantity` es numeric → string en TS; la UI la recibe como número (patrón T4).
  const waste = rows.map((row) => ({
    ...row,
    waste: { ...row.waste, quantity: Number(row.waste.quantity) },
  }));

  return ApiHandler.success({ waste });
});

/**
 * POST /api/inventory/waste — registrar una merma.
 *
 * Multi-tenant y decimal-safe:
 * - `companyId`/`recordedBy` salen SOLO de la sesión (`withTenantAuth`).
 * - `branchId` del body pasa por `enforceBranchScope`; GERENTE/SUPERVISOR
 *   escribiendo en otra sucursal → 403. Sucursal ajena al tenant → 404.
 * - El lote se busca scopeado al tenant (vía sus sucursales): un id de otro
 *   tenant → 404, no 403 (la ruta anterior filtraba solo por id — fuga
 *   cross-tenant).
 * - `quantity` es numeric(12,4): string en TS en la frontera DB.
 * - `totalLoss` se deriva del costo unitario YA redondeado a centavos, para
 *   que cualquier recomputación aguas abajo (quantity × costPerUnit) devuelva
 *   exactamente lo guardado — sin deriva de un centavo por decimales editados.
 */
export const POST = withTenantAuth(async (req: NextRequest, { auth }) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw ApiError.badRequest("Cuerpo de la petición inválido");
  }

  const { batchId, itemId, unit, reason, notes } = body;
  const requestedBranchId = typeof body.branchId === "string" ? body.branchId : null;

  // --- Validación de entrada -------------------------------------------------
  if (
    !requestedBranchId ||
    typeof itemId !== "string" ||
    !itemId ||
    typeof unit !== "string" ||
    !unit ||
    typeof reason !== "string"
  ) {
    throw ApiError.badRequest(
      "Faltan campos obligatorios: branchId, itemId, unit y reason"
    );
  }

  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw ApiError.badRequest("La cantidad debe ser un número mayor a 0");
  }

  if (!(inventoryWasteReasonEnum.enumValues as readonly string[]).includes(reason)) {
    throw ApiError.badRequest(`Motivo de merma inválido: ${reason}`);
  }

  // --- Sucursal: tenancy + scope por rol --------------------------------------
  const tenantBranchIds = (
    await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.companyId, auth.tenantId))
  ).map((b) => b.id);

  if (!tenantBranchIds.includes(requestedBranchId)) {
    throw ApiError.notFound("Sucursal no encontrada");
  }

  const effectiveBranchId = enforceBranchScope(
    auth.user.role as never,
    auth.user.branchId,
    requestedBranchId
  );
  if (effectiveBranchId !== requestedBranchId) {
    throw ApiError.forbidden("Solo puedes registrar mermas en tu sucursal", {
      code: WASTE_ERROR_CODES.BRANCH_FORBIDDEN,
    });
  }

  // --- Lote: lookup scopeado al tenant ----------------------------------------
  let batch: {
    id: string;
    itemId: string;
    branchId: string;
    currentQuantity: string;
    status: typeof inventoryBatches.$inferSelect.status;
  } | null = null;

  if (batchId) {
    const found = await db
      .select({
        id: inventoryBatches.id,
        itemId: inventoryBatches.itemId,
        branchId: inventoryBatches.branchId,
        currentQuantity: inventoryBatches.currentQuantity,
        status: inventoryBatches.status,
      })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.id, batchId as string),
          inArray(inventoryBatches.branchId, tenantBranchIds)
        )
      )
      .limit(1);

    batch = found[0] ?? null;

    // Lote inexistente o de OTRO tenant → 404 a propósito (no filtrar existencia).
    if (!batch) {
      throw ApiError.notFound("No se encontró el lote", {
        code: WASTE_ERROR_CODES.BATCH_NOT_FOUND,
      });
    }

    if (batch.branchId !== effectiveBranchId) {
      throw ApiError.badRequest("El lote no pertenece a esta sucursal");
    }
    if (batch.itemId !== itemId) {
      throw ApiError.badRequest("El lote no corresponde al producto seleccionado");
    }
    if (qty > Number(batch.currentQuantity)) {
      throw ApiError.badRequest(
        `Solo quedan ${formatQty(batch.currentQuantity)} ${unit} en este lote`,
        {
          code: WASTE_ERROR_CODES.OVER_QUANTITY,
          maxQuantity: formatQty(batch.currentQuantity),
        }
      );
    }
  }

  // --- Costos: centavos, sin deriva por decimales editados ----------------------
  const costPerUnitRaw = Number(body.costPerUnit);
  const hasCost = Number.isFinite(costPerUnitRaw) && costPerUnitRaw > 0;
  const costPerUnitCents = hasCost ? Math.round(costPerUnitRaw * 100) : null;
  // `totalLoss` se deriva del costo YA redondeado (misma fuente que aguas abajo
  // usa para recomputar) y no del total enviado, para que quantity × costPerUnit
  // devuelva exactamente lo guardado. Sin costo unitario, se respeta el total
  // enviado (clientes que conocen la pérdida pero no el costo por unidad).
  const totalLossRaw = Number(body.totalLoss);
  const hasTotalLoss = Number.isFinite(totalLossRaw) && totalLossRaw > 0;
  const totalLossCents =
    costPerUnitCents !== null
      ? Math.round(qty * costPerUnitCents)
      : hasTotalLoss
        ? Math.round(totalLossRaw * 100)
        : null;

  // --- Baja del lote (si viene) ------------------------------------------------
  let updatedStock: number | null = null;
  if (batch) {
    const newQuantity = Number(batch.currentQuantity) - qty;
    // 2.5 - 0.4 = 2.1000000000000005 en IEEE; Postgres redondea a 4dp al guardar
    // y el status se decide sobre el valor ya redondeado.
    const roundedNew = Number(newQuantity.toFixed(4));
    await db
      .update(inventoryBatches)
      .set({
        currentQuantity: String(newQuantity),
        status: roundedNew === 0 ? "DEPLETED" : batch.status,
        updatedAt: new Date(),
      })
      .where(eq(inventoryBatches.id, batch.id));
    updatedStock = roundedNew;
  }

  // --- Registros ---------------------------------------------------------------
  const [waste] = await db
    .insert(inventoryWaste)
    .values({
      companyId: auth.tenantId,
      branchId: effectiveBranchId,
      batchId: batch?.id ?? null,
      itemId,
      quantity: String(qty),
      unit,
      reason: reason as WasteReason,
      costPerUnit: costPerUnitCents,
      totalLoss: totalLossCents,
      recordedBy: auth.user.id,
      recordedAt: new Date(),
      notes: typeof notes === "string" && notes ? notes : null,
    })
    .returning();

  // COURTESY se trata igual que STAFF: es consumo (regalo a cliente), no
  // desperdicio — no debe inflar el % de merma (OQ-1).
  const consumoInterno = reason === "STAFF" || reason === "COURTESY";
  await db
    .insert(inventoryMovements)
    .values({
      branchId: effectiveBranchId,
      itemId,
      batchId: batch?.id ?? null,
      type: consumoInterno ? "USAGE" : "WASTE",
      quantityChange: String(-qty),
      reason: consumoInterno
        ? reason === "STAFF"
          ? "Consumo de Personal"
          : "Cortesía a Cliente"
        : `WASTE: ${reason}`,
      performedBy: auth.user.id,
      timestamp: new Date(),
    });

  AuditService.logInventoryAction({
    companyId: auth.tenantId,
    branchId: effectiveBranchId,
    action: "CREATE",
    entityType: "WASTE",
    entityId: waste.id,
    newValue: { itemId, quantity: qty, unit, reason, notes },
    performedBy: auth.user.id,
    reason: `Waste: ${reason}`,
    metadata: {
      batchId: batch?.id ?? null,
      costPerUnit: body.costPerUnit,
      totalLoss: body.totalLoss,
      notes,
    },
  });

  return ApiHandler.success({
    waste: { ...waste, quantity: Number(waste.quantity) },
    updatedStock,
  });
});
