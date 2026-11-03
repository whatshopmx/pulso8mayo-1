import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), retry: vi.fn(),
  repair: vi.fn(), due: vi.fn(), process: vi.fn(), companies: vi.fn() }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: mocks.authorize }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: mocks.companies }) }) }) }) } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: {
  createFunction: (config: unknown, handler: unknown) => ({ config, handler }),
} }));
vi.mock("@/lib/services/accounting/event-service", async original => ({
  ...await original<typeof import("@/lib/services/accounting/event-service")>(),
  listPendingAccountingEvents: mocks.list, retryAccountingEvent: mocks.retry,
  recoverMissingAccountingEvents: mocks.repair, dueAccountingEvents: mocks.due, processAccountingEvent: mocks.process,
}));
import { GET, POST } from "@/app/api/finance/accounting/pending/route";
import { accountingPost, accountingRecoverySweep } from "@/lib/inngest/functions/accounting-post";
const companyId = "00000000-0000-4000-8000-000000000001", eventId = "00000000-0000-4000-8000-000000000002";
const url = "http://localhost/api/finance/accounting/pending";
const request = (body: unknown, origin = "http://localhost") => new NextRequest(url, {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "1"); vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  mocks.authorize.mockResolvedValue({ ctx: { userCompanyId: companyId, userId: "actor", userRole: "OWNER" } });
  mocks.list.mockResolvedValue({ items: [], total: 0 }); mocks.retry.mockResolvedValue({ journal: null, reason: "Periodo cerrado." });
});
afterEach(() => vi.unstubAllEnvs());

it("requires session, financial read permission, bounded paging and private responses", async () => {
  const response = await GET(new NextRequest(`${url}?page=2&pageSize=10`));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.list).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, { page: 2, pageSize: 10 });
  expect(mocks.authorize).toHaveBeenCalledWith("accounting", "read", expect.objectContaining({ classification: "FINANCIAL" }));
  expect((await GET(new NextRequest(`${url}?companyId=${companyId}`))).status).toBe(400);
  expect((await GET(new NextRequest(`${url}?pageSize=101`))).status).toBe(400);
  mocks.authorize.mockRejectedValueOnce(ApiError.unauthorized());
  expect((await GET(new NextRequest(url))).status).toBe(401);
});

it("requires posting authority and same-origin JSON, refusing forged principals and disabled review", async () => {
  expect((await POST(request({ eventId }, "https://untrusted.invalid"))).status).toBe(403);
  expect((await POST(request({ eventId, companyId }))).status).toBe(400);
  expect(mocks.retry).not.toHaveBeenCalled();
  expect((await POST(request({ eventId }))).status).toBe(200);
  expect(mocks.authorize).toHaveBeenLastCalledWith("accounting", "publish", expect.objectContaining({ classification: "FINANCIAL" }));
  expect(mocks.retry).toHaveBeenCalledWith({ companyId, actorId: "actor", role: "OWNER" }, eventId);
  vi.stubEnv("ACCOUNTING_REVIEW_ENABLED", "0");
  expect((await GET(new NextRequest(url))).status).toBe(503);
});

it("hides internal SQL errors from pending and retry responses", async () => {
  mocks.list.mockRejectedValueOnce(new Error("PRIVATE SQL"));
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
});

// createFunction is captured at registration; steps execute their real callbacks.
type Worker = { handler: (args: { event: { data: unknown }; step: { run: ReturnType<typeof vi.fn>; sendEvent: ReturnType<typeof vi.fn> } }) => Promise<unknown> };
const worker = accountingPost as unknown as Worker;
const sweep = accountingRecoverySweep as unknown as Worker;
const steps = () => ({ run: vi.fn(async (_name: string, fn: () => unknown) => fn()), sendEvent: vi.fn() });

it("runs each durable posting independently and lets a failed step retry", async () => {
  const step = steps(); mocks.due.mockResolvedValue([{ id: eventId }]);
  mocks.process.mockRejectedValueOnce(new Error("Simulated network failure")).mockResolvedValueOnce({ journal: { id: eventId } });
  await expect(worker.handler({ event: { data: { companyId } }, step })).rejects.toThrow("network failure");
  await worker.handler({ event: { data: { companyId } }, step });
  expect(step.run).toHaveBeenCalledWith(`post-${eventId}`, expect.any(Function));
  expect(mocks.process).toHaveBeenCalledTimes(2);
  expect(mocks.repair).toHaveBeenCalledWith(companyId);
});

it("dispatches bounded company pages, carries the cursor and stops all jobs when disabled", async () => {
  const step = steps(); mocks.companies.mockResolvedValue(Array.from({ length: 100 }, () => ({ id: companyId })));
  await sweep.handler({ event: { data: {} }, step });
  expect(step.sendEvent).toHaveBeenCalledWith("next-company-page", { name: "accounting/recovery.page", data: { after: companyId } });
  expect(step.sendEvent).toHaveBeenCalledWith("dispatch-companies", expect.arrayContaining([
    { name: "accounting/recover.company", data: { companyId } },
  ]));
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0"); vi.clearAllMocks();
  await worker.handler({ event: { data: { companyId } }, step });
  await sweep.handler({ event: { data: {} }, step });
  expect(step.run).not.toHaveBeenCalled(); expect(step.sendEvent).not.toHaveBeenCalled();
});
