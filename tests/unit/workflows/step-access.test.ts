import { describe, it, expect, vi, beforeEach } from "vitest";

import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { hayExcepcionVigente } from "@/lib/security/policy-overrides";
import { requireReviewAccess } from "@/lib/workflows/execution-access";
import { PATCH as updateStepRoute } from "@/app/api/workflows/executions/[id]/steps/[stepId]/route";
import { PATCH as reviewRoute } from "@/app/api/workflows/executions/[id]/route";
import { WorkflowExecutionService, WorkflowReviewError } from "@/lib/services/workflow-execution-service";
import {
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  SUCURSAL_B_1,
  adminA,
  empleadoA1,
  gerenteA1,
  readonlyA,
  supervisorA2,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C05 — actualizar un paso y revisar una ejecución son dos cosas distintas (H02).
 *
 * La ruta de paso decía `Unauthorized` si no había sesión y, con ella, escribía
 * sobre la fila de cualquiera: `workflow_instance_steps` no guarda empresa, y la
 * instancia se cargaba por id. La ruta de revisión no comprobaba **ningún**
 * permiso —cualquier sesión, incluso `READONLY`, podía aprobar o rechazar— y el
 * servicio sólo comparaba la empresa de la plantilla, así que un `GERENTE` de
 * una sucursal revisaba el trabajo de otra de la misma empresa.
 *
 * El servicio se prueba con su base simulada; las rutas se prueban con sus
 * funciones reales para que el status HTTP forme parte del contrato.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    query: {
      workflowInstances: { findFirst: vi.fn() },
      workflowTemplates: { findFirst: vi.fn() },
      workflowInstanceSteps: { findMany: vi.fn(), findFirst: vi.fn() },
    },
  },
}));

vi.mock("@/lib/security/policy-overrides", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/security/policy-overrides")>();
  return { ...real, hayExcepcionVigente: vi.fn() };
});

vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: vi.fn() }));

function actor(de: SessionFixture) {
  return {
    userId: de.id,
    role: de.role,
    companyId: de.companyId,
    branchId: de.branchId,
  };
}

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

function sinPermiso(statusCode = 403) {
  const error = new Error("access-denied");
  Object.assign(error, { name: "ApiError", statusCode });
  vi.mocked(requirePermissionApi).mockRejectedValue(error);
}

/** `db.select().from().where().limit()` — `assertBranchOfCompany`. */
function encadenarSelect(filas: unknown[]) {
  const limit = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

const INSTANCIA = "4000000-0000-4000-8000-000000000001";

/** Fila de `workflow_instances` tal como la devuelve el driver. */
function instancia(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCIA,
    workflowTemplateId: "plantilla-a",
    branchId: SUCURSAL_A_1,
    assigneeId: empleadoA1.id,
    status: "IN_PROGRESS",
    reviewStatus: null,
    ...overrides,
  };
}

/** Plantilla sin pasos dinámicos ni verificación: `updateStep` no llega lejos. */
function plantillaSinConfig() {
  return {
    id: "plantilla-a",
    companyId: adminA.companyId,
    name: "Recepción",
    steps: [{ id: "paso-1", type: "TEXT", config: {} }],
  };
}

/** Corta la ejecución en el UPDATE para no arrastrar incidentes ni ramas. */
function cortarEnUpdate() {
  const where = vi.fn(() => {
    throw new Error("__corte__");
  });
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where };
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion(adminA);
});

