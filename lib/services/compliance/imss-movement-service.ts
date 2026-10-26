import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { branches, employeeProfiles, imssFiles, imssMovements, users } from '@/lib/db/schema';
import { ApiError } from '@/lib/api/error';
import { decryptProfileRecords } from '@/lib/security/employee-cipher';
import { AuditService } from '@/lib/services/audit-service';
import type { DbExecutor } from '@/lib/services/fefo-allocator';
import { resolveCurrentContracts, yearsOfService } from './imss-contracts';
import { buildIdseFile, buildSuaFile, calculateSDI, type ImssFileMovement } from './imss-parser';
import { isRegistroPatronal, requireSingleRegistroPatronal } from './imss-registro';
import { deleteFromR2, getFromR2, isR2Configured, uploadToR2 } from '@/lib/storage/r2-client';
import { IMSS_REGISTRABLE_ROLES, resolveAltaState, resolveBajaState, todayInMx } from './imss-rules';
import { getImssBimester, validateImssMovementPeriod } from './imss-period';

type Movement = typeof imssMovements.$inferSelect;
type MovementType = Movement['movementType'];
type AfiliacionState = Partial<Record<MovementType, Movement>>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface GenerateImssFileInput {
    employeeIds: string[];
    movementType: MovementType;
    fechaMovimiento: string;
    layout: 'IDSE' | 'SUA';
    /** Compatibilidad con captura SUA: salario diario en pesos, nunca un default. */
    newSalaries?: Record<string, number>;
    /** Alcance calculado por el guard de sesión, nunca leído del JSON del cliente. */
    branchScope?: string;
    bimestre?: string;
}

function requireContext(companyId: string) {
    if (!companyId?.trim()) throw ApiError.badRequest('companyId es obligatorio');
}

function requireActor(actorId: string) {
    if (!actorId?.trim()) throw ApiError.badRequest('actorId es obligatorio');
}

function civilDate(value: Date | string): string {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw ApiError.badRequest('Fecha inválida: usa YYYY-MM-DD');
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw ApiError.badRequest('Fecha de movimiento inválida');
    return text;
}

async function latest(companyId: string, userIds: string[], executor: DbExecutor) {
    const result = new Map<string, AfiliacionState>(userIds.map(id => [id, {}]));
    if (!userIds.length) return result;
    const rows = await executor.selectDistinctOn([imssMovements.userId, imssMovements.movementType])
        .from(imssMovements).where(and(eq(imssMovements.companyId, companyId), inArray(imssMovements.userId, userIds)))
        .orderBy(imssMovements.userId, imssMovements.movementType, desc(imssMovements.effectiveDate), desc(imssMovements.createdAt), desc(imssMovements.id));
    for (const row of rows) result.get(row.userId)![row.movementType] = row;
    return result;
}

async function profiles(companyId: string, executor: DbExecutor, userIds?: string[]) {
    return decryptProfileRecords(companyId, await executor.select({
        userId: users.id, name: users.name, employeeNumber: employeeProfiles.employeeNumber, position: employeeProfiles.position,
        branchId: users.branchId, branchName: branches.name, active: users.active, role: users.role,
        nss: employeeProfiles.nss, curp: employeeProfiles.curp, rfc: employeeProfiles.rfc,
        hireDate: employeeProfiles.hireDate, terminationDate: employeeProfiles.terminationDate,
        employeeStatus: employeeProfiles.employeeStatus, registroPatronal: branches.imssRegistroPatronal,
    }).from(users)
        .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
        .leftJoin(branches, and(eq(branches.id, users.branchId), eq(branches.companyId, companyId)))
        .where(and(eq(users.companyId, companyId), isNull(users.deletedAt), inArray(users.role, [...IMSS_REGISTRABLE_ROLES]),
            userIds ? inArray(users.id, userIds) : undefined)));
}

async function audit(tx: Transaction, companyId: string, actorId: string, row: Movement, oldStatus: string | null, reason?: string, acuseFolio?: string) {
    await AuditService.logEmployeeAction({ userId: row.userId, performedBy: actorId,
        action: oldStatus === null ? 'CREATE' : 'UPDATE', entityType: 'IMSS_MOVEMENT', entityId: row.id,
        fieldName: 'status', oldValue: { companyId, status: oldStatus },
        newValue: { companyId, status: row.status, fileId: row.fileId, blockedReason: row.blockedReason, acuseFolio },
        reason, isSensitive: true,
    }, tx);
}

