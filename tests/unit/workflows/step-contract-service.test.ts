import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  WorkflowExecutionService,
  WorkflowStepContractError,
} from "@/lib/services/workflow-execution-service";
import { PATCH as updateStepRoute } from "@/app/api/workflows/executions/[id]/steps/[stepId]/route";
import { requireExecutionAccess } from "@/lib/workflows/execution-access";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    query: {
      workflowInstances: { findFirst: vi.fn() },
      workflowTemplates: { findFirst: vi.fn() },
      workflowInstanceSteps: { findFirst: vi.fn(), findMany: vi.fn() },
      users: { findFirst: vi.fn(), findMany: vi.fn() },
      branches: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("@/lib/workflows/execution-access", () => ({
  requireExecutionAccess: vi.fn(),
  assertExecutionInScope: vi.fn(),
}));

vi.mock("@/lib/websocket/workflow-handlers", () => ({
  emitWorkflowEvent: vi.fn(),
}));

const INSTANCE_ID = "inst-00000000-0000-0000-0000-000000000001";
const STEP_ID = "paso-temperatura";

const mockInstance = {
  id: INSTANCE_ID,
  branchId: "branch-1",
  assigneeId: "user-emp",
  workflowTemplateId: "tpl-1",
  status: "IN_PROGRESS",
};

const mockStepDef = {
  id: STEP_ID,
  type: "NUMBER",
  title: "Temperatura de Cámara Fría",
  required: true,
  evidenceRequired: true,
  validation: { min: 2, max: 8 },
};

const mockSavedStep = {
  id: "step-row-1",
  instanceId: INSTANCE_ID,
  stepId: STEP_ID,
  status: "PENDING",
  value: null,
  definition: mockStepDef,
};

function actorEmpleado() {
  return {
    userId: "user-emp",
    role: "EMPLEADO" as const,
    companyId: "company-1",
    branchId: "branch-1",
  };
}

function actorSupervisor() {
  return {
    userId: "user-sup",
    role: "SUPERVISOR" as const,
    companyId: "company-1",
    branchId: "branch-1",
  };
}

function cortarEnUpdate() {
  const returning = vi.fn().mockResolvedValue([{ id: "step-row-1", status: "COMPLETED" }]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where, returning };
}

function mockDbSelect() {
  const limit = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where, limit });
  vi.mocked(db.select).mockReturnValue({ from } as never);
}

