import { describe, expect, it } from "vitest";
import { assertSeedReset, SEED_PHASES } from "../../scripts/seed-plan";

describe("seed demo", () => {
  it("exige un reinicio explícito y rechaza producción", () => {
    expect(() => assertSeedReset([], "development")).toThrow("--reset");
    expect(() => assertSeedReset(["--reset"], "production")).toThrow("production");
    expect(() => assertSeedReset(["--reset"], "development")).not.toThrow();
  });

  it("ejecuta las dependencias antes del control ejecutivo", () => {
    // 16 fases de demo + seed-labor-law-rules (legal global, no tenant) +
    // seed-18-finance + seed-19-evidence-civil.
    expect(SEED_PHASES).toHaveLength(19);
    expect(SEED_PHASES[0]).toBe("seed-01-foundation");
    expect(SEED_PHASES[15]).toBe("seed-16-executive-control");
    expect(SEED_PHASES).toContain("seed-labor-law-rules");
    expect(SEED_PHASES[18]).toBe("seed-19-evidence-civil");
    expect(new Set(SEED_PHASES).size).toBe(SEED_PHASES.length);
  });
});
