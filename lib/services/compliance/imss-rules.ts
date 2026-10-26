/**
 * IMSS — reglas puras de elegibilidad y plazos (sin DB, sin env).
 *
 * Fuente de verdad para responder "¿este empleado ya puede ir en un archivo
 * IDSE?". Corrige los defectos del cálculo inline que vivía en
 * `app/api/imss/altas|bajas/route.ts`:
 *
 *  - H1: el RFC de persona física tiene 13 caracteres (moral: 12). El cálculo
 *    anterior exigía `length === 12`, así que nadie alcanzaba el estado listo.
 *  - H2: "vencido" es un FLAG independiente del estado; antes sobrescribía
 *    `READY` y los vencidos eran los únicos que no se podían seleccionar.
 *  - H11: los plazos se cuentan en días HÁBILES (lun-vie), no de calendario,
 *    que es lo que la UI ya prometía.
 *
 * Reglas transversales del módulo (ver `tasks/plan-imss.md`):
 *  - generar ≠ registrar: `REGISTRADO` solo se alcanza con acuse confirmado.
 *  - nunca inventar salario: sin contrato → falta `SIN_SALARIO_BASE`.
 *
 * Los códigos de bloqueo son los mismos que persiste `imss_movements.blocked_reason`.
 */

import { getTodayInMx } from '@/lib/cron/imss-deadlines';
import { validateCURP, validateNSS, validateRFC } from './imss-parser';

/** Plazo de aviso de alta/baja ante el IMSS, en días hábiles. */
export const IMSS_MOVEMENT_DEADLINE_BUSINESS_DAYS = 5;

/**
 * Roles que se registran ante el IMSS. `ADMIN`/`SUPER_ADMIN` administran Pulso y no
 * se dan de alta; `GERENTE`/`SUPERVISOR` sí son trabajadores con NSS.
 */
export const IMSS_REGISTRABLE_ROLES = ['EMPLEADO', 'GERENTE', 'SUPERVISOR'] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Estados de perfil que NO requieren ALTA: ya salieron de la plantilla. */
export const IMSS_EXCLUDED_PROFILE_STATUSES = ['TERMINATED', 'RESIGNED'] as const;

/** Estados de perfil que SÍ requieren BAJA IMSS. */
export const IMSS_DEREGISTRATION_PROFILE_STATUSES = ['TERMINATED', 'RESIGNED'] as const;

export type ImssEstado = 'SIN_DATOS' | 'LISTO' | 'REGISTRADO';

export type ImssBlockedReason =
    | 'SIN_NSS'
    | 'SIN_CURP'
    | 'SIN_RFC'
    | 'SIN_FECHA_ALTA'
    | 'SIN_FECHA_BAJA'
    | 'SIN_SALARIO_BASE'
    | 'SIN_REGISTRO_PATRONAL';

export interface ImssRuleResult {
    /**
     * `SIN_DATOS` = falta evidencia para armar el movimiento.
     * `LISTO`     = se puede incluir en el archivo.
     * `REGISTRADO`= existe acuse confirmado (o adopción de plantilla histórica).
     */
    state: ImssEstado;
    /** Vencido el plazo. Nunca degrada `state`: un vencido sigue siendo `LISTO`. */
    overdue: boolean;
    /** Días hábiles transcurridos desde la fecha del movimiento (0 si es futura). */
    daysElapsed: number;
    /** Motivos por los que NO puede armarse el movimiento. Vacío = listo. */
    missing: ImssBlockedReason[];
}

export interface ImssResolveOptions {
    /** Hay un movimiento ALTA/BAJA `CONFIRMADO` para este empleado. */
    registered?: boolean;
    /**
     * Exigir salario base de contrato vigente (centavos). Se enciende cuando el
     * consumidor ya resuelve `employeeContracts.baseSalary`; apagado por default
     * para que el cálculo no invente bloqueos que el origen no consultó.
     */
    requireBaseSalary?: boolean;
}

export interface ImssAltaInput {
    nss?: string | null;
    curp?: string | null;
    rfc?: string | null;
    hireDate?: Date | string | null;
    /** Salario base DIARIO del contrato vigente, en centavos. */
    baseSalaryCents?: number | null;
}

export interface ImssBajaInput {
    nss?: string | null;
    curp?: string | null;
    terminationDate?: Date | string | null;
}

/**
 * Fecha civil (UTC medianoche) de "hoy" en zona de México.
 * UTC evita que un servidor en otra zona mueva el conteo de días.
 */
export function todayInMx(now: Date = new Date()): Date {
    const { year, month, day } = getTodayInMx(now);
    return new Date(Date.UTC(year, month - 1, day));
}