describe("C24 — WorkflowExecutionService.updateStep con validación de contrato", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect();
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(mockInstance as never);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue({
      id: "tpl-1",
      steps: [mockStepDef],
    } as never);
    vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue(mockSavedStep as never);
    vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue([mockSavedStep] as never);
  });

  it("rechaza si falta el valor requerido y NO llama a db.update", async () => {
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCE_ID,
        STEP_ID,
        { status: "COMPLETED", value: null, evidenceUrl: "https://foto.jpg" },
        { kind: "session", actor: actorEmpleado(), performedBy: "user-emp" }
      )
    ).rejects.toThrow(WorkflowStepContractError);

    expect(update.set).not.toHaveBeenCalled();
  });

  it("rechaza si falta la evidencia requerida (evidenceRequired: true) y NO llama a db.update", async () => {
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCE_ID,
        STEP_ID,
        { status: "COMPLETED", value: 4, evidenceUrl: "" },
        { kind: "session", actor: actorEmpleado(), performedBy: "user-emp" }
      )
    ).rejects.toThrow(WorkflowStepContractError);

    expect(update.set).not.toHaveBeenCalled();
  });

  it("rechaza si el valor excede el límite superior (max: 8) y NO llama a db.update", async () => {
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCE_ID,
        STEP_ID,
        { status: "COMPLETED", value: 12.5, evidenceUrl: "https://foto.jpg" },
        { kind: "session", actor: actorEmpleado(), performedBy: "user-emp" }
      )
    ).rejects.toThrow(WorkflowStepContractError);

    expect(update.set).not.toHaveBeenCalled();
  });

  it("rechaza intento de EMPLEADO de omitir (SKIPPED) un paso obligatorio", async () => {
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCE_ID,
        STEP_ID,
        { status: "SKIPPED", comment: "No quise hacerlo" },
        { kind: "session", actor: actorEmpleado(), performedBy: "user-emp" }
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_SKIP", statusCode: 403 });

    expect(update.set).not.toHaveBeenCalled();
  });

  it("rechaza intento de SUPERVISOR de omitir paso obligatorio si NO incluye justificación", async () => {
    const update = cortarEnUpdate();

    await expect(
      WorkflowExecutionService.updateStep(
        INSTANCE_ID,
        STEP_ID,
        { status: "SKIPPED", comment: "   " },
        { kind: "session", actor: actorSupervisor(), performedBy: "user-sup" }
      )
    ).rejects.toMatchObject({ code: "SKIP_JUSTIFICATION_REQUIRED", statusCode: 400 });

    expect(update.set).not.toHaveBeenCalled();
  });

  it("SUPERVISOR puede omitir paso obligatorio con justificación registrada", async () => {
    const update = cortarEnUpdate();

    await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      STEP_ID,
      { status: "SKIPPED", comment: "Termómetro en calibración oficial NOM-251" },
      { kind: "session", actor: actorSupervisor(), performedBy: "user-sup" }
    );

    expect(update.set).toHaveBeenCalledTimes(1);
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SKIPPED",
        comment: "Termómetro en calibración oficial NOM-251",
      })
    );
  });

  it("escribe en base si el payload cumple con valor y evidencia válidos", async () => {
    const update = cortarEnUpdate();

    await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      STEP_ID,
      { status: "COMPLETED", value: 4.2, evidenceUrl: "https://r2/termometro.jpg" },
      { kind: "session", actor: actorEmpleado(), performedBy: "user-emp" }
    );

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "COMPLETED",
        value: 4.2,
        evidenceUrl: "https://r2/termometro.jpg",
      })
    );
  });
});

describe("C24 — Ruta PATCH /api/workflows/executions/[id]/steps/[stepId]", () => {
  const params = Promise.resolve({ id: INSTANCE_ID, stepId: STEP_ID });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect();
    vi.mocked(requireExecutionAccess).mockResolvedValue(actorEmpleado());
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(mockInstance as never);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue({
      id: "tpl-1",
      steps: [mockStepDef],
    } as never);
    vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue(mockSavedStep as never);
    vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue([mockSavedStep] as never);
    (db.query as any).users.findFirst.mockResolvedValue(null);
    (db.query as any).users.findMany.mockResolvedValue([]);
    (db.query as any).branches.findFirst.mockResolvedValue({ id: "branch-1", name: "Sucursal Central" });
    cortarEnUpdate();
  });

  it("devuelve 400 con código y mensaje cuando falta el valor requerido", async () => {
    const req = new Request(`http://localhost/api/workflows/executions/${INSTANCE_ID}/steps/${STEP_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED", value: null }),
    });

    const res = await updateStepRoute(req, { params });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Este paso requiere evidencia documental o fotográfica obligatoria.");
    expect(json.code).toBe("EVIDENCE_REQUIRED");
  });

  it("devuelve 403 cuando un empleado intenta omitir un paso requerido", async () => {
    const req = new Request(`http://localhost/api/workflows/executions/${INSTANCE_ID}/steps/${STEP_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SKIPPED" }),
    });

    const res = await updateStepRoute(req, { params });
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toBe("Solo un supervisor o administrador puede omitir un paso obligatorio.");
    expect(json.code).toBe("UNAUTHORIZED_SKIP");
  });

  it("devuelve 200 cuando el payload es válido", async () => {
    const req = new Request(`http://localhost/api/workflows/executions/${INSTANCE_ID}/steps/${STEP_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "COMPLETED",
        value: 5.5,
        evidenceUrl: "https://foto.jpg",
      }),
    });

    const res = await updateStepRoute(req, { params });
    expect(res.status).toBe(200);
  });
});
