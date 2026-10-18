import { describe, expect, it } from "vitest";
import {
    buildFingerprint,
    detectDelimiter,
    parseAmount,
    parseBankStatementCsv,
    parseDate,
    scoreCandidate,
    splitCsvLine,
} from "../bank-statement-service";

describe("parseAmount", () => {
    it("parsea MX: comas de miles y punto decimal", () => {
        expect(parseAmount("1,234.56")).toBe(123456);
        expect(parseAmount("-1,234.56")).toBe(-123456);
        expect(parseAmount("$45.00")).toBe(4500);
    });

    it("parsea es-ES: punto de miles, coma decimal", () => {
        expect(parseAmount("1.234,56")).toBe(123456);
    });

    it("signo al final y paréntesis contable son negativos", () => {
        expect(parseAmount("1,234.56-")).toBe(-123456);
        expect(parseAmount("(1,234.56)")).toBe(-123456);
    });

    it("coma de miles sin decimales no partía el monto", () => {
        expect(parseAmount("12,345")).toBe(1234500);
    });

    it("vacío o basura es null, no cero", () => {
        expect(parseAmount("")).toBeNull();
        expect(parseAmount("abc")).toBeNull();
    });
});

describe("parseDate", () => {
    it("ISO directo", () => {
        expect(parseDate("2026-02-14")).toBe("2026-02-14");
    });

    it("dd/mm/yyyy en formato MX", () => {
        expect(parseDate("14/02/2026")).toBe("2026-02-14");
        expect(parseDate("3-4-2026")).toBe("2026-04-03");
    });

    it("fecha imposible es null", () => {
        expect(parseDate("31/02/2026")).toBeNull();
        expect(parseDate("kul")).toBeNull();
    });
});

describe("splitCsvLine", () => {
    it("respeta comillas: una comilla doble dentro se escapa con doble", () => {
        const line = '2026-02-01,"Distribuidora ""El Norte"", S.A.",-450.00';
        expect(splitCsvLine(line, ",")).toEqual([
            "2026-02-01",
            'Distribuidora "El Norte", S.A.',
            "-450.00",
        ]);
    });
});

describe("detectDelimiter", () => {
    it("elige el separador que más columnas separa", () => {
        expect(detectDelimiter("fecha;descripcion;monto")).toBe(";");
        expect(detectDelimiter("fecha,descripcion,monto")).toBe(",");
        expect(detectDelimiter("fecha\tdescripcion\tmonto")).toBe("\t");
    });
});

describe("parseBankStatementCsv", () => {
    it("parsea un CSV de ejemplo completo con acentos y formatos MX", () => {
        const csv = [
            "Fecha,Descripción,Monto,Referencia",
            "14/02/2026,NOMINA Q1,-15000.00,SPEI-881",
            "15/02/2026,Depósito ventanilla,2320.50,BR-1134",
        ].join("\n");
        const { rows, errors } = parseBankStatementCsv(csv);
        expect(errors).toHaveLength(0);
        expect(rows).toEqual([
            {
                valueDate: "2026-02-14",
                description: "NOMINA Q1",
                amountCents: -1500000,
                reference: "SPEI-881",
            },
            {
                valueDate: "2026-02-15",
                description: "Depósito ventanilla",
                amountCents: 232050,
                reference: "BR-1134",
            },
        ]);
    });

    it("acumula errores por línea sin abortar el resto", () => {
        const csv = [
            "Fecha,Concepto,Importe",
            "14/02/2026,NOMINA,-15000",
            "xxx,CORRUPTO?,-5",
            "15/02/2026,Otro,-99.00",
        ].join("\n");
        const { rows, errors } = parseBankStatementCsv(csv);
        expect(rows).toHaveLength(2);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain("Fecha");
    });

    it("rechaza un CSV sin las columnas requeridas", () => {
        const csv = "foo,bar\nx,y";
        expect(() => parseBankStatementCsv(csv)).toThrow(/columnas esperadas/);
    });
});

describe("buildFingerprint", () => {
    it("es estable ante la reimportación del mismo movimiento", () => {
        const a = buildFingerprint({
            sourceBankAccountId: "acc-1",
            valueDate: "2026-02-14",
            reference: "SPEI-881",
            amountCents: -1500000,
        });
        const b = buildFingerprint({
            sourceBankAccountId: "acc-1",
            valueDate: "2026-02-14",
            reference: "SPEI-881",
            amountCents: -1500000,
        });
        expect(a).toBe(b);
        expect(a).toHaveLength(64);
    });

    it("difiere por cuenta, referencia o monto", () => {
        const base = {
            sourceBankAccountId: "acc-1",
            valueDate: "2026-02-14",
            reference: "SPEI-881",
            amountCents: -1500000,
        };
        const changedAccount = buildFingerprint({ ...base, sourceBankAccountId: "acc-2" });
        const changedAmount = buildFingerprint({ ...base, amountCents: -1 });
        expect(changedAccount).not.toBe(buildFingerprint(base));
        expect(changedAmount).not.toBe(buildFingerprint(base));
    });
});

describe("scoreCandidate", () => {
    const tx = { valueDate: "2026-02-14", amountCents: -1500000 };

    it("producto monto espejo exacto dentro de ventana", () => {
        expect(
            scoreCandidate(tx, { amountCents: 1500000, settledAt: "2026-02-15T12:00:00Z" })
        ).toEqual({ ok: true, dateDiffDays: expect.any(Number), reason: null });
    });

    it("monto no espejo se rechaza sin importar la fecha", () => {
        expect(
            scoreCandidate(tx, { amountCents: 1400000, settledAt: "2026-02-15T12:00:00Z" }).reason
        ).toBe("MONTO");
    });

    it("fecha fuera de la ventana de 10 días se rechaza", () => {
        expect(
            scoreCandidate(tx, { amountCents: 1500000, settledAt: "2026-05-01T12:00:00Z" }).reason
        ).toBe("FECHA");
    });

    it("partida sin fecha de liquidación no es candidata", () => {
        expect(scoreCandidate(tx, { amountCents: 1500000, settledAt: null }).reason).toBe("FECHA");
    });
});
