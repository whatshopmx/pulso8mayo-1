// lib/sales/__tests__/aggregator-sales-map.test.ts
//
// Fase 3 — el corte une los campos fijos heredados y el mapa de plataformas
// activas que producen los pasos dinámicos.

import { describe, expect, it } from "vitest";
import { buildAggregatorSalesMap } from "../aggregator-sales-map";

describe("buildAggregatorSalesMap", () => {
  it("sin capturas devuelve null", () => {
    expect(buildAggregatorSalesMap({})).toBeNull();
    expect(buildAggregatorSalesMap({ rappi: 0, uber: 0, didi: 0 })).toBeNull();
    expect(buildAggregatorSalesMap({ plataformas: { rappi: 0 } })).toBeNull();
  });

  it("conserva los campos fijos con monto y omite los ceros", () => {
    expect(buildAggregatorSalesMap({ rappi: 30_000, uber: 0, didi: 5_000 })).toEqual({
      rappi: 30_000,
      didi: 5_000,
    });
  });

  it("normaliza los labels de los pasos dinámicos a la clave canónica", () => {
    expect(
      buildAggregatorSalesMap({
        plataformas: { "Uber Eats": 15_000, "DiDi Food": 5_000, Rappi: 30_000 },
      }),
    ).toEqual({ uber: 15_000, didi: 5_000, rappi: 30_000 });
  });

  it("acepta un agregador fuera del catálogo sin perderlo", () => {
    expect(buildAggregatorSalesMap({ plataformas: { nuevoagregador: 1_000 } })).toEqual({
      nuevoagregador: 1_000,
    });
  });

  it("combina campos fijos y dinámicos", () => {
    expect(
      buildAggregatorSalesMap({ rappi: 10_000, plataformas: { "Mercado Pago": 2_000 } }),
    ).toEqual({ rappi: 10_000, mercadopago: 2_000 });
  });

  it("si el mismo canal viene por las dos vías, gana el valor dinámico", () => {
    expect(buildAggregatorSalesMap({ rappi: 10_000, plataformas: { rappi: 20_000 } })).toEqual({
      rappi: 20_000,
    });
  });
});
