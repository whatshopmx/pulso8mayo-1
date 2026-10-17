import { describe, expect, it } from "vitest";

import {
  SLA_WINDOWS_MS,
  computeSlaDueAt,
  isSlaBreached,
  msUntilSla,
} from "../exception-sla";
import type { ExceptionSeverity } from "../exception-types";

/**
 * Phase 0 / Task 6 — política de SLA pura (severidad → ventana).
 */

const SEVERITIES: ExceptionSeverity[] = [
  "info",
  "warning",
  "high",
  "critical",
  "fatal",
];

describe("SLA_WINDOWS_MS — defaults D7", () => {
  it("fatal y critical son los más cortos (30 min)", () => {
    expect(SLA_WINDOWS_MS.fatal).toBe(30 * 60 * 1000);
    expect(SLA_WINDOWS_MS.critical).toBe(30 * 60 * 1000);
  });

  it("high 4 h, warning 24 h, info 72 h", () => {
    expect(SLA_WINDOWS_MS.high).toBe(4 * 60 * 60 * 1000);
    expect(SLA_WINDOWS_MS.warning).toBe(24 * 60 * 60 * 1000);
    expect(SLA_WINDOWS_MS.info).toBe(72 * 60 * 60 * 1000);
  });

  it("la ventana decrece con la severidad", () => {
    const order = ["fatal", "critical", "high", "warning", "info"] as ExceptionSeverity[];
    for (let i = 1; i < order.length; i++) {
      expect(SLA_WINDOWS_MS[order[i]]).toBeGreaterThanOrEqual(
        SLA_WINDOWS_MS[order[i - 1]],
      );
    }
  });

  it("toda severidad tiene ventana", () => {
    for (const s of SEVERITIES) {
      expect(SLA_WINDOWS_MS[s]).toBeGreaterThan(0);
    }
  });
});

describe("computeSlaDueAt", () => {
  it("suma la ventana a la fecha base", () => {
    const from = new Date("2026-10-17T12:00:00.000Z");
    const due = computeSlaDueAt("high", from);
    expect(due.toISOString()).toBe("2026-10-17T16:00:00.000Z");
  });

  it("default = ahora", () => {
    const before = Date.now();
    const due = computeSlaDueAt("info");
    expect(due.getTime()).toBeGreaterThanOrEqual(before + SLA_WINDOWS_MS.info);
  });
});

describe("isSlaBreached / msUntilSla", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");

  it("sin SLA nunca está vencida", () => {
    expect(isSlaBreached(null, now)).toBe(false);
    expect(isSlaBreached(undefined, now)).toBe(false);
    expect(msUntilSla(null, now)).toBeNull();
  });

  it("fecha pasada = vencida; futura = vigente", () => {
    expect(isSlaBreached("2026-10-17T11:59:00.000Z", now)).toBe(true);
    expect(isSlaBreached("2026-10-17T12:01:00.000Z", now)).toBe(false);
  });

  it("msUntilSla negativo cuando venció", () => {
    expect(msUntilSla("2026-10-17T11:00:00.000Z", now)).toBe(-60 * 60 * 1000);
  });

  it("fecha inválida no revienta y no se reporta vencida", () => {
    expect(isSlaBreached("no-es-fecha", now)).toBe(false);
    expect(msUntilSla("no-es-fecha", now)).toBeNull();
  });
});
