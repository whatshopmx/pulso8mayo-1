import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { workflowCompletionOutbox } from "@/lib/db/schema";

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

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@/lib/workflows/execution-access", () => ({ assertExecutionInScope: vi.fn() }));
vi.mock("@/lib/services/workflow-action-runner", () => ({ WorkflowActionRunner: { runCompletionActions: vi.fn() } }));
vi.mock("@/lib/services/smart-link-service", () => ({ SmartLinkService: { markUsedForInstance: vi.fn() } }));
vi.mock("@/lib/services/incident-engine", () => ({ IncidentEngine: {
  checkIncidentConditions: vi.fn().mockResolvedValue([]), hasBlockingIncidents: vi.fn().mockResolvedValue(false),
} }));

const INSTANCE_ID = "inst-delivery-0001";

const mockInstance = {
  id: INSTANCE_ID,
  branchId: "branch-1",
  assigneeId: "user-1",
  workflowTemplateId: "tpl-1",
  status: "IN_PROGRESS",
  data: {},
};

const mockCompletedStep = {
  id: "step-row-1",
  instanceId: INSTANCE_ID,
  stepId: "paso-final",
  status: "COMPLETED",
  value: null,
  definition: { id: "paso-final", type: "TEXT", required: true },
};

function actor() {
  return { userId: "user-1", role: "EMPLEADO" as const, companyId: "company-1", branchId: "branch-1" };
}

/** db.transaction(callback) → callback(db) */
function mockTx() {
  vi.mocked(db.transaction).mockImplementation(async (callback: any) => callback(db));
}

/** db.update().set().where().returning() resuelve con una fila. */
function updateReturning(row: any) {
  const returning = vi.fn().mockResolvedValue([row]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

describe("C28 — Garantizar entrega de efectos y mostrar efectos pendientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(db.execute).mockResolvedValue([]);
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue(mockInstance as never);
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue({
      id: "tpl-1",
      steps: [mockCompletedStep.definition],
    } as never);
    vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue(mockCompletedStep as never);
    vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue([mockCompletedStep] as never);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue([]) } as never);
  });

  it("marca completionEffectsStatus='pending' e inserta outbox pending al completar (C28.1)", async () => {
    const update = updateReturning({ id: INSTANCE_ID, status: "COMPLETED" });
    vi.mocked(db.update).mockReturnValue(update as never);

    await WorkflowExecutionService.updateStep(
      INSTANCE_ID,
      "paso-final",
      { status: "COMPLETED", value: "hecho" },
      { kind: "session", actor: actor(), performedBy: "user-1" }
    );

    // La transición escribió completionEffectsStatus='pending'
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMPLETED", completionEffectsStatus: "pending" })
    );
    // Insertó la intención de entrega en el outbox
    expect(db.insert).toHaveBeenCalledWith(workflowCompletionOutbox);
    const builder = vi.mocked(db.insert).mock.results[0].value;
    const valuesCall = vi.mocked(builder.values).mock.calls[0][0] as any;
    expect(valuesCall.instanceId).toBe(INSTANCE_ID);
    expect(valuesCall.intent).toBe("workflow/instance.completed");
    expect(valuesCall.status).toBe("pending");
  });

  it("propaga un fallo del outbox para revertir la transacción de cierre", async () => {
    vi.mocked(db.update).mockReturnValue(updateReturning({ id: INSTANCE_ID }) as never);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("outbox caído")) } as never);
    await expect(WorkflowExecutionService.recalculateProgress(INSTANCE_ID)).rejects.toThrow("outbox caído");
  });

  it("no duplica el outbox ni re-ejecuta efectos si la instancia ya está COMPLETED (idempotencia)", async () => {
    // Instancia ya COMPLETED: fast-path retorna sin tocar outbox ni efectos.
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue({
      ...mockInstance,
      status: "COMPLETED",
      completionEffectsStatus: "delivered",
    } as never);

    const update = updateReturning({ id: INSTANCE_ID, status: "COMPLETED" });
    vi.mocked(db.update).mockReturnValue(update as never);

    const resultado = await WorkflowExecutionService.recalculateProgress(INSTANCE_ID, "user-1");

    expect(resultado.alreadyCompleted).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
    expect(update.set).not.toHaveBeenCalled();
  });
});
