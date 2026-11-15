import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/finance/payees/[id]/finance/route";
import { getPayeeFinance, associatePayeeInvoice } from "@/lib/services/payee-finance-service";

const authState = vi.hoisted(() => ({ session: null as null | { user: Record<string, unknown> } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn(() => authState.session) } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/services/payee-finance-service", () => ({ getPayeeFinance: vi.fn(async () => ({})),
  associatePayeeInvoice: vi.fn(async () => ({})), getPayeeInvoiceCandidates: vi.fn(async () => []) }));
const payeeId = "00000000-0000-4000-8000-000000000002";
const branchId = "00000000-0000-4000-8000-000000000003";
const params = { params: Promise.resolve({ id: payeeId }) };
const url = `http://localhost/api/finance/payees/${payeeId}/finance`;
beforeEach(() => {
  vi.clearAllMocks();
  authState.session = { user: { id: "admin", role: "ADMIN", companyId: "company", branchId } };
});

describe("permisos de la ficha financiera", () => {
  it("rechaza solicitudes sin sesión", async () => {
    authState.session = null;
    expect((await GET(new Request(url), params)).status).toBe(401);
    expect(getPayeeFinance).not.toHaveBeenCalled();
  });
  it.each(["EMPLEADO", "READONLY"])("no permite consultar con rol %s", async role => {
    authState.session!.user.role = role;
    expect((await GET(new Request(url), params)).status).toBe(403);
  });
  it("fija la sucursal del gerente aunque pida otra", async () => {
    authState.session!.user.role = "GERENTE";
    expect((await GET(new Request(`${url}?branchId=00000000-0000-4000-8000-000000000090`), params)).status).toBe(200);
    expect(getPayeeFinance).toHaveBeenCalledWith("company", payeeId, branchId, 0, { from: undefined, to: undefined });
  });
  it("falla cerrado cuando el gerente no tiene sucursal", async () => {
    authState.session!.user = { ...authState.session!.user, role: "GERENTE", branchId: null };
    expect((await GET(new Request(url), params)).status).toBe(403);
    expect(getPayeeFinance).not.toHaveBeenCalled();
  });
  it("no acepta identidad de empresa ni actor del navegador", async () => {
    const response = await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expenseId: payeeId, invoiceId: branchId, companyId: "otra" }) }), params);
    expect(response.status).toBe(400);
    expect(associatePayeeInvoice).not.toHaveBeenCalled();
  });
  it("usa la identidad y alcance de sesión al asociar", async () => {
    authState.session!.user.role = "SUPERVISOR";
    expect((await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expenseId: payeeId, invoiceId: branchId }) }), params)).status).toBe(200);
    expect(associatePayeeInvoice).toHaveBeenCalledWith({ companyId: "company", actorId: "admin", payeeId,
      branchId, expenseId: payeeId, invoiceId: branchId });
  });
});
