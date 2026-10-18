import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/workflows/evidence/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveEvidenceUrl } from "@/lib/storage/scoped-evidence";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/storage/scoped-evidence", () => ({
  resolveEvidenceUrl: vi.fn(async (value: string | null | undefined) => value ?? null),
}));

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchA = "b1000000-0000-4000-8000-000000000001";
const branchB = "b2000000-0000-4000-8000-000000000002";

let whereArg: unknown;
let rows: unknown[] = [];

function chain() {
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn((arg: unknown) => {
    whereArg = arg;
    return { orderBy };
  });
  const node: Record<string, unknown> = { where };
  node.leftJoin = vi.fn(() => node);
  return node;
}

function paramsOfWhere(): string[] {
  const query = new PgDialect().sqlToQuery(whereArg as never);
  return query.params as string[];
}

const url = (query = "") =>
  new NextRequest(`http://localhost/api/workflows/evidence${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  whereArg = undefined;
  rows = [];
  vi.mocked(db.select).mockReturnValue({ from: () => chain() } as never);
});

describe("SEC-02: consulta de evidencia acotada al actor", () => {
  it("a un gerente se le impone su sucursal y se ignora el branchId pedido", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "gerente", role: "GERENTE", branchId: branchA, companyId },
    } as never);

    const res = await GET(url(`?branchId=${branchB}`));

    expect(res.status).toBe(200);
    const params = paramsOfWhere();
    expect(params).toContain(branchA);
    expect(params).not.toContain(branchB);
  });

  it("un empleado sólo consulta sus tareas aunque manipule la sucursal", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "empleado-1", role: "EMPLEADO", branchId: branchA, companyId },
    } as never);

    await GET(url(`?branchId=${branchB}`));

    expect(paramsOfWhere()).toContain("empleado-1");
  });

  it("un rol de sucursal sin sucursal asignada recibe vacío sin consultar", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "supervisor", role: "SUPERVISOR", branchId: null, companyId },
    } as never);

    const res = await GET(url());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: [] });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("la URL firmada se deriva sólo para la evidencia ya filtrada", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin", role: "ADMIN", branchId: null, companyId },
    } as never);
    rows = [
      { id: "s1", evidenceUrl: "companies/c/branchA/1.jpg", aiAnalysis: null, createdAt: null },
      { id: "s2", evidenceUrl: "", aiAnalysis: null, createdAt: null },
    ];

    const res = await GET(url());

    await expect(res.json()).resolves.toMatchObject({ data: [{ id: "s1" }] });
    expect(resolveEvidenceUrl).toHaveBeenCalledTimes(1);
    expect(resolveEvidenceUrl).toHaveBeenCalledWith("companies/c/branchA/1.jpg");
  });
});
