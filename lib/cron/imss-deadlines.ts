/**
 * IMSS Deadlines (pure date logic — no DB/env dependencies)
 *
 * T22 — Alertas IMSS (Grupo Restaurantero, Fase 7)
 *
 * Calcula las fechas límite recurrentes de seguridad social en México:
 * 1. Pago mensual de cuotas obrero-patronales (SUA): día 17 de cada mes.
 * 2. Modificación salarial bimestral (IDSE/SUA): dentro de los primeros
 *    5 días hábiles del mes siguiente al fin de cada bimestre
 *    (enero, marzo, mayo, julio, septiembre, noviembre — LSS Art. 34).
 */

const MX_TIMEZONE = 'America/Mexico_City';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const IMSS_ALERT_WINDOWS_DAYS = [7, 3, 1];
export const SUA_PAYMENT_DAY = 17;
export const BIMONTHLY_MODIFICATION_MONTHS = [1, 3, 5, 7, 9, 11];
export const MODIFICATION_NTH_BUSINESS_DAY = 5;

export interface CivilDate {
    year: number;
    month: number; // 1-12
    day: number;   // 1-31
}

export type ImssDeadlineType = 'SUA_MONTHLY_PAYMENT' | 'BIMONTHLY_SALARY_MODIFICATION';

export interface ImssDeadline {
    type: ImssDeadlineType;
    label: string;
    date: CivilDate;
    daysUntil: number; // negativo si ya pasó
}

function civilToUtcMs(d: CivilDate): number {
    return Date.UTC(d.year, d.month - 1, d.day);
}

/** Fecha civil de hoy en zona horaria de México (independiente del TZ del servidor). */
export function getTodayInMx(now: Date = new Date()): CivilDate {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: MX_TIMEZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).formatToParts(now);

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
}

/** N-ésimo día hábil (lunes a viernes) del mes. Retorna el día del mes (1-31). */
export function nthBusinessDay(year: number, month: number, n: number): number {
    let count = 0;
    let day = 0;
    while (count < n) {
        day++;
        const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    }
    return day;
}

function nextMonth(year: number, month: number): { year: number; month: number } {
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * Fechas límite IMSS próximas relativas a `today`, con los días restantes
 * (0 = vence hoy, negativo = ya venció).
 *
 * Se evalúan el mes actual y el siguiente: una fecha límite a inicios del
 * mes próximo (p. ej. la modificación bimestral, 5° día hábil) puede entrar
 * en la ventana de 7 días al final del mes actual.
 */
export function getImssDeadlines(today: CivilDate): ImssDeadline[] {
    const deadlines: ImssDeadline[] = [];
    const todayMs = civilToUtcMs(today);

    const months = [
        { year: today.year, month: today.month },
        nextMonth(today.year, today.month),
    ];

    for (const { year, month } of months) {
        const suaDate: CivilDate = { year, month, day: SUA_PAYMENT_DAY };
        deadlines.push({
            type: 'SUA_MONTHLY_PAYMENT',
            label: 'Pago mensual de cuotas obrero-patronales (SUA)',
            date: suaDate,
            daysUntil: Math.round((civilToUtcMs(suaDate) - todayMs) / MS_PER_DAY),
        });

        if (BIMONTHLY_MODIFICATION_MONTHS.includes(month)) {
            const modDate: CivilDate = {
                year,
                month,
                day: nthBusinessDay(year, month, MODIFICATION_NTH_BUSINESS_DAY),
            };
            deadlines.push({
                type: 'BIMONTHLY_SALARY_MODIFICATION',
                label: 'Modificación salarial bimestral IMSS (IDSE/SUA)',
                date: modDate,
                daysUntil: Math.round((civilToUtcMs(modDate) - todayMs) / MS_PER_DAY),
            });
        }
    }

    return deadlines;
}

/** Deadlines cuyos días restantes caen en las ventanas de alerta (7, 3, 1). */
export function getDueDeadlines(today: CivilDate): ImssDeadline[] {
    return getImssDeadlines(today).filter((d) => IMSS_ALERT_WINDOWS_DAYS.includes(d.daysUntil));
}

/** "17 de agosto de 2026" (es-MX). */
export function formatDeadlineDate(d: CivilDate): string {
    return new Date(civilToUtcMs(d)).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

/** "1 día" / "3 días" / "7 días". */
export function formatDaysUntil(daysUntil: number): string {
    return `${daysUntil} ${daysUntil === 1 ? 'día' : 'días'}`;
}
