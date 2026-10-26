import { describe, expect, it } from "vitest";
import { calcularPagoAguinaldo, resolverFechaPagoAguinaldo } from "@/lib/services/aguinaldo-payment";

describe("AGU-03A.1 — fecha civil y contrato de pago", () => {
  it("separa el año del pago de un aguinaldo causado antes", () => {
    expect(resolverFechaPagoAguinaldo("2026-01-01")).toEqual({ fechaPago: "2026-01-01", anioPago: 2026, mesPago: 1 });
  });

  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01", "2026-01-01T00:00:00Z", "", null, 20260101])(
    "rechaza fecha civil inválida %s sin normalizarla", (date) => {
      expect(() => resolverFechaPagoAguinaldo(date as string)).toThrow(RangeError);
    },
  );

  it("acepta día bisiesto pero bloquea un año sin tarifa publicada", () => {
    expect(resolverFechaPagoAguinaldo("2024-02-29").fechaPago).toBe("2024-02-29");
    expect(() => calcularPagoAguinaldo({ brutoCents: 0, exentoCents: 0, gravadoCents: 0 }, 60_000, "2027-01-01"))
      .toThrow(/tarifa/i);
  });

  it.each([
    { brutoCents: 225_000, exentoCents: 225_000, gravadoCents: 0, tax: 0, net: 225_000 },
    { brutoCents: 900_000, exentoCents: 351_930, gravadoCents: 548_070, tax: 117_065, net: 782_935 },
    { brutoCents: 0, exentoCents: 0, gravadoCents: 0, tax: 0, net: 0 },
  ])("bruto $brutoCents conserva percepciones, deducciones y neto", (f) => {
    expect(calcularPagoAguinaldo(f, 60_000, "2026-12-15")).toMatchObject({
      totalDeduccionesCents: f.tax, netoCents: f.net, retencion: { retencionCents: f.tax },
    });
  });

  it("rechaza aplicar subsidio mensual sin acumulados conciliados", () => {
    expect(() => calcularPagoAguinaldo({ brutoCents: 525_000, exentoCents: 351_930, gravadoCents: 173_070 }, 35_000, "2026-12-15"))
      .toThrow(/acumulados mensuales/i);
  });

  it("rechaza un cálculo con partición inválida o centavos fraccionarios", () => {
    expect(() => calcularPagoAguinaldo({ brutoCents: 100, exentoCents: 90, gravadoCents: 20 }, 60_000, "2026-12-15")).toThrow(RangeError);
    expect(() => calcularPagoAguinaldo({ brutoCents: 100.5, exentoCents: 100.5, gravadoCents: 0 }, 60_000, "2026-12-15")).toThrow(RangeError);
  });
});
