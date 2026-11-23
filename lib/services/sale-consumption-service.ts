import { db } from "@/lib/db";
import { branches, inventoryBatches, inventoryItems, inventoryMovements, recipeConsumptionPolicies, salesEntries, salesConsumptionIdentities as identities, salesConsumptionRevisions as revisions } from "@/lib/db/schema";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { normalizeSaleConsumptionIdentity, nextSaleConsumptionRevision, soldQuantity, type SaleConsumptionIdentity, type SaleConsumptionMovement, type SaleRecipeSnapshot } from "./sale-consumption-contract";
import { planSaleConsumptionDelta } from "./sale-consumption-delta";
import { buildSaleRecipeSnapshot, saleSnapshotDemand } from "./sale-consumption-snapshot";
import { publishedSaleRecipeReader, saleRecipeReader } from "./sale-consumption-reader";
import { allocateScopedBatches } from "./fefo-allocator";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Head = typeof revisions.$inferSelect;
export interface ApplySaleConsumptionInput extends SaleConsumptionIdentity {
  recipeId: string; quantitySold: string; totalRevenueCents: number | null; userId: string;
  expectedRevision?: number | null;
  /** Solo para cambiar explícitamente la definición de la misma receta; nunca acepta un snapshot del cliente. */
  recipeVersionKey?: string;
}
export class SaleConsumptionError extends Error {
  constructor(public readonly code: "INVALID_INPUT" | "INVALID_SCOPE" | "REVISION_CONFLICT" | "RECIPE_VERSION_CONFLICT" | "PENDING_RECOVERY" | "INSUFFICIENT_STOCK", message: string) { super(message); this.name = "SaleConsumptionError"; }
}
const zero = BigInt(0), maxStock = BigInt("999999999999"), maxSale = BigInt("9999999999"), maxRevenue = BigInt(2147483647);
function ticks(value: string, places = 4) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > places) throw new SaleConsumptionError("PENDING_RECOVERY", "Cantidad persistida inválida");
  const result = BigInt(match[2]) * BigInt(10) ** BigInt(places) + BigInt((match[3] || "").padEnd(places, "0"));
  return match[1] ? -result : result;
}
function decimal(value: bigint, places = 4) {
  const scale = BigInt(10) ** BigInt(places), absolute = value < zero ? -value : value;
  return `${value < zero ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(places, "0")}`;
}
function pending(message: string): never { throw new SaleConsumptionError("PENDING_RECOVERY", message); }
function snapshotPublications(snapshot: SaleRecipeSnapshot | undefined) {
  const recipes = snapshot?.definition.recipes;
  return Array.isArray(recipes) ? recipes.flatMap(recipe => recipe?.publication ? [recipe.publication] : []) : [];
}

