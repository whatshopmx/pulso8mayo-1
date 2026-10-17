import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { POST } from "@/app/api/equipment/maintenance/route";
import { db } from "@/lib/db";
import { requireAuth, requireTenant } from "@/lib/tenant-context";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn(), requireTenant: vi.fn() }));

const companyId = "a1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const equipmentId = "e1000000-0000-4000-8000-000000000001";
const values = vi.fn();
const where = vi.fn();

function equipment(row: object | null) {
  where.mockReturnValue({ limit: async () => row ? [row] : [] });
  vi.mocked(db.select).mockReturnValue({ from: () => ({ where }) } as never);
}

function create(extra: object = {}) {
  return POST(new Request("http://localhost/api/equipment/maintenance", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ equipmentId, maintenanceType: "PREVENTIVE",
      scheduledDate: "2026-10-20T12:00:00Z", description: "Inspección", ...extra }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: "actor", role: "GERENTE", branchId, companyId } } as never);
  vi.mocked(requireTenant).mockResolvedValue({ id: companyId, userId: "actor", branchId } as never);
  equipment({ id: equipmentId, companyId, branchId });
  values.mockReturnValue({ returning: async () => [{ id: "maintenance" }] });
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  vi.mocked(db.update).mockReturnValue({ set: () => ({ where: async () => [] }) } as never);
});

describe("SEC-01: alta general de mantenimiento", () => {
  it("rechaza equipo de otra empresa sin escrituras y consulta por empresa", async () => {
    equipment(null);
    expect((await create()).status).toBe(404);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.params).toEqual([equipmentId, companyId]);
  });

  it("rechaza equipo de otra sucursal sin escrituras", async () => {
    equipment({ id: equipmentId, companyId, branchId: "otra-sucursal" });
    expect((await create()).status).toBe(403);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it.each(["EMPLEADO", "READONLY"])("%s no programa mantenimiento", async (role) => {
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: "actor", role, branchId, companyId } } as never);
    expect((await create()).status).toBe(403);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("programa en el alcance del equipo sin adelantar el último mantenimiento", async () => {
    expect((await create({ companyId: "ajena", branchId: "ajena", createdBy: "ajeno" })).status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      equipmentId, companyId, branchId, createdBy: "actor", status: "SCHEDULED",
    }));
    expect(db.update).not.toHaveBeenCalled();
  });
});
