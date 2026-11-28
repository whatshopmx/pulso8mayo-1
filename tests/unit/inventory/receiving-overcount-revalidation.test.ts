import { describe, expect, it } from "vitest";
import {
  buildRevalidationReport,
  evaluateBatchRevalidation,
  rec03AdjustmentReference,
  type BatchRevalidationInput,
} from "@/lib/inventory/receiving-overcount-revalidation";

const company = "aaaaaaaa-0000-4000-8000-000000000001";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const report = { id: "aaaaaaaa-0000-4000-8000-000000000099", branchId: branch, companyId: company };

/** Lote pre-REC-01 intacto: recibió 10, nació en 10 y el movimiento sumó 10. */
const preFix = (overrides: Partial<BatchRevalidationInput> = {}): BatchRevalidationInput => ({
  batchId: "aaaaaaaa-0000-4000-8000-000000000041",
  branchId: branch,
  itemId: "aaaaaaaa-0000-4000-8000-000000000021",
  status: "AVAILABLE",
  createdAt: new Date("2026-09-01T12:00:00Z"),
  initialQuantity: 10,
  currentQuantity: 20,
  branchCompanyId: company,
  itemCompanyId: company,
  ledger: 10,
  receivingQuantity: 10,
  receivingCount: 1,
  laterMovementCount: 0,
  markerCount: 0,
  reportReference: report.id,
  report,
  reportLineQuantities: [10],
  ...overrides,
});