export class ImssMovementService {
    static async getSuaCandidates(companyId: string, branchScope?: string, bimestre?: string, fechaMovimiento?: string) {
        requireContext(companyId);
        let window;
        try { window = fechaMovimiento ? validateImssMovementPeriod(fechaMovimiento, bimestre) : getImssBimester(bimestre); }
        catch (error) { throw ApiError.badRequest((error as Error).message); }
        const rows = (await profiles(companyId, db)).filter(row => row.active && !['TERMINATED', 'RESIGNED'].includes(row.employeeStatus!) && (!branchScope || row.branchId === branchScope));
        const today = todayInMx();
        const contracts = await resolveCurrentContracts(companyId, rows.map(row => row.userId), today);
        const states = await latest(companyId, rows.map(row => row.userId), db);
        const candidates = rows.map(row => {
            const contract = contracts.get(row.userId);
            const baseSalaryCents = contract && contract.baseSalaryCents > 0 ? contract.baseSalaryCents : null;
            const blockedReasons: string[] = [...resolveAltaState({ ...row, baseSalaryCents }, today, { requireBaseSalary: true }).missing];
            if (!isRegistroPatronal(row.registroPatronal)) blockedReasons.push('SIN_REGISTRO_PATRONAL');
            const previous = states.get(row.userId)?.MOD_SALARIO;
            const current = fechaMovimiento && previous && previous.effectiveDate >= fechaMovimiento ? previous : undefined;
            if (current?.status === 'EN_ARCHIVO') blockedReasons.push('MOVIMIENTO_EN_ARCHIVO');
            if (current?.status === 'CONFIRMADO') blockedReasons.push('MOVIMIENTO_CONFIRMADO');
            const years = yearsOfService(row.hireDate, today);
            return { userId: row.userId, name: row.name || row.userId, employeeNumber: row.employeeNumber, nss: row.nss,
                branchName: row.branchName, registroPatronal: row.registroPatronal, position: row.position,
                baseSalaryPesos: baseSalaryCents ? baseSalaryCents / 100 : null,
                sdiPesos: baseSalaryCents ? calculateSDI(baseSalaryCents / 100, years) : null,
                contractId: contract?.contractId ?? null, yearsOfService: years, blockedReasons };
        });
        return { candidates, window };
    }

    static async getDashboardSummary(companyId: string, branchScope?: string) {
        requireContext(companyId);
        const rows = (await profiles(companyId, db)).filter(row => !branchScope || row.branchId === branchScope);
        const states = await latest(companyId, rows.map(row => row.userId), db);
        const stats = { totalEmployees: 0, requiredMovements: 0, confirmedMovements: 0, pendingAltas: 0, pendingBajas: 0, overdueAltas: 0, overdueBajas: 0 };
        for (const row of rows) {
            const terminated = ['TERMINATED', 'RESIGNED'].includes(row.employeeStatus!);
            if (!terminated && !row.active) continue;
            const date = terminated ? row.terminationDate : row.hireDate;
            const movement = states.get(row.userId)?.[terminated ? 'BAJA' : 'ALTA'];
            const confirmed = !!date && movement?.status === 'CONFIRMADO' && movement.effectiveDate >= civilDate(date);
            stats.requiredMovements++;
            if (!terminated) stats.totalEmployees++;
            if (confirmed) stats.confirmedMovements++;
            else if (terminated) stats.pendingBajas++;
            else stats.pendingAltas++;
            const rule = terminated ? resolveBajaState(row, todayInMx(), { registered: confirmed }) : resolveAltaState(row, todayInMx(), { registered: confirmed });
            if (rule.overdue) stats[terminated ? 'overdueBajas' : 'overdueAltas']++;
        }
        return { ...stats, complianceRate: stats.requiredMovements ? Math.round(stats.confirmedMovements / stats.requiredMovements * 100) : null };
    }

