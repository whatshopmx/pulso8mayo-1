import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  eq,
  and,
  desc,
  gte,
  lte,
  ilike,
  or,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  inventoryWaste,
  inventoryWasteReasonEnum,
  inventoryBatches,
  inventoryItems,
  inventoryMovements,
  branches,
  users,
  recipes,
  recipeItems,
} from "@/lib/db/schema";
import { AuditService } from "@/lib/services/audit-service";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { enforceBranchScope, resolveBranchScope } from "@/lib/branch-scope";
import { initialApprovalStatus } from "@/lib/inventory/waste-approval";
import { compareYield } from "@/lib/inventory/waste-yield";
import { wasteLossEligible } from "@/lib/inventory/waste-kpi";
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
  /** Datos de merma por preparación incompletos o inconsistentes (Task 11). */
  PREPARATION_INVALID: "PREPARATION_INVALID",
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
    // Misma forma que la respuesta con datos, para que el cliente no tenga dos contratos.
    return ApiHandler.success({
      waste: [],
      total: 0,
      summary: { count: 0, trueWasteLossCents: 0, totalLossCents: 0, byReason: [] },
    });
  }

  const effectiveBranchId = alcance.kind === "BRANCH" ? alcance.branchId : null;

  const conditions = [eq(inventoryWaste.companyId, auth.tenantId)];
  if (effectiveBranchId) {
    conditions.push(eq(inventoryWaste.branchId, effectiveBranchId));
  }

  // --- Filtros del historial (plan-mermas-historial Task 1) -------------------
  // `from`/`to` como días de calendario locales (`to` inclusivo hasta el último
  // ms del día); `limit` topado en 200.
  const fromDate = parseDateParam(searchParams.get("from"), "from");
  if (fromDate) conditions.push(gte(inventoryWaste.recordedAt, fromDate));

  const toDate = parseDateParam(searchParams.get("to"), "to", true);
  if (toDate) conditions.push(lte(inventoryWaste.recordedAt, toDate));

  const reasonParam = searchParams.get("reason");
  if (reasonParam) {
    if (!(inventoryWasteReasonEnum.enumValues as readonly string[]).includes(reasonParam)) {
      throw ApiError.badRequest(`Motivo de merma inválido: ${reasonParam}`);
    }
    conditions.push(eq(inventoryWaste.reason, reasonParam as WasteReason));
  }

  const originParam = searchParams.get("origin");
  if (originParam) {
    // `manual` = captura por formulario/API, donde origin es NULL (los tres
    // valores nombrados los escriben los extractores de workflow).
    if (originParam === "manual") {
      conditions.push(isNull(inventoryWaste.origin));
    } else {
      conditions.push(eq(inventoryWaste.origin, originParam));
    }
  }

  // Categoría y búsqueda viven en `inventory_items`: los aggregates de abajo
  // necesitan el mismo join para respetar exactamente los mismos filtros.
  const categoryParam = searchParams.get("category");
  if (categoryParam) {
    conditions.push(eq(inventoryItems.category, categoryParam));
  }

  const q = searchParams.get("q")?.trim();
  if (q) {
    conditions.push(
      or(ilike(inventoryItems.name, `%${q}%`), ilike(inventoryItems.sku, `%${q}%`))!
    );
  }

  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;

  // Resumen y conteo con los MISMOS filtros que la lista (join a ítems incluido):
  // los totales no deben cambiar al paginar. STAFF/COURTESY son consumo interno,
  // no merma real (OQ-1, mismo criterio que inventory-reports-service). Las
  // PENDING_APPROVAL/REJECTED tampoco suman: aún no son consumo aceptado o
  // jamás lo serán (Task 3 §8.1, criterio único en waste-kpi).
  const itemJoin = eq(inventoryWaste.itemId, inventoryItems.id);
  const eligible = [wasteLossEligible];

  const [agg] = await db
    .select({
      count: sql<number>`count(*)`,
      totalLossCents: sql<string>`coalesce(sum(case when ${wasteLossEligible} then ${inventoryWaste.totalLoss} else 0 end), 0)`,
      trueWasteLossCents: sql<string>`coalesce(sum(case when ${inventoryWaste.reason} not in ('STAFF', 'COURTESY') and ${wasteLossEligible} then ${inventoryWaste.totalLoss} else 0 end), 0)`,
    })
    .from(inventoryWaste)
    .leftJoin(inventoryItems, itemJoin)
    .where(and(...conditions));

  const byReasonRows = await db
    .select({
      reason: inventoryWaste.reason,
      entries: sql<number>`count(*)`,
      lossCents: sql<string>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
    })
    .from(inventoryWaste)
    .leftJoin(inventoryItems, itemJoin)
    .where(and(...conditions, ...eligible))
    .groupBy(inventoryWaste.reason);

  const rows = await db
    .select({
      waste: inventoryWaste,
      item: {
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        unit: inventoryItems.unit,
        category: inventoryItems.category,
      },
      batch: {
        id: inventoryBatches.id,
        lotNumber: inventoryBatches.lotNumber,
        expirationDate: inventoryBatches.expirationDate,
      },
      recordedByUser: {
        id: users.id,
        name: users.name,
      },
    })
    .from(inventoryWaste)
    .leftJoin(inventoryItems, itemJoin)
    .leftJoin(inventoryBatches, eq(inventoryWaste.batchId, inventoryBatches.id))
    .leftJoin(users, eq(inventoryWaste.recordedBy, users.id))
    .where(and(...conditions))
    .orderBy(desc(inventoryWaste.recordedAt))
    .limit(limit)
    .offset(offset);

  // `quantity` es numeric → string en TS; la UI la recibe como número (patrón T4).
  // Igual con count(*)/sum(): bigint/numeric llegan como string desde pg.
  const waste = rows.map((row) => ({
    ...row,
    waste: { ...row.waste, quantity: Number(row.waste.quantity) },
  }));

  const total = Number(agg?.count ?? 0);
  return ApiHandler.success({
    waste,
    total,
    limit,
    offset,
    summary: {
      count: total,
      trueWasteLossCents: Number(agg?.trueWasteLossCents ?? 0),
      totalLossCents: Number(agg?.totalLossCents ?? 0),
      byReason: byReasonRows
        .map((r) => ({
          reason: r.reason,
          entries: Number(r.entries),
          lossCents: Number(r.lossCents),
        }))
        .sort((a, b) => b.lossCents - a.lossCents),
    },
  });
});

