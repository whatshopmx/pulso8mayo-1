import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), declare: vi.fn(), refund: vi.fn() }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: mocks.authorize }));
vi.mock("@/lib/services/accounting/sales-adapter", () => ({ declareSalesCut: mocks.declare, recordSalesRefund: mocks.refund }));
import { POST } from "@/app/api/finance/accounting/sales/route";

const id = "00000000-0000-4000-8000-000000000001", companyId = "00000000-0000-4000-8000-000000000002";
const url = "http://localhost/api/finance/accounting/sales";
const amounts = { totalCents: 11600, cashCents: 11600, cardCents: 0, platformCents: 0, otherCents: 0,
  revenueCents: 10000, discountCents: 0, taxCents: 1600, tipsCents: 0 };
const document = { ...amounts, documentId: id, cutId: id, totalIncludesTaxAndTips: true,
  documentReference: "SYN-POS", reason: "Declaración revisada" };
const request = (body: unknown, origin = "http://localhost") => new NextRequest(url, { method: "POST",
  headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1");
  mocks.authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userId: "actor", userRole: "OWNER" } });
  mocks.declare.mockResolvedValue({ journal: { id }, reason: null });
  mocks.refund.mockResolvedValue({ journal: null, reason: "Regla pendiente." });
});
afterEach(() => vi.unstubAllEnvs());
it("authenticates first and requires the specific financial posting capability", async () => {
  mocks.authorize.mockRejectedValueOnce(ApiError.unauthorized());
  expect((await POST(request({ action: "DECLARE", document }))).status).toBe(401);
  expect(mocks.declare).not.toHaveBeenCalled();
  const response = await POST(request({ action: "DECLARE", document }));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.authorize).toHaveBeenLastCalledWith("accounting", "publish", expect.objectContaining({ classification: "FINANCIAL" }));
  expect(mocks.declare).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, expect.objectContaining({ cutId: id, version: 1 }));
});
it("requires reversal authority for a linked refund", async () => {
  const refund = { ...amounts, documentId: id, originalId: id, accountingDate: "2026-11-01",
    documentReference: "REF-1", reason: "Devolución autorizada" };
  expect((await POST(request({ action: "REFUND", document: refund }))).status).toBe(200);
  expect(mocks.authorize).toHaveBeenLastCalledWith("accounting", "reverse", expect.objectContaining({ classification: "FINANCIAL" }));
  expect(mocks.refund).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, refund);
});
it("rejects cross-origin JSON, a forged tenant and incomplete tax or tip declarations", async () => {
  expect((await POST(request({ action: "DECLARE", document }, "https://untrusted.invalid"))).status).toBe(403);
  expect((await POST(request({ action: "DECLARE", document, companyId }))).status).toBe(400);
  expect((await POST(request({ action: "DECLARE", document: { ...document, tipsCents: undefined } }))).status).toBe(400);
  expect((await POST(request({ action: "DECLARE", document: { ...document, taxCents: undefined } }))).status).toBe(400);
  expect(mocks.declare).not.toHaveBeenCalled();
});
it("keeps review disabled and returns safe errors", async () => {
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "0");
  expect((await POST(request({ action: "DECLARE", document }))).status).toBe(503);
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1"); mocks.declare.mockRejectedValueOnce(new Error("PRIVATE SQL WITH BANK DATA"));
  const response = await POST(request({ action: "DECLARE", document }));
  expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
});
