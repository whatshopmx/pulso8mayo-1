import { describe, expect, it } from "vitest";
import {
    buildChain,
    defaultMatrixRules,
    denyApproval,
    matchesRange,
    nextPendingLevel,
    validateMatrixRules,
} from "./approval-matrix-service";

const defaults = defaultMatrixRules();

describe("defaultMatrixRules", () => {
    it("refleja la matriz del doc §4 en centavos", () => {
        expect(defaults).toEqual([
            { amountMin: 0, amountMax: 500000, requiredRole: "GERENTE", minQuotes: 1, sequence: 1 },
            { amountMin: 500001, amountMax: 2500000, requiredRole: "ADMIN", minQuotes: 2, sequence: 2 },
            { amountMin: 2500001, amountMax: 10000000, requiredRole: "OWNER", minQuotes: 3, sequence: 3 },
            { amountMin: 10000001, amountMax: null, requiredRole: "OWNER", minQuotes: 3, sequence: 4 },
        ]);
    });

    it("los rangos son contiguos sin huecos ni traslapes", () => {
        for (let i = 0; i < defaults.length - 1; i++) {
            expect(defaults[i + 1].amountMin).toBe((defaults[i].amountMax ?? 0) + 1);
        }
    });
});

describe("matchesRange / buildChain — montos límite", () => {
    it("$5,000 exacto va SOLO al primer nivel (GERENTE)", () => {
        const chain = buildChain(defaults, 500000);
        expect(chain.map((r) => r.requiredRole)).toEqual(["GERENTE"]);
    });

    it("$5,001 salta al segundo nivel (ADMIN)", () => {
        expect(buildChain(defaults, 500001).map((r) => r.requiredRole)).toEqual(["ADMIN"]);
    });

    it("$25,000 exacto → ADMIN; $25,001 → OWNER", () => {
        expect(buildChain(defaults, 2500000).map((r) => r.sequence)).toEqual([2]);
        expect(buildChain(defaults, 2500001).map((r) => r.sequence)).toEqual([3]);
    });

    it(">$100,000 requiere el nivel final OWNER", () => {
        const chain = buildChain(defaults, 15000000);
        expect(chain.map((r) => r.sequence)).toEqual([4]);
    });

    it("monto sin cobertura por la matriz → cadena vacía (config con hueco)", () => {
        const gapped = [
            { amountMin: 0, amountMax: 100000, requiredRole: "GERENTE", minQuotes: 1, sequence: 1 },
            { amountMin: 200000, amountMax: null, requiredRole: "OWNER", minQuotes: 1, sequence: 2 },
        ];
        expect(buildChain(gapped, 150000)).toEqual([]);
    });

    it("reglas inactivas no participan", () => {
        const rules = [
            { amountMin: 0, amountMax: null, requiredRole: "OWNER", minQuotes: 1, sequence: 1, active: false },
        ];
        expect(buildChain(rules, 100)).toEqual([]);
    });
});

describe("nextPendingLevel", () => {
    it("devuelve el nivel pendiente más bajo", () => {
        expect(
            nextPendingLevel([
                { status: "APPROVED", level: 1 },
                { status: "PENDING", level: 2 },
                { status: "PENDING", level: 3 },
            ]),
        ).toBe(2);
    });

    it("sin pendientes → null", () => {
        expect(nextPendingLevel([{ status: "APPROVED", level: 1 }])).toBeNull();
    });
});

describe("denyApproval — segregación de funciones y orden de niveles", () => {
    const base = {
        requestStatus: "PENDING" as const,
        currentPendingLevel: 2,
        actorId: "user-b",
        requesterId: "user-a",
    };

    it("rol insuficiente → ROLE", () => {
        expect(
            denyApproval({
                ...base,
                requestLevel: 2,
                actorRole: "GERENTE",
                requiredRole: "ADMIN",
            }),
        ).toBe("ROLE");
    });

    it("rol suficiente aprueba su nivel", () => {
        expect(
            denyApproval({
                ...base,
                requestLevel: 2,
                actorRole: "ADMIN",
                requiredRole: "ADMIN",
            }),
        ).toBeNull();
    });

    it("quien creó el documento no puede aprobarlo (SELF)", () => {
        expect(
            denyApproval({
                ...base,
                actorId: "user-a",
                requestLevel: 2,
                actorRole: "OWNER",
                requiredRole: "ADMIN",
            }),
        ).toBe("SELF");
    });

    it("no se puede aprobar un nivel mientras hay niveles previos pendientes", () => {
        expect(
            denyApproval({
                ...base,
                requestLevel: 3,
                currentPendingLevel: 2,
                actorRole: "OWNER",
                requiredRole: "OWNER",
            }),
        ).toBe("NOT_CURRENT_LEVEL");
    });

    it("un request ya resuelto no se re-resuelve", () => {
        expect(
            denyApproval({
                ...base,
                requestStatus: "APPROVED",
                requestLevel: 1,
                currentPendingLevel: null,
                actorRole: "OWNER",
                requiredRole: "GERENTE",
            }),
        ).toBe("NOT_CURRENT_LEVEL");
    });

    it("sin rol conocido se deniega", () => {
        expect(
            denyApproval({ ...base, requestLevel: 2, actorRole: undefined, requiredRole: "GERENTE" }),
        ).toBe("ROLE");
    });
});

