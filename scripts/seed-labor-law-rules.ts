/**
 * Seed idempotente de la ley laboral federal (calendario 2026-2030).
 *
 * Origen: decreto DOF 1-may-2026 "reducción de la jornada laboral"
 * (reforma a los Arts. 59, 66, 68, 132 y 994 LFT; reforma constitucional
 * al Art. 123 publicada 3-mar-2026) + salarios mínimos generales publicado
 * por la Comisión Nacional de Salarios Mínimos para 2026.
 *
 * Idempotencia: si la fila con la misma `effectiveFrom`+`effectiveTo`
 * existe, se ACTUALIZA (corrección) en vez de duplicar. Correr 2x produce
 * el mismo estado. Nada se borra: las filas pasadas de vigencia
 * preservan el histórico para validar fechas retroactivas.
 *
 * Run: npx tsx scripts/seed-labor-law-rules.ts
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { laborLawCalendarRules } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const DOF_JORNADA_URL = "https://www.dof.gob.mx/nota_detalle.php?codigo=5786537&fecha=01/05/2026";

interface SeedRule {
    effectiveFrom: string; // ISO date inclusive
    effectiveTo: string | null; // ISO date inclusive, null = abierto
    maxWeeklyHours: number;
    maxDoubleOvertimeHours: number;
    maxTripleOvertimeHours: number;
    maxDailySumHours: number;
    maxExtraHoursPerDay: number;
    maxExtraDaysPerWeek: number;
    minRestBetweenShiftsHours: number;
    aguinaldoDaysMxn: number;
    minimumWageMxn: string | null;
    sourceDofUrl: string | null;
    sourcePublishedOn: string | null;
    legalNote: string;
}

const SEED_RULES: SeedRule[] = [
    // Vigente desde 1-ene-2020 hasta 30-abr-2026: jornada de 48h y allowance
    // clásico de 9h dobles / 3h triples (Arts. 61/66/68 anteriores).
    {
        effectiveFrom: "2020-01-01",
        effectiveTo: "2026-04-30",
        maxWeeklyHours: 48,
        maxDoubleOvertimeHours: 9,
        maxTripleOvertimeHours: 3,
        maxDailySumHours: 11,
        maxExtraHoursPerDay: 3,
        maxExtraDaysPerWeek: 3,
        minRestBetweenShiftsHours: 12,
        aguinaldoDaysMxn: 15,
        minimumWageMxn: "248.93",
        sourceDofUrl: null,
        sourcePublishedOn: null,
        legalNote: "Régimen anterior a la reforma de jornada (Art. 66 original: extra ≤3h/día, máx 3 días/semana, 9h dobles + 3h triples). Salario mínimo 2025 (248.93).",
    },
    // 1-may-2026 a 31-dic-2026: decreto en vigor (sem 48h) hasta el escalón 2027.
    // Transitorios 2.º/4.º: 48h / 9 dobles / 4 triples, tope suma 12h/día,
    // extras ≤4h/día en máx 4 días.
    {
        effectiveFrom: "2026-05-01",
        effectiveTo: "2026-12-31",
        maxWeeklyHours: 48,
        maxDoubleOvertimeHours: 9,
        maxTripleOvertimeHours: 4,
        maxDailySumHours: 12,
        maxExtraHoursPerDay: 4,
        maxExtraDaysPerWeek: 4,
        minRestBetweenShiftsHours: 12,
        aguinaldoDaysMxn: 15,
        minimumWageMxn: "278.80",
        sourceDofUrl: DOF_JORNADA_URL,
        sourcePublishedOn: "2026-05-01",
        legalNote: "Decreto DOF 1-may-2026 en vigor; calendario del transitorio arranca el 1-ene-2027 con 46h.",
    },
    {
        effectiveFrom: "2027-01-01",
        effectiveTo: "2027-12-31",
        maxWeeklyHours: 46,
        maxDoubleOvertimeHours: 9,
        maxTripleOvertimeHours: 4,
        maxDailySumHours: 12,
        maxExtraHoursPerDay: 4,
        maxExtraDaysPerWeek: 4,
        minRestBetweenShiftsHours: 12,
        aguinaldoDaysMxn: 15,
        minimumWageMxn: null, // anunciar por CONASAMI (dic-2026)
        sourceDofUrl: DOF_JORNADA_URL,
        sourcePublishedOn: "2026-05-01",
        legalNote: "Escalón transitorio 2.º (46h) y 4.º (9h dobles).",
    },
    {
        effectiveFrom: "2028-01-01",
        effectiveTo: "2028-12-31",
        maxWeeklyHours: 44,
        maxDoubleOvertimeHours: 10,
        maxTripleOvertimeHours: 4,
        maxDailySumHours: 12,
        maxExtraHoursPerDay: 4,
        maxExtraDaysPerWeek: 4,
        minRestBetweenShiftsHours: 12,
        aguinaldoDaysMxn: 15,
        minimumWageMxn: null,
        sourceDofUrl: DOF_JORNADA_URL,
        sourcePublishedOn: "2026-05-01",
        legalNote: "Escalón transitorio 2.º (44h) y 4.º (10h dobles).",
    },
    {
        effectiveFrom: "2029-01-01",
        effectiveTo: "2029-12-31",
        maxWeeklyHours: 42,
        maxDoubleOvertimeHours: 11,
        maxTripleOvertimeHours: 4,
        maxDailySumHours: 12,
        maxExtraHoursPerDay: 4,
        maxExtraDaysPerWeek: 4,
        minRestBetweenShiftsHours: 12,
        aguinaldoDaysMxn: 15,
        minimumWageMxn: null,
        sourceDofUrl: DOF_JORNADA_URL,
        sourcePublishedOn: "2026-05-01",
        legalNote: "Escalón transitorio 2.º (42h) y 4.º (11h dobles).",
    },
    {
        effectiveFrom: "2030-01-01",
        effectiveTo: null,
        maxWeeklyHours: 40,
        maxDoubleOvertimeHours: 12,
        maxTripleOvertimeHours: 4,
        maxDailySumHours: 12,
        maxExtraHoursPerDay: 4,
        maxExtraDaysPerWeek: 4,
        minRestBetweenShiftsHours: 12,
        aguinaldoDaysMxn: 15,
        minimumWageMxn: null,
        sourceDofUrl: DOF_JORNADA_URL,
        sourcePublishedOn: "2026-05-01",
        legalNote: "Meta final del transitorio 2.º (40h) y 4.º (12h dobles).",
    },
];

export async function main() {
    console.log("=== Seed labor law calendar rules (LFT 2026-2030) ===");

    for (const rule of SEED_RULES) {
        const existing = await db
            .select()
            .from(laborLawCalendarRules)
            .where(
                rule.effectiveTo === null
                    ? and(
                          eq(laborLawCalendarRules.effectiveFrom, rule.effectiveFrom),
                          isNull(laborLawCalendarRules.effectiveTo),
                      )
                    : and(
                          eq(laborLawCalendarRules.effectiveFrom, rule.effectiveFrom),
                          eq(laborLawCalendarRules.effectiveTo, rule.effectiveTo),
                      ),
            )
            .limit(1);

        if (existing.length > 0) {
            await db
                .update(laborLawCalendarRules)
                // Ley = corrección de fuente; nunca rompemos histórico.
                .set({
                    maxWeeklyHours: rule.maxWeeklyHours,
                    maxDoubleOvertimeHours: rule.maxDoubleOvertimeHours,
                    maxTripleOvertimeHours: rule.maxTripleOvertimeHours,
                    maxDailySumHours: rule.maxDailySumHours,
                    maxExtraHoursPerDay: rule.maxExtraHoursPerDay,
                    maxExtraDaysPerWeek: rule.maxExtraDaysPerWeek,
                    minRestBetweenShiftsHours: rule.minRestBetweenShiftsHours,
                    aguinaldoDaysMxn: rule.aguinaldoDaysMxn,
                    minimumWageMxn: rule.minimumWageMxn,
                    sourceDofUrl: rule.sourceDofUrl,
                    sourcePublishedOn: rule.sourcePublishedOn,
                    legalNote: rule.legalNote,
                    updatedAt: new Date(),
                })
                .where(eq(laborLawCalendarRules.id, existing[0].id));
            console.log(`updated ${rule.effectiveFrom} → ${rule.effectiveTo ?? "open"} (48→${rule.maxWeeklyHours}h)`);
        } else {
            await db.insert(laborLawCalendarRules).values(rule);
            console.log(`inserted ${rule.effectiveFrom} → ${rule.effectiveTo ?? "open"} (48→${rule.maxWeeklyHours}h)`);
        }
    }

    console.log("done");
}

// Ejecución directa (npx tsx scripts/seed-labor-law-rules.ts); cuando un
// seed maestro importa `main` no corre el proceso solo.
const isDirectRun = process.argv[1]?.includes("seed-labor-law-rules");
if (isDirectRun) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
