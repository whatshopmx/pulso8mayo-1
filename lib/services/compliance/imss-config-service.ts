import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { branches, companies, configChangeLogs, employeeProfiles, users } from '@/lib/db/schema';
import { ApiError } from '@/lib/api/error';
import { isRegistroPatronal } from './imss-registro';
import { IMSS_EXCLUDED_PROFILE_STATUSES, IMSS_REGISTRABLE_ROLES } from './imss-rules';

/**
 * Configuración IMSS de la empresa: modo de operación, responsable y registro
 * patronal por sucursal (`tasks/plan-imss-operacion.md`, Phase 0).
 *
 * El registro patronal siempre fue de la sucursal (`branches.imssRegistroPatronal`)
 * y hasta este plan sólo se capturaba entrando a Organización → Sucursales. Aquí
 * se expone el mismo dato desde el módulo IMSS, con conteo de plantilla para que
 * "2 de 4 configuradas" signifique algo.
 */

/**
 * Phase 0 no tiene `companies.imss_operation_mode` (llega con la migración
 * `0124`, T8). El contrato ya devuelve el campo para que ese cambio altere una
 * sola fuente, no la pantalla. Nunca se infiere obligación IMSS: el default
 * declarado es `POR_CONFIGURAR`.
 */
export type ImssOperationMode = 'POR_CONFIGURAR' | 'INTERNO' | 'DESPACHO_EXTERNO' | 'SIN_OBLIGACION';
export const IMSS_OPERATION_MODE_DEFAULT: ImssOperationMode = 'POR_CONFIGURAR';

export interface ImssBranchConfig {
    id: string;
    name: string;
    imssRegistroPatronal: string | null;
    /** El string existe y cumple SIDEIMSS; guardarlo mal no cuenta como configurado. */
    configured: boolean;
    active: boolean;
    /** Empleados activos registrables (sin `TERMINATED`/`RESIGNED`). */
    employees: number;
}

export interface ImssCompanyConfig {
    mode: ImssOperationMode;
    /** Dato de registro; no alimenta cuotas obrero-patronales. */
    primaRiesgoTrabajo: string | null;
    branches: ImssBranchConfig[];
    configuredCount: number;
}

export interface ImssConfigUpdateInput {
    /**
     * Atajo para una sola sucursal en alcance. Con más de una sucursal se
     * rechaza: aplicar el mismo registro a varias sería inventar centros de
     * trabajo, no capturarlos.
     */
    imssRegistroPatronal?: string | null;
    branchUpdates?: Array<{ branchId: string; imssRegistroPatronal?: string | null }>;
}

interface BranchRow {
    id: string;
    name: string;
    imssRegistroPatronal: string | null;
    active: boolean | null;
}

/**
 * Conteo por sucursal en UNA consulta. Se excluye lo que el módulo IMSS no
 * registra (roles administrativos) y a quien ya salió de la plantilla: sumar
 * terminados haría que "empleados" contradiga las tablas de Altas y Bajas.
 */
async function employeeCounts(companyId: string): Promise<Map<string, number>> {
    const rows = await db
        .select({ branchId: users.branchId, count: sql<number>`count(*)::int` })
        .from(users)
        .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
        .where(and(
            eq(users.companyId, companyId),
            isNull(users.deletedAt),
            eq(users.active, true),
            inArray(users.role, [...IMSS_REGISTRABLE_ROLES]),
            or(
                isNull(employeeProfiles.employeeStatus),
                notInArray(employeeProfiles.employeeStatus, [...IMSS_EXCLUDED_PROFILE_STATUSES]),
            ),
        ))
        .groupBy(users.branchId);

    const counts = new Map<string, number>();
    for (const row of rows) {
        if (row.branchId) counts.set(row.branchId, row.count);
    }
    return counts;
}

export class ImssConfigService {
    /**
     * `branchScope` viene del guard de sesión, nunca del cliente sin validar.
     * Un `GERENTE` ve su sucursal; el resto ve la empresa entera.
     */
    static async getConfig(companyId: string, branchScope?: string): Promise<ImssCompanyConfig> {
        if (!companyId?.trim()) throw ApiError.badRequest('companyId es obligatorio');

        const [company] = await db
            .select({ primaRiesgoTrabajo: companies.imssPrimaRiesgoTrabajo })
            .from(companies)
            .where(eq(companies.id, companyId))
            .limit(1);

        const branchRows: BranchRow[] = await db
            .select({
                id: branches.id,
                name: branches.name,
                imssRegistroPatronal: branches.imssRegistroPatronal,
                active: branches.active,
            })
            .from(branches)
            .where(and(
                eq(branches.companyId, companyId),
                branchScope ? eq(branches.id, branchScope) : undefined,
            ))
            .orderBy(asc(branches.name), asc(branches.id));

        const counts = await employeeCounts(companyId);
        const configBranches: ImssBranchConfig[] = branchRows.map(branch => ({
            id: branch.id,
            name: branch.name,
            imssRegistroPatronal: branch.imssRegistroPatronal ?? null,
            configured: isRegistroPatronal(branch.imssRegistroPatronal),
            active: branch.active !== false,
            employees: counts.get(branch.id) ?? 0,
        }));

        return {
            mode: IMSS_OPERATION_MODE_DEFAULT,
            primaRiesgoTrabajo: company?.primaRiesgoTrabajo ?? null,
            branches: configBranches,
            configuredCount: configBranches.filter(branch => branch.configured).length,
        };
    }

