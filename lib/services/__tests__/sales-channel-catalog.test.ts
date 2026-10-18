// lib/services/__tests__/sales-channel-catalog.test.ts
//
// Fase 1 — "¿qué plataformas tenemos?".
//
// La derivación es pura a propósito: el estado "activo" de un canal no puede
// depender de que la UI adivine. Aquí se comprueba que se deriva del catálogo
// canónico más las tarifas capturadas.

import { describe, expect, it } from "vitest";
import { COMMISSION_CHANNELS } from "../commission-types";
import {
  activeSalesChannels,
  deriveSalesChannels,
  isSystemChannel,
  type ChannelRateInput,
} from "../sales-channel-catalog";

const TODAY = "2026-10-17";

/** Tarifa del grupo vigente. */
function groupRate(channel: string, rateBps: number, effectiveFrom = "2026-01-01"): ChannelRateInput {
  return { channel, branchId: null, effectiveFrom, rateBps, vatBps: 1600 };
}

describe("deriveSalesChannels", () => {
  it("sin tarifas, sólo los canales de sistema están activos", () => {
    const channels = deriveSalesChannels([], TODAY);

    expect(channels.map((c) => c.key)).toEqual([...COMMISSION_CHANNELS]);
    expect(isSystemChannel("mostrador")).toBe(true);
    expect(isSystemChannel("tpv")).toBe(true);
    expect(isSystemChannel("rappi")).toBe(false);

    const mostrador = channels.find((c) => c.key === "mostrador")!;
    expect(mostrador.kind).toBe("SYSTEM");
    expect(mostrador.active).toBe(true);

    const rappi = channels.find((c) => c.key === "rappi")!;
    expect(rappi.kind).toBe("AGGREGATOR");
    expect(rappi.active).toBe(false);
    expect(rappi.configured).toBe(false);
    expect(rappi.rateBps).toBeNull();
  });

  it("una tarifa del grupo activa el agregador y reporta su vigencia", () => {
    const channels = deriveSalesChannels([groupRate("rappi", 2750)], TODAY);
    const rappi = channels.find((c) => c.key === "rappi")!;

    expect(rappi.active).toBe(true);
    expect(rappi.configured).toBe(true);
    expect(rappi.rateBps).toBe(2750);
    expect(rappi.vatBps).toBe(1600);
    expect(rappi.effectiveFrom).toBe("2026-01-01");

    // Uber sigue sin configurar: activar Rappi no activa a nadie más.
    expect(channels.find((c) => c.key === "uber")!.active).toBe(false);
  });

  it("elige la vigencia más reciente que ya empezó", () => {
    const channels = deriveSalesChannels(
      [groupRate("rappi", 3000, "2026-01-01"), groupRate("rappi", 2750, "2026-06-01")],
      TODAY,
    );
    expect(channels.find((c) => c.key === "rappi")!.rateBps).toBe(2750);
  });

  it("ignora una tarifa futura para la vigencia de hoy, pero el canal queda configurado", () => {
    const channels = deriveSalesChannels([groupRate("didi", 2200, "2026-12-01")], TODAY);
    const didi = channels.find((c) => c.key === "didi")!;

    expect(didi.configured).toBe(true);
    expect(didi.active).toBe(true);
    expect(didi.rateBps).toBeNull(); // todavía no rige
    expect(didi.effectiveFrom).toBeNull();
  });

  it("una tarifa sólo por sucursal activa el canal sin tarifa del grupo", () => {
    const rates: ChannelRateInput[] = [
      { channel: "uber", branchId: "b-1", effectiveFrom: "2026-01-01", rateBps: 2500, vatBps: 1600 },
    ];
    const uber = deriveSalesChannels(rates, TODAY).find((c) => c.key === "uber")!;

    expect(uber.active).toBe(true);
    expect(uber.configured).toBe(true);
    expect(uber.rateBps).toBeNull();
  });

  it("anexa un canal con tarifa que no está en el catálogo", () => {
    const channels = deriveSalesChannels([groupRate("nuevoagregador", 1800)], TODAY);

    expect(channels.slice(0, COMMISSION_CHANNELS.length).map((c) => c.key)).toEqual([
      ...COMMISSION_CHANNELS,
    ]);
    const extra = channels.at(-1)!;
    expect(extra.key).toBe("nuevoagregador");
    expect(extra.kind).toBe("AGGREGATOR");
    expect(extra.active).toBe(true);
  });
});

describe("activeSalesChannels", () => {
  it("devuelve sistema + agregadores con tarifa, en orden de catálogo", () => {
    const active = activeSalesChannels([groupRate("rappi", 2750), groupRate("didi", 2100)], TODAY);

    expect(active.map((c) => c.key)).toEqual(["mostrador", "tpv", "rappi", "didi"]);
  });
});
