import { describe, expect, it } from "vitest";
import { resetSeedRandom, seedDate, seedRandom, seedWorkday } from "../../scripts/seed-scenarios";

describe("escenarios estables del demo", () => {
  it("usa el día civil de CDMX al cruzar medianoche UTC", () => {
    expect(seedDate(1, new Date("2026-10-30T02:00:00Z")).toISOString()).toBe("2026-10-30T12:00:00.000Z");
  });
  it("conserva incidencias de lunes a sábado para cualquier día de ejecución", () => {
    for (let day = 1; day <= 7; day++) {
      const now = new Date(`2026-11-0${day}T18:00:00Z`);
      const dates = [2, 3, 5, 10].map((n) => seedWorkday(n, now));
      expect(new Set(dates).size).toBe(4);
      for (const date of dates) {
        expect(new Date(`${date}T12:00:00Z`).getUTCDay()).not.toBe(0);
        expect(date < now.toISOString().slice(0, 10)).toBe(true);
      }
    }
  });
  it("repite cantidades tras reset sin acoplar las fases", () => {
    resetSeedRandom();
    const first = [seedRandom("inventory"), seedRandom("inventory")];
    resetSeedRandom();
    seedRandom("labor");
    expect([seedRandom("inventory"), seedRandom("inventory")]).toEqual(first);
  });
});
