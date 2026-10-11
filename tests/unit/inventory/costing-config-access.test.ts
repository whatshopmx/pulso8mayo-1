import { describe, it, expect, vi, beforeEach } from "vitest";

import { db } from "@/lib/db";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { CostingService } from "@/lib/services/costing-service";
import { PATCH } from "@/app/api/inventory/costing/config/route";
import {
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  SUCURSAL_B_1,
  adminA,
  empleadoA1,
  gerenteA1,
  gerenteA1SinSucursal,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C07 — cambiar el método de costeo verifica de qué sucursal es (H02).
 *
 * `PATCH /api/inventory/costing/config` comprobaba `inventory:update` y nada
 * más: obtenía el tenant y no lo usaba. Con el id de una sucursal ajena, un
 * `GERENTE` o un `SUPERVISOR` cambiaba el método de costeo de otra empresa —que
 * a su vez decide cómo se valoriza su inventario.
 *
 * Las guardas de la ruta se prueban con sus funciones reales; `CostingService`
 * va simulado porque lo que importa es si se llega a llamarlo.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

vi.mock("@/lib/tenant-context", () => ({
  requireAuth: vi.fn(),
  requireTenant: vi.fn(),
}));

/** `db.select().from().where().limit()` — `assertBranchOfCompany`. */
function encadenarSelect(filas: unknown[]) {
  const limit = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

function sesion(de: SessionFixture) {
  vi.mocked(requireAuth).mockResolvedValue({
    user: {
      id: de.id,
      role: de.role,
      companyId: de.companyId,
      branchId: de.branchId,
      email: de.email,
    },
    session: { id: "sesion" },
  } as never);
  vi.mocked(requireTenant).mockResolvedValue({
    id: de.companyId,
    userId: de.id,
    branchId: de.branchId,
  } as never);
}

function peticion(cuerpo: unknown) {
  return new Request("http://localhost/api/inventory/costing/config", {
    method: "PATCH",
    body: JSON.stringify(cuerpo),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion(adminA);
  vi.spyOn(CostingService, "updateBranchMethod").mockResolvedValue(undefined);
  vi.spyOn(CostingService, "clearBranchMethod").mockResolvedValue(undefined);
});

describe("PATCH /api/inventory/costing/config — pertenencia de la sucursal", () => {
  it("un admin cambia el método de una sucursal de su empresa", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const res = await PATCH(peticion({ branchId: SUCURSAL_A_1, method: "AVERAGE_COST" }) as never);

    expect(res.status).toBe(200);
    expect(CostingService.updateBranchMethod).toHaveBeenCalledWith(
      SUCURSAL_A_1,
      "AVERAGE_COST"
    );
  });

  it("una sucursal de otra empresa no llega al servicio", async () => {
    // La sucursal existe —la llave foránea no dice nada de quién es—, así que
    // sin esta comprobación el cambio pasaba.
    encadenarSelect([]);

    const res = await PATCH(peticion({ branchId: SUCURSAL_B_1, method: "AVERAGE_COST" }) as never);

    expect(res.status).toBe(400);
    expect(CostingService.updateBranchMethod).not.toHaveBeenCalled();
  });

  it("un reset de una sucursal ajena tampoco pasa", async () => {
    encadenarSelect([]);

    const res = await PATCH(peticion({ branchId: SUCURSAL_B_1, reset: true }) as never);

    expect(res.status).toBe(400);
    expect(CostingService.clearBranchMethod).not.toHaveBeenCalled();
  });

  it("un gerente sólo cambia el método de su sucursal", async () => {
    sesion(gerenteA1);
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const res = await PATCH(peticion({ branchId: SUCURSAL_A_2, method: "LAST_COST" }) as never);

    expect(res.status).toBe(403);
    expect(CostingService.updateBranchMethod).not.toHaveBeenCalled();
    // El alcance se resuelve antes que la empresa: un id ajeno no sirve ni para
    // confirmar que esa sucursal existe.
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("un gerente sin sucursal falla cerrado", async () => {
    sesion(gerenteA1SinSucursal);

    const res = await PATCH(peticion({ branchId: SUCURSAL_A_1, method: "LAST_COST" }) as never);

    expect(res.status).toBe(403);
    expect(CostingService.updateBranchMethod).not.toHaveBeenCalled();
  });

  it("un rol sin permiso de inventario no cambia nada", async () => {
    sesion(empleadoA1); // `inventory: read` únicamente

    const res = await PATCH(peticion({ branchId: SUCURSAL_A_1, method: "LAST_COST" }) as never);

    expect(res.status).toBe(403);
    expect(CostingService.updateBranchMethod).not.toHaveBeenCalled();
  });

  it("un método inválido se rechaza en el servidor", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const res = await PATCH(peticion({ branchId: SUCURSAL_A_1, method: "PROMEDIO_MAGICO" }) as never);

    expect(res.status).toBe(400);
    expect(CostingService.updateBranchMethod).not.toHaveBeenCalled();
  });

  it("un usuario sin empresa recibe 403 antes de buscar la sucursal", async () => {
    sesion(adminA);
    vi.mocked(requireTenant).mockResolvedValue({
      id: null,
      userId: adminA.id,
      unassigned: true,
      branchId: null,
    } as never);

    const res = await PATCH(peticion({ branchId: SUCURSAL_A_1, method: "LAST_COST" }) as never);

    expect(res.status).toBe(403);
    expect(CostingService.updateBranchMethod).not.toHaveBeenCalled();
  });
});