describe("updateStep — el servicio recibe contexto verificado", () => {
  it("con contexto de sesión verifica la instancia antes de escribir", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(instancia() as never);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue(
      plantillaSinConfig() as never
    );
    // Instancia de otra sucursal: el alcance cierra antes del UPDATE.
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_2 }) as never
    );
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCIA,
        "paso-1",
        { status: "COMPLETED", value: "x" },
        { kind: "session", actor: actor(gerenteA1), performedBy: gerenteA1.id }
      )
    ).rejects.toBeTruthy();

    expect(update.set).not.toHaveBeenCalled();
  });

  it("con contexto de sesión y alcance válido sí escribe", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(instancia() as never);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue(
      plantillaSinConfig() as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCIA,
        "paso-1",
        { status: "COMPLETED", value: "x" },
        { kind: "session", actor: actor(adminA), performedBy: adminA.id }
      )
    ).rejects.toThrow("__corte__");

    expect(update.set).toHaveBeenCalledTimes(1);
  });

  it("con contexto de enlace no vuelve a verificar la instancia", async () => {
    // `validateSmartLink` ya respondió por ella: el contexto es el token.
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(instancia() as never);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue(
      plantillaSinConfig() as never
    );
    const select = encadenarSelect([]);
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCIA,
        "paso-1",
        { status: "COMPLETED", value: "x" },
        { kind: "link", performedBy: "smart_link:abcd1234" }
      )
    ).rejects.toThrow("__corte__");

    expect(select.from).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenCalledTimes(1);
  });

  it("una instancia inexistente se responde como tal, no como 500", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(null as never);
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCIA,
        "paso-1",
        { status: "COMPLETED", value: "x" },
        { kind: "session", actor: actor(adminA), performedBy: adminA.id }
      )
    ).rejects.toBeInstanceOf(WorkflowReviewError);

    expect(update.set).not.toHaveBeenCalled();
  });
});

describe("PATCH /steps/[stepId] — la ruta", () => {
  const params = Promise.resolve({ id: INSTANCIA, stepId: "paso-1" });
  const peticion = () =>
    new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ status: "COMPLETED", value: "x" }),
      headers: { "content-type": "application/json" },
    });

  it("un rol sin permiso no llega al servicio", async () => {
    sinPermiso();
    const updateStep = vi.spyOn(WorkflowExecutionService, "updateStep");

    const res = await updateStepRoute(peticion(), { params });

    expect(res.status).toBe(403);
    expect(updateStep).not.toHaveBeenCalled();
  });

  it("READONLY no ejecuta pasos", async () => {
    // La matriz `workflows` le da `read`, no `update`.
    sinPermiso();
    const updateStep = vi.spyOn(WorkflowExecutionService, "updateStep");

    const res = await updateStepRoute(peticion(), { params });

    expect(res.status).toBe(403);
    expect(updateStep).not.toHaveBeenCalled();
  });

  it("un rechazo de alcance sale como 403 con su mensaje, no como 500", async () => {
    vi.spyOn(WorkflowExecutionService, "updateStep").mockRejectedValue(
      Object.assign(new Error("No puedes ver una ejecución de otra sucursal."), {
        name: "ApiError",
        statusCode: 403,
      })
    );

    const res = await updateStepRoute(peticion(), { params });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "No puedes ver una ejecución de otra sucursal.",
    });
  });

  it("una ejecución inexistente sale como 404", async () => {
    vi.spyOn(WorkflowExecutionService, "updateStep").mockRejectedValue(
      new WorkflowReviewError("NOT_FOUND", "No encontramos esta ejecución.")
    );

    const res = await updateStepRoute(peticion(), { params });

    expect(res.status).toBe(404);
  });
});

describe("requireReviewAccess — revisar no es ejecutar", () => {
  it("SUPERVISOR y gerencia pueden revisar", async () => {
    for (const sesionDe of [supervisorA2, gerenteA1, adminA]) {
      sesion(sesionDe);
      await expect(requireReviewAccess()).resolves.toMatchObject({
        companyId: sesionDe.companyId,
      });
    }
  });

  it("EMPLEADO no revisa aunque pueda cumplir sus propios pasos", async () => {
    sesion(empleadoA1);

    await expect(requireReviewAccess()).rejects.toBeTruthy();
  });

  it("READONLY no revisa", async () => {
    sesion(readonlyA);

    await expect(requireReviewAccess()).rejects.toBeTruthy();
  });
});