async function newSnapshot(tx: Tx, identity: SaleConsumptionIdentity, recipeId: string, head: Head | undefined) {
  // La activación exige preparar 0159/0160 y publicar versiones. No se infiere
  // un modo histórico por ausencia de filas ni se permite opt-out del cliente.
  const mode = process.env.SALES_RECIPE_POLICY_MODE;
  if (mode !== undefined && mode !== 'PUBLISHED') pending('Configuración de políticas de consumo inválida');
  const published = mode === 'PUBLISHED' || snapshotPublications(head?.recipeSnapshot).length > 0;
  try {
    const reader = published ? publishedSaleRecipeReader(tx, identity.saleDay) : saleRecipeReader(tx);
    if (!published) {
      const schema = (await tx.execute<{ installed: boolean }>(sql`SELECT to_regclass('public.recipe_consumption_policies') IS NOT NULL AS installed`)).rows[0];
      const read = reader.recipe;
      // También la transición legacy comparte los locks de publicación. Una
      // venta nueva y una publicación no pueden aprobar fechas incompatibles.
      reader.recipe = async (id, companyId) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recipe-consumption-policy:${companyId}:${id}`}, 0))`);
        if (schema?.installed) {
          const [policy] = await tx.select({ id: recipeConsumptionPolicies.id }).from(recipeConsumptionPolicies)
            .where(and(eq(recipeConsumptionPolicies.companyId, companyId), eq(recipeConsumptionPolicies.recipeId, id))).limit(1);
          if (policy) pending('La receta ya tiene políticas publicadas; habilita su lector antes de registrar otra venta');
        }
        return read(id, companyId);
      };
    }
    return await buildSaleRecipeSnapshot(identity.companyId, recipeId, reader);
  } catch (error) {
    // Conservar errores SQL para reintentar la transacción completa, nunca
    // degradar una política ilegible/incompleta a la ficha mutable.
    if (error && typeof error === 'object' && ('code' in error || 'cause' in error)) throw error;
    pending('No hay una definición de consumo vigente y verificable para esta venta');
  }
}
function validate(input: ApplySaleConsumptionInput) {
  let identity: SaleConsumptionIdentity, quantity: string;
  try { identity = normalizeSaleConsumptionIdentity(input); quantity = soldQuantity(input.quantitySold); }
  catch (error) { throw new SaleConsumptionError("INVALID_INPUT", error instanceof Error ? error.message : "Identidad o cantidad inválida"); }
  if (typeof input.recipeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.recipeId)
    || (input.totalRevenueCents !== null && (!Number.isInteger(input.totalRevenueCents) || input.totalRevenueCents < 0 || input.totalRevenueCents > Number(maxRevenue)))
    || typeof input.userId !== "string" || !input.userId.trim() || input.userId !== input.userId.trim() || input.userId.length > 256
    || (input.expectedRevision != null && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision > 2147483647))
    || (input.recipeVersionKey !== undefined && !/^[a-f0-9]{64}$/.test(input.recipeVersionKey))) throw new SaleConsumptionError("INVALID_INPUT", "Receta, ingreso, actor o versión inválidos");
  return { identity, quantity, recipeId: input.recipeId.toLowerCase() };
}

/** La proyección legada conserva el subtotal conocido; los heads nullable declaran cobertura.
 * Compara TODOS los heads del día antes de cambiar un producto; nunca adopta ventas sin revisión. */
async function projection(tx: Tx, identity: SaleConsumptionIdentity, recipeIds: string[]) {
  const heads = await tx.execute<{ recipeId: string; quantitySold: string; totalRevenue: number | null }>(sql`
    SELECT DISTINCT ON (r.identity_id) r.recipe_id AS "recipeId", r.quantity_sold AS "quantitySold", r.total_revenue AS "totalRevenue"
    FROM sales_consumption_revisions r JOIN sales_consumption_identities i ON i.id=r.identity_id
    WHERE i.company_id=${identity.companyId} AND i.branch_id=${identity.branchId} AND i.sale_day=${identity.saleDay}::date
    ORDER BY r.identity_id, r.revision DESC`);
  const history = await tx.execute<{ recipeId: string }>(sql`SELECT DISTINCT r.recipe_id AS "recipeId"
    FROM sales_consumption_revisions r JOIN sales_consumption_identities i ON i.id=r.identity_id
    WHERE i.company_id=${identity.companyId} AND i.branch_id=${identity.branchId} AND i.sale_day=${identity.saleDay}::date`);
  const totals = new Map(recipeIds.map(id => [id, { quantity: zero, revenue: zero, unknownRevenue: 0 }]));
  for (const row of heads.rows) {
    const total = totals.get(row.recipeId);
    if (!total) continue;
    if (row.totalRevenue === null) total.unknownRevenue++;
    total.quantity += ticks(row.quantitySold, 2); total.revenue += BigInt(row.totalRevenue ?? 0);
  }
  const existing = await tx.select().from(salesEntries).where(and(eq(salesEntries.companyId, identity.companyId),
    eq(salesEntries.branchId, identity.branchId), eq(salesEntries.saleDate, new Date(`${identity.saleDay}T00:00:00Z`)), inArray(salesEntries.recipeId, recipeIds)))
    .orderBy(salesEntries.recipeId).for("update");
  for (const recipeId of recipeIds) {
    const total = totals.get(recipeId)!, actual = existing.find(row => row.recipeId === recipeId);
    const known = history.rows.some(row => row.recipeId === recipeId);
    if ((!known && actual) || (known && !actual) || (actual && (ticks(actual.quantitySold, 2) !== total.quantity || BigInt(actual.totalRevenue) !== total.revenue))) pending("Venta y consumo previo no concuerdan: requiere recuperación con evidencia");
  }
  return totals;
}

