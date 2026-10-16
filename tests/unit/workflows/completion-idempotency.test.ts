import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { WorkflowActionRunner } from "@/lib/services/workflow-action-runner";
import { StockCountService } from "@/lib/services/stock-count-service";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { inngest } from "@/lib/inngest/client";
import { workflowCompletionOutbox } from "@/lib/db/schema";
import { assertExecutionInScope } from "@/lib/workflows/execution-access";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
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
  assertExecutionInScope: vi.fn(),
}));

vi.mock("@/lib/services/workflow-action-runner", () => ({
  WorkflowActionRunner: { runCompletionActions: vi.fn() },
}));

vi.mock("@/lib/services/stock-count-service", () => ({
  StockCountService: { completeStockCount: vi.fn(), notifyStockCountVariance: vi.fn() },
}));

vi.mock("@/lib/services/smart-link-service", () => ({
  SmartLinkService: { markUsedForInstance: vi.fn() },
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@/lib/services/incident-engine", () => ({
  IncidentEngine: {
    checkIncidentConditions: vi.fn().mockResolvedValue([]),
    hasBlockingIncidents: vi.fn().mockResolvedValue(false),
    evaluateCondition: vi.fn().mockReturnValue(false),
  },
}));

const INSTANCE_ID = "inst-completion-0001";
const STEP_ID = "paso-final";

const mockInstanceBase = {
  id: INSTANCE_ID,
  branchId: "branch-1",
  assigneeId: "user-1",
  workflowTemplateId: "tpl-1",
  data: {},
};

const mockStepDef = { id: STEP_ID, type: "TEXT", required: true };
const mockSavedStep = {
  id: "step-row-1",
  instanceId: INSTANCE_ID,
  stepId: STEP_ID,
  status: "PENDING",
  value: null,
  definition: mockStepDef,
};
const mockCompletedStep = { ...mockSavedStep, status: "COMPLETED" as const };

function actor() {
  return { userId: "user-1", role: "EMPLEADO" as const, companyId: "company-1", branchId: "branch-1" };
}

function instanceWithStatus(status: "IN_PROGRESS" | "COMPLETED") {
  return { ...mockInstanceBase, status };
}

