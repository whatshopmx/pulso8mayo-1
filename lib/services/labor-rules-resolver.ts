import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { laborLawCalendarRules, type LaborLawCalendarRule } from "@/lib/db/schema";
import { LaborCalendarRulesService } from "./labor-calendar-rules";

/**
 * Resolución de parámetros laborales en 3 capas (plan
 * plans/2026-correcciones-legales-config-laboral.md Task 2):
 *
 *   (1) LEY      — `laborLawCalendarRules` con vigencia por FECHA
 *                  (seed DOF 1-may-2026). Fallback determinista al
 *                  mapa estático corregido de
 *                  `labor-calendar-rules.ts` si la tabla está vacía
 *                  o la DB falla; el resultado se marca con
 *                  `source: "static-fallback"` para que el consumidor
 *                  sepa que no resolvió contra la tabla seed.
 *   (2) EMPRESA  — override más restrictivo (contrato colectivo):
 *                  sube topes → RECHAZADO, jamás puede ser más laxo
 *                  que la ley (Art. 52 LFT: normas de orden público).
 *   (3) ESTATUS  — reformas pendientes resueltas en
 *                  `lib/company/labor-reform-status-catalog.ts`.
 */

export type LaborRulesSource = "law-table" | "static-fallback";

export interface ResolvedLaborRule {
    source: LaborRulesSource;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    maxWeeklyHours: number;
    maxDoubleOvertimeHours: number;
    maxTripleOvertimeHours: number;
    maxDailySumHours: number;
    maxExtraHoursPerDay: number;
    maxExtraDaysPerWeek: number;
    minRestBetweenShiftsHours: number;
    /** Días de aguinaldo legal por año de servicio (Art. 87 LFT; vigente 15). */
    aguinaldoDaysMxn: number;
    /** UMA diaria vigente (exención 30 UMA del art. 93-XIV LISR; null = no seedeada). */
    umaDailyMxn: number | null;
    minimumWageMxn: number | null;
    sourceDofUrl: string | null;
    sourcePublishedOn: Date | null;
    legalNote: string | null;
}

export interface CompanyLaborOverride {
    branchId?: string | null;
    maxWeeklyHours?: number;
    maxDoubleOvertimeHours?: number;
    maxTripleOvertimeHours?: number;
    maxExtraHoursPerDay?: number;
    maxExtraDaysPerWeek?: number;
}

export interface MergeResult {
    rule: ResolvedLaborRule;
    /** Campos del override rechazados por ser más laxos que la ley. */
    rejectedOverrideFields: string[];
}

export const LABOR_RULES_CACHE_TAG = "labor-law-calendar-rules";

/** Capa 1a — selector puro por fecha (unit-testable, sin DB). */
export function pickLawRuleForDate(
    rows: Pick<LaborLawCalendarRule, "effectiveFrom" | "effectiveTo" | "aguinaldoDaysMxn">[],
    date: Date
): Pick<LaborLawCalendarRule, "effectiveFrom" | "effectiveTo" | "aguinaldoDaysMxn"> | null {
    // Comparaciones por día calendario (las columnas date llegan como
    // "YYYY-MM-DD"); normalizo a UTC mediodía para evitar desfaces de
    // zona horaria en los límites de vigencia.
    const isoDate = new Date(date.toISOString().slice(0, 10) + "T12:00:00Z");
    const candidates = rows
        .filter((r) => {
            const from = new Date(r.effectiveFrom + "T12:00:00Z");
            const to = r.effectiveTo ? new Date(r.effectiveTo + "T12:00:00Z") : null;
            return from <= isoDate && (!to || isoDate <= to);
        })
        .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
    return candidates[0] ?? null;
}

/** Capa 1b — fallback determinista al mapa estático corregido. */
export function staticFallbackRule(date: Date): ResolvedLaborRule {
    const year = date.getFullYear();
    const r = LaborCalendarRulesService.getRulesForYear(year);
    return {
        source: "static-fallback",
        effectiveFrom: new Date(`${year}-01-01T00:00:00Z`),
        effectiveTo: new Date(`${year}-12-31T23:59:59Z`),
        maxWeeklyHours: r.maxWeeklyHours,
        maxDoubleOvertimeHours: r.maxWeeklyDoubleOvertimeHours,
        maxTripleOvertimeHours: r.maxWeeklyTripleOvertimeCap,
        maxDailySumHours: r.maxDailySumHours,
        maxExtraHoursPerDay: r.maxExtraHoursPerDay,
        maxExtraDaysPerWeek: r.maxExtraDaysPerWeek,
        minRestBetweenShiftsHours: r.minRestBetweenShiftsHours,
        // El aguinaldo de 15 días es ley desde la LFT de 1970 (Art. 87):
        // no depende del decreto de jornada, válido en cualquier fallback.
        aguinaldoDaysMxn: 15,
        umaDailyMxn: null,
        minimumWageMxn: null,
        sourceDofUrl: "https://www.dof.gob.mx/nota_detalle.php?codigo=5786537&fecha=01/05/2026",
        sourcePublishedOn: null,
        legalNote:
            "Resuelto desde el mapa estático (fallback) por ausencia/indisponibilidad de labor_law_calendar_rules. Correr scripts/seed-labor-law-rules.ts para la tabla con vigencia de DOF.",
    };
}

