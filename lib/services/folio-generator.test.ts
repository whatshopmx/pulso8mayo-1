import { describe, expect, it } from "vitest";
import {
    detectGaps,
    draftFolio,
    formatFolio,
    parseFolio,
} from "./folio-generator";

describe("formatFolio", () => {
    it("sigue el formato TIPO-CODIGO-AÑO-SECUENCIA con padding a 4", () => {
        expect(formatFolio("OC", "CDMX01", 2026, 45)).toBe("OC-CDMX01-2026-0045");
        expect(formatFolio("OS", "gdl02", 2025, 1)).toBe("OS-GDL02-2025-0001");
    });

    it("no trunca secuencias mayores a 9999", () => {
        expect(formatFolio("OC", "MTY01", 2026, 12345)).toBe("OC-MTY01-2026-12345");
    });
});

describe("parseFolio", () => {
    it("parsea folios válidos", () => {
        expect(parseFolio("OS-CDMX01-2026-0045")).toEqual({
            docType: "OS",
            branchCode: "CDMX01",
            year: 2026,
            sequence: 45,
        });
    });

    it("rechaza folios de borrador y formatos ajenos", () => {
        expect(parseFolio(draftFolio())).toBeNull();
        expect(parseFolio("OC-2025-0001")).toBeNull(); // formato legacy sin código
        expect(parseFolio("REQ-CDMX01-2026-0007")).toBeNull();
        expect(parseFolio("")).toBeNull();
        expect(parseFolio("OS-CDMX01-26-0045")).toBeNull(); // año de 2 dígitos
        expect(parseFolio("OS-CDMX01-2026-45")).toBeNull(); // secuencia sin padding
    });

    it("roundtrip parse(format(x)) conserva los datos", () => {
        const folio = formatFolio("OC", "QRO03", 2026, 789);
        expect(parseFolio(folio)).toEqual({
            docType: "OC",
            branchCode: "QRO03",
            year: 2026,
            sequence: 789,
        });
    });
});

describe("draftFolio", () => {
    it("genera placeholders únicos que nunca colisionan con el formato real", () => {
        const a = draftFolio();
        const b = draftFolio();
        expect(a).not.toBe(b);
        expect(a).toMatch(/^DRAFT-[A-Z0-9]{8}$/);
    });
});

describe("detectGaps", () => {
    it("serie completa sin huecos", () => {
        expect(detectGaps([1, 2, 3, 4], 4)).toEqual([]);
    });

    it("detecta hueco intermedio", () => {
        expect(detectGaps([1, 2, 4, 5], 5)).toEqual([3]);
    });

    it("detecta múltiples huecos ordenados", () => {
        expect(detectGaps([2, 5, 7], 8)).toEqual([1, 3, 4, 6, 8]);
    });

    it("serie vacía reporta todo faltante", () => {
        expect(detectGaps([], 3)).toEqual([1, 2, 3]);
    });

    it("ignora secuencias fuera de rango o inválidas", () => {
        expect(detectGaps([0, -1, 99, 1.5, NaN], 2)).toEqual([1, 2]);
    });

    it("duplicados no rompen el cálculo", () => {
        expect(detectGaps([1, 1, 2, 2], 2)).toEqual([]);
    });
});
