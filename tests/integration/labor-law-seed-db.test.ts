import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { laborLawCalendarRules } from "@/lib/db/schema/labor-law-ref";
import { LABOR_LAW_SEED_RULES, assertLawCalendarRanges } from "@/lib/services/labor-law-seed-data";
import { seedLaborLawRules } from "@/scripts/seed-labor-law-rules";
import { resolveFiscalLaborLawRules } from "@/lib/services/labor-rules-resolver";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Mismo DDL real, ámbito pg_temp de la conexión; nunca escribe el catálogo público. */
async function withLawTable(run: (tx: Tx) => Promise<void>) {
    await db.transaction(async (tx) => {
        await tx.execute(sql`CREATE TEMP TABLE labor_law_calendar_rules
            (LIKE public.labor_law_calendar_rules INCLUDING ALL) ON COMMIT DROP`);
        const { rows } = await tx.execute(sql`SELECT relnamespace::regnamespace::text AS namespace
            FROM pg_class WHERE oid = 'labor_law_calendar_rules'::regclass`);
        expect(rows[0].namespace).toMatch(/^pg_temp_/);
        await run(tx);
    }, { isolationLevel: "repeatable read" });
}

const legacyRules = () => [
    { ...LABOR_LAW_SEED_RULES[0], effectiveTo: "2026-04-30", minimumWageMxn: "248.93" },
    { ...LABOR_LAW_SEED_RULES.find((r) => r.effectiveFrom === "2026-05-01")!, umaDailyMxn: "113.14", minimumWageMxn: "278.80" },
];
const payslipDigest = (tx: Tx) => tx.execute(sql`SELECT md5(coalesce(
    jsonb_agg(to_jsonb(p) ORDER BY id)::text, '[]')) AS digest FROM public.payroll_payslips p`);

describe("FIS-02A — seed contra Postgres aislado", () => {
    it("corrige los intervalos legacy, repite sin duplicar y conserva recibos emitidos", async () => {
        await withLawTable(async (tx) => {
            const publicHistory = (await payslipDigest(tx)).rows;
            // Recibo emitido con el DDL real, también en pg_temp. Así la
            // preservación no depende de que el entorno ya tenga recibos.
            await tx.execute(sql`CREATE TEMP TABLE payroll_payslips
                (LIKE public.payroll_payslips INCLUDING ALL) ON COMMIT DROP`);
            await tx.execute(sql`INSERT INTO payroll_payslips
                (run_id, user_id, aguinaldo_cents, total_percepciones_cents, total_deducciones_cents, cfdi_uuid, cfdi_status)
                VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
                    900000, 900000, 123456, '00000000-0000-4000-8000-000000000003', 'TIMBRADO')`);
            const issued = await tx.execute(sql`SELECT to_jsonb(p) AS receipt FROM payroll_payslips p`);
            const old = await tx.insert(laborLawCalendarRules).values(legacyRules()).returning();
            await seedLaborLawRules(tx);
            const first = await tx.select().from(laborLawCalendarRules).orderBy(laborLawCalendarRules.effectiveFrom);
            expect(first).toHaveLength(11);
            expect(() => assertLawCalendarRanges(first)).not.toThrow();
            for (const row of old) expect(first.find((r) => r.effectiveFrom === row.effectiveFrom)?.id).toBe(row.id);
            expect(first.find((r) => r.effectiveFrom === "2020-01-01")?.effectiveTo).toBe("2024-12-31");
            expect(first.find((r) => r.effectiveFrom === "2026-01-01")).toMatchObject({ minimumWageMxn: "315.04", umaDailyMxn: "113.14" });
            expect(first.find((r) => r.effectiveFrom === "2026-02-01")).toMatchObject({ minimumWageMxn: "315.04", umaDailyMxn: "117.31" });
            await seedLaborLawRules(tx);
            const second = await tx.select().from(laborLawCalendarRules).orderBy(laborLawCalendarRules.effectiveFrom);
            const withoutUpdated = (rows: typeof first) => rows.map((row) => ({ ...row, updatedAt: null }));
            expect(withoutUpdated(second)).toEqual(withoutUpdated(first));
            expect((await payslipDigest(tx)).rows).toEqual(publicHistory);
            expect((await tx.execute(sql`SELECT to_jsonb(p) AS receipt FROM payroll_payslips p`)).rows).toEqual(issued.rows);
        });
    });

    it("una fila ajena superpuesta revierte toda la corrección, sin borrarla", async () => {
        await withLawTable(async (tx) => {
            await tx.insert(laborLawCalendarRules).values([
                ...legacyRules(), { ...LABOR_LAW_SEED_RULES[0], effectiveFrom: "2026-03-15", effectiveTo: "2026-03-16" },
            ]);
            const before = await tx.select().from(laborLawCalendarRules).orderBy(laborLawCalendarRules.effectiveFrom);
            await expect(tx.transaction(seedLaborLawRules)).rejects.toThrow(/huecos o solapamientos/);
            expect(await tx.select().from(laborLawCalendarRules).orderBy(laborLawCalendarRules.effectiveFrom)).toEqual(before);
        });
    });

    it("una tabla vacía recibe solo cifras con vigencia conocida", async () => {
        await withLawTable(async (tx) => {
            await seedLaborLawRules(tx);
            const rows = await tx.select().from(laborLawCalendarRules);
            expect(rows.find((r) => r.effectiveFrom === "2027-01-01")).toMatchObject({ umaDailyMxn: "117.31", minimumWageMxn: null });
            expect(rows.find((r) => r.effectiveFrom === "2027-02-01")).toMatchObject({ umaDailyMxn: null, minimumWageMxn: null });
        });
    });

    it("el cerrojo transaccional impide otra corrección simultánea", async () => {
        await withLawTable(async (tx) => {
            await seedLaborLawRules(tx);
            await db.transaction(async (other) => {
                const { rows } = await other.execute(sql`SELECT pg_try_advisory_xact_lock(20261022, 2) AS acquired`);
                expect(rows[0].acquired).toBe(false);
            });
        });
    });

    it("la lectura fiscal bloquea vacío/desconocido y observa cada corrección sin caché", async () => {
        await withLawTable(async (tx) => {
            const date = new Date("2026-02-15T12:00:00Z");
            await expect(resolveFiscalLaborLawRules(date, ["umaDailyMxn"], tx)).rejects.toMatchObject({ statusCode: 409 });
            await seedLaborLawRules(tx);
            expect((await resolveFiscalLaborLawRules(new Date("2026-01-31"), ["umaDailyMxn"], tx)).umaDailyMxn).toBe(113.14);
            expect((await resolveFiscalLaborLawRules(date, ["umaDailyMxn"], tx)).umaDailyMxn).toBe(117.31);
            await tx.update(laborLawCalendarRules).set({ umaDailyMxn: null }).where(eq(laborLawCalendarRules.effectiveFrom, "2026-02-01"));
            await expect(resolveFiscalLaborLawRules(date, ["umaDailyMxn"], tx)).rejects.toMatchObject({ statusCode: 409 });
            await seedLaborLawRules(tx);
            expect((await resolveFiscalLaborLawRules(date, ["umaDailyMxn"], tx)).umaDailyMxn).toBe(117.31);
            await expect(resolveFiscalLaborLawRules(new Date("2027-02-01"), ["umaDailyMxn"], tx)).rejects.toMatchObject({ statusCode: 409 });
        });
    });
});
