import { describe, it, expect } from "vitest";
import { LaborCalculator } from "../labor-calculator";

describe("LaborCalculator - Holiday Overtime & Sunday Classification", () => {
  it("does not classify regular Sundays as holiday 3x overtime", () => {
    // Domingo 10 de mayo de 2026 (no es festivo LFT)
    const sundayDate = new Date("2026-05-10T12:00:00Z");
    expect(sundayDate.getUTCDay()).toBe(0); // Domingo

    // Acceder al método privado de clasificación mediante reflect / casting
    const isHolidayMethod = (LaborCalculator as any).isHoliday;
    
    // Con holidayDates vacío (solo fecha regular)
    const isSundayHoliday = isHolidayMethod(sundayDate, new Set<string>());
    expect(isSundayHoliday).toBe(false);
  });

  it("classifies dates declared in holidayDates as holiday 3x", () => {
    const isHolidayMethod = (LaborCalculator as any).isHoliday;
    const holidaySet = new Set<string>(["2026-05-01", "2026-09-16"]);

    const dayOfLabor = new Date("2026-05-01T10:00:00Z");
    const regularDay = new Date("2026-05-02T10:00:00Z");

    expect(isHolidayMethod(dayOfLabor, holidaySet)).toBe(true);
    expect(isHolidayMethod(regularDay, holidaySet)).toBe(false);
  });
});
