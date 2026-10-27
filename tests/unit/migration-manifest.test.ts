import { describe, expect, it } from "vitest";
import { classifyMigrations } from "@/scripts/migration-manifest";

const expected = [
  { tag: "0120_base", when: 100, hash: "a" },
  { tag: "0121_imss", when: 200, hash: "b" },
  { tag: "0122_snapshot", when: 300, hash: "c" },
];

describe("OPS-01: manifiesto no confunde el último timestamp con historial íntegro", () => {
  it("identifica el lote pendiente sin renumerar ni aplicar migraciones", () => {
    const result = classifyMigrations(expected, [{ id: 8, created_at: "100", hash: "a" }]);
    expect(result.entries.map((entry) => entry.status)).toEqual(["APPLIED", "PENDING", "PENDING"]);
    expect(result.requiresReview).toBe(false);
  });
  it("un hueco anterior al último timestamp no se presenta como aplicable por el runner", () => {
    const result = classifyMigrations(expected, [{ id: 9, created_at: "300", hash: "c" }]);
    expect(result.entries.map((entry) => entry.status)).toEqual(["HISTORY_GAP", "HISTORY_GAP", "APPLIED"]);
    expect(result.requiresReview).toBe(true);
  });
  it("un hash distinto bloquea aunque coincidan número y timestamp", () => {
    const result = classifyMigrations(expected, [{ id: 8, created_at: "100", hash: "alterado" }]);
    expect(result.entries[0].status).toBe("HASH_MISMATCH");
    expect(result.requiresReview).toBe(true);
  });
  it("registra entradas ajenas al journal local y timestamps duplicados", () => {
    const result = classifyMigrations(expected, [
      { id: 1, created_at: "100", hash: "a" }, { id: 2, created_at: "100", hash: "a" },
      { id: 3, created_at: "150", hash: "externo" },
    ]);
    expect(result.duplicateTimes).toEqual([100]);
    expect(result.unknownApplied.map((row) => row.id)).toEqual([3]);
    expect(result.requiresReview).toBe(true);
  });
  it("una base sin journal muestra todos pendientes", () => {
    expect(classifyMigrations(expected, []).entries.map((entry) => entry.status)).toEqual(["PENDING", "PENDING", "PENDING"]);
  });
  it("distingue variación LF/CRLF conocida del cambio de contenido sin aceptarla silenciosamente", () => {
    const result = classifyMigrations([{ ...expected[0], lineEndingHashes: ["a", "a-crlf"] }],
      [{ id: 1, created_at: "100", hash: "a-crlf" }]);
    expect(result.entries[0].status).toBe("LINE_ENDINGS_DIFFER");
    expect(result.requiresReview).toBe(true);
  });
});
