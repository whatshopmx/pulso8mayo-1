// lib/services/__tests__/aggregator-settlement-extraction.test.ts
//
// Fase 4 — la acción de cierre del workflow semanal convierte los pasos en el
// input de la conciliación. Los valores de paso son `jsonb` con formas
// irregulares, y una liquidación mal parseada concilia contra el número
// equivocado sin avisar.

import { describe, expect, it } from "vitest";
import { extractAggregatorSettlement } from "../aggregator-settlement-extraction";

const STEPS = [
  { stepId: "paso-canal", value: "Rappi" },
  { stepId: "paso-periodo-inicio", value: "2026-10-06" },
  { stepId: "paso-periodo-fin", value: "2026-10-12" },
  { stepId: "paso-venta-bruta", value: "12,500.50" },
  { stepId: "paso-comision", value: "3,437.64" },
  { stepId: "paso-neto", value: "9,062.86" },
  { stepId: "paso-evidencia", value: "https://r2.example/estado-rappi.pdf" },
  { stepId: "paso-notas", value: "Semana con promoción" },
];

describe("extractAggregatorSettlement", () => {
  it("extrae la liquidación y normaliza el canal al label del SELECT", () => {
    const r = extractAggregatorSettlement(STEPS);

    expect(r).not.toBeNull();
    expect(r!.channel).toBe("rappi");
    expect(r!.periodStart).toBe("2026-10-06");
    expect(r!.periodEnd).toBe("2026-10-12");
    expect(r!.grossSalesCents).toBe(1_250_050);
    expect(r!.commissionCents).toBe(343_764);
    expect(r!.netDepositedCents).toBe(906_286);
    expect(r!.evidenceUrls).toEqual(["https://r2.example/estado-rappi.pdf"]);
    expect(r!.notes).toBe("Semana con promoción");
  });

  it("normaliza el label 'Uber Eats' a la clave uber", () => {
    const r = extractAggregatorSettlement(
      STEPS.map((s) => (s.stepId === "paso-canal" ? { ...s, value: "Uber Eats" } : s)),
    );
    expect(r!.channel).toBe("uber");
  });

  it("sin canal no hay contra qué conciliar: devuelve null", () => {
    expect(extractAggregatorSettlement(STEPS.filter((s) => s.stepId !== "paso-canal"))).toBeNull();
  });

  it("sin periodo válido devuelve null", () => {
    const sinFin = STEPS.filter((s) => s.stepId !== "paso-periodo-fin");
    expect(extractAggregatorSettlement(sinFin)).toBeNull();

    const malFecha = STEPS.map((s) =>
      s.stepId === "paso-periodo-fin" ? { ...s, value: "12/10/2026" } : s,
    );
    expect(extractAggregatorSettlement(malFecha)).toBeNull();
  });

  it("rechaza un periodo invertido", () => {
    const invertido = STEPS.map((s) =>
      s.stepId === "paso-periodo-fin" ? { ...s, value: "2026-10-01" } : s,
    );
    expect(extractAggregatorSettlement(invertido)).toBeNull();
  });

  it("sin venta bruta o sin neto no se inventa la liquidación", () => {
    expect(extractAggregatorSettlement(STEPS.filter((s) => s.stepId !== "paso-venta-bruta"))).toBeNull();
    expect(extractAggregatorSettlement(STEPS.filter((s) => s.stepId !== "paso-neto"))).toBeNull();
  });

  it("la comisión es opcional: sin capturarla queda en cero", () => {
    const r = extractAggregatorSettlement(STEPS.filter((s) => s.stepId !== "paso-comision"));
    expect(r!.commissionCents).toBe(0);
  });

  it("acepta valores serializados con comillas y fechas ISO", () => {
    const r = extractAggregatorSettlement([
      { stepId: "paso-canal", value: '"didi"' },
      { stepId: "paso-periodo-inicio", value: '"2026-10-06T00:00:00.000Z"' },
      { stepId: "paso-periodo-fin", value: "2026-10-12T23:59:59.000Z" },
      { stepId: "paso-venta-bruta", value: '"1000.00"' },
      { stepId: "paso-comision", value: 100 },
      { stepId: "paso-neto", value: "900" },
    ]);

    expect(r!.channel).toBe("didi");
    expect(r!.periodStart).toBe("2026-10-06");
    expect(r!.periodEnd).toBe("2026-10-12");
    expect(r!.grossSalesCents).toBe(100_000);
    expect(r!.commissionCents).toBe(10_000);
    expect(r!.netDepositedCents).toBe(90_000);
  });

  it("recoge evidencias de un arreglo o de un objeto { url }", () => {
    const arreglo = extractAggregatorSettlement(
      STEPS.map((s) =>
        s.stepId === "paso-evidencia"
          ? { ...s, value: ["https://a/1.jpg", { url: "https://a/2.jpg" }] }
          : s,
      ),
    );
    expect(arreglo!.evidenceUrls).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
  });

  it("ignora pasos desconocidos", () => {
    const r = extractAggregatorSettlement([...STEPS, { stepId: "paso-x", value: "ruido" }]);
    expect(r!.channel).toBe("rappi");
  });
});
