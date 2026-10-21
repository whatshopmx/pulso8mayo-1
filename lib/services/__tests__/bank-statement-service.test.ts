import { describe, expect, it, vi } from "vitest";
import {
    buildFingerprint,
    confirmDepositMatch,
    detectDelimiter,
    parseAmount,
    parseBankStatementCsv,
    parseDate,
    scoreCandidate,
    scoreDepositCandidate,
    splitCsvLine,
} from "../bank-statement-service";

/**
 * Mock de `db` para las pruebas transaccionales de confirmación: el resto del
 * archivo ejercita funciones puras y no toca la base de datos.
 */
vi.mock("@/lib/db", () => {
    const selectChain = (rows: unknown) => ({
        from: () => ({
            where: () => ({
                for: () => ({ limit: () => Promise.resolve(rows) }),
                limit: () => Promise.resolve(rows),
            }),
        }),
    });
    const updateChain = (rows: unknown) => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }),
    });
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
            select: vi.fn(),
            update: vi.fn(),
        })
    );
    return { db: { transaction } };
});

import { db } from "@/lib/db";

describe("confirmDepositMatch (protocolo atómico de entradas)", () => {
    const txUnmatchedRow = {
        id: "tx-1",
        matchStatus: "UNMATCHED",
        amountCents: 47912,
        valueDate: "2026-02-14",
        sourceBankAccountId: "acc-1",
    };
    const gwRow = {
        id: "gw-1",
        netAmountCents: 47912,
        destinationBankAccountId: "acc-1",
    };
    const input = {
        companyId: "comp-1",
        transactionId: "tx-1",
        gatewayTransactionId: "gw-1",
        userId: "user-1",
    };

    /** Mock transaccional por índice de select: 1 = bank tx, 2 = gateway, 3 = clash. */
    const mockTx = (rows: unknown[], updateRows: unknown[]) => ({
        select: vi.fn(() => {
            const rowsLeft = rows.length;
            void rowsLeft;
            return {
                from: () => ({
                    where: () => ({
                        for: () => ({ limit: () => Promise.resolve([]) }),
                        limit: () => Promise.resolve([]),
                    }),
                }),
            };
        }),
        update: vi.fn(),
    });
    void mockTx;

    function txMock(selectRows: unknown[], updateRows: unknown[]) {
        let call = 0;
        return {
            select: vi.fn(
                () =>
                    ({
                        from: () => ({
                            where: () => ({
                                for: () => ({
                                    limit: () => Promise.resolve(selectRows[call++] ?? []),
                                }),
                                limit: () =>
                                    Promise.resolve(
                                        call >= selectRows.length
                                            ? []
                                            : (selectRows[call++] ?? [])
                                    ),
                            }),
                        }),
                    }) as never
            ),
            update: vi.fn(
                () =>
                    ({
                        set: () => ({ where: () => ({ returning: () => Promise.resolve(updateRows) }) }),
                    }) as never
            ),
        };
    }

    it("doble confirmación simulada: el primer cruce queda MATCHED y el segundo levanta conflicto (409)", async () => {
        // Primera confirmación: UNMATCHED + fila gateway libre + update aplica.
        vi.mocked(db.transaction).mockImplementationOnce(async (cb) => cb(txMock([[txUnmatchedRow], [gwRow], []], [{ id: "tx-1" }]) as never));
        await expect(confirmDepositMatch(input)).resolves.toBeUndefined();

        // Segunda confirmación sobre el mismo par ya cruzado: conflicto.
        vi.mocked(db.transaction).mockImplementationOnce(async (cb) => cb(txMock([[{ ...txUnmatchedRow, matchStatus: "MATCHED" }]], []) as never));
        await expect(confirmDepositMatch(input)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("si el cerrojo optimista final mueve 0 filas, la carrera produjo 409 y nada queda cruzado a medias", async () => {
        vi.mocked(db.transaction).mockImplementationOnce(async (cb) =>
            cb(txMock([[txUnmatchedRow], [gwRow], []], []) as never)
        );
        await expect(confirmDepositMatch(input)).rejects.toMatchObject({ statusCode: 409 });
    });
});

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

// ── Matching de ENTRADAS (depósitos de pasarela) ────────────────────────────

describe("scoreDepositCandidate", () => {
    const dep = { valueDate: "2026-02-14", amountCents: 47912 };

    it("abono neto exacto dentro de ventana es candidato", () => {
        expect(
            scoreDepositCandidate(dep, {
                netAmountCents: 47912,
                settlementDate: "2026-02-16",
            })
        ).toEqual({ ok: true, dateDiffDays: expect.any(Number), reason: null });
    });

    it("monto distinto no es candidato aunque la fecha calce", () => {
        expect(
            scoreDepositCandidate(dep, {
                netAmountCents: 47913,
                settlementDate: "2026-02-14",
            }).reason
        ).toBe("MONTO");
    });

    it("settlement futura fuera de la ventana de 10 días se rechaza", () => {
        expect(
            scoreDepositCandidate(dep, {
                netAmountCents: 47912,
                settlementDate: "2026-05-01",
            }).reason
        ).toBe("FECHA");
    });

    it("fila de pasarela sin settlementDate no es candidata", () => {
        expect(
            scoreDepositCandidate(dep, { netAmountCents: 47912, settlementDate: null }).reason
        ).toBe("FECHA");
    });

    it("un movimiento negativo (salida) nunca produce candidatos de entrada", () => {
        // Un movimiento bancario negativo (salida) no puede cruzarse contra
        // una fila gateway de entrada: el monto nunca es espejo por signo.
        expect(
            scoreDepositCandidate(
                { valueDate: "2026-02-14", amountCents: -47912 },
                { netAmountCents: 47912, settlementDate: "2026-02-14" }
            ).reason
        ).toBe("MONTO");
    });
});
