import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '@/lib/api/error';
import { branches, leaveBalances, leaveTypes, users } from '@/lib/db/schema';
import { withCompanyContext } from '@/lib/db/tenant-context';
import { hasPermission, type Role } from '@/lib/permissions';
import { resolveResourceScope, targetInScope } from '@/lib/rbac/resource-scope';
import { AuditService } from './audit-service';

type Actor = { userId: string; companyId: string };
type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
const days = z.number().int().min(0).max(2147483647);
const year = z.number().int().min(2000).max(2100);
const reason = z.string().trim().min(4).max(1000);
const userId = z.string().trim().min(1).max(255);
export const entitlementSchema = z.object({
  userId: userId.optional(), leaveTypeId: z.string().uuid(), year, totalEntitlement: days, reason,
  // Payload legacy: se contrasta con la base; nunca se escribe sobre los contadores.
  used: days.optional(), pending: days.optional(), balance: days.optional(),
}).strict();
export const accrualSchema = z.object({
  userIds: z.array(userId).min(1).max(200), leaveTypeId: z.string().uuid(), year, accrualRate: days, reason,
}).strict();
export const balanceQuerySchema = z.object({ userId: userId.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });
type Entitlement = z.infer<typeof entitlementSchema>;

async function loadActor(tx: Tx, actor: Actor) {
  const [row] = await tx.select({ id: users.id, role: users.role, companyId: users.companyId, branchId: users.branchId })
    .from(users).where(and(eq(users.id, actor.userId), eq(users.companyId, actor.companyId), isNull(users.deletedAt))).for('share');
  if (!row) throw ApiError.forbidden('La cuenta ya no tiene acceso a esta empresa.');
  return row;
}

/** Consulta por identidad y alcance reales; nunca confía en el rol del payload. */
export async function getLeaveBalances(actor: Actor, query: z.infer<typeof balanceQuerySchema>) {
  return withCompanyContext({ companyId: actor.companyId, actorId: actor.userId }, async tx => {
    const current = await loadActor(tx, actor);
    const catalog = await tx.select({ id: branches.id, companyId: branches.companyId }).from(branches).where(eq(branches.companyId, actor.companyId));
    const scope = resolveResourceScope({ userId: current.id, role: current.role as Role, companyId: current.companyId, branchId: current.branchId }, 'users', 'read', catalog);
    if (scope.kind === 'NONE') throw ApiError.forbidden('No hay un alcance de consulta autorizado.');
    const targetId = query.userId ?? actor.userId;
    const [target] = await tx.select({ userId: users.id, companyId: users.companyId, branchId: users.branchId }).from(users)
      .where(and(eq(users.id, targetId), eq(users.companyId, actor.companyId), isNull(users.deletedAt))).for('share');
    if (!target || !targetInScope(scope, target)) throw ApiError.notFound('No se encontró el colaborador.');
    return tx.select({
      id: leaveBalances.id, userId: leaveBalances.userId, leaveTypeId: leaveBalances.leaveTypeId,
      year: leaveBalances.year, totalEntitlement: leaveBalances.totalEntitlement, used: leaveBalances.used,
      pending: leaveBalances.pending, balance: leaveBalances.balance, updatedAt: leaveBalances.updatedAt,
      leaveTypeName: leaveTypes.name, leaveTypeDescription: leaveTypes.description, isPaid: leaveTypes.isPaid,
    }).from(leaveBalances).innerJoin(leaveTypes, and(eq(leaveBalances.leaveTypeId, leaveTypes.id), eq(leaveTypes.companyId, actor.companyId)))
      .where(and(eq(leaveBalances.userId, targetId), query.year === undefined ? undefined : eq(leaveBalances.year, query.year)));
  });
}

