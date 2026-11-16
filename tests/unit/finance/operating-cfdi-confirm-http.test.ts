import { beforeEach, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { confirmOperatingCfdi } from "@/lib/services/operating-cfdi-confirm";
import { POST } from "@/app/api/finance/expense-invoices/confirm/route";
import { ApiError } from "@/lib/api/error";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/services/operating-cfdi-confirm", () => ({ confirmOperatingCfdi: vi.fn() }));
const companyId = "00000000-0000-4000-8000-000000000001", branchId = "00000000-0000-4000-8000-000000000002";
function request(data = JSON.stringify({ mode: "CREATE", branchId, payeeId: branchId, category: "SERVICIOS", description: "Luz" }), file = true) {
  const form = new FormData(); form.set("data", data); form.set("companyId", "foreign-company");
  if (file) form.set("file", new File(["<xml-original/>"], "cfdi.xml", { type: "application/xml" }));
  return new Request("http://localhost/api/finance/expense-invoices/confirm", { method: "POST", body: form });
}
beforeEach(() => {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "actor", companyId, branchId: null, role: "OWNER", email: "actor@fixture.invalid" } } as never);
  vi.mocked(confirmOperatingCfdi).mockReset().mockResolvedValue({ invoiceId: "invoice", expenseId: "expense", outcome: "CREATED" });
});
it("confirma usando el XML original y la identidad de sesión, no la del formulario", async () => {
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(confirmOperatingCfdi).toHaveBeenCalledWith({ userId: "actor", companyId, assignedBranchId: null, role: "OWNER" }, "<xml-original/>", expect.objectContaining({ mode: "CREATE", branchId }));
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rechaza sesión ausente y rol sin permiso antes del servicio", async () => {
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "actor", companyId, role: "READONLY" } } as never);
  expect((await POST(request())).status).toBe(403); expect(confirmOperatingCfdi).not.toHaveBeenCalled();
});
it("requiere XML y metadata JSON bien formada", async () => {
  expect((await POST(request("{}", false))).status).toBe(400);
  expect((await POST(request("bad-json"))).status).toBe(400); expect(confirmOperatingCfdi).not.toHaveBeenCalled();
});
it("no filtra información interna y conserva el conflicto genérico de duplicado", async () => {
  vi.mocked(confirmOperatingCfdi).mockRejectedValueOnce(ApiError.conflict("El CFDI ya está registrado o requiere revisión."));
  expect((await POST(request())).status).toBe(409);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    vi.mocked(confirmOperatingCfdi).mockRejectedValueOnce(new Error("database-secret"));
    const response = await POST(request()); expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database-secret");
  } finally { log.mockRestore(); }
});
