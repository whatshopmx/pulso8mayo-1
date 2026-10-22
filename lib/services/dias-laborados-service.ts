/**
 * Conteo automático de días laborados por empleado y año fiscal (Task 14,
 * decisión Q2 fase 2). Fuente declarada: cruce de turnos COMPLETED + permisos
 * APROBADOS con goce de sueldo. El ajuste manual del admin SIEMPRE prevalece
 * sobre este valor propuesto (semántica de la preview, Task 7).
 *
 * Criterio PROFEDET (Task 2 del plan-aguinaldo): vacaciones, festivos,
 * riesgo de trabajo, maternidad y paternidad SÍ cuentan para el aguinaldo;
 * faltas, permisos sin goce y SL general NO. Aquí esa regla vive en los
 * datos: un permiso cuenta si su `leaveType.isPaid` es true — el admin
 * configura los tipos (SL/permisos sin goce = isPaid false).
 *
 * Union, no suma: un día en vacaciones aprobadas no genera turno COMPLETED,
 * y un día con turno no puede duplicarse por un permiso el mismo día. El
 * calendario devuelto es el ANUAL (1-ene a 31-dic del año fiscal) V la
 * intersección con la vigencia de cada subtarea se hace por rango en SQL.
 *
 * Montos: ninguno. Conteo reproducible y auditable: cada día se puede
 * reconstruir turnos+permisos con las mismas consultas.
 */
import { db } from "@/lib/db";
import { shiftSessions, leaveRequests, leaveTypes, users } from "@/lib/db/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

export type FuenteDias = "TURNOS_Y_PERMISOS" | "SIN_DATOS";

export interface DiasLaboradosConteo {
    userId: string;
    /** Días únicos para el aguinaldo (turnos COMPLETED ∪ permisos pagados). */
    dias: number;
    fuente: FuenteDias;
    contribuciones: {
        /** Días únicos con turno COMPLETED en el año fiscal. */
        turnosCompletados: number;
        /** Días únicos de permisos aprobados con goce (isPaid). */
        permisosPagados: number;
    };
}

export interface ConteoDiasLaborados {
    porUsuario: Record<string, DiasLaboradosConteo>;
    anioFiscal: number;
    fuente: "shift_sessions(COMPLETED) ∪ leave_requests(APPROVED|COMPLETED, isPaid)";
}

// --- Helpers puros (testeables sin DB) -------------------------------------

/** Días calendario inclusivos entre dos fechas ISO, acotadas al año. */
export function diasDelRango(inicioISO: string, finISO: string): number {
    if (inicioISO > finISO) return 0;
    const d = new Date(`${inicioISO}T12:00:00Z`);
    const f = new Date(`${finISO}T12:00:00Z`);
    return Math.round((f.getTime() - d.getTime()) / 86_400_000) + 1;
}

export function unionDays(turnos: number, permisosPagados: number, interseccion: number): number {
    return turnos + permisosPagados - interseccion;
}

function interseccion(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let hit = 0;
    for (const v of a) if (b.has(v)) hit += 1;
    return hit;
}

// --- Consulta ---------------------------------------------------------------

export async function conteoDiasLaboradosAnual(
    companyId: string,
    anioFiscal: number
): Promise<ConteoDiasLaborados> {
    const inicioAno = new Date(`${anioFiscal}-01-01T00:00:00Z`);
    const finAno = new Date(`${anioFiscal}-12-31T23:59:59Z`);

    // 1) Días únicos con turno COMPLETED por usuario (mismo día calendario).
    const turnos = await db
        .select({
            userId: users.id,
            dia: sql<string>`to_char(${shiftSessions.startedAt}, 'YYYY-MM-DD')`,
        })
        .from(shiftSessions)
        .innerJoin(users, eq(users.id, shiftSessions.userId))
        .where(
            and(
                eq(users.companyId, companyId),
                eq(shiftSessions.status, "COMPLETED"),
                gte(shiftSessions.startedAt, inicioAno),
                lte(shiftSessions.startedAt, finAno)
            )
        )
        .groupBy(users.id, sql`to_char(${shiftSessions.startedAt}, 'YYYY-MM-DD')`);

    const turnosPorUsuario = new Map<string, Set<string>>();
    for (const t of turnos) {
        if (!turnosPorUsuario.has(t.userId)) turnosPorUsuario.set(t.userId, new Set());
        turnosPorUsuario.get(t.userId)!.add(t.dia);
    }

    // 2) Permisos aprobados con goce que cruzan el año fiscal.
    const permisos = await db
        .select({
            userId: leaveRequests.userId,
            inicio: leaveRequests.startDate,
            fin: leaveRequests.endDate,
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(
            and(
                eq(leaveRequests.companyId, companyId),
                inArray(leaveRequests.status, ["APPROVED", "COMPLETED"] as const),
                eq(leaveTypes.isPaid, true),
                lte(leaveRequests.startDate, finAno),
                gte(leaveRequests.endDate, inicioAno)
            )
        );

    const permisosPorUsuario = new Map<string, Set<string>>();
    for (const p of permisos) {
        const set = permisosPorUsuario.get(p.userId) ?? new Set<string>();
        const inicioISO = (p.inicio instanceof Date ? p.inicio : new Date(p.inicio)).toISOString().slice(0, 10);
        const finISO = (p.fin instanceof Date ? p.fin : new Date(p.fin)).toISOString().slice(0, 10);
        const yearStart = `${anioFiscal}-01-01`;
        const yearEnd = `${anioFiscal}-12-31`;
        let cursor = inicioISO > yearStart ? inicioISO : yearStart;
        const hasta = finISO < yearEnd ? finISO : yearEnd;
        while (cursor <= hasta) {
            set.add(cursor);
            const d = new Date(`${cursor}T12:00:00Z`);
            d.setUTCDate(d.getUTCDate() + 1);
            cursor = d.toISOString().slice(0, 10);
        }
        permisosPorUsuario.set(p.userId, set);
    }

    // 3) Unión y contribuciones por usuario.
    const ids = new Set<string>([...turnosPorUsuario.keys(), ...permisosPorUsuario.keys()]);
    const porUsuario: Record<string, DiasLaboradosConteo> = {};
    for (const userId of ids) {
        const turnosSet = turnosPorUsuario.get(userId) ?? new Set<string>();
        const permisosSet = permisosPorUsuario.get(userId) ?? new Set<string>();
        const total = unionDays(turnosSet.size, permisosSet.size, interseccion(turnosSet, permisosSet));
        if (total <= 0) continue;
        porUsuario[userId] = {
            userId,
            dias: total,
            fuente: "TURNOS_Y_PERMISOS",
            contribuciones: {
                turnosCompletados: turnosSet.size,
                permisosPagados: permisosSet.size,
            },
        };
    }

    return { porUsuario, anioFiscal, fuente: "shift_sessions(COMPLETED) ∪ leave_requests(APPROVED|COMPLETED, isPaid)" };
}