    /**
     * Captura del registro patronal. Cada cambio queda en `config_change_logs`
     * con actor, valor anterior y valor nuevo: es el dato que decide a qué
     * registro se manda cada archivo, y el plan exige poder auditarlo.
     *
     * Los cambios se aplican en una transacción; la auditoría es best-effort
     * (igual que `operating-config`): perder una fila de rastro no debe
     * convertir un guardado correcto en "no se pudo guardar".
     */
    static async updateConfig(
        companyId: string,
        actorId: string,
        input: ImssConfigUpdateInput,
        branchScope?: string,
    ): Promise<{ updated: number; branches: string[] }> {
        if (!companyId?.trim()) throw ApiError.badRequest('companyId es obligatorio');
        if (!actorId?.trim()) throw ApiError.badRequest('actorId es obligatorio');

        const requested = new Map<string, string | null>();
        for (const update of input.branchUpdates ?? []) {
            // El cliente puede repetir una sucursal: el último valor gana, y el
            // mapa evita escribir dos veces la misma fila y auditar un no-cambio.
            requested.set(update.branchId, update.imssRegistroPatronal ?? null);
        }
        if (!requested.size && input.imssRegistroPatronal !== undefined) {
            const targets = await this.resolveSingleBranch(companyId, branchScope);
            requested.set(targets, input.imssRegistroPatronal ?? null);
        }
        if (!requested.size) throw ApiError.badRequest('Indica al menos una sucursal con su registro patronal');

        const ids = [...requested.keys()];
        const existing = await db
            .select({
                id: branches.id,
                name: branches.name,
                imssRegistroPatronal: branches.imssRegistroPatronal,
            })
            .from(branches)
            .where(and(eq(branches.companyId, companyId), inArray(branches.id, ids)));

        if (existing.length !== ids.length) {
            throw ApiError.badRequest('Alguna de las sucursales no pertenece a esta empresa');
        }
        if (branchScope && existing.some(branch => branch.id !== branchScope)) {
            throw ApiError.forbidden('Sólo puedes configurar tu sucursal');
        }

        // Validación de dominio, además del contrato Zod: el servicio también
        // se llama sin pasar por la ruta (y T20 abrirá otra entrada).
        for (const value of requested.values()) {
            if (value !== null && !isRegistroPatronal(value)) {
                throw ApiError.badRequest('Registro patronal: 11 caracteres, primero letra o número y después 10 dígitos');
            }
        }

        const changes: Array<{
            branchId: string;
            branchName: string;
            before: string | null;
            after: string | null;
        }> = [];

        await db.transaction(async tx => {
            for (const branch of existing) {
                const after = requested.get(branch.id) ?? null;
                const before = branch.imssRegistroPatronal ?? null;
                if (before === after) continue;
                await tx.update(branches).set({ imssRegistroPatronal: after })
                    .where(and(eq(branches.id, branch.id), eq(branches.companyId, companyId)));
                changes.push({ branchId: branch.id, branchName: branch.name, before, after });
            }
        });

        await this.recordChanges(companyId, actorId, changes);
        return { updated: changes.length, branches: changes.map(change => change.branchId) };
    }

    /** Una sucursal en alcance, o error: nunca adivinar a cuál se refiere. */
    private static async resolveSingleBranch(companyId: string, branchScope?: string): Promise<string> {
        if (branchScope) return branchScope;
        const rows = await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.companyId, companyId), eq(branches.active, true)))
            .limit(2);
        if (rows.length !== 1) throw ApiError.badRequest('Indica a qué sucursal corresponde el registro patronal');
        return rows[0].id;
    }

    private static async recordChanges(
        companyId: string,
        actorId: string,
        changes: Array<{ branchId: string; branchName: string; before: string | null; after: string | null }>,
    ): Promise<void> {
        if (!changes.length) return;
        try {
            await db.insert(configChangeLogs).values(changes.map(change => ({
                companyId,
                userId: actorId,
                fieldName: 'branches.imssRegistroPatronal',
                oldValue: { branchId: change.branchId, branchName: change.branchName, registroPatronal: change.before },
                newValue: { branchId: change.branchId, branchName: change.branchName, registroPatronal: change.after },
            })));
        } catch (error) {
            console.error('[imss-config] No se pudo registrar el historial de cambios:', error);
        }
    }
}
