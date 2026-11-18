import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  auth: { tenantId: "c1000000-0000-4000-8000-000000000001",
    user: { id: "actor", role: "ADMIN", branchId: null as string | null } },
  select: vi.fn(), where: vi.fn(),
}));
vi.mock("@/lib/api/with-auth", () => ({
  withRoleAuth: (_roles: unknown, handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    (req: unknown) => handler(req, { auth: state.auth }),
}));
vi.mock("@/lib/db", () => ({ db: { select: state.select } }));
vi.mock("@/lib/services/cash-variance-alert-service", () => ({ checkCashVarianceAndAlertSafe: vi.fn() }));
vi.mock("@/lib/services/financial-period-service", () => ({ isPeriodClosed: vi.fn() }));
vi.mock("@/lib/services/accounting/sales-cut-capture", () => ({ persistSalesCutInScope: vi.fn() }));

import { GET } from "@/app/api/sales/cuts/route";

const branch = "b1000000-0000-4000-8000-000000000001";
const other = "b2000000-0000-4000-8000-000000000002";
const day = "2026-11-17";
const call = (extra = "") => GET(new NextRequest(`http://localhost/api/sales/cuts?startDate=${day}&endDate=${day}${extra}`), {} as never);

beforeEach(() => {
  vi.clearAllMocks();
  state.auth.user.role = "ADMIN";
  state.auth.user.branchId = null;
  state.select.mockImplementation((columns: { total?: unknown }) => {
    const query = { from: () => query, leftJoin: () => query,
      where: (condition: unknown) => {
        state.where(condition);
        return columns.total ? Promise.resolve([{ total: 7 }]) : query;
      },
      orderBy: () => query, limit: () => query, offset: async () => [],
    };
    return query;
  });
});

it.each(["GERENTE", "SUPERVISOR"])("%s sin filtro usa su sucursal en filas, conteo y alcance", async role => {
  state.auth.user.role = role;
  state.auth.user.branchId = branch;
  const response = await call();
  expect(response.status).toBe(200);
  expect((await response.json()).data.scope.branchId).toBe(branch);
  expect(state.where).toHaveBeenCalledTimes(2);
  for (const [condition] of state.where.mock.calls) {
    expect(new PgDialect().sqlToQuery(condition).params).toEqual([state.auth.tenantId, branch, day, day]);
  }
});

it.each(["GERENTE", "SUPERVISOR"])("%s no puede solicitar otra sucursal", async role => {
  state.auth.user.role = role;
  state.auth.user.branchId = branch;
  expect((await call(`&branchId=${other}`)).status).toBe(403);
  expect(state.select).not.toHaveBeenCalled();
});

it.each(["GERENTE", "SUPERVISOR"])("%s sin sucursal asignada queda denegado", async role => {
  state.auth.user.role = role;
  expect((await call()).status).toBe(403);
  expect(state.select).not.toHaveBeenCalled();
});

it("ADMIN mantiene alcance de empresa o filtro explícito", async () => {
  expect((await (await call()).json()).data.scope.branchId).toBeNull();
  for (const [condition] of state.where.mock.calls) {
    expect(new PgDialect().sqlToQuery(condition).params).toEqual([state.auth.tenantId, day, day]);
  }
  state.where.mockClear();
  expect((await (await call(`&branchId=${branch}`)).json()).data.scope.branchId).toBe(branch);
  for (const [condition] of state.where.mock.calls) {
    expect(new PgDialect().sqlToQuery(condition).params).toEqual([state.auth.tenantId, branch, day, day]);
  }
});

it("rechaza una sucursal mal formada antes de consultar Postgres", async () => {
  expect((await call("&branchId=invalid")).status).toBe(400);
  expect(state.select).not.toHaveBeenCalled();
});