/**
 * Parsea un parámetro de fecha. Una fecha suelta `YYYY-MM-DD` es un día de
 * calendario LOCAL, no medianoche UTC: `new Date("2026-08-24")` parsea como
 * UTC y en husos negativos (todo LATAM) cae en el día anterior local, así
 * que encimar `setHours(23:59:59)` sobre eso recorta la ventana y `to=hoy`
 * termina EXCLUYENDO la tarde completa. Con fecha+hora ISO se respeta tal
 * cual. Fecha inválida → 400 explícito, no filtro silenciosamente roto.
 */
function parseDateParam(raw: string | null, name: string, endOfDay = false): Date | null {
  if (!raw) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw ApiError.badRequest(`Fecha inválida en '${name}': ${raw}`);
  }
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

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

  // Task 3 (§8.1): STAFF/COURTESY nacen PENDING_APPROVAL — sin baja de lote ni
  // movimiento. El descuento ocurre sólo cuando un GERENTE+ aprueba.
  const approvalStatus = initialApprovalStatus(reason);

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

  // --- Merma por preparación: contraste contra el rendimiento de la ficha -------
  // Task 11 (§8.1/§8.3). El manual pide que el recorte/grasa se mida contra el
  // rendimiento esperado; sin eso "preparación" sería un OTHER con otro nombre.
  // Los campos son opcionales (una merma de proceso sin ficha sigue siendo
  // capturable) pero vienen juntos: receta + cuánto se procesó en bruto.
  const rawRecipeId = typeof body.recipeId === "string" && body.recipeId ? body.recipeId : null;
  const processedRaw = Number(body.processedQuantity);
  const hasProcessed = Number.isFinite(processedRaw) && processedRaw > 0;

  if (rawRecipeId && reason !== "PREPARATION") {
    throw ApiError.badRequest(
      "La receta y la cantidad procesada solo aplican a la merma por preparación",
      { code: WASTE_ERROR_CODES.PREPARATION_INVALID }
    );
  }

  let recipeId: string | null = null;
  let processedQuantity: number | null = null;
  let expectedQuantity: number | null = null;
  let yieldFlagged = false;

  if (reason === "PREPARATION" && rawRecipeId) {
    if (!hasProcessed) {
      throw ApiError.badRequest(
        "Indica cuánto se procesó en bruto para comparar contra el rendimiento de la ficha",
        { code: WASTE_ERROR_CODES.PREPARATION_INVALID }
      );
    }

    // Receta scopeada al tenant: 404 en vez de 403 para no filtrar existencia.
    const [recipe] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, rawRecipeId), eq(recipes.companyId, auth.tenantId)))
      .limit(1);
    if (!recipe) throw ApiError.notFound("No se encontró la receta");

    const [line] = await db
      .select({ yieldPercent: recipeItems.yieldPercent })
      .from(recipeItems)
      .where(and(eq(recipeItems.recipeId, recipe.id), eq(recipeItems.itemId, itemId)))
      .limit(1);
    if (!line) {
      throw ApiError.badRequest("El insumo no forma parte de esa receta", {
        code: WASTE_ERROR_CODES.PREPARATION_INVALID,
      });
    }

    const comparison = compareYield({
      processedQuantity: processedRaw,
      actualWaste: qty,
      yieldPercent: line.yieldPercent,
    });

    recipeId = recipe.id;
    processedQuantity = processedRaw;
    expectedQuantity = Number(comparison.expectedQuantity.toFixed(4));
    yieldFlagged = comparison.flagged;
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
  // Sólo para mermas AUTO: una PENDING_APPROVAL descuenta al aprobar, no aquí.
  let updatedStock: number | null = null;
  if (batch && approvalStatus === "AUTO") {
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
      approvalStatus,
      recipeId,
      processedQuantity: processedQuantity !== null ? String(processedQuantity) : null,
      expectedQuantity: expectedQuantity !== null ? String(expectedQuantity) : null,
      yieldFlagged,
    })
    .returning();

  // COURTESY se trata igual que STAFF: es consumo (regalo a cliente), no
  // desperdicio — no debe inflar el % de merma (OQ-1). El movimiento USAGE/WASTE
  // sólo para AUTO; el aprobador lo genera al aprobar (waste/[id]/approval).
  const consumoInterno = reason === "STAFF" || reason === "COURTESY";
  if (approvalStatus === "AUTO") {
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
  }

  AuditService.logInventoryAction({
    companyId: auth.tenantId,
    branchId: effectiveBranchId,
    action: "CREATE",
    entityType: "WASTE",
    entityId: waste.id,
    newValue: { itemId, quantity: qty, unit, reason, notes, approvalStatus },
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
