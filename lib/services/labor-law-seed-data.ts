import type { NewLaborLawCalendarRule } from "@/lib/db/schema/labor-law-ref";

const JORNADA = "https://sidof.segob.gob.mx/notas/docFuente/5786537";
const MINIMUM_2025 = "https://sidof.segob.gob.mx/notas/docFuente/5745678";
const MINIMUM_2026 = "https://sidof.segob.gob.mx/notas/docFuente/5775534";
const UMA_2025 = "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/uma/uma2025.pdf";
const UMA_2026 = "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf";
const previousRegime = {
    maxWeeklyHours: 48, maxDoubleOvertimeHours: 9, maxTripleOvertimeHours: 3,
    maxDailySumHours: 11, maxExtraHoursPerDay: 3, maxExtraDaysPerWeek: 3,
    minRestBetweenShiftsHours: 12, aguinaldoDaysMxn: 15,
};
const currentRegime = {
    ...previousRegime, maxTripleOvertimeHours: 4, maxDailySumHours: 12,
    maxExtraHoursPerDay: 4, maxExtraDaysPerWeek: 4,
};
const monetaryNote = (minimum: string, uma: string) =>
    `Mínimo GENERAL: ${minimum}. UMA: ${uma}. ZLFN requiere resolución por zona; no extrapolar importes fuera de vigencia.`;

/** Referencia global de operador. Pesos decimales únicamente en el borde DB. */
export const LABOR_LAW_SEED_RULES: NewLaborLawCalendarRule[] = [
    {
        ...previousRegime, effectiveFrom: "2020-01-01", effectiveTo: "2024-12-31",
        minimumWageMxn: null, umaDailyMxn: null, sourceDofUrl: null, sourcePublishedOn: null,
        legalNote: "Historial monetario no cargado: bloquear cálculos fiscales exigibles. Topes operativos heredados: triple 3h y descanso 12h no se acreditan aquí como mandatos legales (revisión LEG-03).",
    },
    {
        ...previousRegime, effectiveFrom: "2025-01-01", effectiveTo: "2025-01-31",
        minimumWageMxn: "278.80", umaDailyMxn: null, sourceDofUrl: MINIMUM_2025, sourcePublishedOn: "2024-12-19",
        legalNote: monetaryNote(MINIMUM_2025, "enero 2025 no cargada; no usar la UMA publicada para febrero"),
    },
    {
        ...previousRegime, effectiveFrom: "2025-02-01", effectiveTo: "2025-12-31",
        minimumWageMxn: "278.80", umaDailyMxn: "113.14", sourceDofUrl: UMA_2025, sourcePublishedOn: "2025-01-09",
        legalNote: monetaryNote(MINIMUM_2025, UMA_2025),
    },
    {
        ...previousRegime, effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31",
        minimumWageMxn: "315.04", umaDailyMxn: "113.14", sourceDofUrl: MINIMUM_2026, sourcePublishedOn: "2025-12-09",
        legalNote: monetaryNote(MINIMUM_2026, `${UMA_2025} (también enero 2026)`),
    },
    {
        ...previousRegime, effectiveFrom: "2026-02-01", effectiveTo: "2026-04-30",
        minimumWageMxn: "315.04", umaDailyMxn: "117.31", sourceDofUrl: UMA_2026, sourcePublishedOn: "2026-01-08",
        legalNote: monetaryNote(MINIMUM_2026, UMA_2026),
    },
    {
        ...currentRegime, effectiveFrom: "2026-05-01", effectiveTo: "2026-12-31",
        minimumWageMxn: "315.04", umaDailyMxn: "117.31", sourceDofUrl: JORNADA, sourcePublishedOn: "2026-05-01",
        legalNote: `Decreto de jornada en vigor. ${monetaryNote(MINIMUM_2026, UMA_2026)}`,
    },
    {
        ...currentRegime, effectiveFrom: "2027-01-01", effectiveTo: "2027-01-31", maxWeeklyHours: 46,
        minimumWageMxn: null, umaDailyMxn: "117.31", sourceDofUrl: JORNADA, sourcePublishedOn: "2026-05-01",
        legalNote: `Mínimo 2027 desconocido; UMA anterior vigente en enero: ${UMA_2026}.`,
    },
    {
        ...currentRegime, effectiveFrom: "2027-02-01", effectiveTo: "2027-12-31", maxWeeklyHours: 46,
        minimumWageMxn: null, umaDailyMxn: null, sourceDofUrl: JORNADA, sourcePublishedOn: "2026-05-01",
        legalNote: "Escalón 46h / 9h dobles; mínimo y UMA no publicados en este catálogo.",
    },
    ...[
        { year: 2028, weekly: 44, double: 10 }, { year: 2029, weekly: 42, double: 11 },
        { year: 2030, weekly: 40, double: 12 },
    ].map(({ year, weekly, double }) => ({
        ...currentRegime, effectiveFrom: `${year}-01-01`, effectiveTo: year === 2030 ? null : `${year}-12-31`,
        maxWeeklyHours: weekly, maxDoubleOvertimeHours: double,
        minimumWageMxn: null, umaDailyMxn: null, sourceDofUrl: JORNADA, sourcePublishedOn: "2026-05-01",
        legalNote: `Escalón ${weekly}h / ${double}h dobles. Sin valores monetarios conocidos; no copiar 2026.`,
    })),
];

/** Un estado incoherente revierte la transacción completa del seed. */
export function assertLawCalendarRanges(rows: readonly { effectiveFrom: string; effectiveTo?: string | null }[]): void {
    const ordered = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (!ordered.length) throw new Error("Calendario legal vacío");
    const day = (date: string) => {
        const parsed = new Date(`${date}T12:00:00Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("Fecha de ley inválida");
        return parsed.getTime();
    };
    for (let i = 0; i < ordered.length; i++) {
        const row = ordered[i];
        const from = day(row.effectiveFrom);
        if (row.effectiveTo && day(row.effectiveTo) < from) throw new Error("Vigencia legal invertida");
        if (i) {
            const previous = ordered[i - 1];
            if (!previous.effectiveTo || day(previous.effectiveTo) + 86_400_000 !== from) {
                throw new Error("Calendario legal con huecos o solapamientos; revisar datos antes de corregir");
            }
        }
    }
}
