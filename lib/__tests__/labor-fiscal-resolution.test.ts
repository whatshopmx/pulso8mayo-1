import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LaborLawCalendarRule } from "@/lib/db/schema/labor-law-ref";

const state = vi.hoisted(() => ({ rows: [] as LaborLawCalendarRule[], fail: false, cached: null as LaborLawCalendarRule[] | null }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: async () => {
    if (state.fail) throw new Error("private-database-detail");
    return state.rows.map((row) => ({ ...row }));
} }) } }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => Promise<LaborLawCalendarRule[]>) => async () => {
    state.cached ??= await load();
    return state.cached;
} }));

import { resolveFiscalLaborLawRules, resolveLaborLawRules, pickLawRuleForDate } from "@/lib/services/labor-rules-resolver";
import { LABOR_LAW_SEED_RULES } from "@/lib/services/labor-law-seed-data";
import { ApiHandler } from "@/lib/api/response";

function row(from = "2026-02-01", patch: Partial<LaborLawCalendarRule> = {}): LaborLawCalendarRule {
    return { ...LABOR_LAW_SEED_RULES.find((r) => r.effectiveFrom === from)!, id: from, createdAt: null, updatedAt: null, ...patch } as LaborLawCalendarRule;
}
const date = new Date("2026-02-15T12:00:00Z");
beforeEach(() => { state.rows = [row()]; state.cached = null; state.fail = false; });

describe("FIS-02B — datos fiscales exigibles y caché", () => {
    it("el selector conserva la fila completa y rechaza dos vigencias activas", () => {
        const a = row();
        expect(pickLawRuleForDate([a], date)).toBe(a);
        expect(() => pickLawRuleForDate([a, row("2026-01-01", { effectiveTo: "2026-12-31" })], date)).toThrow(/solap|ambigu/i);
    });
    it("la lectura fiscal ve la corrección aunque la lectura general tenga caché anterior", async () => {
        state.rows = [row("2026-02-01", { umaDailyMxn: "113.14" })];
        expect((await resolveLaborLawRules(date)).umaDailyMxn).toBe(113.14);
        state.rows = [row()];
        expect((await resolveLaborLawRules(date)).umaDailyMxn).toBe(113.14);
        expect(await resolveFiscalLaborLawRules(date)).toMatchObject({ source: "law-table", umaDailyMxn: 117.31, minimumWageMxn: 315.04 });
        state.rows = [row("2026-02-01", { umaDailyMxn: null })];
        await expect(resolveFiscalLaborLawRules(date)).rejects.toMatchObject({ statusCode: 409 });
    });
    it("DB vacía permite fallback informativo pero no un cálculo fiscal exigible", async () => {
        state.rows = [];
        expect((await resolveLaborLawRules(date)).source).toBe("static-fallback");
        const error = await resolveFiscalLaborLawRules(date).catch((e: unknown) => e);
        const silence = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const response = ApiHandler.error(error);
            expect(response.status).toBe(409);
            expect((await response.json()).error.message).toMatch(/fiscal|vigente/i);
        } finally { silence.mockRestore(); }
    });
    it.each([null, "0.00", "-1.00", "NaN"])("no trata UMA %s como exención cero", async (uma) => {
        state.rows = [row("2026-02-01", { umaDailyMxn: uma })];
        await expect(resolveFiscalLaborLawRules(date)).rejects.toMatchObject({ statusCode: 409 });
    });
    it("una falla de lectura no inventa valores ni expone detalles de conexión", async () => {
        state.fail = true;
        const error = await resolveFiscalLaborLawRules(date).catch((e: unknown) => e);
        expect(error).toMatchObject({ statusCode: 503 });
        expect(String(error)).not.toContain("private-database-detail");
    });
    it("enero 2027 solo permite la UMA conocida; no inventa mínimo ni UMA desde febrero", async () => {
        state.rows = [row("2027-01-01"), row("2027-02-01")];
        await expect(resolveFiscalLaborLawRules(new Date("2027-01-15"))).rejects.toMatchObject({ statusCode: 409 });
        expect((await resolveFiscalLaborLawRules(new Date("2027-01-15"), ["umaDailyMxn"])).umaDailyMxn).toBe(117.31);
        await expect(resolveFiscalLaborLawRules(new Date("2027-02-01"), ["umaDailyMxn"])).rejects.toMatchObject({ statusCode: 409 });
    });
});
