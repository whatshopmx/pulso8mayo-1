import { describe, expect, it } from "vitest";
import { format } from "date-fns";
import { parseCivilDate } from "@/lib/business-date";

describe("parseCivilDate", () => {
  it.each(["2026-10-22", "2026-01-01", "2026-12-31"])(
    "conserva el día civil %s sin desplazarlo por la zona horaria",
    (iso) => {
      const date = parseCivilDate(iso);
      expect(format(date, "yyyy-MM-dd")).toBe(iso);
      expect(date.getFullYear()).toBe(Number(iso.slice(0, 4)));
      expect(date.getMonth() + 1).toBe(Number(iso.slice(5, 7)));
      expect(date.getDate()).toBe(Number(iso.slice(8, 10)));
    }
  );

  it("usa mediodía para que ningún cambio de offset cruce el día", () => {
    expect(parseCivilDate("2026-10-28").getHours()).toBe(12);
  });
});
