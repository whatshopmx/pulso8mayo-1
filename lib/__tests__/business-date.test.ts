import { describe, expect, it } from "vitest";
import {
  businessDateIso,
  businessDayEnd,
  businessDayStart,
  dataAnchorFor,
} from "../business-date";

/**
 * Los instantes se construyen con Date.UTC para que el test no dependa de la
 * zona horaria de la máquina que lo corre — que es justamente el bug que este
 * módulo existe para eliminar.
 */
const mxLocal = (isoDate: string, hour: number, minute = 0) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Mexico es UTC-6 (sin horario de verano desde 2022).
  return new Date(Date.UTC(y, m - 1, d, hour + 6, minute));
};

describe("businessDateIso", () => {
  it("a las 09:00 local devuelve el día local", () => {
    expect(businessDateIso(mxLocal("2026-09-18", 9))).toBe("2026-09-18");
  });

  it("a las 18:00 local SIGUE devolviendo el día local (regresión del bug UTC)", () => {
    // Con toISOString().slice(0,10) esto devolvía "2026-09-19".
    expect(businessDateIso(mxLocal("2026-09-18", 18))).toBe("2026-09-18");
  });

  it("a las 23:59 local sigue siendo el mismo día", () => {
    expect(businessDateIso(mxLocal("2026-09-18", 23, 59))).toBe("2026-09-18");
  });

  it("cruza a medianoche local, no a medianoche UTC", () => {
    expect(businessDateIso(mxLocal("2026-09-18", 23, 59))).toBe("2026-09-18");
    expect(businessDateIso(mxLocal("2026-09-19", 0, 1))).toBe("2026-09-19");
  });

  it("no coincide con toISOString durante la tarde/noche", () => {
    const evening = mxLocal("2026-09-18", 20);
    expect(evening.toISOString().slice(0, 10)).toBe("2026-09-19");
    expect(businessDateIso(evening)).toBe("2026-09-18");
  });
});

describe("businessDayStart", () => {
  it("es la medianoche local expresada en UTC (06:00Z)", () => {
    expect(businessDayStart(mxLocal("2026-09-18", 12)).toISOString()).toBe(
      "2026-09-18T06:00:00.000Z",
    );
  });

  it("es estable en cualquier hora del mismo día", () => {
    const a = businessDayStart(mxLocal("2026-09-18", 0, 1));
    const b = businessDayStart(mxLocal("2026-09-18", 23, 59));
    expect(a.getTime()).toBe(b.getTime());
  });

  it("un instante justo antes de la medianoche local pertenece al día anterior", () => {
    // 2026-09-18T05:00Z == 2026-09-17 23:00 local
    expect(businessDayStart(new Date("2026-09-18T05:00:00.000Z")).toISOString()).toBe(
      "2026-09-17T06:00:00.000Z",
    );
  });
});

describe("businessDayEnd", () => {
  it("es el último instante del día local", () => {
    expect(businessDayEnd(mxLocal("2026-09-18", 12)).toISOString()).toBe(
      "2026-09-19T05:59:59.999Z",
    );
  });

  it("start y end describen el mismo día de negocio", () => {
    const start = businessDayStart(mxLocal("2026-09-18", 20));
    const end = businessDayEnd(mxLocal("2026-09-18", 20));
    expect(businessDateIso(start)).toBe("2026-09-18");
    expect(businessDateIso(end)).toBe("2026-09-18");
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe("dataAnchorFor", () => {
  const at = mxLocal("2026-09-18", 20); // tarde: el caso que rompía

  it("marca isCurrent cuando la fuente tiene datos de hoy", () => {
    expect(dataAnchorFor("2026-09-18", at)).toEqual({ asOf: "2026-09-18", isCurrent: true });
  });

  it("marca isCurrent=false cuando la fuente se quedó atrás", () => {
    expect(dataAnchorFor("2026-09-17", at)).toEqual({ asOf: "2026-09-17", isCurrent: false });
  });

  it("sin datos, usa el día de negocio actual", () => {
    expect(dataAnchorFor(null, at)).toEqual({ asOf: "2026-09-18", isCurrent: true });
  });
});