async function assignInTransaction(tx: Tx, actor: Actor, input: Entitlement & { userId: string }) {
  const existingRows = await tx.select().from(leaveBalances).where(and(
    eq(leaveBalances.userId, input.userId), eq(leaveBalances.leaveTypeId, input.leaveTypeId), eq(leaveBalances.year, input.year),
  )).for('update');
  if (existingRows.length > 1) throw ApiError.conflict('Hay saldos duplicados; se requiere revisión antes de asignar derechos.');
  const existing = existingRows[0];
  const used = existing?.used ?? 0, pending = existing?.pending ?? 0;
  const balance = input.totalEntitlement - used - pending;
  if (![used, pending].every(value => Number.isSafeInteger(value) && value >= 0) || balance < 0 ||
    (input.used !== undefined && input.used !== used) || (input.pending !== undefined && input.pending !== pending) ||
    (input.balance !== undefined && input.balance !== balance)) {
    throw ApiError.conflict('La asignación no puede alterar días usados o pendientes ni ser menor al consumo reservado.');
  }
  if (existing && existing.totalEntitlement === input.totalEntitlement && existing.balance === balance) return { balance: existing, created: false, changed: false };
  const values = { totalEntitlement: input.totalEntitlement, balance, updatedAt: new Date() };
  const [saved] = existing
    ? await tx.update(leaveBalances).set(values).where(eq(leaveBalances.id, existing.id)).returning()
    : await tx.insert(leaveBalances).values({ ...values, userId: input.userId, leaveTypeId: input.leaveTypeId, year: input.year, used, pending }).returning();
  const snapshot = (row: typeof saved) => ({ companyId: actor.companyId, userId: row.userId, leaveTypeId: row.leaveTypeId,
    year: row.year, totalEntitlement: row.totalEntitlement, used: row.used, pending: row.pending, balance: row.balance });
  const audit = await AuditService.logCriticalEmployeeAction({
    userId: input.userId, performedBy: actor.userId, entityType: 'LEAVE_ENTITLEMENT', entityId: saved.id,
    action: existing ? 'UPDATE' : 'CREATE', oldValue: existing ? snapshot(existing) : undefined,
    newValue: snapshot(saved), reason: input.reason,
  }, tx);
  if (!audit) throw ApiError.internal('No se pudo registrar la auditoría.');
  return { balance: saved, created: !existing, changed: true };
}

async function assign(actor: Actor, inputs: Array<Entitlement & { userId: string }>) {
  return withCompanyContext({ companyId: actor.companyId, actorId: actor.userId }, async tx => {
    // Orden estable y bloqueo incluso sin fila: dos altas no crean duplicados.
    const sorted = [...inputs].sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
    for (const input of sorted) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.companyId, input.userId, input.leaveTypeId, input.year])}, 0))`);
    const current = await loadActor(tx, actor);
    if (!hasPermission(current.role as Role, 'payroll', 'manage')) throw ApiError.forbidden('Se requiere capacidad administrativa de nómina para asignar derechos.');
    const [type] = await tx.select({ id: leaveTypes.id }).from(leaveTypes)
      .where(and(eq(leaveTypes.id, sorted[0].leaveTypeId), eq(leaveTypes.companyId, actor.companyId), eq(leaveTypes.isActive, true))).for('share');
    if (!type) throw ApiError.notFound('No se encontró el tipo de permiso activo.');
    const targets = await tx.select({ id: users.id }).from(users).where(and(
      inArray(users.id, sorted.map(input => input.userId)), eq(users.companyId, actor.companyId), isNull(users.deletedAt),
    )).orderBy(users.id).for('share');
    if (targets.length !== sorted.length) throw ApiError.notFound('No se encontró un colaborador de la empresa.');
    const results = [];
    for (const input of sorted) results.push(await assignInTransaction(tx, actor, input));
    return results;
  });
}

export async function setLeaveEntitlement(actor: Actor, input: Entitlement) {
  const parsed = entitlementSchema.parse(input);
  return (await assign(actor, [{ ...parsed, userId: parsed.userId ?? actor.userId }]))[0];
}
export async function accrueLeaveEntitlements(actor: Actor, input: z.infer<typeof accrualSchema>) {
  const parsed = accrualSchema.parse(input);
  const results = await assign(actor, [...new Set(parsed.userIds)].map(userId => ({ userId, leaveTypeId: parsed.leaveTypeId,
    year: parsed.year, totalEntitlement: parsed.accrualRate, reason: parsed.reason })));
  return { count: results.length, changed: results.filter(result => result.changed).length };
}
