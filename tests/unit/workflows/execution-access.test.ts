import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/rbac/abac";
import {
  assertAssigneeAutorizado,
  assertBranchDestino,
  assertExecutionInScope,
  requireExecutionAccess,
} from "@/lib/workflows/execution-access";
import { GET } from "@/app/api/workflows/executions/[id]/route";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import {
  EMPLEADO_A_1,
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  SUCURSAL_B_1,
  adminA,
  empleadoA1,
  gerenteA1,
  gerenteA1SinSucursal,
  readonlyA,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C04 — creación y lectura de ejecuciones acotadas al actor (H02).
 *
 * `POST /api/workflows/execute` llevaba un `// TODO: Check permissions` y
 * `GET /api/workflows/executions/[id]` cargaba por id y ya. Aquí se prueban las
 * tres capas por separado:
 *
 * - La **puerta** decide, con la matriz de `lib/rbac/abac.ts`.
 * - El **alcance** decide, con el modelo ALL/BRANCH/NONE de `lib/branch-scope.ts`.
 * - La **ruta** llama a las dos y traduce el rechazo a su status HTTP.
 *
 * El detalle que más importa: `workflow_instances` **no tiene columna de
 * empresa**, así que la empresa de una instancia se averigua por su sucursal. Las
 * pruebas lo fijan: si alguien "optimiza" quitando esa comprobación, truena.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    query: {
      workflowTemplates: { findFirst: vi.fn() },
      workflowInstances: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: vi.fn() }));

const dialect = new PgDialect();

function traducir(condicion: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condicion as never);
}

function actor(de: SessionFixture) {
  return {
    userId: de.id,
    role: de.role,
    companyId: de.companyId,
    branchId: de.branchId,
  };
}

/** Sesión simulada para `requirePermissionApi`. */
function sesion(de: SessionFixture) {
  vi.mocked(requirePermissionApi).mockResolvedValue({
    session: { id: "sesion" },
    user: {
      id: de.id,
      role: de.role,
      companyId: de.companyId,
      branchId: de.branchId,
      email: de.email,
    },
    ctx: {},
    decision: { allowed: true },
  } as never);
}

/** `db.select().from().where().limit()` — la forma de las guardas. */
function encadenarSelect(filas: unknown[]) {
  const limit = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

const PLANTILLA_A = "plantilla-a";
const INSTANCIA_A = "4000000-0000-4000-8000-000000000001";

/** Instancia tal como la devuelve `getExecution` (fila + datos resueltos). */
function instancia(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCIA_A,
    workflowTemplateId: PLANTILLA_A,
    branchId: SUCURSAL_A_1,
    assigneeId: EMPLEADO_A_1,
    status: "IN_PROGRESS",
    steps: [],
    template: { id: PLANTILLA_A, companyId: adminA.companyId },
    branch: { id: SUCURSAL_A_1, name: "Condesa" },
    assignee: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion(adminA);
});

describe("requireExecutionAccess", () => {
  it("exige permiso de workflows y devuelve la empresa de la sesión", async () => {
    const actorDeEjecucion = await requireExecutionAccess("create");

    expect(requirePermissionApi).toHaveBeenCalledWith("workflows", "create");
    expect(actorDeEjecucion.companyId).toBe(adminA.companyId);
  });

  it("cierra a un rol sin permiso antes de tocar la base", async () => {
    sesion(empleadoA1);
    vi.mocked(requirePermissionApi).mockRejectedValue(
      new ApiErrorLike(403, "access-denied")
    );
    const select = encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(requireExecutionAccess("create")).rejects.toBeTruthy();
    expect(select.from).not.toHaveBeenCalled();
  });

  it("cierra a un usuario sin empresa", async () => {
    vi.mocked(requirePermissionApi).mockResolvedValue({
      session: {},
      user: { id: "u", role: "ADMIN", companyId: null, branchId: null, email: "x@y.z" },
      ctx: {},
      decision: { allowed: true },
    } as never);

    await expect(requireExecutionAccess("read")).rejects.toBeTruthy();
  });
});

/** ApiError mínimo para no arrastrar el módulo real al arnés. */
class ApiErrorLike extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

