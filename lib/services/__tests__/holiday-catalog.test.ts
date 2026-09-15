import { describe, it, expect } from "vitest";
import { HolidayCatalogService } from "../holiday-catalog";

describe("HolidayCatalogService (LFT Art. 74)", () => {
  it("generates correct official holidays for 2026", () => {
    const holidays2026 = HolidayCatalogService.getOfficialHolidays(2026);
    
    // In 2026 there are 7 standard holidays (not presidential transition year)
    expect(holidays2026).toHaveLength(7);

    const map = new Map(holidays2026.map(h => [h.name, h.date]));

    // 1 de enero
    expect(map.get("Año Nuevo")).toBe("2026-01-01");

    // 1er lunes de febrero (Feb 1 2026 is Sunday, first Monday is Feb 2)
    expect(map.get("Día de la Constitución")).toBe("2026-02-02");

    // 3er lunes de marzo (Mar 1 2026 is Sunday, first Mon Mar 2, 2nd Mar 9, 3rd Mar 16)
    expect(map.get("Natalicio de Benito Juárez")).toBe("2026-03-16");

    // 1 de mayo
    expect(map.get("Día del Trabajo")).toBe("2026-05-01");

    // 16 de septiembre
    expect(map.get("Día de la Independencia")).toBe("2026-09-16");

    // 3er lunes de noviembre (Nov 1 2026 is Sunday, 1st Mon Nov 2, 3rd Mon Nov 16)
    expect(map.get("Día de la Revolución")).toBe("2026-11-16");

    // 25 de diciembre
    expect(map.get("Navidad")).toBe("2026-12-25");
  });

  it("includes Transmisión del Poder Ejecutivo Federal in 2024 and 2030 (every 6 years)", () => {
    const holidays2024 = HolidayCatalogService.getOfficialHolidays(2024);
    const trans2024 = holidays2024.find(h => h.name === "Transmisión del Poder Ejecutivo Federal");
    expect(trans2024).toBeDefined();
    expect(trans2024?.date).toBe("2024-10-01");

    const holidays2026 = HolidayCatalogService.getOfficialHolidays(2026);
    const trans2026 = holidays2026.find(h => h.name === "Transmisión del Poder Ejecutivo Federal");
    expect(trans2026).toBeUndefined();

    const holidays2030 = HolidayCatalogService.getOfficialHolidays(2030);
    const trans2030 = holidays2030.find(h => h.name === "Transmisión del Poder Ejecutivo Federal");
    expect(trans2030).toBeDefined();
    expect(trans2030?.date).toBe("2030-10-01");
  });

  it("calculates movable Mondays correctly for 2027", () => {
    const holidays2027 = HolidayCatalogService.getOfficialHolidays(2027);
    const map = new Map(holidays2027.map(h => [h.name, h.date]));

    // In 2027: Feb 1 is a Monday, so first Monday is Feb 1!
    expect(map.get("Día de la Constitución")).toBe("2027-02-01");

    // Mar 1 is a Monday, so 1st is Mar 1, 2nd is Mar 8, 3rd is Mar 15!
    expect(map.get("Natalicio de Benito Juárez")).toBe("2027-03-15");

    // Nov 1 is a Monday, so 1st is Nov 1, 2nd is Nov 8, 3rd is Nov 15!
    expect(map.get("Día de la Revolución")).toBe("2027-11-15");
  });
});
