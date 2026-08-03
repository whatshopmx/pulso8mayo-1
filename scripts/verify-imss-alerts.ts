/**
 * T22 — Verificación de la lógica de alertas IMSS (sin DB/env).
 *
 * Simula fechas cercanas a los límites SUA/bimestrales y confirma que
 * las ventanas de alerta (7, 3, 1 días) disparan correctamente.
 *
 * Run: npx tsx scripts/verify-imss-alerts.ts
 */

import {
    formatDaysUntil,
    formatDeadlineDate,
    getDueDeadlines,
    nthBusinessDay,
    type CivilDate,
} from '../lib/cron/imss-deadlines';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
    if (condition) {
        passed++;
        console.log(`  PASS ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function dueOn(today: CivilDate) {
    return getDueDeadlines(today);
}

console.log('T22 — verify IMSS deadline alerts\n');

// --- Días hábiles ---
console.log('[nthBusinessDay]');
// Sep 2026: Sep 1 = martes → hábiles: 1,2,3,4,7 → 5° = 7
check('sep-2026 5° día hábil = 7', nthBusinessDay(2026, 9, 5) === 7, `got ${nthBusinessDay(2026, 9, 5)}`);
// Mar 2026: Mar 1 = domingo → hábiles: 2,3,4,5,6 → 5° = 6
check('mar-2026 5° día hábil = 6', nthBusinessDay(2026, 3, 5) === 6, `got ${nthBusinessDay(2026, 3, 5)}`);

// --- SUA mensual (día 17) ---
console.log('[SUA mensual]');
{
    const due = dueOn({ year: 2026, month: 8, day: 10 });
    check('2026-08-10 → SUA a 7 días', due.length === 1 && due[0].type === 'SUA_MONTHLY_PAYMENT' && due[0].daysUntil === 7, JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 8, day: 14 });
    check('2026-08-14 → SUA a 3 días', due.some((d) => d.type === 'SUA_MONTHLY_PAYMENT' && d.daysUntil === 3), JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 8, day: 16 });
    check('2026-08-16 → SUA a 1 día', due.some((d) => d.type === 'SUA_MONTHLY_PAYMENT' && d.daysUntil === 1), JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 8, day: 9 });
    check('2026-08-09 → sin alertas (8 días)', due.length === 0, JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 8, day: 17 });
    check('2026-08-17 → sin alertas (vence hoy)', due.length === 0, JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 8, day: 18 });
    check('2026-08-18 → sin alertas (ya venció; sep-17 a 30 días)', due.length === 0, JSON.stringify(due));
}

// --- Modificación salarial bimestral ---
console.log('[Modificación bimestral]');
{
    // Sep-2026 es mes post-bimestre; límite = sep 7 (5° día hábil)
    const due = dueOn({ year: 2026, month: 8, day: 31 });
    check('2026-08-31 → bimestral sep-7 a 7 días (fin de mes)', due.some((d) => d.type === 'BIMONTHLY_SALARY_MODIFICATION' && d.daysUntil === 7), JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 9, day: 4 });
    check('2026-09-04 → bimestral sep-7 a 3 días', due.some((d) => d.type === 'BIMONTHLY_SALARY_MODIFICATION' && d.daysUntil === 3), JSON.stringify(due));
}
{
    const due = dueOn({ year: 2026, month: 9, day: 6 });
    check('2026-09-06 → bimestral sep-7 a 1 día', due.some((d) => d.type === 'BIMONTHLY_SALARY_MODIFICATION' && d.daysUntil === 1), JSON.stringify(due));
}
{
    // Feb-2026 no es mes de modificación; el de marzo (mar-6) aún está a 24 días
    const due = dueOn({ year: 2026, month: 2, day: 10 });
    check('2026-02-10 → solo SUA (sin bimestral)', due.length === 1 && due[0].type === 'SUA_MONTHLY_PAYMENT' && due[0].daysUntil === 7, JSON.stringify(due));
}
{
    // Cambio de año: ene-2027 5° día hábil = ene 7 (ene 1 = viernes → hábiles 1,4,5,6,7)
    const due = dueOn({ year: 2026, month: 12, day: 31 });
    check('2026-12-31 → bimestral ene-7-2027 a 7 días (cruce de año)', due.some((d) => d.type === 'BIMONTHLY_SALARY_MODIFICATION' && d.daysUntil === 7 && d.date.year === 2027 && d.date.month === 1 && d.date.day === 7), JSON.stringify(due));
}

// --- Formato ---
console.log('[formato]');
check('formatDaysUntil(1) = "1 día"', formatDaysUntil(1) === '1 día');
check('formatDaysUntil(7) = "7 días"', formatDaysUntil(7) === '7 días');
check('formatDeadlineDate incluye mes en español', formatDeadlineDate({ year: 2026, month: 8, day: 17 }).includes('agosto'), formatDeadlineDate({ year: 2026, month: 8, day: 17 }));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
