import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), slips: vi.fn(), auth: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: mocks.permission }));
vi.mock("@/lib/services/payroll-service", () => ({ getPayrollPayslips: mocks.slips }));
// Permite reproducir el contrato anterior, que sólo autenticaba y elegía tenant.
vi.mock("@/lib/tenant-context", () => ({ requireAuth: mocks.auth, requireTenant: mocks.tenant }));
import { GET } from "@/app/api/payroll/[id]/payslips/route";
import { ApiError } from "@/lib/api/error";

const company = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const request = () => new NextRequest(`http://localhost/api/payroll/${runId}/payslips?companyId=otra`);
const params = (id = runId) => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ ctx: { userCompanyId: company } });
  mocks.tenant.mockResolvedValue({ id: company }); mocks.auth.mockResolvedValue({ user: { companyId: company } });
  mocks.slips.mockResolvedValue([{ id: "recibo", totalPercepcionesCents: 900000 }]);
});

describe("OPS-02.nomina.B.3 — contrato API de recibos", () => {
  it("exige lectura FINANCIAL y pasa empresa de sesión, ignorando el companyId de query", async () => {
    const req = request(); const response = await GET(req, params());
    expect(response.status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("reports", "read", { classification: "FINANCIAL", audit: { action: "READ", req } });
    expect(mocks.slips).toHaveBeenCalledWith(company, runId);
    expect((await response.json()).data).toEqual([{ id: "recibo", totalPercepcionesCents: 900000 }]);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it.each([401, 403])("rechaza sesión/permiso con %s antes de consultar recibos", async (status) => {
    mocks.permission.mockRejectedValue(new ApiError("Acceso rechazado", status));
    expect((await GET(request(), params())).status).toBe(status);
    expect(mocks.slips).not.toHaveBeenCalled();
  });
  it.each(["", "no-uuid"])("ID inválido %s devuelve 400 sin consultar SQL", async (id) => {
    expect((await GET(request(), params(id))).status).toBe(400);
    expect(mocks.slips).not.toHaveBeenCalled();
  });
  it("sin empresa en el contexto devuelve 400", async () => {
    mocks.permission.mockResolvedValue({ ctx: { userCompanyId: "" } });
    expect((await GET(request(), params())).status).toBe(400);
    expect(mocks.slips).not.toHaveBeenCalled();
  });
  it("mantiene 404 para corrida ajena/inexistente", async () => {
    mocks.slips.mockRejectedValue(ApiError.notFound("Corrida de nómina no encontrada"));
    expect((await GET(request(), params())).status).toBe(404);
  });
});
