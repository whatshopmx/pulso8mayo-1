import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { db } from '@/lib/db';
import { configChangeLogs, inventoryItems, recipeConsumptionPolicies, recipeVersions } from '@/lib/db/schema';
import { ApiError } from '@/lib/api/error';
import { hasPermission } from '@/lib/permissions';
import { getRoleScope, type ScopeActor } from '@/lib/rbac/resource-scope';
import { withSalesWriterTransaction } from '@/lib/db/sales-runtime';
import { AuditService } from './audit-service';
import { parseRecipeConsumptionPolicy } from './recipe-consumption-policy';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PolicyRow = typeof recipeConsumptionPolicies.$inferSelect;
const inputSchema = z.object({
  recipeId: z.string(), recipeVersionId: z.string(), effectiveFrom: z.string(),
  mode: z.enum(['INGREDIENTS_ON_SALE', 'FINISHED_PRODUCT_ON_SALE']),
  inventoryItemId: z.string().optional(), unit: z.string().optional(), reason: z.string().trim().min(4).max(1000),
}).strict();
function prepare(actor: ScopeActor, raw: unknown) {
  if (!actor || getRoleScope(actor.role) !== 'COMPANY' || !hasPermission(actor.role, 'inventory', 'manage')
    || !actor.userId || actor.userId !== actor.userId.trim() || actor.userId.length > 256) throw ApiError.forbidden('La publicación requiere administración de inventario a nivel empresa.');
  try {
    const { reason, ...fields } = inputSchema.parse(raw);
    const policy = parseRecipeConsumptionPolicy({ schemaVersion: 1, id: randomUUID(), companyId: actor.companyId, ...fields });
    return { policy, reason, userId: actor.userId };
  } catch { throw ApiError.badRequest('Política de consumo o motivo inválidos.'); }
}
type Prepared = ReturnType<typeof prepare>;
type Outcome = { status: 'PUBLISHED' | 'UNCHANGED'; policy: PolicyRow };
const field = (id: string) => `recipe_consumption_policy:${id}`;

