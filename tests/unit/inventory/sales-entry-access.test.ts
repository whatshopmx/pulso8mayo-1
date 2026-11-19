import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/inventory/sales-entry/route";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { SalesIngestService } from "@/lib/services/sales-ingest-service";
import { SaleConsumptionError } from "@/lib/services/sale-consumption-service";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/services/sales-ingest-service", () => ({ SalesIngestService: { ingest: vi.fn() } }));

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchA = "b1000000-0000-4000-8000-000000000001";
const branchB = "b2000000-0000-4000-8000-000000000002";
const recipeId = "d1000000-0000-4000-8000-000000000001";
function session(user: Record<string, unknown>) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: "actor", ...user } } as never);
}
function request(body: Record<string, unknown> | string) {
  return POST(new NextRequest("http://localhost/api/inventory/sales-entry", { method: "POST",
    headers: { "content-type": "application/json" }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
}
beforeEach(() => {
  vi.clearAllMocks();
  const chain = { from: () => chain, where: () => ({ limit: async () => [{ id: branchA }] }) };
  vi.mocked(db.select).mockReturnValue(chain as never);
  vi.mocked(SalesIngestService.ingest).mockResolvedValue({ inserted: 1, updated: 0, skipped: 0, errors: [], revenueComplete: false, revenueCoverage: [] });
});
describe("captura manual mediante writer único", () => {
  it("rechaza JSON mal formado o vacío con 400 antes de consultar stock", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    for (const body of ['{', '']) {
      const response = await request(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'El cuerpo debe contener JSON válido.' });
    }
    expect(db.select).not.toHaveBeenCalled();
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("niega sesión ausente, empleado sin permiso y rol ausente antes de escribir", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await request({})).status).toBe(401);
    for (const role of ["EMPLEADO", undefined]) {
      session({ role, companyId, branchId: branchA });
      expect((await request({ sales: [{ recipeId, quantitySold: 1 }] })).status).toBe(403);
    }
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("rechaza sucursal ajena al alcance y gerente sin asignación", async () => {
    session({ role: "GERENTE", companyId, branchId: branchA });
    expect((await request({ branchId: branchB, sales: [{ recipeId, quantitySold: 1 }] })).status).toBe(403);
    session({ role: "GERENTE", companyId, branchId: null });
    expect((await request({ sales: [{ recipeId, quantitySold: 1 }] })).status).toBe(403);
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("usa identidad estable, fecha civil escrita y null para ingreso no reportado", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    const response = await request({ branchId: branchA, saleDate: "2026-11-12T23:00:00-06:00", sales: [{ recipeId, quantitySold: 2 }] });
    expect(response.status).toBe(200);
    expect(SalesIngestService.ingest).toHaveBeenCalledWith({ companyId, branchId: branchA, userId: "actor", source: "manual:recipe", atomic: true,
      rows: [{ rowNumber: 1, recipeRef: recipeId, productKey: recipeId, saleDay: "2026-11-12", quantitySold: 2, totalRevenueCents: null }] });
    expect(await response.json()).toMatchObject({ success: true, inserted: 1, revenueComplete: false });
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("acepta cero de anulación y convierte dinero exacto a centavos", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    expect((await request({ branchId: branchA, saleDate: "2026-11-12", sales: [{ recipeId, quantitySold: 0, totalRevenue: 0 }, { recipeId, quantitySold: 1, totalRevenue: 1.01 }] })).status).toBe(200);
    expect(vi.mocked(SalesIngestService.ingest).mock.calls[0][0].rows.map(row => row.totalRevenueCents)).toEqual([0, 101]);
  });
  it("rechaza precisión excesiva, overflow, fechas imposibles y lote vacío", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    for (const body of [
      { sales: [{ recipeId, quantitySold: 1.001 }] },
      { sales: [{ recipeId, quantitySold: 100000000 }] },
      { sales: [{ recipeId, quantitySold: 1, totalRevenue: 0.001 }] },
      { sales: [{ recipeId, quantitySold: 1, totalRevenue: 21474836.48 }] },
      { saleDate: "2026-02-30", sales: [{ recipeId, quantitySold: 1 }] },
      { sales: [] },
    ]) expect((await request({ branchId: branchA, ...body })).status).toBe(400);
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("traduce errores de negocio del writer a 400/403/409 con código visible", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    for (const [code, status] of [["INVALID_INPUT", 400], ["INVALID_SCOPE", 403], ["PENDING_RECOVERY", 409], ["INSUFFICIENT_STOCK", 409]] as const) {
      vi.mocked(SalesIngestService.ingest).mockRejectedValueOnce(new SaleConsumptionError(code, "Venta no aplicada"));
      const response = await request({ branchId: branchA, sales: [{ recipeId, quantitySold: 1 }] });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, error: "Venta no aplicada" });
    }
  });
});
