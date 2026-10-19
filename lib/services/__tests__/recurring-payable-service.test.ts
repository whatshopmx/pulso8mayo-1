import { describe, expect, it } from "vitest";
import { periodKeyFor } from "../recurring-payable-service";

describe("periodKeyFor", () => {
    it("mensual y superiores se llavean por el mes YYYY-MM", () => {
        expect(periodKeyFor("2026-02-14", "MONTHLY")).toBe("2026-02");
        expect(periodKeyFor("2026-02-28", "MENSUAL")).toBe("2026-02");
        expect(periodKeyFor("2026-04-01", "QUARTERLY")).toBe("2026-04");
        expect(periodKeyFor("2026-06-10", "ANNUAL")).toBe("2026-06");
    });

    it("sub-mensual se llavea por el día exacto", () => {
        expect(periodKeyFor("2026-02-02", "WEEKLY")).toBe("2026-02-02");
        expect(periodKeyFor("2026-02-02", "BIWEEKLY")).toBe("2026-02-02");
    });

    it("frecuencia desconocida cae a mensual — la normalidad del catálogo", () => {
        expect(periodKeyFor("2026-03-05", "TRIMESTRAL")).toBe("2026-03");
    });
});