describe("assertBranchDestino — la sucursal donde arranca", () => {
  it("acepta la sucursal propia de un gerente", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    await expect(
      assertBranchDestino(actor(gerenteA1), SUCURSAL_A_1)
    ).resolves.toBeUndefined();
  });

  it("rechaza la sucursal de otro para un gerente, sin llegar a la base", async () => {
    const select = encadenarSelect([{ id: SUCURSAL_A_2 }]);

    await expect(
      assertBranchDestino(actor(gerenteA1), SUCURSAL_A_2)
    ).rejects.toBeTruthy();
    // El alcance se resuelve antes de preguntar a Postgres: el id ajeno no
    // sirve ni para confirmar que esa sucursal existe.
    expect(select.from).not.toHaveBeenCalled();
  });

  it("rechaza la sucursal de otra empresa aunque el alcance sea ALL", async () => {
    // ADMIN tiene alcance ALL, así que la puerta es `assertBranchOfCompany`.
    encadenarSelect([]);

    await expect(
      assertBranchDestino(actor(adminA), SUCURSAL_B_1)
    ).rejects.toBeTruthy();
  });

  it("un gerente sin sucursal falla cerrado", async () => {
    const select = encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertBranchDestino(actor(gerenteA1SinSucursal), SUCURSAL_A_1)
    ).rejects.toBeTruthy();
    expect(select.from).not.toHaveBeenCalled();
  });
});

describe("assertAssigneeAutorizado — el responsable", () => {
  it("el propio actor es siempre una asignación válida", async () => {
    const select = encadenarSelect([]);
    await expect(
      assertAssigneeAutorizado(actor(adminA), adminA.id)
    ).resolves.toBeUndefined();
    expect(select.from).not.toHaveBeenCalled();
  });

  it("rechaza un responsable de otra empresa", async () => {
    encadenarSelect([{ companyId: "otra-empresa", branchId: SUCURSAL_B_1 }]);

    await expect(
      assertAssigneeAutorizado(actor(adminA), "user-de-otra-empresa")
    ).rejects.toBeTruthy();
  });

  it("rechaza a un responsable de otra sucursal para un gerente acotado", async () => {
    encadenarSelect([{ companyId: adminA.companyId, branchId: SUCURSAL_A_2 }]);

    await expect(
      assertAssigneeAutorizado(actor(gerenteA1), "user-de-otra-sucursal")
    ).rejects.toBeTruthy();
  });

  it("acepta a un responsable de su empresa y sucursal", async () => {
    encadenarSelect([{ companyId: adminA.companyId, branchId: SUCURSAL_A_1 }]);

    await expect(
      assertAssigneeAutorizado(actor(gerenteA1), EMPLEADO_A_1)
    ).resolves.toBeUndefined();
  });
});

describe("assertExecutionInScope — la lectura por id", () => {
  it("un admin lee cualquier ejecución de su empresa", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    await expect(
      assertExecutionInScope(actor(adminA), instancia())
    ).resolves.toBeUndefined();
  });

  it("la empresa se averigua por la sucursal: la de B no es suya ni con alcance ALL", async () => {
    // Si alguien quita `assertBranchOfCompany` por "innecesario porque el
    // alcance ya filtró", esta es la prueba que truena.
    encadenarSelect([]);

    await expect(
      assertExecutionInScope(actor(adminA), instancia({ branchId: SUCURSAL_B_1 }))
    ).rejects.toBeTruthy();
  });

  it("un gerente no lee una ejecución de otra sucursal", async () => {
    encadenarSelect([{ id: SUCURSAL_A_2 }]);

    await expect(
      assertExecutionInScope(actor(gerenteA1), instancia({ branchId: SUCURSAL_A_2 }))
    ).rejects.toBeTruthy();
  });

  it("un gerente lee la de su sucursal aunque el responsable sea otro", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertExecutionInScope(actor(gerenteA1), instancia())
    ).resolves.toBeUndefined();
  });

  it("un gerente sin sucursal no lee nada, ni siquiera lo asignado a él", async () => {
    const select = encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertExecutionInScope(
        actor(gerenteA1SinSucursal),
        instancia({ assigneeId: gerenteA1SinSucursal.id })
      )
    ).rejects.toBeTruthy();
    expect(select.from).not.toHaveBeenCalled();
  });

  it("un empleado lee la ejecución que tiene asignada", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertExecutionInScope(actor(empleadoA1), instancia({ assigneeId: empleadoA1.id }))
    ).resolves.toBeUndefined();
  });

  it("un empleado no lee la ejecución asignada a otro de su sucursal", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertExecutionInScope(actor(empleadoA1), instancia({ assigneeId: "otro-empleado" }))
    ).rejects.toBeTruthy();
  });

  it("una ejecución sin asignar es de quien la puede tomar en su sucursal", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      assertExecutionInScope(actor(empleadoA1), instancia({ assigneeId: null }))
    ).resolves.toBeUndefined();
  });

  it("una ejecución sin asignar de otra sucursal no es de nadie que pregunta", async () => {
    encadenarSelect([{ id: SUCURSAL_A_2 }]);

    await expect(
      assertExecutionInScope(
        actor(empleadoA1),
        instancia({ assigneeId: null, branchId: SUCURSAL_A_2 })
      )
    ).rejects.toBeTruthy();
  });

  it("READONLY lee lo de su empresa pero no lo de otra", async () => {
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    await expect(
      assertExecutionInScope(actor(readonlyA), instancia())
    ).resolves.toBeUndefined();

    encadenarSelect([]);
    await expect(
      assertExecutionInScope(actor(readonlyA), instancia({ branchId: SUCURSAL_B_1 }))
    ).rejects.toBeTruthy();
  });
});