async function apply(tx: Transaction, prepared: Prepared): Promise<Outcome> {
  const isolation = (await tx.execute(sql`SELECT current_setting('transaction_isolation') AS isolation`)).rows[0]?.isolation;
  if (isolation !== 'serializable') throw ApiError.badRequest('La publicación requiere una transacción serializable.');
  // Savepoint completo: también revierte si el caller captura una validación
  // o fallo de auditoría y decide continuar con su transacción exterior.
  return tx.transaction(async scoped => {
    const { policy, reason, userId } = prepared;
    const previousContext = (await scoped.execute<{ company: string | null; branch: string | null }>(sql`
      SELECT current_setting('app.current_company_id', true) AS company, current_setting('app.current_branch_id', true) AS branch`)).rows[0];
    await scoped.execute(sql`SELECT set_config('app.current_company_id', ${policy.companyId}, true), set_config('app.current_branch_id', '', true)`);
    await scoped.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recipe-consumption-policy:${policy.companyId}:${policy.recipeId}`}, 0))`);
    const history = await scoped.select().from(recipeConsumptionPolicies).where(and(
      eq(recipeConsumptionPolicies.companyId, policy.companyId), eq(recipeConsumptionPolicies.recipeId, policy.recipeId)));
    const existing = history.find(row => row.recipeVersionId === policy.recipeVersionId);
    let result: Outcome;
    if (existing) {
      if (existing.effectiveFrom !== policy.effectiveFrom || existing.mode !== policy.mode || existing.reason !== reason
        || existing.publishedBy !== userId || existing.inventoryItemId !== ('inventoryItemId' in policy ? policy.inventoryItemId : null)
        || existing.unit !== ('unit' in policy ? policy.unit : null)) throw ApiError.conflict('La versión ya fue publicada con otra definición.');
      const [audit] = await scoped.select({ id: configChangeLogs.id }).from(configChangeLogs).where(and(
        eq(configChangeLogs.companyId, policy.companyId), eq(configChangeLogs.fieldName, field(existing.id)))).limit(1);
      if (!audit) throw ApiError.conflict('La política existente requiere revisión de su auditoría; no se adoptó automáticamente.');
      result = { status: 'UNCHANGED', policy: existing };
    } else {
      const [version] = await scoped.select({ id: recipeVersions.id }).from(recipeVersions).where(and(
        eq(recipeVersions.id, policy.recipeVersionId), eq(recipeVersions.recipeId, policy.recipeId), eq(recipeVersions.companyId, policy.companyId)));
      if (!version) throw ApiError.notFound('Versión de receta no encontrada.');
      if (policy.mode === 'FINISHED_PRODUCT_ON_SALE') {
        const [item] = await scoped.select({ unit: inventoryItems.unit }).from(inventoryItems).where(and(
          eq(inventoryItems.id, policy.inventoryItemId), eq(inventoryItems.companyId, policy.companyId)));
        if (!item) throw ApiError.notFound('Artículo elaborado no encontrado.');
        if (item.unit !== policy.unit) throw ApiError.badRequest('La unidad declarada no corresponde al artículo elaborado.');
      }
      const last = history.reduce<PolicyRow | null>((head, row) => !head || row.effectiveFrom > head.effectiveFrom ? row : head, null);
      const latestSale = (await scoped.execute<{ day: string | null }>(sql`WITH RECURSIVE affected(id) AS (
        SELECT ${policy.recipeId}::uuid
        UNION
        SELECT line.recipe_id FROM public.recipe_items line
          JOIN public.recipes parent ON parent.id=line.recipe_id AND parent.company_id=${policy.companyId}
          JOIN affected child ON child.id=line.item_id WHERE line.is_sub_recipe=true
      ) SELECT max(day)::text AS day FROM (
        SELECT sale_date::date AS day FROM public.sales_entries
          WHERE company_id=${policy.companyId} AND recipe_id IN (SELECT id FROM affected)
        UNION ALL
        SELECT i.sale_day AS day FROM public.sales_consumption_revisions r
          JOIN public.sales_consumption_identities i ON i.id=r.identity_id AND i.company_id=r.company_id
          WHERE r.company_id=${policy.companyId} AND (r.recipe_id IN (SELECT id FROM affected)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
              WHEN jsonb_typeof(r.recipe_snapshot #> '{definition,recipes}')='array'
              THEN r.recipe_snapshot #> '{definition,recipes}' ELSE '[]'::jsonb END) frozen
              WHERE frozen->>'id'=${policy.recipeId}))
      ) known_sales`)).rows[0]?.day;
      if ((last && policy.effectiveFrom <= last.effectiveFrom) || (latestSale && policy.effectiveFrom <= latestSale)) {
        throw ApiError.conflict('La vigencia debe ser posterior a la última política y a todas las ventas ya registradas.');
      }
      const [created] = await scoped.insert(recipeConsumptionPolicies).values({
        id: policy.id, companyId: policy.companyId, recipeId: policy.recipeId, recipeVersionId: policy.recipeVersionId,
        effectiveFrom: policy.effectiveFrom, mode: policy.mode,
        inventoryItemId: 'inventoryItemId' in policy ? policy.inventoryItemId : null, unit: 'unit' in policy ? policy.unit : null,
        publishedBy: userId, reason,
      }).returning();
      if (!created) throw ApiError.conflict('No se pudo confirmar la publicación.');
      await AuditService.logCriticalConfigChange({ companyId: policy.companyId, performedBy: userId,
        fieldName: field(created.id), oldValue: last ? { policy: last } : null, newValue: { policy: created }, reason }, scoped);
      result = { status: 'PUBLISHED', policy: created };
    }
    await scoped.execute(sql`SELECT set_config('app.current_company_id', ${previousContext?.company ?? ''}, true),
      set_config('app.current_branch_id', ${previousContext?.branch ?? ''}, true)`);
    return result;
  });
}

/** Actor de sesión/job del servidor; nunca se construye desde JSON del cliente. */
export function publishRecipeConsumptionPolicyInTransaction(tx: Transaction, actor: ScopeActor, input: unknown): Promise<Outcome> {
  return apply(tx, prepare(actor, input));
}

/** Runtime configurado falla cerrado. Reintentos acotados sin repetir auditoría. */
export async function publishRecipeConsumptionPolicy(actor: ScopeActor, input: unknown): Promise<Outcome> {
  const prepared = prepare(actor, input);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await withSalesWriterTransaction(tx => apply(tx, prepared)); }
    catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if (!['40001', '40P01', '23505'].includes(failure.cause?.code ?? failure.code ?? '')) throw error;
      if (attempt === 2) throw ApiError.conflict('Otra publicación cambió la receta. Recarga y vuelve a intentarlo.');
    }
  }
  throw ApiError.conflict('No se pudo confirmar la publicación.');
}