    static async generateFile(companyId: string, input: GenerateImssFileInput, actorId: string) {
        requireContext(companyId);
        requireActor(actorId);
        const fechaMovimiento = civilDate(input.fechaMovimiento);
        if (input.layout === 'SUA') {
            try { validateImssMovementPeriod(fechaMovimiento, input.bimestre); }
            catch (error) { throw ApiError.badRequest((error as Error).message); }
        }
        if (!['ALTA', 'BAJA', 'MOD_SALARIO'].includes(input.movementType) || !['IDSE', 'SUA'].includes(input.layout)) throw ApiError.badRequest('Movimiento o layout inválido');
        if (input.layout === 'SUA' && input.movementType !== 'MOD_SALARIO') throw ApiError.badRequest('SUA solo admite modificación salarial');
        const ids = [...new Set(input.employeeIds)];
        if (!ids.length || ids.length > 500) throw ApiError.badRequest('Selecciona entre 1 y 500 empleados');
        let cleanupKey: string | null = null;
        try {
            return await db.transaction(async tx => {
                await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.id, ids))).orderBy(users.id).for('update');
                const rows = await profiles(companyId, tx, ids);
                if (rows.length !== ids.length) throw ApiError.badRequest('La selección contiene empleados no disponibles en esta empresa');
                if (input.branchScope && rows.some(row => row.branchId !== input.branchScope)) throw ApiError.forbidden('La selección excede tu sucursal');
                const registroPatronal = requireSingleRegistroPatronal(rows);
                const today = todayInMx();
                const contracts = await resolveCurrentContracts(companyId, ids, today, tx);
                const states = await latest(companyId, ids, tx);
                const excluded: Array<{ userId: string; reason: string }> = [];
                const included: ImssFileMovement[] = [];
                for (const row of rows.sort((a, b) => a.userId.localeCompare(b.userId))) {
                    const terminated = row.employeeStatus === 'TERMINATED' || row.employeeStatus === 'RESIGNED';
                    if (input.movementType === 'BAJA' ? !terminated : terminated || !row.active) {
                        excluded.push({ userId: row.userId, reason: 'ESTADO_LABORAL_INCOMPATIBLE' }); continue;
                    }
                    const contract = contracts.get(row.userId);
                    const baseSalary = contract && contract.baseSalaryCents > 0 ? contract.baseSalaryCents : null;
                    const rule = resolveAltaState({ ...row, baseSalaryCents: baseSalary }, today, { requireBaseSalary: true });
                    const missing = [...rule.missing];
                    if (input.movementType === 'BAJA' && !row.terminationDate) missing.push('SIN_FECHA_BAJA');
                    if (missing.length) { excluded.push({ userId: row.userId, reason: missing[0] }); continue; }
                    const effectiveDate = input.movementType === 'ALTA' ? civilDate(row.hireDate!)
                        : input.movementType === 'BAJA' ? civilDate(row.terminationDate!) : fechaMovimiento;
                    const previous = states.get(row.userId)?.[input.movementType];
                    if (previous && previous.effectiveDate >= effectiveDate && ['CONFIRMADO', 'EN_ARCHIVO'].includes(previous.status)) {
                        throw ApiError.conflict('La selección incluye movimientos ya confirmados o en archivo');
                    }
                    const captured = input.newSalaries?.[row.userId];
                    if (captured !== undefined && (input.movementType !== 'MOD_SALARIO' || !Number.isFinite(captured) || captured <= 0)) throw ApiError.badRequest('Salario capturado inválido');
                    const baseSalaryCents = captured === undefined ? baseSalary! : Math.round(captured * 100);
                    if (!Number.isSafeInteger(baseSalaryCents) || baseSalaryCents > 2147483647) throw ApiError.badRequest('Salario fuera de rango');
                    const sdiCents = Math.round(calculateSDI(baseSalaryCents / 100, yearsOfService(row.hireDate, today)) * 100);
                    if (sdiCents <= 0 || sdiCents > 9999999) throw ApiError.badRequest('SDI fuera del rango del layout');
                    included.push({ userId: row.userId, name: row.name || '', nss: row.nss!.trim(), curp: row.curp!.trim().toUpperCase(), rfc: row.rfc!.trim().toUpperCase(),
                        hireDate: civilDate(row.hireDate!), effectiveDate, baseSalaryCents, sdiCents, movementType: input.movementType });
                }
                if (!included.length) throw ApiError.badRequest('No hay empleados con identidad y contrato vigente completos', { excluded });
                const built = await (input.layout === 'IDSE' ? buildIdseFile : buildSuaFile)(included, { registroPatronal, fechaMovimiento });
                const id = randomUUID();
                const fileName = `${input.layout}_${input.movementType}_${fechaMovimiento.replaceAll('-', '')}.txt`;
                const branchIds = new Set(rows.map(row => row.branchId));
                const [file] = await tx.insert(imssFiles).values({ id, companyId, branchId: branchIds.size === 1 ? rows[0].branchId : null,
                    layout: input.layout, layoutVersion: built.layoutVersion, movementType: input.movementType, fechaMovimiento,
                    fileName, contentSha256: built.sha256, lineCount: built.lineCount, generatedBy: actorId, contentUnavailable: true,
                }).onConflictDoNothing({ target: [imssFiles.companyId, imssFiles.contentSha256] }).returning();
                if (!file) throw ApiError.conflict('Ya existe un archivo con el mismo contenido');
                if (isR2Configured()) {
                    cleanupKey = `companies/${companyId}/imss/${id}/${fileName}`;
                    await uploadToR2(Buffer.from(built.content, 'utf8'), cleanupKey, 'text/plain;charset=utf-8', { companyId, sha256: built.sha256, retentionMonths: '12' });
                    await tx.update(imssFiles).set({ storageKey: cleanupKey, contentUnavailable: false }).where(and(eq(imssFiles.companyId, companyId), eq(imssFiles.id, id)));
                }
                const codes = { ALTA: '08', BAJA: '02', MOD_SALARIO: '07' };
                for (const row of included) {
                    const [movement] = await tx.insert(imssMovements).values({ companyId, userId: row.userId, fileId: id,
                        movementType: row.movementType, movementCode: codes[row.movementType], effectiveDate: row.effectiveDate,
                        registroPatronal, baseSalaryCents: row.baseSalaryCents, sdiCents: row.sdiCents, status: 'EN_ARCHIVO',
                    }).onConflictDoUpdate({ target: [imssMovements.companyId, imssMovements.userId, imssMovements.movementType, imssMovements.effectiveDate],
                        set: { fileId: id, registroPatronal, baseSalaryCents: row.baseSalaryCents, sdiCents: row.sdiCents, status: 'EN_ARCHIVO', blockedReason: null, rejectionReason: null },
                        setWhere: and(eq(imssMovements.companyId, companyId), inArray(imssMovements.status, ['PENDIENTE', 'RECHAZADO'])),
                    }).returning();
                    if (!movement) throw ApiError.conflict('El movimiento ya se incluyó en otro archivo');
                    await audit(tx, companyId, actorId, movement, states.get(row.userId)?.[row.movementType]?.status ?? null, `Archivo ${id}`);
                }
                return { ...built, fileId: id, fileName, excluded, downloadAvailable: isR2Configured() };
            });
        } catch (error) {
            if (cleanupKey) await deleteFromR2(cleanupKey).catch(() => { console.error('[IMSS] No se pudo eliminar un objeto revertido de R2'); });
            throw error;
        }
    }

    static async listFiles(companyId: string, page = 1, pageSize = 25, branchScope?: string) {
        requireContext(companyId);
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw ApiError.badRequest('Paginación inválida');
        const where = and(eq(imssFiles.companyId, companyId), branchScope ? eq(imssFiles.branchId, branchScope) : undefined);
        const files = await db.select({ id: imssFiles.id, layout: imssFiles.layout, layoutVersion: imssFiles.layoutVersion,
            movementType: imssFiles.movementType, fechaMovimiento: imssFiles.fechaMovimiento, fileName: imssFiles.fileName, lineCount: imssFiles.lineCount,
            status: imssFiles.status, acuseFolio: imssFiles.acuseFolio, acuseReceivedAt: imssFiles.acuseReceivedAt, rejectionReason: imssFiles.rejectionReason,
            contentSha256: imssFiles.contentSha256, contentUnavailable: imssFiles.contentUnavailable, storageKey: imssFiles.storageKey, createdAt: imssFiles.createdAt,
        }).from(imssFiles).where(where).orderBy(desc(imssFiles.createdAt), desc(imssFiles.id)).limit(pageSize).offset((page - 1) * pageSize);
        const [count] = await db.select({ total: sql<number>`count(*)::int`,
            idseCount: sql<number>`count(*) FILTER (WHERE ${imssFiles.layout} = 'IDSE')::int`,
            suaCount: sql<number>`count(*) FILTER (WHERE ${imssFiles.layout} = 'SUA')::int`,
            acceptedCount: sql<number>`count(*) FILTER (WHERE ${imssFiles.status} = 'ACEPTADO')::int`,
            rejectedCount: sql<number>`count(*) FILTER (WHERE ${imssFiles.status} = 'RECHAZADO')::int`,
        }).from(imssFiles).where(where);
        return { files: files.map(({ storageKey, ...file }) => ({ ...file,
            downloadAvailable: isR2Configured() && !!storageKey && !file.contentUnavailable && Date.now() - file.createdAt.getTime() < 365 * 86400000,
        })), pagination: { page, pageSize, total: count.total }, stats: { ...count,
            acceptanceRate: count.acceptedCount + count.rejectedCount ? Math.round(count.acceptedCount / (count.acceptedCount + count.rejectedCount) * 100) : null } };
    }

    static async downloadFile(companyId: string, id: string, branchScope?: string) {
        requireContext(companyId);
        const [file] = await db.select().from(imssFiles).where(and(eq(imssFiles.companyId, companyId), eq(imssFiles.id, id), branchScope ? eq(imssFiles.branchId, branchScope) : undefined));
        if (!file) throw ApiError.notFound('Archivo IMSS no encontrado');
        if (!isR2Configured() || !file.storageKey || file.contentUnavailable || Date.now() - file.createdAt.getTime() >= 365 * 86400000) throw new ApiError('Contenido no disponible para descarga', 410);
        if (!file.storageKey.startsWith(`companies/${companyId}/imss/`)) throw ApiError.notFound('Archivo IMSS no encontrado');
        const content = await getFromR2(file.storageKey);
        if (!content) throw new ApiError('Contenido no disponible para descarga', 410);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(content));
        const sha = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        if (sha !== file.contentSha256) throw ApiError.internal('El contenido almacenado no coincide con su hash');
        return { content, fileName: file.fileName };
    }

    /** Borrado privado idempotente; conserva hash y metadatos de la evidencia. */
    static async purgeExpiredFiles(companyId: string, now = new Date(), ids?: string[]) {
        requireContext(companyId);
        if (!isR2Configured() || (ids && !ids.length)) return 0;
        const expired = await db.select({ id: imssFiles.id, storageKey: imssFiles.storageKey }).from(imssFiles).where(and(
            eq(imssFiles.companyId, companyId), lte(imssFiles.createdAt, new Date(now.getTime() - 365 * 86400000)),
            isNotNull(imssFiles.storageKey), ids ? inArray(imssFiles.id, ids) : undefined,
        )).orderBy(imssFiles.createdAt).limit(100);
        for (const file of expired) {
            if (!file.storageKey!.startsWith(`companies/${companyId}/imss/`)) throw ApiError.internal('El objeto IMSS no pertenece a la empresa');
            await deleteFromR2(file.storageKey!);
            await db.update(imssFiles).set({ storageKey: null, contentUnavailable: true }).where(and(eq(imssFiles.companyId, companyId), eq(imssFiles.id, file.id)));
        }
        return expired.length;
    }

    /** Una sola consulta para toda la selección; también admite un solo id. */
    static async getAfiliacionState(companyId: string, userIds: string[] | string) {
        requireContext(companyId);
        return latest(companyId, typeof userIds === 'string' ? [userIds] : userIds, db);
    }

    /** No modifica snapshots en archivo/confirmados ni resetea un rechazo. */
    static async ensurePendingMovements(companyId: string, type: 'ALTA' | 'BAJA', actorId: string) {
        requireContext(companyId);
        requireActor(actorId);
        if (!['ALTA', 'BAJA'].includes(type)) throw ApiError.badRequest('Tipo de movimiento inválido');
        return db.transaction(async tx => {
            // El mismo lock se usa en adopción: no puede confirmar a la vez que
            // este proceso refresca pendientes. Orden estable evita deadlocks.
            await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId),
                inArray(users.role, [...IMSS_REGISTRABLE_ROLES]))).orderBy(users.id).for('update');
            const rows = await profiles(companyId, tx);
            const today = todayInMx();
            const contracts = await resolveCurrentContracts(companyId, rows.map(row => row.userId), today, tx);
            const states = await latest(companyId, rows.map(row => row.userId), tx);
            const existingRows = await tx.select().from(imssMovements).where(and(eq(imssMovements.companyId, companyId), eq(imssMovements.movementType, type)));
            const existingByDate = new Map(existingRows.map(row => [`${row.userId}:${row.effectiveDate}`, row]));
            const movements: Movement[] = [];
            const skipped: Array<{ userId: string; reason: string }> = [];
            for (const row of rows) {
                const terminated = row.employeeStatus === 'TERMINATED' || row.employeeStatus === 'RESIGNED';
                if (type === 'ALTA' ? terminated || !row.active : !terminated) continue;
                const date = type === 'ALTA' ? row.hireDate : row.terminationDate;
                if (!date) { skipped.push({ userId: row.userId, reason: type === 'ALTA' ? 'SIN_FECHA_ALTA' : 'SIN_FECHA_BAJA' }); continue; }
                const effectiveDate = civilDate(date);
                const previous = states.get(row.userId)?.[type];
                if (previous && previous.effectiveDate >= effectiveDate && ['CONFIRMADO', 'EN_ARCHIVO'].includes(previous.status)) continue;
                const contract = contracts.get(row.userId);
                const baseSalaryCents = contract && contract.baseSalaryCents > 0 ? contract.baseSalaryCents : null;
                const rule = type === 'ALTA'
                    ? resolveAltaState({ ...row, baseSalaryCents }, today, { requireBaseSalary: true })
                    : resolveBajaState(row, today);
                const snapshot = {
                    registroPatronal: isRegistroPatronal(row.registroPatronal) ? row.registroPatronal : null,
                    baseSalaryCents,
                    sdiCents: baseSalaryCents ? Math.round(calculateSDI(baseSalaryCents / 100, yearsOfService(row.hireDate, today)) * 100) : null,
                    blockedReason: rule.missing[0] ?? (!isRegistroPatronal(row.registroPatronal) ? 'SIN_REGISTRO_PATRONAL' : null),
                };
                const existing = existingByDate.get(`${row.userId}:${effectiveDate}`);
                if (existing) {
                    if (!['PENDIENTE', 'RECHAZADO'].includes(existing.status)) continue;
                    if (Object.entries(snapshot).every(([key, value]) => existing[key as keyof Movement] === value)) { movements.push(existing); continue; }
                    const [updated] = await tx.update(imssMovements).set(snapshot).where(and(eq(imssMovements.companyId, companyId),
                        eq(imssMovements.id, existing.id), inArray(imssMovements.status, ['PENDIENTE', 'RECHAZADO']))).returning();
                    if (updated) { await audit(tx, companyId, actorId, updated, existing.status, 'Datos de pendiente actualizados'); movements.push(updated); }
                } else {
                    const [created] = await tx.insert(imssMovements).values({ companyId, userId: row.userId, movementType: type,
                        movementCode: type === 'ALTA' ? '08' : '02', effectiveDate, ...snapshot }).onConflictDoNothing().returning();
                    if (created) { await audit(tx, companyId, actorId, created, null); movements.push(created); }
                }
            }
            return { movements, skipped };
        });
    }

    static async confirmFile(companyId: string, fileId: string, input: {
        accepted: boolean; acuseFolio?: string; reason?: string;
    }, actorId: string) {
        requireContext(companyId);
        requireActor(actorId);
        if (typeof input.accepted !== 'boolean' || (input.accepted ? !input.acuseFolio?.trim() : !input.reason?.trim())) {
            throw ApiError.badRequest('Indica folio para aceptar o motivo para rechazar');
        }
        return db.transaction(async tx => {
            const [file] = await tx.select().from(imssFiles).where(and(eq(imssFiles.companyId, companyId), eq(imssFiles.id, fileId))).for('update');
            if (!file) throw ApiError.notFound('Archivo IMSS no encontrado');
            if (!['GENERADO', 'ENVIADO'].includes(file.status)) throw ApiError.conflict('El archivo ya tiene un acuse; no se puede revertir su estado');
            const rows = await tx.select().from(imssMovements).where(and(eq(imssMovements.companyId, companyId), eq(imssMovements.fileId, fileId))).for('update');
            if (!rows.length || rows.length !== file.lineCount || rows.some(row => row.status !== 'EN_ARCHIVO')) {
                throw ApiError.conflict('Los movimientos del archivo no están en un estado confirmable');
            }
            const now = new Date();
            const [updatedFile] = await tx.update(imssFiles).set({ status: input.accepted ? 'ACEPTADO' : 'RECHAZADO',
                acuseFolio: input.acuseFolio?.trim() || null, acuseReceivedAt: now, rejectionReason: input.accepted ? null : input.reason!.trim(),
            }).where(and(eq(imssFiles.companyId, companyId), eq(imssFiles.id, fileId))).returning();
            const updated = await tx.update(imssMovements).set({ status: input.accepted ? 'CONFIRMADO' : 'RECHAZADO',
                confirmedAt: input.accepted ? now : null, rejectionReason: input.accepted ? null : input.reason!.trim(),
            }).where(and(eq(imssMovements.companyId, companyId), eq(imssMovements.fileId, fileId), eq(imssMovements.status, 'EN_ARCHIVO'))).returning();
            for (const row of updated) await audit(tx, companyId, actorId, row, 'EN_ARCHIVO', input.accepted ? `Acuse ${input.acuseFolio!.trim()}` : input.reason, input.acuseFolio?.trim());
            return updatedFile;
        });
    }

    /** Carga histórica explícita. No fabrica archivos: fileId=null, folio
     * MIGRACION y nota obligatoria en la auditoría de cada empleado. */
    static async adoptAsRegistered(companyId: string, input: {
        userIds: string[]; effectiveDate: string; actorId: string; nota: string; branchId: string; dryRun: boolean; expectedUserIds?: string[];
    }) {
        requireContext(companyId);
        requireActor(input.actorId);
        const effectiveDate = civilDate(input.effectiveDate);
        if (!input.nota?.trim() || !input.branchId || !input.userIds?.length || typeof input.dryRun !== 'boolean') {
            throw ApiError.badRequest('Indica empleados, sucursal, nota y dryRun explícito para adoptar la plantilla');
        }
        if (effectiveDate > civilDate(todayInMx())) throw ApiError.badRequest('La adopción histórica no puede tener fecha futura');
        const ids = [...new Set(input.userIds)].sort();
        return db.transaction(async tx => {
            await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.id, ids))).orderBy(users.id).for('update');
            const rows = await profiles(companyId, tx, ids);
            if (rows.length !== ids.length || rows.some(row => row.branchId !== input.branchId || !row.active || ['TERMINATED', 'RESIGNED'].includes(row.employeeStatus!))) {
                throw ApiError.badRequest('Todos los empleados deben pertenecer a la sucursal y plantilla activa de esta empresa');
            }
            const states = await latest(companyId, ids, tx);
            const eligible = rows.filter(row => {
                const previous = states.get(row.userId)?.ALTA;
                if (previous?.status === 'EN_ARCHIVO') throw ApiError.conflict('Hay empleados con un alta en archivo; registra su acuse');
                if (!row.hireDate || effectiveDate < civilDate(row.hireDate)) throw ApiError.badRequest('La adopción requiere fecha de ingreso y no puede precederla');
                if (previous?.status === 'CONFIRMADO' && previous.effectiveDate >= civilDate(row.hireDate)) return false;
                if (previous && previous.effectiveDate > effectiveDate) throw ApiError.conflict('La fecha de adopción no puede preceder al último movimiento de alta');
                return true;
            });
            const result = { adoptedCount: eligible.length, userIds: eligible.map(row => row.userId), dryRun: input.dryRun, acuseFolio: 'MIGRACION' as const };
            if (input.expectedUserIds && JSON.stringify([...result.userIds].sort()) !== JSON.stringify([...input.expectedUserIds].sort())) {
                throw ApiError.conflict('La plantilla cambió; vuelve a previsualizar la adopción');
            }
            if (input.dryRun || !eligible.length) return result;
            for (const row of eligible) {
                const previous = states.get(row.userId)?.ALTA;
                const [movement] = await tx.insert(imssMovements).values({ companyId, userId: row.userId,
                    movementType: 'ALTA', movementCode: '08', effectiveDate, fileId: null, status: 'CONFIRMADO', confirmedAt: new Date(),
                    registroPatronal: row.registroPatronal,
                }).onConflictDoUpdate({ target: [imssMovements.companyId, imssMovements.userId, imssMovements.movementType, imssMovements.effectiveDate],
                    set: { status: 'CONFIRMADO', confirmedAt: new Date(), fileId: null, blockedReason: null, rejectionReason: null },
                    setWhere: and(eq(imssMovements.companyId, companyId), notInArray(imssMovements.status, ['CONFIRMADO', 'EN_ARCHIVO'])),
                }).returning();
                if (!movement) throw ApiError.conflict('El movimiento cambió durante la adopción');
                await audit(tx, companyId, input.actorId, movement, previous?.effectiveDate === effectiveDate ? previous.status : null, `MIGRACION: ${input.nota.trim()}`, 'MIGRACION');
            }
            return result;
        });
    }
}
