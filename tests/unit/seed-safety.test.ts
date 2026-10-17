import { describe, expect, it } from "vitest";
import { assertSeedReset, SEED_PHASES } from "../../scripts/seed-plan";

describe("seed demo", () => {
  it("exige un reinicio explícito y rechaza producción", () => {
    expect(() => assertSeedReset([], "development")).toThrow("--reset");
    expect(() => assertSeedReset(["--reset"], "production")).toThrow("production");
    expect(() => assertSeedReset(["--reset"], "development")).not.toThrow();
  });

  it("ejecuta las dependencias antes del control ejecutivo", () => {
    expect(SEED_PHASES).toHaveLength(16);
    expect(SEED_PHASES[0]).toBe("seed-01-foundation");
    expect(SEED_PHASES[15]).toBe("seed-16-executive-control");
    expect(new Set(SEED_PHASES).size).toBe(SEED_PHASES.length);
  });
});