/** Prueba la procedencia y el saldo vigente de cada movimiento, no solo la forma del JSON. */
async function checkAllocations(tx: Tx, identity: SaleConsumptionIdentity, identityId: string, head: Head | undefined) {
  const reference = `salecons:${identityId}`;
  const rows = await tx.select({ id: inventoryMovements.id, batchId: inventoryMovements.batchId, itemId: inventoryMovements.itemId,
    type: inventoryMovements.type, quantity: inventoryMovements.quantityChange, reference: inventoryMovements.referenceId, unit: inventoryItems.unit })
    .from(inventoryMovements).innerJoin(inventoryItems, eq(inventoryMovements.itemId, inventoryItems.id))
    .where(and(eq(inventoryMovements.branchId, identity.branchId), eq(inventoryItems.companyId, identity.companyId),
      or(eq(inventoryMovements.referenceId, reference), like(inventoryMovements.referenceId, `${reference}:reverse:%`))));
  // Un saldo neto cero no demuestra el estado histórico sin una revisión aplicada.
  if (!head && rows.length) pending("Movimientos de venta sin revisión: requiere recuperación con evidencia");
  const balances = new Map<string, { row: typeof rows[number]; quantity: bigint }>();
  for (const row of rows.filter(row => row.reference === reference)) {
    const amount = ticks(row.quantity);
    if (row.type !== "USAGE" || !row.batchId || amount >= zero) pending("Movimiento original de venta inválido");
    balances.set(row.id, { row, quantity: -amount });
  }
  for (const row of rows.filter(row => row.reference !== reference)) {
    const original = balances.get(row.reference.slice(`${reference}:reverse:`.length));
    const amount = ticks(row.quantity);
    if (!original || amount <= zero || row.type !== "USAGE" || row.batchId !== original.row.batchId || row.itemId !== original.row.itemId) pending("Devolución sin procedencia válida");
    original.quantity -= amount;
  }
  const allocations = head?.allocations ?? [];
  const live = [...balances.values()].filter(value => value.quantity > zero);
  if (live.length !== allocations.length || [...balances.values()].some(value => value.quantity < zero)) pending("Saldo de asignaciones no reconstruible");
  for (const allocation of allocations) {
    const original = balances.get(allocation.movementId);
    if (!original || original.quantity !== ticks(allocation.remainingQuantity) || original.row.batchId !== allocation.batchId
      || original.row.itemId !== allocation.itemId || original.row.unit !== allocation.unit) pending("Asignación no coincide con su movimiento original");
  }
  if (head) {
    if (head.recipeSnapshot.definition.companyId !== identity.companyId) pending("Snapshot previo sin empresa demostrada");
    let required;
    try { required = saleSnapshotDemand(head.recipeSnapshot, head.quantitySold); } catch { pending("Snapshot previo desconocido: requiere recuperación con evidencia"); }
    const delta = planSaleConsumptionDelta(allocations, required);
    if (delta.consume.length || delta.returns.length) pending("Consumo anterior incompleto: requiere recuperación con evidencia");
  }
}

