import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C35.1 — productores migrados a la ruta durable.
 *
 * `check-overdue` (`workflow_overdue`) y `workflow-reminders`
 * (`workflow_due_soon`) dejan de enviar por el dispatcher y encolan en
 * `NotificationQueue`. Lo que se prueba es la garantía de idempotencia: una
 * ocurrencia produce un id de evento determinista y repetirla produce el mismo
 * id, que Inngest deduplica. Un fallo de encolado no se cuenta como enviado.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  selectResult: [] as unknown[],
  markOverdue: vi.fn(),
  getOrCreateForInstance: vi.fn(),
  findInstance: vi.fn(),
  findTemplate: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/lib/inngest/client", () => ({ inngest: { send: mocks.send } }));

vi.mock("@/lib/services/workflow-assignment-service", () => ({
  WorkflowAssignmentService: { markOverdue: mocks.markOverdue },
}));

vi.mock("@/lib/services/smart-link-service", () => ({
  SmartLinkService: { getOrCreateForInstance: mocks.getOrCreateForInstance },
}));

vi.mock("@/lib/db", () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.leftJoin = () => builder;
  builder.where = () => Promise.resolve(mocks.selectResult);
  builder.orderBy = () => Promise.resolve(mocks.selectResult);
  return {
    db: {
      select: () => builder,
      update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
      query: {
        workflowInstances: { findFirst: mocks.findInstance },
        workflowTemplates: { findFirst: mocks.findTemplate },
      },
    },
  };
});

const { checkOverdueAssignments } = await import("@/lib/cron/check-overdue");
const { sendWorkflowReminders } = await import("@/lib/cron/workflow-reminders");

const AHORA = new Date("2026-10-19T16:00:00Z");

function sendCalls() {
  return mocks.send.mock.calls.map(([event]) => event as {
    id: string;
    name: string;
    data: { id: string; payload: { eventType: string; metadata?: Record<string, unknown> } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  mocks.selectResult = [];
  mocks.markOverdue.mockResolvedValue(undefined);
  mocks.getOrCreateForInstance.mockResolvedValue({ url: "https://pulso.test/link/abc" });
  mocks.findInstance.mockResolvedValue({ id: "i1", workflowTemplateId: "t1", sessionId: "s1" });
  mocks.findTemplate.mockResolvedValue({ name: "Apertura", reminderIntervals: [1440] });
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("check-overdue (workflow_overdue)", () => {
  it("una asignación vencida encola una sola notificación con clave natural", async () => {
    mocks.selectResult = [
      {
        assignment: { id: "a1", assignedTo: "u1", instanceId: "i1", dueDate: AHORA },
        instance: { id: "i1", workflowTemplateId: "t1", sessionId: "s1" },
        template: { name: "Apertura de sucursal" },
      },
    ];

    const result = await checkOverdueAssignments();

    expect(result).toMatchObject({ success: true, processed: 1, errors: 0 });
    const [call] = sendCalls();
    expect(call.name).toBe("notification/dispatch.requested");
    expect(call.id).toBe("notification-dispatch:notif_workflow-overdue:a1");
    expect(call.data.id).toBe("notif_workflow-overdue:a1");
    expect(call.data.payload.eventType).toBe("workflow_overdue");
    expect(call.data.payload.metadata).toMatchObject({ dedupeKey: "workflow-overdue:a1" });
  });

  it("repetir la ocurrencia produce el mismo id (sin segunda notificación)", async () => {
    mocks.selectResult = [
      {
        assignment: { id: "a1", assignedTo: "u1", instanceId: "i1", dueDate: AHORA },
        instance: { id: "i1", workflowTemplateId: "t1", sessionId: "s1" },
        template: { name: "Apertura de sucursal" },
      },
    ];

    await checkOverdueAssignments();
    await checkOverdueAssignments();

    const ids = sendCalls().map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it("un fallo de encolado no se cuenta como enviado", async () => {
    mocks.selectResult = [
      {
        assignment: { id: "a1", assignedTo: "u1", instanceId: "i1", dueDate: AHORA },
        instance: { id: "i1", workflowTemplateId: "t1", sessionId: "s1" },
        template: { name: "Apertura de sucursal" },
      },
    ];
    mocks.send.mockRejectedValueOnce(new Error("Inngest caído"));

    const result = await checkOverdueAssignments();

    expect(result).toMatchObject({ success: true, processed: 0, errors: 1 });
  });
});

describe("workflow-reminders (workflow_due_soon)", () => {
  // 1438 minutos hasta el vencimiento: dentro de la ventana de 5 min del
  // intervalo de 24 h (1440).
  const VENCE_EN_24H = new Date(AHORA.getTime() + 1438 * 60 * 1000);

  const asignacion = () => ({
    assignment: {
      id: "a1",
      assignedTo: "u1",
      instanceId: "i1",
      dueDate: VENCE_EN_24H,
      status: "PENDING",
      remindersSent: [],
    },
  });

  it("un recordatorio escalonado encola una notificación con clave asignación+tipo", async () => {
    mocks.selectResult = [asignacion()];

    const result = await sendWorkflowReminders();

    expect(result).toMatchObject({ success: true, remindersSent: 1, errors: 0 });
    const [call] = sendCalls();
    expect(call.id).toBe("notification-dispatch:notif_workflow-due-soon:a1:24h");
    expect(call.data.payload.eventType).toBe("workflow_due_soon");
    expect(call.data.payload.metadata).toMatchObject({
      dedupeKey: "workflow-due-soon:a1:24h",
      reminderType: "24h",
    });
    // El seguimiento de negocio se conserva: se marca el recordatorio enviado.
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
  });

  it("repetir la ocurrencia produce el mismo id (sin segunda notificación)", async () => {
    mocks.selectResult = [asignacion()];

    await sendWorkflowReminders();
    await sendWorkflowReminders();

    const ids = sendCalls().map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it("un fallo de encolado no marca el recordatorio como enviado", async () => {
    mocks.selectResult = [asignacion()];
    mocks.send.mockRejectedValueOnce(new Error("Inngest caído"));

    const result = await sendWorkflowReminders();

    expect(result).toMatchObject({ success: true, remindersSent: 0, errors: 1 });
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });
});