describe("reviewExecution — el alcance es empresa, sucursal y relación", () => {
  it("un gerente de otra sucursal no revisa el trabajo de esta", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_2 }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(gerenteA1)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("el rechazo de alcance llega como WorkflowReviewError, no como ApiError", async () => {
    // La ruta mapea códigos de WorkflowReviewError a status; un ApiError suelto
    // se convertiría en 500.
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_2 }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "REJECTED", reviewComment: "no" },
        actor(gerenteA1)
      )
    ).rejects.toBeInstanceOf(WorkflowReviewError);
  });

  it("una revisión de su propia sucursal sí pasa a las reglas de negocio", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_1, status: "COMPLETED", reviewStatus: null }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(gerenteA1)
      )
    ).rejects.toThrow("__corte__");

    expect(update.set).toHaveBeenCalledTimes(1);
  });

  it("el alcance se resuelve antes que las reglas de negocio", async () => {
    // Alcanzable por empresa pero no completada: si el alcance se comprobara
    // después, el mensaje sería NOT_REVIEWABLE y el operador creería que sólo
    // faltaba terminar el flujo.
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_1, status: "PENDING", reviewStatus: null }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(gerenteA1)
      )
    ).rejects.toMatchObject({ code: "NOT_REVIEWABLE" });
  });

  it("no revisa una ejecución de otra empresa aunque el alcance de rol sea ALL", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_B_1, status: "COMPLETED" }) as never
    );
    encadenarSelect([]);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(adminA)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("reviewExecution — nadie revisa su propio trabajo", () => {
  beforeEach(() => {
    // Por defecto: el revisor no registró ningún paso y no hay excepción.
    vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue(undefined as never);
    vi.mocked(hayExcepcionVigente).mockResolvedValue(false);
  });

  it("el responsable de la ejecución no puede revisarla", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ assigneeId: supervisorA2.id }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(supervisorA2)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quien registró un paso tampoco puede revisarla, aunque no sea el responsable", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ assigneeId: empleadoA1.id }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);
    vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue({
      id: "paso-1",
    } as never);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(supervisorA2)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("el alcance se comprueba antes que la auto-revisión", async () => {
    // Al revés, el mensaje le diría a un gerente de otra sucursal que no
    // puede revisar "porque participó", que no es lo que pasó y sí le da
    // información sobre quién la hizo.
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({ branchId: SUCURSAL_A_2, assigneeId: supervisorA2.id }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_1 }]);

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(supervisorA2)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("con una excepción concedida, el propio autor puede revisarla", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({
        branchId: SUCURSAL_A_2,
        assigneeId: supervisorA2.id,
        status: "COMPLETED",
      }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_2 }]);
    vi.mocked(hayExcepcionVigente).mockResolvedValue(true);
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(supervisorA2)
      )
    ).rejects.toThrow("__corte__");

    // La excepción se consulta para esa ejecución y en la empresa del revisor:
    // una excepción de otra empresa no abriría nada.
    expect(hayExcepcionVigente).toHaveBeenCalledWith(
      supervisorA2.companyId,
      expect.objectContaining({
        domain: "WORKFLOW_REVIEW",
        rule: "SELF_REVIEW",
        resourceType: "workflow_instance",
        resourceId: INSTANCIA,
      })
    );
    expect(update.set).toHaveBeenCalledTimes(1);
  });

  it("otro autor puede revisarla sin necesidad de excepción", async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(
      instancia({
        branchId: SUCURSAL_A_2,
        assigneeId: empleadoA1.id,
        status: "COMPLETED",
      }) as never
    );
    encadenarSelect([{ id: SUCURSAL_A_2 }]);
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.reviewExecution(
        INSTANCIA,
        { reviewStatus: "APPROVED" },
        actor(supervisorA2)
      )
    ).rejects.toThrow("__corte__");

    // Sin auto-revisión no hay ni una consulta extra a excepciones.
    expect(hayExcepcionVigente).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /executions/[id] — la ruta de revisión", () => {
  const params = Promise.resolve({ id: INSTANCIA });
  const peticion = (cuerpo: unknown) =>
    new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify(cuerpo),
      headers: { "content-type": "application/json" },
    });

  it("EMPLEADO recibe 403 y no se llama al servicio", async () => {
    sesion(empleadoA1);
    const review = vi.spyOn(WorkflowExecutionService, "reviewExecution");

    const res = await reviewRoute(peticion({ reviewStatus: "APPROVED" }), { params });

    expect(res.status).toBe(403);
    expect(review).not.toHaveBeenCalled();
  });

  it("un supervisor puede revisar", async () => {
    sesion(supervisorA2);
    vi.spyOn(WorkflowExecutionService, "reviewExecution").mockResolvedValue({
      id: INSTANCIA,
    } as never);

    const res = await reviewRoute(peticion({ reviewStatus: "APPROVED" }), { params });

    expect(res.status).toBe(200);
  });

  it("un cuerpo inválido se responde 400 antes de preguntar por la ejecución", async () => {
    const review = vi.spyOn(WorkflowExecutionService, "reviewExecution");

    const res = await reviewRoute(peticion({ reviewStatus: "tal-vez" }), { params });

    expect(res.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });
});