/** Mapeo fila→regla resuelta (exportado para tests). */
export function rowToResolved(row: LaborLawCalendarRule): ResolvedLaborRule {
    return {
        source: "law-table",
        effectiveFrom: new Date(row.effectiveFrom + "T00:00:00Z"),
        effectiveTo: row.effectiveTo ? new Date(row.effectiveTo + "T00:00:00Z") : null,
        maxWeeklyHours: row.maxWeeklyHours,
        maxDoubleOvertimeHours: row.maxDoubleOvertimeHours,
        maxTripleOvertimeHours: row.maxTripleOvertimeHours,
        maxDailySumHours: row.maxDailySumHours,
        maxExtraHoursPerDay: row.maxExtraHoursPerDay,
        maxExtraDaysPerWeek: row.maxExtraDaysPerWeek,
        minRestBetweenShiftsHours: row.minRestBetweenShiftsHours,
        aguinaldoDaysMxn: row.aguinaldoDaysMxn,
        umaDailyMxn: row.umaDailyMxn ? Number(row.umaDailyMxn) : null,
        minimumWageMxn: row.minimumWageMxn ? Number(row.minimumWageMxn) : null,
        sourceDofUrl: row.sourceDofUrl,
        sourcePublishedOn: row.sourcePublishedOn ? new Date(row.sourcePublishedOn + "T00:00:00Z") : null,
        legalNote: row.legalNote,
    };
}

const cachedLoader = (dateKey: string) =>
    unstable_cache(
        async () => {
            try {
                return await db.select().from(laborLawCalendarRules);
            } catch {
                return [];
            }
        },
        ["labor-law-calendar-rules", dateKey],
        { revalidate: 300, tags: [LABOR_RULES_CACHE_TAG] },
    );

/**
 * Carga de filas de ley: cache de Next (runtime del server) → DB directa
 * (scripts/tsx, Inngest standalone) → vacío (fallback estático). Sin esto,
 * `unstable_cache` lanza "incrementalCache missing" fuera del servidor Next
 * y el resolver entero se cae aunque la DB esté viva.
 */
async function loadLaborRows(): Promise<LaborLawCalendarRule[]> {
    try {
        return await cachedLoader(new Date().toISOString().slice(0, 10))();
    } catch {
        try {
            return await db.select().from(laborLawCalendarRules);
        } catch {
            return [];
        }
    }
}

/**
 * Capa 1 — ley por fecha efectiva. Cache 5 min (mismo patrón que
 * tenant-config-service). Si la DB falla o no hay fila: fallback estático.
 */
export async function resolveLaborLawRules(date: Date = new Date()): Promise<ResolvedLaborRule> {
    const rows = await loadLaborRows();
    const picked = pickLawRuleForDate(rows, date);
    if (!picked) return staticFallbackRule(date);
    // Releo la fila completa desde el resultado cacheado.
    const full = rows.find((r) => r.effectiveFrom === picked.effectiveFrom);
    return full ? rowToResolved(full) : staticFallbackRule(date);
}

/**
 * Capa 2 — merge con override de empresa. La LFT es norma de orden
 * público: el override automáticamente RECHAZA cualquier campo que
 * relaje un tope bajo la ley. Valores de tope: menor = más restrictivo.
 */
export function mergeCompanyLaborOverride(
    law: ResolvedLaborRule,
    override?: CompanyLaborOverride | null
): MergeResult {
    if (!override) return { rule: law, rejectedOverrideFields: [] };

    const ceilings: Array<{ field: keyof CompanyLaborOverride; lawValue: number }> = [
        { field: "maxWeeklyHours", lawValue: law.maxWeeklyHours },
        { field: "maxDoubleOvertimeHours", lawValue: law.maxDoubleOvertimeHours },
        { field: "maxTripleOvertimeHours", lawValue: law.maxTripleOvertimeHours },
        { field: "maxExtraHoursPerDay", lawValue: law.maxExtraHoursPerDay },
        { field: "maxExtraDaysPerWeek", lawValue: law.maxExtraDaysPerWeek },
    ];
    const rejected: string[] = [];
    const merged: ResolvedLaborRule = { ...law };

    for (const { field, lawValue } of ceilings) {
        const overrideValue = override[field];
        if (typeof overrideValue !== "number") continue;
        if (overrideValue <= lawValue) {
            (merged as any)[field] = overrideValue;
        } else {
            // Override más laxo que la ley: prohibido (norma de orden público).
            rejected.push(field);
        }
    }

    return { rule: merged, rejectedOverrideFields: Array.from(new Set(rejected)) };
}

/** Atajo de las 3 capas para consumidores: ley por fecha + override de empresa. */
export async function resolveLaborRulesForCompany(
    date: Date = new Date(),
    override?: CompanyLaborOverride | null
): Promise<MergeResult> {
    const law = await resolveLaborLawRules(date);
    return mergeCompanyLaborOverride(law, override);
}
