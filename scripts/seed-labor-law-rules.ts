/**
 * Corrección idempotente por effectiveFrom (índice único existente).
 * La transacción acota intervalos anteriores y agrega nuevos sin borrar
 * filas ni modificar recibos. Run de operador: pnpm exec tsx scripts/seed-labor-law-rules.ts
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { laborLawCalendarRules } from "@/lib/db/schema/labor-law-ref";
import { sql } from "drizzle-orm";
import { LABOR_LAW_SEED_RULES, assertLawCalendarRanges } from "@/lib/services/labor-law-seed-data";

type LawSeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Exige ejecutor transaccional; serializa correcciones concurrentes. */
export async function seedLaborLawRules(tx: LawSeedTransaction) {
    assertLawCalendarRanges(LABOR_LAW_SEED_RULES);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261022, 2)`);
    for (const rule of LABOR_LAW_SEED_RULES) {
        await tx.insert(laborLawCalendarRules).values(rule).onConflictDoUpdate({
            target: laborLawCalendarRules.effectiveFrom,
            set: { ...rule, updatedAt: new Date() },
        });
    }
    const rows = await tx.select().from(laborLawCalendarRules);
    // Una fila ajena superpuesta requiere revisión: no eliminarla a ciegas.
    assertLawCalendarRanges(rows);
    return { rows: rows.length };
}

export async function main() {
    const result = await db.transaction(seedLaborLawRules);
    console.log("Labor law calendar corrected: " + result.rows + " intervals.");
}

const isDirectRun = process.argv[1]?.includes("seed-labor-law-rules");
if (isDirectRun) {
    main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
}