/** Normaliza Date | ISO a fecha civil UTC. `null` si no es una fecha válida. */
export function toCivilDate(value: Date | string | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function isBusinessDay(date: Date): boolean {
    const dow = date.getUTCDay();
    return dow !== 0 && dow !== 6;
}

/**
 * Días hábiles (lun-vie) entre dos fechas civiles, contando `to` y NO `from`.
 * Viernes → lunes = 1. Sábado/domingo no cuentan. Fechas futuras → negativo.
 */
export function businessDaysBetween(from: Date, to: Date): number {
    const start = toCivilDate(from);
    const end = toCivilDate(to);
    if (!start || !end) return 0;

    const totalDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
    if (totalDays === 0) return 0;

    const direction = totalDays > 0 ? 1 : -1;
    const steps = Math.abs(totalDays);
    let count = 0;

    for (let i = 1; i <= steps; i++) {
        const cursor = new Date(start.getTime() + direction * i * MS_PER_DAY);
        if (isBusinessDay(cursor)) count++;
    }

    return count * direction;
}

function identityMissing(identity: { nss?: string | null; curp?: string | null; rfc?: string | null }): ImssBlockedReason[] {
    const missing: ImssBlockedReason[] = [];
    if (!identity.nss || !validateNSS(identity.nss.trim())) missing.push('SIN_NSS');
    if (!identity.curp || !validateCURP(identity.curp.trim())) missing.push('SIN_CURP');
    if (!identity.rfc || !validateRFC(identity.rfc.trim())) missing.push('SIN_RFC');
    return missing;
}

function overdueFlag(daysElapsed: number, registered: boolean): boolean {
    return !registered && daysElapsed > IMSS_MOVEMENT_DEADLINE_BUSINESS_DAYS;
}

/**
 * Estado de ALTA (inscripción) de un empleado.
 * Requiere identidad completa (NSS 11, CURP 18, RFC 12 o 13) y fecha de alta.
 */
export function resolveAltaState(
    profile: ImssAltaInput,
    today: Date = todayInMx(),
    options: ImssResolveOptions = {},
): ImssRuleResult {
    const registered = options.registered === true;
    const missing = identityMissing(profile);

    const hireDate = toCivilDate(profile.hireDate);
    if (!hireDate) missing.push('SIN_FECHA_ALTA');

    if (options.requireBaseSalary && !(Number(profile.baseSalaryCents) > 0)) {
        missing.push('SIN_SALARIO_BASE');
    }

    const daysElapsed = hireDate ? Math.max(0, businessDaysBetween(hireDate, today)) : 0;

    return {
        state: registered ? 'REGISTRADO' : missing.length > 0 ? 'SIN_DATOS' : 'LISTO',
        overdue: overdueFlag(daysElapsed, registered),
        daysElapsed,
        missing,
    };
}

/**
 * Estado de BAJA (aviso de baja). El IDSE de baja se arma con NSS + fecha de
 * baja; la CURP se valida solo si llega (no bloquea una baja que ya aconteció).
 */
export function resolveBajaState(
    profile: ImssBajaInput,
    today: Date = todayInMx(),
    options: ImssResolveOptions = {},
): ImssRuleResult {
    const registered = options.registered === true;
    const missing: ImssBlockedReason[] = [];

    if (!profile.nss || !validateNSS(profile.nss.trim())) missing.push('SIN_NSS');
    if (profile.curp && !validateCURP(profile.curp.trim())) missing.push('SIN_CURP');

    const terminationDate = toCivilDate(profile.terminationDate);
    if (!terminationDate) missing.push('SIN_FECHA_BAJA');

    const daysElapsed = terminationDate ? Math.max(0, businessDaysBetween(terminationDate, today)) : 0;

    return {
        state: registered ? 'REGISTRADO' : missing.length > 0 ? 'SIN_DATOS' : 'LISTO',
        overdue: overdueFlag(daysElapsed, registered),
        daysElapsed,
        missing,
    };
}

/** Etiqueta legible para la UI (el por qué del bloqueo, no un guion). */
export const IMSS_BLOCKED_REASON_LABELS: Record<ImssBlockedReason, string> = {
    SIN_NSS: 'Falta NSS (11 dígitos)',
    SIN_CURP: 'Falta CURP (18 caracteres)',
    SIN_RFC: 'Falta RFC (12 o 13 caracteres)',
    SIN_FECHA_ALTA: 'Falta fecha de alta',
    SIN_FECHA_BAJA: 'Falta fecha de baja',
    SIN_SALARIO_BASE: 'Sin contrato vigente con salario base',
    SIN_REGISTRO_PATRONAL: 'Sucursal sin registro patronal IMSS',
};