/** db.update() → .set() → .where() → .returning() resuelve con una fila. */
function updateMockReturning(row: any) {
  const returning = vi.fn().mockResolvedValue([row]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

describe("C27 — Hacer única la transición de finalización (H10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertExecutionInScope).mockResolvedValue(undefined);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue({
      id: "tpl-1",
      steps: [mockStepDef],
    } as never);
    vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue(mockSavedStep as never);
    vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(db));
    vi.mocked(db.execute).mockResolvedValue([]);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue([]) } as never);
  });

  it("completar el último paso ejecuta efectos secundarios exactamente una vez", async () => {
    // Lecturas de instancia: inicial (updateStep) + fast-path (checkProgress) + doble-check dentro del lock
    vi.mocked(db.query.workflowInstances.findFirst)
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS"))
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS"))
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS"));
    // Todos los pasos ya están COMPLETED tras guardar este paso
    vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue([mockCompletedStep] as never);
    vi.mocked(db.update).mockReturnValue(updateMockReturning({ id: INSTANCE_ID, status: "COMPLETED" }) as never);

    const result = await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      STEP_ID,
      { status: "COMPLETED", value: "hecho" },
      { kind: "session", actor: actor(), performedBy: "user-1" }
    );

    expect(result.step.status).toBe("COMPLETED");

    // Criterio 1: efectos secundarios una sola vez por instancia
    expect(vi.mocked(WorkflowActionRunner.runCompletionActions)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(WorkflowActionRunner.runCompletionActions)).toHaveBeenCalledWith(
      INSTANCE_ID,
      "user-1",
      db,
    );
    expect(vi.mocked(SmartLinkService.markUsedForInstance)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(SmartLinkService.markUsedForInstance)).toHaveBeenCalledWith(INSTANCE_ID);
    // Stock count no aplica (sin stockCountGrid)
    expect(vi.mocked(StockCountService.completeStockCount)).not.toHaveBeenCalled();
    // El envío sale del outbox después del commit.
    expect(db.insert).toHaveBeenCalledWith(workflowCompletionOutbox);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("llamada duplicada o concurrente no vuelve a disparar efectos secundarios (idempotente)", async () => {
    // Simula dos llamadas concurrentes: ambas leen la instancia IN_PROGRESS al inicio,
    // pero la segunda ve COMPLETED en el fast-path de checkProgress (primera ya commiteó).
    vi.mocked(db.query.workflowInstances.findFirst)
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS")) // llamada 1: inicial
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS")) // llamada 1: fast-path
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS")) // llamada 1: doble-check dentro del lock
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS")) // llamada 2: inicial (lectura concurrente antes del commit)
      .mockResolvedValueOnce(instanceWithStatus("COMPLETED")); // llamada 2: fast-path ya ve COMPLETED → idempotente
    vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue([mockCompletedStep] as never);
    vi.mocked(db.update).mockReturnValue(updateMockReturning({ id: INSTANCE_ID, status: "COMPLETED" }) as never);

    // Llamada 1: completa y dispara efectos
    const resultado1 = await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      STEP_ID,
      { status: "COMPLETED", value: "hecho" },
      { kind: "session", actor: actor(), performedBy: "user-1" }
    );
    expect(resultado1.step.status).toBe("COMPLETED");

    // Llamada 2: duplicada / concurrente, no vuelve a disparar efectos
    const resultado2 = await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      STEP_ID,
      { status: "COMPLETED", value: "hecho" },
      { kind: "session", actor: actor(), performedBy: "user-1" }
    );
    expect(resultado2.step.status).toBe("COMPLETED");

    // Criterio 2: los efectos secundarios se ejecutaron una sola vez en total
    expect(vi.mocked(WorkflowActionRunner.runCompletionActions)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(SmartLinkService.markUsedForInstance)).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("recalculateProgress sobre instancia ya COMPLETED es idempotente (fast-path sin efectos)", async () => {
    // recalculateProgress no pasa por validarContratoDePaso, así que alcanza el fast-path de checkProgress.
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(instanceWithStatus("COMPLETED"));

    const resultado = await WorkflowExecutionService.recalculateProgress(INSTANCE_ID, "user-1");

    expect(resultado.alreadyCompleted).toBe(true);
    expect(resultado.completed).toBe(false);
    expect(resultado.notFound).toBe(false);

    // Criterio 2: instancia ya terminada no vuelve a disparar efectos secundarios
    expect(vi.mocked(WorkflowActionRunner.runCompletionActions)).not.toHaveBeenCalled();
    expect(vi.mocked(SmartLinkService.markUsedForInstance)).not.toHaveBeenCalled();
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
    expect(vi.mocked(StockCountService.completeStockCount)).not.toHaveBeenCalled();
  });

  it("no todos los pasos completos no dispara efectos de terminación", async () => {
    vi.mocked(db.query.workflowInstances.findFirst)
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS"))
      .mockResolvedValueOnce(instanceWithStatus("IN_PROGRESS"));
    // Queda al menos un paso PENDING
    vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue([
      mockCompletedStep,
      { ...mockSavedStep, stepId: "otro-paso", status: "PENDING" },
    ] as never);
    vi.mocked(db.update).mockReturnValue(updateMockReturning({ id: INSTANCE_ID, status: "IN_PROGRESS" }) as never);

    await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      STEP_ID,
      { status: "COMPLETED", value: "hecho" },
      { kind: "session", actor: actor(), performedBy: "user-1" }
    );

    expect(vi.mocked(WorkflowActionRunner.runCompletionActions)).not.toHaveBeenCalled();
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });
});
