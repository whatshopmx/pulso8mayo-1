import { getTodayInMx } from '@/lib/cron/imss-deadlines';

/** Período de trabajo seleccionado; no representa el plazo legal de presentación. */
export function getImssBimester(key?: string, now = new Date()) {
    const today = getTodayInMx(now);
    const selected = key ?? `${today.year}-${String(Math.floor((today.month - 1) / 2) * 2 + 1).padStart(2, '0')}`;
    const match = /^(\d{4})-(01|03|05|07|09|11)$/.exec(selected);
    if (!match || Number(match[1]) < 1900 || Number(match[1]) > 9998) throw new Error('Inicio de bimestre inválido');
    const year = Number(match[1]);
    const month = Number(match[2]);
    return { key: selected, start: `${selected}-01`, end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10) };
}

export function validateImssMovementPeriod(date: string, key?: string, now = new Date()) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Fecha de movimiento inválida');
    const window = getImssBimester(key, now);
    if (date < window.start || date > window.end) throw new Error(`La fecha debe estar dentro del bimestre ${window.start} a ${window.end}`);
    return window;
}
