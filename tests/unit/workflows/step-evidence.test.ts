import { describe, expect, it } from "vitest";
import { parseStepEvidenceUrls } from "@/lib/workflows/step-evidence";

/**
 * EVI-01 (2b) — normalización del valor `evidence_url` de un paso.
 * Puro: no toca base de datos.
 */
describe("parseStepEvidenceUrls", () => {
  it("devuelve lista vacía para valores no utilizables", () => {
    expect(parseStepEvidenceUrls(undefined)).toEqual([]);
    expect(parseStepEvidenceUrls(null)).toEqual([]);
    expect(parseStepEvidenceUrls(123)).toEqual([]);
    expect(parseStepEvidenceUrls("")).toEqual([]);
    expect(parseStepEvidenceUrls("   ")).toEqual([]);
  });

  it("acepta un string simple (URL o key de R2)", () => {
    expect(parseStepEvidenceUrls("companies/a/x.jpg")).toEqual(["companies/a/x.jpg"]);
    expect(parseStepEvidenceUrls("  companies/a/x.jpg  ")).toEqual(["companies/a/x.jpg"]);
  });

  it("deserializa un arreglo JSON y descarta elementos no-string o vacíos", () => {
    expect(parseStepEvidenceUrls('["a.jpg","b.jpg"]')).toEqual(["a.jpg", "b.jpg"]);
    expect(parseStepEvidenceUrls('[" a.jpg ", "", "b.jpg"]')).toEqual(["a.jpg", "b.jpg"]);
    expect(parseStepEvidenceUrls('[1,"a.jpg",null]')).toEqual(["a.jpg"]);
    expect(parseStepEvidenceUrls("[]")).toEqual([]);
  });

  it("trata como string simple un arreglo JSON inválido", () => {
    expect(parseStepEvidenceUrls("[no-es-json")).toEqual(["[no-es-json"]);
  });
});
