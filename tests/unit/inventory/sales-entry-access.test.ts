import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/inventory/sales-entry/route";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { TheoreticalConsumptionService } from "@/lib/services/theoretical-consumption-service";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/services/theoretical-consumption-service", () => ({
  TheoreticalConsumptionService: { consume: vi.fn() },
}));

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchA = "b1000000-0000-4000-8000-000000000001";
const branchB = "b2000000-0000-4000-8000-000000000002";
const recipeId = "d1000000-0000-4000-8000-000000000001";

let selectQueue: unknown[][] = [];
const insertValues = vi.fn();

function thenable(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    limit: () => promise,
    then: (onFulfilled: unknown, onRejected: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  };
}

function session(user: Record<string, unknown>) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: "actor", ...user } } as never);
}

function request(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/inventory/sales-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  insertValues.mockResolvedValue([]);
  vi.mocked(db.insert).mockReturnValue({ values: insertValues } as never);
  vi.mocked(db.select).mockImplementation(() => {
    const rows = selectQueue.shift() ?? [];
    const node = { from: () => node, where: () => thenable(rows) };
    return node as never;
  });
});

describe("SEC-03: registro manual de ventas", () => {
  it("niega a un empleado sin autoridad antes de tocar la base", async () => {
    session({ role: "EMPLEADO", companyId, branchId: branchA });

    const res = await request({ sales: [{ recipeId, quantitySold: 1 }] });

    expect(res.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
    expect(TheoreticalConsumptionService.consume).not.toHaveBeenCalled();
  });

  it("rechaza una sucursal ajena al alcance del gerente", async () => {
    session({ role: "GERENTE", companyId, branchId: branchA });

    const res = await request({ branchId: branchB, sales: [{ recipeId, quantitySold: 1 }] });

    expect(res.status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
    expect(TheoreticalConsumptionService.consume).not.toHaveBeenCalled();
  });

  it("rechaza recetas de otra empresa antes de escribir la primera venta", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    selectQueue = [[{ id: branchA }], []]; // sucursal válida, recetas ajenas

    const res = await request({ branchId: branchA, sales: [{ recipeId, quantitySold: 2 }] });

    expect(res.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
    expect(TheoreticalConsumptionService.consume).not.toHaveBeenCalled();
  });

  it("registra venta legítima en la sucursal validada", async () => {
    session({ role: "ADMIN", companyId, branchId: null });
    selectQueue = [[{ id: branchA }], [{ id: recipeId }]];

    const res = await request({ branchId: branchA, sales: [{ recipeId, quantitySold: 2 }] });

    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, branchId: branchA, recipeId })
    );
    expect(TheoreticalConsumptionService.consume).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, branchId: branchA, recipeId, userId: "actor" })
    );
  });
});
