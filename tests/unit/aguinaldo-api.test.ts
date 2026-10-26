import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), preview: vi.fn(), execute: vi.fn(), recover: vi.fn(), dispersion: vi.fn(), list: vi.fn(),
}));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: mocks.permission }));
vi.mock("@/lib/services/aguinaldo-payroll-service", () => ({
  previsualizarAguinaldo: mocks.preview, executeAguinaldoRun: mocks.execute,
  recuperarAguinaldoRun: mocks.recover,
  registrarDispersionExcedente: mocks.dispersion, listarDispersionesExcedente: mocks.list,
  AguinaldoRunDuplicadoError: class extends Error {}, AguinaldoDispersionInvalidaError: class extends Error {},
}));
import { GET, POST } from "@/app/api/payroll/aguinaldo/route";
import { ApiError } from "@/lib/api/error";

const branchId = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) => new NextRequest("http://localhost/api/payroll/aguinaldo", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ ctx: { userCompanyId: "company-session", userId: "actor-session" } });
  mocks.preview.mockResolvedValue({ fechaPago: "2026-01-31", totalNetoCents: 780_269 });
  mocks.execute.mockResolvedValue({ runId: "run", results: [] });
  mocks.recover.mockResolvedValue({ runId: branchId, fechaPago: "2026-12-15", anioFiscal: 2026, status: "COMPLETED", results: [] });
});

describe("AGU-03B.4C — API de recuperación", () => {
  it("recupera por ID con empresa de sesión, sin fecha/salarios nuevos ni preview", async () => {
    const response = await POST(post({ action: "RECOVER", runId: branchId }));
    expect(response.status).toBe(200);
    expect(mocks.recover).toHaveBeenCalledWith("company-session", branchId);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect((await response.json()).data).toMatchObject({ fechaPago: "2026-12-15", status: "COMPLETED" });
  });
  it.each([{ runId: "no-uuid" }, { runId: branchId, fechaPago: "2026-12-16" }, { runId: branchId, companyId: "otra" }])("rechaza payload de recuperación inválido: %j", async (body) => {
    expect((await POST(post({ action: "RECOVER", ...body }))).status).toBe(400);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it("corrida ajena o snapshot inconsistente no se presenta como recuperado", async () => {
    mocks.recover.mockRejectedValue(new RangeError("Corrida no encontrada en esta empresa"));
    expect((await POST(post({ action: "RECOVER", runId: branchId }))).status).toBe(400);
  });
  it.each([401, 403])("requiere permiso financiero: %s", async (status) => {
    mocks.permission.mockRejectedValue(new ApiError("Acceso rechazado", status));
    expect((await POST(post({ action: "RECOVER", runId: branchId }))).status).toBe(status);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});

describe("AGU-03A.2 — API del pago", () => {
  it("GET preserva fecha y año causado, con empresa de la sesión", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/payroll/aguinaldo?anioFiscal=2025&fechaPago=2026-01-31&branchId=${branchId}&companyId=ajena`));
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith("company-session", 2025, branchId, { fechaPago: "2026-01-31" });
    expect((await response.json()).data).toMatchObject({ fechaPago: "2026-01-31", totalNetoCents: 780_269 });
  });

  it("POST transmite la fecha autorizada y el actor de sesión", async () => {
    const response = await POST(post({ anioFiscal: 2025, fechaPago: "2026-01-31", companyId: "ajena", performedBy: "ajeno" }));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith("company-session", 2025, "actor-session", {
      fechaPago: "2026-01-31", diasLaboradosPorUsuario: undefined,
    }, undefined);
    expect((await response.json()).data.windowWarning).toMatch(/fuera de diciembre/i);
  });

  it.each([undefined, "2026-02-29", "2026-01-01T00:00:00Z", null, 20260101])("POST rechaza fecha ausente/inválida %s antes de ejecutar", async (fechaPago) => {
    expect((await POST(post({ anioFiscal: 2026, fechaPago }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("GET rechaza un día imposible antes de calcular", async () => {
    expect((await GET(new NextRequest("http://localhost/api/payroll/aguinaldo?anioFiscal=2026&fechaPago=2026-04-31"))).status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("el bloqueo fiscal del servicio es 400 y no un éxito parcial", async () => {
    mocks.execute.mockRejectedValue(new RangeError("Se requieren acumulados mensuales conciliados"));
    expect((await POST(post({ anioFiscal: 2026, fechaPago: "2026-12-15" }))).status).toBe(400);
  });

  it.each([401, 403])("conserva rechazo de acceso %s", async (status) => {
    mocks.permission.mockRejectedValue(new ApiError("Acceso rechazado", status));
    expect((await GET(new NextRequest("http://localhost/api/payroll/aguinaldo"))).status).toBe(status);
    expect((await POST(post({ anioFiscal: 2026, fechaPago: "2026-12-15" }))).status).toBe(status);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
