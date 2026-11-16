import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { SalesIngestService } from "../sales-ingest-service";

const { apply, Failure } = vi.hoisted(() => ({
  apply: vi.fn(),
  Failure: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock("../sale-consumption-service", () => ({ applySaleConsumptionInTransaction: apply, SaleConsumptionError: Failure }));
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const companyId = randomUUID(), branchId = randomUUID(), recipeId = randomUUID();
function scope(complete = true, validBranch = true) {
  return {
    execute: async () => ({ rows: [{ complete }] }),
    select: () => ({ from: (table: unknown) => ({ where: async () => table === branches
      ? validBranch ? [{ id: branchId }] : []
      : [{ id: recipeId, name: "Plato" }, { id: randomUUID(), name: "Duplicado" }, { id: randomUUID(), name: "duplicado" }] }) }),
  } as unknown as Tx;
}
const row = (rowNumber: number, quantitySold: number, totalRevenueCents: number | null = 100) => ({
  rowNumber, recipeRef: recipeId, productKey: "SKU", saleDay: "2026-11-12", quantitySold, totalRevenueCents,
});
const params = { companyId, branchId, userId: "test" };

describe("adaptador de importación al writer", () => {
  it("agrupa exacto, conserva null y devuelve cobertura incompleta", async () => {
    apply.mockReset().mockResolvedValue({ applied: true, created: true });
    const result = await SalesIngestService.ingestInTransaction(scope(false), { ...params, rows: [row(2, 0.1, null), row(3, 0.2)] });
    expect(result).toMatchObject({ inserted: 1, updated: 0, skipped: 0, errors: [], revenueComplete: false });
    expect(apply.mock.calls[0][1]).toMatchObject({ productKey: "SKU", source: "pos:import", quantitySold: "0.30", totalRevenueCents: null });
  });
  it("rechaza grupos inválidos enteros y propaga errores del writer a todas sus filas", async () => {
    apply.mockReset().mockRejectedValue(new Failure("INSUFFICIENT_STOCK", "Stock insuficiente"));
    const result = await SalesIngestService.ingestInTransaction(scope(), { ...params,
      rows: [row(2, 1), row(3, 2), { ...row(4, 1.001), productKey: "invalid" }, { ...row(5, 2), productKey: "invalid" }] });
    expect(result).toMatchObject({ inserted: 0, updated: 0, skipped: 0, revenueComplete: false });
    expect(result.errors.map(row => row.rowNumber).sort()).toEqual([2, 3, 4, 5]);
  });
  it("distingue corrección y repetición, y conserva la fuente explícita", async () => {
    apply.mockReset().mockResolvedValueOnce({ applied: true, created: false }).mockResolvedValueOnce({ applied: false, created: false });
    const result = await SalesIngestService.ingestInTransaction(scope(), { ...params, source: "pos:counter",
      rows: [row(2, 0, 0), { ...row(3, 1), productKey: "second" }] });
    expect(result).toMatchObject({ inserted: 0, updated: 1, skipped: 1, revenueComplete: true });
    expect(apply.mock.calls[0][1]).toMatchObject({ source: "pos:counter", quantitySold: "0.00" });
  });
  it("no captura fallos de infraestructura como errores de fila", async () => {
    apply.mockReset().mockRejectedValue(new Error("connection lost"));
    await expect(SalesIngestService.ingestInTransaction(scope(), { ...params, rows: [row(2, 1)] })).rejects.toThrow("connection lost");
  });
  it("resuelve UUID/nombre propio y rechaza nombre ambiguo o UUID desconocido", async () => {
    const missing = randomUUID();
    expect(await SalesIngestService.resolveRecipeRefs(companyId, [recipeId, " plato ", "Duplicado", missing], scope()))
      .toEqual(new Map([[recipeId, recipeId], [" plato ", recipeId], ["Duplicado", null], [missing, null]]));
  });
  it("rechaza sucursal ajena incluso con archivo vacío", async () => {
    await expect(SalesIngestService.ingestInTransaction(scope(true, false), { ...params, rows: [] })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  });
});