describe("REC-03A: evidencia por lote del doble incremento de recepción", () => {
  it("expediente completo es SUFFICIENT y propone exactamente -delta hasta el ledger", () => {
    const result = evaluateBatchRevalidation(preFix());
    expect(result).toMatchObject({ evidence: "SUFFICIENT", reasons: [], delta: 10, proposedAdjustment: -10,
      correctedBalance: 10, action: "PROPOSE_ADJUSTMENT" });
  });

  it("consumo posterior registrado con movimientos conserva la atribución y el saldo corregido es el ledger", () => {
    // 20 - 6 consumidos = 14 observado; ledger 10 - 6 = 4.
    const result = evaluateBatchRevalidation(preFix({ currentQuantity: 14, ledger: 4, laterMovementCount: 2 }));
    expect(result).toMatchObject({ evidence: "SUFFICIENT", delta: 10, proposedAdjustment: -10, correctedBalance: 4 });
  });

  it("cantidades fraccionarias sin ruido binario", () => {
    const result = evaluateBatchRevalidation(preFix({ initialQuantity: 3, currentQuantity: 6.1, ledger: 3.1,
      receivingQuantity: 3, reportLineQuantities: [3], laterMovementCount: 1 }));
    expect(result.evidence).toBe("SUFFICIENT");
    expect(result.proposedAdjustment).toBe(-3);
    expect(result.correctedBalance).toBe(3.1);
  });

  it("delta que no coincide con lo recibido queda AMBIGUOUS sin cantidad propuesta", () => {
    // Caso histórico: 98.49 observado, ledger 50 — escrituras directas sin movimiento.
    const result = evaluateBatchRevalidation(preFix({ initialQuantity: 50, currentQuantity: 98.49, ledger: 50,
      receivingQuantity: 50, reportLineQuantities: [50] }));
    expect(result).toMatchObject({ evidence: "AMBIGUOUS", reasons: ["DELTA_NOT_RECEIVED_QUANTITY"],
      proposedAdjustment: null, correctedBalance: null, action: "RETAIN_FOR_PHYSICAL_COUNT" });
  });

  it("delta negativo, saldo corregido negativo y recepciones múltiples o ausentes no se atribuyen", () => {
    expect(evaluateBatchRevalidation(preFix({ currentQuantity: 8 })).reasons).toContain("NEGATIVE_DELTA");
    expect(evaluateBatchRevalidation(preFix({ currentQuantity: 5, ledger: -5, laterMovementCount: 1 })).reasons)
      .toEqual(["CORRECTED_BALANCE_NEGATIVE"]);
    expect(evaluateBatchRevalidation(preFix({ receivingCount: 2, receivingQuantity: 20, ledger: 20, currentQuantity: 30 })).reasons)
      .toEqual(expect.arrayContaining(["MULTIPLE_RECEIVING_MOVEMENTS", "DELTA_NOT_RECEIVED_QUANTITY"]));
    const none = evaluateBatchRevalidation(preFix({ receivingCount: 0, receivingQuantity: 0, ledger: 0 }));
    expect(none.reasons).toContain("NO_RECEIVING_MOVEMENT");
    expect(none.evidence).toBe("AMBIGUOUS");
  });

  it("la recepción debe coincidir con la cantidad inicial del lote", () => {
    expect(evaluateBatchRevalidation(preFix({ initialQuantity: 12 })).reasons).toEqual(["RECEIVING_NOT_INITIAL"]);
  });

  it("reporte ausente, de otra sucursal/empresa o sin línea equivalente deja el lote retenido", () => {
    expect(evaluateBatchRevalidation(preFix({ report: null, reportLineQuantities: [] })).reasons).toEqual(["REPORT_MISSING"]);
    expect(evaluateBatchRevalidation(preFix({ report: { ...report, branchId: "bbbbbbbb-0000-4000-8000-000000000011" } })).reasons)
      .toEqual(["REPORT_SCOPE_MISMATCH"]);
    expect(evaluateBatchRevalidation(preFix({ report: { ...report, companyId: "bbbbbbbb-0000-4000-8000-000000000001" } })).reasons)
      .toEqual(["REPORT_SCOPE_MISMATCH"]);
    expect(evaluateBatchRevalidation(preFix({ reportLineQuantities: [] })).reasons).toEqual(["REPORT_LINE_MISSING"]);
    expect(evaluateBatchRevalidation(preFix({ reportLineQuantities: [12, 9] })).reasons).toEqual(["REPORT_LINE_QUANTITY_MISMATCH"]);
  });

  it("ítem de otra empresa invalida el expediente", () => {
    expect(evaluateBatchRevalidation(preFix({ itemCompanyId: "bbbbbbbb-0000-4000-8000-000000000001" })).reasons)
      .toEqual(["SCOPE_MISMATCH"]);
  });

  it("lotes creados en o después del corte de REC-01, o sin fecha, no se atribuyen a H01", () => {
    expect(evaluateBatchRevalidation(preFix({ createdAt: new Date("2026-10-17T00:00:00Z") })).reasons)
      .toEqual(["CREATED_AFTER_FIX"]);
    expect(evaluateBatchRevalidation(preFix({ createdAt: null })).reasons).toEqual(["CREATED_AT_UNKNOWN"]);
    // El corte es configurable (p.ej. fecha real de despliegue, más tardía).
    expect(evaluateBatchRevalidation(preFix({ createdAt: new Date("2026-10-20T00:00:00Z") }),
      { fixCutoff: "2026-10-25T00:00:00Z" }).evidence).toBe("SUFFICIENT");
    expect(() => evaluateBatchRevalidation(preFix(), { fixCutoff: "no-date" })).toThrow();
  });

  it("lote ya ajustado que cuadra es ALREADY_CORRECTED; con residuo sigue AMBIGUOUS", () => {
    expect(evaluateBatchRevalidation(preFix({ currentQuantity: 10, ledger: 10, markerCount: 1 })))
      .toMatchObject({ evidence: "ALREADY_CORRECTED", proposedAdjustment: null, action: "NONE" });
    expect(evaluateBatchRevalidation(preFix({ markerCount: 1 })).reasons).toContain("MARKER_WITH_RESIDUAL");
  });

  it("el reporte cuenta lo encontrado sin asumir un número fijo de lotes", () => {
    const rows = [
      evaluateBatchRevalidation(preFix()),
      evaluateBatchRevalidation(preFix({ currentQuantity: 8 })),
      evaluateBatchRevalidation(preFix({ report: null, reportLineQuantities: [], createdAt: null })),
    ];
    const reportOut = buildRevalidationReport(rows, { generatedAt: new Date("2026-11-22T00:00:00Z"),
      fixCutoff: "2026-10-17T00:00:00Z", companyId: null, nonReceivingMismatches: 3 });
    expect(reportOut.summary).toEqual({ candidates: 3, sufficient: 1, ambiguous: 2, alreadyCorrected: 0,
      byReason: { NEGATIVE_DELTA: 1, REPORT_MISSING: 1, CREATED_AT_UNKNOWN: 1 }, nonReceivingMismatches: 3 });
    expect(buildRevalidationReport([], { generatedAt: new Date(), fixCutoff: "2026-10-17T00:00:00Z",
      companyId: company, nonReceivingMismatches: 0 }).summary.candidates).toBe(0);
  });

  it("referencia determinista por lote", () => {
    expect(rec03AdjustmentReference("x")).toBe("REC-03:H01:x");
  });
});