async function applyRevision(tx: Tx, input: ApplySaleConsumptionInput) {
  const { identity, quantity, recipeId } = validate(input);
  if ((await tx.execute(sql`SELECT current_setting('transaction_isolation') AS isolation`)).rows[0].isolation !== "serializable") throw new SaleConsumptionError("INVALID_INPUT", "La aplicación de venta requiere transacción serializable");
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${identity.companyId}, true), set_config('app.current_branch_id', ${identity.branchId}, true)`);
  // Una proyección pertenece a receta/día, no a un producto: serializar el día
  // completo de la sucursal también coordina dos fuentes y remapeos de receta.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([identity.companyId, identity.branchId, identity.saleDay])}, 0))`);
  const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, identity.branchId), eq(branches.companyId, identity.companyId)));
  if (!branch) throw new SaleConsumptionError("INVALID_SCOPE", "Sucursal fuera de la empresa");
  await tx.insert(identities).values(identity).onConflictDoNothing();
  const [key] = await tx.select().from(identities).where(and(eq(identities.companyId, identity.companyId), eq(identities.branchId, identity.branchId),
    eq(identities.source, identity.source), eq(identities.productKey, identity.productKey), eq(identities.saleDay, identity.saleDay)));
  if (!key) throw new SaleConsumptionError("INVALID_SCOPE", "Identidad de venta no disponible");
  const [head] = await tx.select().from(revisions).where(eq(revisions.identityId, key.id)).orderBy(desc(revisions.revision)).limit(1);
  if (input.expectedRevision !== undefined && input.expectedRevision !== (head?.revision ?? null)) throw new SaleConsumptionError("REVISION_CONFLICT", "La venta ya tiene otra revisión; recarga antes de corregir");
  const recipeIds = [...new Set([recipeId, ...(head ? [head.recipeId] : [])])].sort();
  const totals = await projection(tx, identity, recipeIds);
  await checkAllocations(tx, identity, key.id, head);
  // Corregir cantidad no sustituye la definición histórica por la receta mutable.
  const snapshot = head?.recipeId === recipeId && input.recipeVersionKey === undefined ? head.recipeSnapshot
    : await newSnapshot(tx, identity, recipeId, head);
  if (input.recipeVersionKey !== undefined && input.recipeVersionKey !== snapshot.versionKey) throw new SaleConsumptionError("RECIPE_VERSION_CONFLICT", "La definición de receta cambió; recarga su versión");
  const target = saleSnapshotDemand(snapshot, quantity);
  const finishedItemIds = new Set(
    snapshotPublications(snapshot).flatMap(publication =>
      publication.policy?.mode === 'FINISHED_PRODUCT_ON_SALE' ? [publication.policy.inventoryItemId] : []
    )
  );
  if (head && head.quantitySold === quantity && head.totalRevenue === input.totalRevenueCents && head.recipeId === recipeId && head.recipeSnapshot.versionKey === snapshot.versionKey) return { identityId: key.id, revision: head.revision, applied: false, created: false, movementIds: [] as string[], revenueComplete: [...totals.values()].every(total => total.unknownRevenue === 0) };
  const next = nextSaleConsumptionRevision(head ?? null, quantity);
  const delta = planSaleConsumptionDelta(head?.allocations ?? [], target, !!head && head.recipeSnapshot.versionKey !== snapshot.versionKey);
  const itemIds = [...new Set([...target.map(row => row.itemId), ...(head?.allocations ?? []).map(row => row.itemId)])];
  const locked = itemIds.length ? await tx.select({ id: inventoryBatches.id, itemId: inventoryBatches.itemId, unit: inventoryItems.unit, current: inventoryBatches.currentQuantity })
    .from(inventoryBatches).innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
    .where(and(eq(inventoryBatches.branchId, identity.branchId), eq(inventoryItems.companyId, identity.companyId), inArray(inventoryBatches.itemId, itemIds)))
    .orderBy(inventoryBatches.id).for("update", { of: inventoryBatches }) : [];
  if (locked.some(row => ticks(row.current) < zero)) pending("Lote con saldo negativo previo: requiere recuperación");
  const movementRefs: SaleConsumptionMovement[] = [];
  const allocations = [...delta.retained];
  async function move(itemId: string, batchId: string, unit: string, amount: bigint, original: string | null) {
    if (amount === zero || amount < -maxStock || amount > maxStock) throw new SaleConsumptionError("INVALID_INPUT", "Movimiento físico fuera de rango");
    const batch = locked.find(row => row.id === batchId && row.itemId === itemId && row.unit === unit);
    if (!batch) pending("Lote o unidad original fuera de alcance");
    const updated = await tx.update(inventoryBatches).set({ currentQuantity: sql`${inventoryBatches.currentQuantity} + ${decimal(amount)}`, updatedAt: new Date() })
      .where(and(eq(inventoryBatches.id, batchId), eq(inventoryBatches.branchId, identity.branchId), eq(inventoryBatches.itemId, itemId),
        sql`${inventoryBatches.currentQuantity} + ${decimal(amount)} BETWEEN 0 AND 99999999.9999`)).returning({ id: inventoryBatches.id });
    if (!updated.length) throw new SaleConsumptionError("INSUFFICIENT_STOCK", "Saldo insuficiente o fuera de rango para aplicar la venta completa");
    // INSERT con columnas explícitas: Drizzle enumera también DEFAULT para las
    // columnas omitidas, lo que exigiría conceder INSERT sobre ubicaciones/fecha.
    const movement = (await tx.execute<{ id: string }>(sql`INSERT INTO public.inventory_movements
      (branch_id,item_id,batch_id,type,quantity_change,reference_id,performed_by,reason)
      VALUES (${identity.branchId},${itemId},${batchId},'USAGE',${decimal(amount)},
        ${original ? `salecons:${key.id}:reverse:${original}` : `salecons:${key.id}`},${input.userId},${`Venta revisión ${next.revision}`}) RETURNING id`)).rows[0];
    movementRefs.push({ movementId: movement.id, itemId, batchId, unit, quantityChange: decimal(amount), reversesMovementId: original });
    return movement.id;
  }
  for (const row of delta.returns) await move(row.itemId, row.batchId, row.unit, ticks(row.quantity), row.movementId);
  for (const row of delta.consume.sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)) {
    const isFinishedProduct = finishedItemIds.has(row.itemId);
    const plan = await allocateScopedBatches(tx, {
      companyId: identity.companyId,
      branchId: identity.branchId,
      itemId: row.itemId,
      quantity: row.quantity,
      ...(isFinishedProduct ? { requiredOrigin: 'PRODUCTION' } : {}),
    });
    if (plan.shortfallQuantity > 0) {
      throw new SaleConsumptionError(
        "INSUFFICIENT_STOCK",
        isFinishedProduct
          ? "Stock de lote terminado de producción insuficiente; no se aplicó la revisión"
          : "Stock elegible insuficiente; no se aplicó la revisión"
      );
    }
    for (const allocation of plan.allocations) {
      const amount = allocation.quantity.toFixed(4);
      const movementId = await move(row.itemId, allocation.batchId, row.unit, -ticks(amount), null);
      allocations.push({ itemId: row.itemId, batchId: allocation.batchId, unit: row.unit, movementId, remainingQuantity: amount });
    }
  }
  if (head) { const old = totals.get(head.recipeId)!; old.quantity -= ticks(head.quantitySold, 2); old.revenue -= BigInt(head.totalRevenue ?? 0); if (head.totalRevenue === null) old.unknownRevenue--; }
  const current = totals.get(recipeId)!; current.quantity += ticks(quantity, 2); current.revenue += BigInt(input.totalRevenueCents ?? 0); if (input.totalRevenueCents === null) current.unknownRevenue++;
  for (const [id, total] of totals) {
    if (total.quantity < zero || total.quantity > maxSale || total.revenue < zero || total.revenue > maxRevenue) throw new SaleConsumptionError("INVALID_INPUT", "Total agregado de venta fuera de rango");
    await tx.execute(sql`INSERT INTO public.sales_entries (company_id,branch_id,recipe_id,sale_date,quantity_sold,total_revenue)
      VALUES (${identity.companyId},${identity.branchId},${id},${`${identity.saleDay} 00:00:00`}::timestamp,${decimal(total.quantity, 2)},${Number(total.revenue)})
      ON CONFLICT (company_id,branch_id,sale_date,recipe_id) DO UPDATE
      SET quantity_sold=EXCLUDED.quantity_sold,total_revenue=EXCLUDED.total_revenue,updated_at=now()`);
  }
  await tx.insert(revisions).values({ identityId: key.id, companyId: identity.companyId, branchId: identity.branchId, ...next, totalRevenue: input.totalRevenueCents,
    recipeId, recipeSnapshot: snapshot, allocations, movementRefs, recordedBy: input.userId });
  return { identityId: key.id, revision: next.revision, applied: true, created: !head, movementIds: movementRefs.map(row => row.movementId), revenueComplete: [...totals.values()].every(total => total.unknownRevenue === 0) };
}

/** Unidad atómica propia incluso si el llamador captura el error y conserva su transacción. */
export async function applySaleConsumptionInTransaction(tx: Tx, input: ApplySaleConsumptionInput) {
  validate(input);
  return tx.transaction(revisionTx => applyRevision(revisionTx, input));
}

/** Una conexión y un commit; reintentos de serialización/deadlock nunca separan venta y stock. */
export async function applySaleConsumption(input: ApplySaleConsumptionInput) {
  validate(input);
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(tx => applySaleConsumptionInTransaction(tx, input), { isolationLevel: "serializable" }); }
    catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if (attempt >= 2 || !["40001", "40P01"].includes(failure.cause?.code ?? failure.code)) throw error;
    }
  }
}
