import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), declare: vi.fn() }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: mocks.authorize }));
vi.mock("@/lib/services/accounting/purchase-adapter", () => ({ declarePurchase: mocks.declare }));
import { POST } from "@/app/api/finance/accounting/purchases/route";
const request = (body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/finance/accounting/purchases", {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1");
  mocks.authorize.mockResolvedValue({ ctx: { userCompanyId: "company", userId: "actor", userRole: "OWNER" } });
  mocks.declare.mockResolvedValue({ journal: { id: "posted" }, reason: null });
});
afterEach(() => vi.unstubAllEnvs());
it("requires a session with publish permission and the accounting review flag", async () => {
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "0");
  expect((await POST(request({}))).status).toBe(503);
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1");
  mocks.authorize.mockRejectedValueOnce(ApiError.unauthorized());
  expect((await POST(request({}))).status).toBe(401);
  mocks.authorize.mockRejectedValueOnce(ApiError.forbidden());
  expect((await POST(request({}))).status).toBe(403);
  expect(mocks.declare).not.toHaveBeenCalled();
});
it("uses the session tenant and keeps responses private", async () => {
  const body = { sourceType: "PURCHASE_INVOICE", sourceId: "invoice" };
  const response = await POST(request(body));
  expect(response.status).toBe(201); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.declare).toHaveBeenCalledWith({ companyId: "company", actorId: "actor", role: "OWNER" }, body);
  expect(mocks.authorize).toHaveBeenCalledWith("accounting", "publish", expect.any(Object));
});
it("rejects cross-origin writes before declaration and hides unexpected service details", async () => {
  expect((await POST(request({}, "https://foreign.invalid"))).status).toBe(403);
  expect(mocks.declare).not.toHaveBeenCalled();
  mocks.declare.mockRejectedValueOnce(new Error("PRIVATE SQL ACCOUNT"));
  const response = await POST(request({})); expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
});
