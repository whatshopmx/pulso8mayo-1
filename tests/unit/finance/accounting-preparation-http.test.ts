import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn(), preview: vi.fn(), link: vi.fn(), create: vi.fn(),
  rule: vi.fn(), resolve: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: mocks.authorize }));
vi.mock("@/lib/services/accounting/account-service", () => ({ readAccountingPreparation: mocks.read,
  createAccount: mocks.create, linkSource: mocks.link }));
vi.mock("@/lib/services/accounting/expense-adapter", () => ({ previewExpenseRecognition: mocks.preview }));
vi.mock("@/lib/services/accounting/mapping-service", () => ({ getRule: mocks.rule, previewRule: mocks.resolve,
  listRules: mocks.list, createRule: vi.fn() }));
import { GET, POST } from "@/app/api/finance/accounting/preparation/route";
import { GET as settingsGET } from "@/app/api/finance/accounting/settings/route";

const companyId = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const url = "http://localhost/api/finance/accounting/preparation";
const request = (body: unknown, origin = "http://localhost") => new NextRequest(url, {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1");
  mocks.authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userId: "actor", userRole: "OWNER" } });
  mocks.read.mockResolvedValue({ centers: [], banks: [], accounts: [], links: [] });
});
afterEach(() => vi.unstubAllEnvs());

it("keeps preparation gated and rejects unauthorized reads without calling catalogs", async () => {
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "0");
  expect((await GET(new NextRequest(url))).status).toBe(503);
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1");
  mocks.authorize.mockRejectedValueOnce(ApiError.unauthorized());
  expect((await GET(new NextRequest(url))).status).toBe(401);
  mocks.authorize.mockResolvedValueOnce({ ctx: { userCompanyId: companyId, userId: "actor", userRole: "GERENTE" } });
  expect((await GET(new NextRequest(url))).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("takes the company from the session and returns private no-store data", async () => {
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.read).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" });
  expect((await GET(new NextRequest(`${url}?companyId=${id}`))).status).toBe(400);
});

it("previews an existing expense without invoking account or link mutations", async () => {
  mocks.preview.mockResolvedValue({ reason: null, published: false, lines: [] });
  expect((await GET(new NextRequest(`${url}?expenseId=${id}`))).status).toBe(200);
  expect(mocks.preview).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, id);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.link).not.toHaveBeenCalled();
  expect((await GET(new NextRequest(`${url}?expenseId=invalid`))).status).toBe(400);
});

it("rejects cross-origin writes and unknown actions before mutating configuration", async () => {
  expect((await POST(request({ action: "link", input: {} }, "https://untrusted.invalid"))).status).toBe(403);
  expect((await POST(request({ action: "activate", input: {} }))).status).toBe(400);
  expect(mocks.link).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  mocks.link.mockResolvedValue({ accountId: id });
  expect((await POST(request({ action: "link", input: { accountId: id, costCenterId: id } }))).status).toBe(201);
});

it("hides unexpected errors and preserves denials from the existing service", async () => {
  mocks.read.mockRejectedValueOnce(new Error("PRIVATE bank account"));
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  mocks.link.mockRejectedValueOnce(ApiError.notFound("La referencia no existe en esta empresa."));
  expect((await POST(request({ action: "link", input: {} }))).status).toBe(404);
});

it("accepts preview and version selectors without leaking them into strict rule schemas", async () => {
  mocks.resolve.mockResolvedValue({ rule: null, entries: [], blockers: [] });
  mocks.rule.mockResolvedValue({ rule: { id }, entries: [] });
  expect((await settingsGET(new NextRequest(`http://localhost/api/finance/accounting/settings?view=preview&eventType=EXPENSE_RECOGNIZED&date=2026-11-03`))).status).toBe(200);
  expect(mocks.resolve).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, { eventType: "EXPENSE_RECOGNIZED", date: "2026-11-03" });
  expect((await settingsGET(new NextRequest(`http://localhost/api/finance/accounting/settings?view=rule&id=${id}`))).status).toBe(200);
  expect(mocks.rule).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, id);
  expect((await settingsGET(new NextRequest("http://localhost/api/finance/accounting/settings?view=unknown"))).status).toBe(400);
});