describe("validateMatrixRules", () => {
    const base = { requiredRole: "GERENTE", minQuotes: 1, sequence: 1, active: true };

    it("acepta la matriz default (bandas disjuntas contiguas)", () => {
        const result = validateMatrixRules(defaultMatrixRules().map((r) => ({ ...r, active: true })));
        expect(result.ok).toBe(true);
        if (result.ok === false) throw new Error(result.error);
        expect(result.warnings).toHaveLength(0);
    });

    it("acepta matriz acumulativa multi-nivel: traslape total con secuencias distintas", () => {
        const result = validateMatrixRules([
            { ...base, amountMin: 0, amountMax: null, sequence: 1 },
            { requiredRole: "ADMIN", minQuotes: 1, sequence: 2, amountMin: 0, amountMax: null, active: true },
        ]);
        expect(result.ok).toBe(true);
    });

    it("rechaza traslape con MISMA secuencia (orden ambiguo)", () => {
        const result = validateMatrixRules([
            { ...base, amountMin: 0, amountMax: 500000, sequence: 1 },
            { ...base, amountMin: 400000, amountMax: 900000, sequence: 1 },
        ]);
        expect(result.ok === true ? "" : result.error).toMatch(/misma secuencia/);
    });

    it("traslape parcial con secuencias distintas también es válido (apilado por rango)", () => {
        const result = validateMatrixRules([
            { ...base, amountMin: 0, amountMax: 500000, sequence: 1 },
            { requiredRole: "ADMIN", minQuotes: 2, sequence: 2, active: true, amountMin: 250000, amountMax: 2500000 },
        ]);
        expect(result.ok).toBe(true);
    });

    it("el límite inclusivo no es traslape: [0,500] y [501,null] son válidos sin hueco", () => {
        const result = validateMatrixRules([
            { ...base, amountMin: 0, amountMax: 500 },
            { ...base, sequence: 2, amountMin: 501, amountMax: null },
        ]);
        expect(result.ok).toBe(true);
        if (result.ok === false) throw new Error(result.error);
        expect(result.warnings).toHaveLength(0);
    });

    it("marca hueco como advertencia y techo abierto sin regla infinita", () => {
        const result = validateMatrixRules([
            { ...base, amountMin: 0, amountMax: 100000 },
            { ...base, sequence: 2, amountMin: 200000, amountMax: 300000 },
        ]);
        expect(result.ok).toBe(true);
        if (result.ok === false) throw new Error(result.error);
        expect(result.warnings.some((w) => w.includes("Hueco"))).toBe(true);
        expect(result.warnings.some((w) => w.includes("sin cadena"))).toBe(true);
    });

    it("ignora reglas inactivas para traslapes pero advierte si todas inactivas", () => {
        const result = validateMatrixRules([
            { ...base, amountMin: 0, amountMax: 100000, active: false },
            { ...base, amountMin: 0, amountMax: 100000, active: false },
        ]);
        expect(result.ok).toBe(true);
        if (result.ok === false) throw new Error(result.error);
        expect(result.warnings.join(" ")).toMatch(/inactivas/);
    });

    it("rechaza rol desconocido (fail closed)", () => {
        const result = validateMatrixRules([{ ...base, requiredRole: "DUENO", amountMin: 0, amountMax: 100 }]);
        expect(result.ok === true ? "" : result.error).toMatch(/desconocido/);
    });

    it("rechaza max < min y cotizaciones < 1", () => {
        expect(validateMatrixRules([{ ...base, amountMin: 500, amountMax: 100 }]).ok).toBe(false);
        expect(validateMatrixRules([{ ...base, amountMin: 0, amountMax: 100, minQuotes: 0 }]).ok).toBe(false);
    });
});
