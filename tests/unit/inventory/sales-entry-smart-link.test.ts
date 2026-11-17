import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { POST } from "@/app/api/workflows/smart-links/upload-pos/route";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { SalesIngestService } from "@/lib/services/sales-ingest-service";

const { update, conditions } = vi.hoisted(() => ({ update: vi.fn(), conditions: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { update } }));
vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn(), requireTenant: vi.fn() }));
vi.mock("@/lib/branch-scope", async () => ({ ...(await vi.importActual("@/lib/branch-scope")), assertBranchOfCompany: vi.fn() }));
vi.mock("@/lib/services/sales-ingest-service", async () => ({ ...(await import("@/lib/services/sales-ingest-pure")),
  SalesIngestService: { buildRows: (await import("@/lib/services/sales-ingest-pure")).buildRows, ingest: vi.fn() },
}));
const companyId = "c1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const otherBranch = "b2000000-0000-4000-8000-000000000002";
const key = `companies/${companyId}/branches/${branchId}/pos/2026-11-12/1_report.csv`;
const body = { branchId, fileUrl: key, businessDate: "2026-11-12" };
const json = (data = body) => POST(new NextRequest("http://localhost/api/workflows/smart-links/upload-pos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));
function session(role = "ADMIN", branch: string | null = null) {
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: "actor", companyId, branchId: branch, role } } as never);
}
beforeEach(() => {
  vi.clearAllMocks(); session();
  vi.mocked(requireTenant).mockResolvedValue({ id: companyId, userId: "actor", branchId: null });
  const query = { set: () => query, where: conditions, returning: async () => [] };
  conditions.mockReturnValue(query); update.mockReturnValue(query);
  vi.mocked(SalesIngestService.ingest).mockResolvedValue({ inserted: 0, updated: 1, skipped: 0, errors: [], revenueComplete: true, revenueCoverage: [] });
});
describe("frontera de archivo POS del cierre", () => {
  it("deniega empleado, rol ausente y gerente de otra sucursal antes de enlazar evidencia", async () => {
    for (const role of ["EMPLEADO", undefined]) {
      vi.mocked(requireAuth).mockResolvedValue({ user: { id: "actor", companyId, role } } as never);
      expect((await json()).status).toBe(403);
    }
    session("GERENTE", otherBranch); expect((await json()).status).toBe(403);
    expect(update).not.toHaveBeenCalled(); expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("solo enlaza cortes de empresa, sucursal y día solicitados", async () => {
    expect((await json()).status).toBe(200);
    const sql = new PgDialect().sqlToQuery(conditions.mock.calls[0][0]);
    expect(sql.params).toEqual([companyId, branchId, "2026-11-12"]);
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it.each([
    key.replace(companyId, "c2000000-0000-4000-8000-000000000002"),
    key.replace(branchId, otherBranch),
    key.replace("2026-11-12", "2026-11-13"),
    key.replace("/pos/", "/evidence/"),
    key.replace("1_report.csv", "../1_report.csv"),
    key.replace("1_report.csv", "%2e%2e%2f1_report.csv"),
    `${key}\n`,
    `${key}?download=1`,
    "pos-uploads/report.csv",
    "https://cdn.example/report.csv",
    `local://pos-uploads/${companyId}/${branchId}/2026-11-12-report.csv`,
  ])("rechaza referencias no verificables antes de actualizar el corte: %s", async fileUrl => {
    expect((await json({ ...body, fileUrl })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(SalesIngestService.ingest).not.toHaveBeenCalled();
  });
  it("rechaza día civil imposible y discrepancia entre tenant y sesión", async () => {
    expect((await json({ ...body, businessDate: "2026-02-30" })).status).toBe(400);
    vi.mocked(requireTenant).mockResolvedValue({ id: otherBranch, userId: "actor", branchId: null });
    expect((await json()).status).toBe(403); expect(update).not.toHaveBeenCalled();
  });
  it("multipart respeta mapeo explícito de producto, fuente común y cobertura de filas omitidas", async () => {
    const form = new FormData();
    form.set("branchId", branchId); form.set("businessDate", "2026-11-12");
    form.set("mapping", JSON.stringify({ productKey: "SKU", recipeRef: "Producto", quantitySold: "Cantidad" }));
    form.set("file", new File(["SKU,Producto,Cantidad\nABC,Plato,2\nBAD,Otro,invalid"], "report.csv", { type: "text/csv" }));
    const response = await POST(new NextRequest("http://localhost/api/workflows/smart-links/upload-pos", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect(vi.mocked(SalesIngestService.ingest).mock.calls[0][0]).toMatchObject({ companyId, branchId, source: "pos:import", rows: [{ productKey: "ABC" }] });
    expect((await response.json()).data.sales).toMatchObject({ updated: 1, revenueComplete: false, errors: [{ rowNumber: 3 }] });
  });
});