describe("GET /api/workflows/executions/[id] — la ruta con su status HTTP", () => {
  const params = Promise.resolve({ id: INSTANCIA_A });

  it("devuelve 404 cuando la instancia no existe", async () => {
    vi.spyOn(WorkflowExecutionService, "getExecution").mockResolvedValue(null);

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(404);
  });

  it("devuelve 403 cuando la instancia es de otra sucursal", async () => {
    vi.spyOn(WorkflowExecutionService, "getExecution").mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_2 }) as never
    );
    sesion(gerenteA1);
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(403);
  });

  it("devuelve la ejecución cuando el actor sí está en alcance", async () => {
    vi.spyOn(WorkflowExecutionService, "getExecution").mockResolvedValue(
      instancia() as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(200);
  });

  it("no consulta la base cuando el permiso ya se denegó", async () => {
    const getExecution = vi.spyOn(WorkflowExecutionService, "getExecution");
    vi.mocked(requirePermissionApi).mockRejectedValue(
      new ApiErrorLike(403, "access-denied")
    );

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(403);
    expect(getExecution).not.toHaveBeenCalled();
  });
});

describe("createExecution — la plantilla se busca dentro de la empresa", () => {
  it("filtra por id y company_id cuando la ruta pasa la empresa", async () => {
    const plantilla = { id: PLANTILLA_A, companyId: adminA.companyId, name: "Recepción", steps: [] };
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue(plantilla as never);

    // Cortamos después de la plantilla: aquí importa la condición, no el resto
    // del armado de la instancia.
    vi.spyOn(db.query.workflowTemplates, "findFirst").mockImplementation(
      () => new Promise(() => {}) as never
    );

    void WorkflowExecutionService.createExecution(
      PLANTILLA_A,
      SUCURSAL_A_1,
      adminA.id,
      null,
      undefined,
      adminA.companyId
    ).catch(() => undefined);

    const args = vi.mocked(db.query.workflowTemplates.findFirst).mock.calls[0][0];
    const { sql, params } = traducir((args as { where: unknown }).where);
    expect(sql).toContain('"id" =');
    expect(sql).toContain('"company_id" =');
    expect(params).toContain(adminA.companyId);
  });

  it("el camino interno sin empresa conserva el filtro por id", async () => {
    vi.spyOn(db.query.workflowTemplates, "findFirst").mockImplementation(
      () => new Promise(() => {}) as never
    );

    void WorkflowExecutionService.createExecution(
      PLANTILLA_A,
      SUCURSAL_A_1,
      adminA.id,
      null
    ).catch(() => undefined);

    const args = vi.mocked(db.query.workflowTemplates.findFirst).mock.calls[0][0];
    const { sql } = traducir((args as { where: unknown }).where);
    expect(sql).toContain('"id" =');
    expect(sql).not.toContain('"company_id" =');
  });
});