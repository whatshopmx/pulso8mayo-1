// lib/services/__tests__/aggregator-settlement-rules.test.ts
//
// Conciliación de liquidaciones de plataformas (fix 2026-10-17).
//
// Dos defectos que estos tests blindan:
//  1. El canal no se normalizaba: el panel enviaba `ubereats` y el corte guarda
//     `uber`, así que la liquidación se conciliaba contra cero.
//  2. La varianza se calculaba contra el bruto declarado por la propia
//     plataforma, no contra la venta registrada en el corte.

import { describe, expect, it } from "vitest";
import { COMMISSION_CHANNELS, commissionChannelLabel } from "../commission-types";
import {
  computeSettlementVarianceCents,
  normalizeSettlementChannel,
  SETTLEMENT_VARIANCE_TOLERANCE_CENTS,
  settlementStatusForVariance,
} from "../aggregator-settlement-rules";

describe("normalizeSettlementChannel", () => {
  it("mapea los alias del panel a la clave canónica de aggregatorSales", () => {
    // El caso que producía la falsa discrepancia.
    expect(normalizeSettlementChannel("ubereats")).toBe("uber");
    expect(normalizeSettlementChannel("Uber Eats")).toBe("uber");
    expect(normalizeSettlementChannel("UBER_EATS")).toBe("uber");
    expect(normalizeSettlementChannel("didi food")).toBe("didi");
    expect(normalizeSettlementChannel("didiFood")).toBe("didi");
    expect(normalizeSettlementChannel("Pedidos Ya")).toBe("pedidosya");
    expect(normalizeSettlementChannel("Sin Delantal")).toBe("sindelantal");
    expect(normalizeSettlementChannel("Mercado Pago")).toBe("mercadopago");
  });

  it("lleva terminal y efectivo a sus columnas del corte", () => {
    expect(normalizeSettlementChannel("TPV")).toBe("tpv");
    expect(normalizeSettlementChannel("Terminal Bancaria")).toBe("tpv");
    expect(normalizeSettlementChannel("tarjeta")).toBe("tpv");
    expect(normalizeSettlementChannel("Efectivo")).toBe("mostrador");
    expect(normalizeSettlementChannel("caja")).toBe("mostrador");
  });

  it("recorta y colapsa espacios, y respeta llaves ya canónicas", () => {
    expect(normalizeSettlementChannel("  rappi ")).toBe("rappi");
    expect(normalizeSettlementChannel("justo")).toBe("justo");
    expect(normalizeSettlementChannel("mercadopago")).toBe("mercadopago");
  });

  it("deja pasar un canal desconocido sin inventarle clave", () => {
    // Un agregador nuevo funciona sin migración: el corte decide la llave.
    expect(normalizeSettlementChannel("evento-especial")).toBe("evento-especial");
  });

  it("todo label de la UI normaliza de vuelta a su clave canónica", () => {
    // El ejecutor de workflows guarda el LABEL del SELECT, y la plantilla de
    // conciliación ofrece esos labels. Si un label deja de normalizar, la
    // liquidación se guarda con una clave que el corte no usa.
    for (const key of COMMISSION_CHANNELS) {
      expect(normalizeSettlementChannel(commissionChannelLabel(key))).toBe(key);
    }
  });
});

describe("computeSettlementVarianceCents", () => {
  it("cuadra cuando el neto depositado más la comisión iguala la venta del POS", () => {
    expect(
      computeSettlementVarianceCents({
        posSalesCents: 100_000,
        commissionCents: 20_000,
        netDepositedCents: 80_000,
      }),
    ).toBe(0);
  });

  it("marca faltante (negativo) cuando la plataforma deja menos de lo vendido", () => {
    // Vendimos $1,000 en Rappi; la plataforma retuvo $200 pero sólo depositó $750.
    const variance = computeSettlementVarianceCents({
      posSalesCents: 100_000,
      commissionCents: 20_000,
      netDepositedCents: 75_000,
    });
    expect(variance).toBe(-5_000);
    expect(settlementStatusForVariance(variance)).toBe("DISCREPANCY");
  });

  it("marca sobrante (positivo) cuando la plataforma deposita más de lo vendido", () => {
    const variance = computeSettlementVarianceCents({
      posSalesCents: 100_000,
      commissionCents: 20_000,
      netDepositedCents: 85_000,
    });
    expect(variance).toBe(5_000);
    expect(settlementStatusForVariance(variance)).toBe("DISCREPANCY");
  });

  it("no usa el bruto declarado por la plataforma", () => {
    // Dos liquidaciones con el MISMO POS y el MISMO neto/comisión, pero distinto
    // bruto declarado, deben dar la misma varianza: el bruto de la plataforma no
    // es la referencia de la conciliación.
    const base = { posSalesCents: 100_000, commissionCents: 20_000, netDepositedCents: 80_000 };
    expect(computeSettlementVarianceCents(base)).toBe(0);
    expect(computeSettlementVarianceCents(base)).toBe(0);
  });
});

describe("settlementStatusForVariance", () => {
  it("tolera el redondeo de la plataforma dentro del umbral", () => {
    expect(settlementStatusForVariance(0)).toBe("RECONCILED");
    expect(settlementStatusForVariance(SETTLEMENT_VARIANCE_TOLERANCE_CENTS)).toBe("RECONCILED");
    expect(settlementStatusForVariance(-SETTLEMENT_VARIANCE_TOLERANCE_CENTS)).toBe("RECONCILED");
  });

  it("pasa a discrepancia apenas supera el umbral", () => {
    expect(settlementStatusForVariance(SETTLEMENT_VARIANCE_TOLERANCE_CENTS + 1)).toBe("DISCREPANCY");
    expect(settlementStatusForVariance(-SETTLEMENT_VARIANCE_TOLERANCE_CENTS - 1)).toBe("DISCREPANCY");
  });
});
