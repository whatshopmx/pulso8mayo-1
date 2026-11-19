import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/inventory/sales-entry/bulk/route";
import { getSession } from "@/lib/auth";
import { SalesIngestService } from "@/lib/services/sales-ingest-service";
import { SaleConsumptionError } from "@/lib/services/sale-consumption-service";
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/services/sales-ingest-service", async () => ({
  SalesIngestService: { buildRows: (await import("@/lib/services/sales-ingest-pure")).buildRows, ingest: vi.fn() },
}));
const companyId = "c1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const otherBranch = "b2000000-0000-4000-8000-000000000002";
const body = { branchId, csvText: "SKU,Recipe,Qty\nABC,Plato,2", mapping: { productKey: "SKU", recipeRef: "Recipe", quantitySold: "Qty" }, defaultDay: "2026-11-12" };
const request = (data = body) => POST(new NextRequest("http://localhost/api/inventory/sales-entry/bulk", { method: "POST", body: JSON.stringify(data) }));
function session(role?: string, branch: string | null = branchId) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: "actor", companyId, branchId: branch, role } } as never);
}
beforeEach(() => {
  vi.clearAllMocks(); session("ADMIN");
  vi.mocked(SalesIngestService.ingest).mockResolvedValue({ inserted: 0, updated: 1, skipped: 0, errors: [], revenueCoverage: [], revenueComplete: true });
});
describe("frontera bulk al writer", () => {
  it("rechaza JSON inválido o vacío antes de parsear CSV o aplicar consumo", async () => {
    for (const body of ['{', '']) {
      const response = await POST(new NextRequest('http://localhost/api/inventory/sales-entry/bulk', { method: 'POST', body }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'El cuerpo debe contener JSON válido.' });
    }
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("no eleva rol ausente a ADMIN y rechaza sucursal fuera de alcance", async () => {
    session(); expect((await request()).status).toBe(403);
    session("GERENTE"); expect((await request({ ...body, branchId: otherBranch })).status).toBe(403);
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("conserva clave de producto independiente y expone corrección/cobertura", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(vi.mocked(SalesIngestService.ingest).mock.calls[0][0]).toMatchObject({ companyId, branchId, userId: "actor", source: "pos:import",
      rows: [{ productKey: "ABC", recipeRef: "Plato", quantitySold: 2, totalRevenueCents: null }] });
    expect(await response.json()).toMatchObject({ updated: 1, revenueComplete: true });
  });
  it("no afirma cobertura completa si el parser descartó otro grupo", async () => {
    const response = await request({ ...body, csvText: "SKU,Recipe,Qty\nABC,Plato,2\nBAD,Otro,invalid" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revenueComplete: false, errors: [{ rowNumber: 3 }] });
  });
  it("archivo sin filas válidas devuelve 400 y no aplica el writer", async () => {
    const response = await request({ ...body, csvText: "SKU,Recipe,Qty\nABC,Plato,invalid" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ inserted: 0, updated: 0, skipped: 0, revenueComplete: false });
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("traduce alcance de empresa rechazado por runtime a 403", async () => {
    vi.mocked(SalesIngestService.ingest).mockRejectedValue(new SaleConsumptionError("INVALID_SCOPE", "Sucursal fuera de la empresa"));
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_SCOPE" });
  });
});
