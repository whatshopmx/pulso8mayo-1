import { test, expect } from "@playwright/test";
import {
  FREQUENCY_REQUIREMENTS,
  checkScheduleFrequency,
  frequencyMeetsRequirement,
  scheduleFrequencyToCompliance,
} from "../lib/compliance/frequency-requirements";

/**
 * T4 — comparador de frecuencias normativas (D1).
 *
 * Spec de lógica pura: no toca la UI ni la base. Vive aquí porque Playwright es
 * el único runner del repo.
 */

test.describe("checkScheduleFrequency", () => {
  test("NOM-251 programada mensual, sin enforce: advierte y deja guardar", () => {
    const result = checkScheduleFrequency("NOM_251", "monthly");

    expect(result.blocking).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("NOM-251");
    expect(result.warnings[0]).toContain("diaria");
    expect(result.warnings[0]).toContain("mensual");
    // El aviso declara que es un valor operativo, no asesoría legal (AD-2).
    expect(result.warnings[0]).toContain("no asesoría legal");
  });

  test("la misma norma con enforce activo bloquea el guardado", () => {
    const original = FREQUENCY_REQUIREMENTS.NOM_251.enforce;
    FREQUENCY_REQUIREMENTS.NOM_251.enforce = true;
    try {
      const result = checkScheduleFrequency("NOM_251", "monthly");
      expect(result.blocking).toBe(true);
      expect(result.warnings).toHaveLength(1);
    } finally {
      FREQUENCY_REQUIREMENTS.NOM_251.enforce = original;
    }
  });

  test("COMPLIANCE_FREQ_ENFORCE apaga el bloqueo sin tocar la tabla", () => {
    const original = FREQUENCY_REQUIREMENTS.NOM_251.enforce;
    FREQUENCY_REQUIREMENTS.NOM_251.enforce = true;
    try {
      const result = checkScheduleFrequency("NOM_251", "monthly", true);
      expect(result.blocking).toBe(false);
      // El desajuste se sigue reportando: apagar el bloqueo no lo oculta.
      expect(result.warnings).toHaveLength(1);
    } finally {
      FREQUENCY_REQUIREMENTS.NOM_251.enforce = original;
    }
  });

  test("NOM-251 programada diaria cumple, sin advertencias", () => {
    const result = checkScheduleFrequency("NOM_251", "daily");
    expect(result).toEqual({ warnings: [], blocking: false });
  });

  test("programar por encima del mínimo nunca es error", () => {
    // NOM-030 exige mensual; diaria y semanal la superan.
    expect(checkScheduleFrequency("NOM_030", "daily").warnings).toEqual([]);
    expect(checkScheduleFrequency("NOM_030", "weekly").warnings).toEqual([]);
    expect(checkScheduleFrequency("NOM_030", "monthly").warnings).toEqual([]);
  });

  test("NONE y las normas laborales no se validan", () => {
    for (const tipo of ["NONE", "LFT", "LSSN", "INFONAVIT", "FONACOT"]) {
      expect(checkScheduleFrequency(tipo, "on_demand").warnings).toEqual([]);
    }
    expect(checkScheduleFrequency(null, "on_demand").warnings).toEqual([]);
    expect(checkScheduleFrequency(undefined, "monthly").warnings).toEqual([]);
  });

  test("bajo demanda no satisface ningún mínimo periódico", () => {
    const result = checkScheduleFrequency("NOM_035", "on_demand");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("anual");
  });
});

test.describe("frequencyMeetsRequirement", () => {
  test("más frecuente satisface, menos frecuente no", () => {
    expect(frequencyMeetsRequirement("DAILY", "MONTHLY")).toBe(true);
    expect(frequencyMeetsRequirement("MONTHLY", "MONTHLY")).toBe(true);
    expect(frequencyMeetsRequirement("MONTHLY", "DAILY")).toBe(false);
    expect(frequencyMeetsRequirement("ON_DEMAND", "ANNUAL")).toBe(false);
  });
});

test.describe("scheduleFrequencyToCompliance", () => {
  test("traduce las cuatro frecuencias del programador", () => {
    expect(scheduleFrequencyToCompliance("daily")).toBe("DAILY");
    expect(scheduleFrequencyToCompliance("weekly")).toBe("WEEKLY");
    expect(scheduleFrequencyToCompliance("monthly")).toBe("MONTHLY");
    expect(scheduleFrequencyToCompliance("on_demand")).toBe("ON_DEMAND");
  });

  test("un valor desconocido devuelve null en vez de inventar un veredicto", () => {
    expect(scheduleFrequencyToCompliance("cada_luna_llena")).toBeNull();
  });
});
