import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C35 — productores migrados a la ruta durable.
 *
 * Lo que se prueba en cada productor es la garantía de idempotencia: una
 * ocurrencia produce un id de evento determinista y repetirla produce el mismo
 * id, que Inngest deduplica. Un fallo de encolado no se cuenta como enviado.
 *
 * Lotes migrados: C35.1 `check-overdue` + `workflow-reminders`; C35.2
 * `imss-deadline-alerts` + `cron-sales-cut-reminder`.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  // Cola de resultados de `db.select`: cada cadena awaited consume una entrada.
  selectQueue: [] as unknown[][],
  selectIndex: 0,
  markOverdue: vi.fn(),
  getOrCreateForInstance: vi.fn(),
  findInstance: vi.fn(),
  findTemplate: vi.fn(),
  updateWhere: vi.fn(),
  findUsers: vi.fn(),
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: mocks.send,
    createFunction: (config: unknown, handler: unknown) => ({ config, handler }),
  },
}));

vi.mock("@/lib/services/workflow-assignment-service", () => ({
  WorkflowAssignmentService: { markOverdue: mocks.markOverdue },
}));

vi.mock("@/lib/services/smart-link-service", () => ({
  SmartLinkService: { getOrCreateForInstance: mocks.getOrCreateForInstance },
}));

vi.mock("@/lib/db", () => {
  const next = () => {
    const value = mocks.selectQueue[mocks.selectIndex] ?? [];
    mocks.selectIndex += 1;
    return value;
  };
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.leftJoin = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  return {
    db: {
      select: () => builder,
      update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
      query: {
        workflowInstances: { findFirst: mocks.findInstance },
        workflowTemplates: { findFirst: mocks.findTemplate },
        users: { findMany: mocks.findUsers },
      },
    },
  };
});

const { checkOverdueAssignments } = await import("@/lib/cron/check-overdue");
const { sendWorkflowReminders } = await import("@/lib/cron/workflow-reminders");
const { checkImssDeadlines } = await import("@/lib/cron/imss-deadline-alerts");
const { cronSalesCutReminder } = await import("@/lib/inngest/functions/cron-sales-cut-reminder");

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
  mocks.selectQueue = [];
  mocks.selectIndex = 0;
  mocks.markOverdue.mockResolvedValue(undefined);
  mocks.getOrCreateForInstance.mockResolvedValue({ url: "https://pulso.test/link/abc" });
  mocks.findInstance.mockResolvedValue({ id: "i1", workflowTemplateId: "t1", sessionId: "s1" });
  mocks.findTemplate.mockResolvedValue({ name: "Apertura", reminderIntervals: [1440] });
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.findUsers.mockResolvedValue([]);
  mocks.send.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("check-overdue (workflow_overdue)", () => {
  it("una asignación vencida encola una sola notificación con clave natural", async () => {
    mocks.selectQueue = [
      [
        {
          assignment: { id: "a1", assignedTo: "u1", instanceId: "i1", dueDate: AHORA },
          instance: { id: "i1", workflowTemplateId: "t1", sessionId: "s1" },
          template: { name: "Apertura de sucursal" },
        },
      ],
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
    const fila = [
      {
        assignment: { id: "a1", assignedTo: "u1", instanceId: "i1", dueDate: AHORA },
        instance: { id: "i1", workflowTemplateId: "t1", sessionId: "s1" },
        template: { name: "Apertura de sucursal" },
      },
    ];
    mocks.selectQueue = [fila];

    await checkOverdueAssignments();
    mocks.selectIndex = 0;
    await checkOverdueAssignments();

    const ids = sendCalls().map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it("un fallo de encolado no se cuenta como enviado", async () => {
    mocks.selectQueue = [
      [
        {
          assignment: { id: "a1", assignedTo: "u1", instanceId: "i1", dueDate: AHORA },
          instance: { id: "i1", workflowTemplateId: "t1", sessionId: "s1" },
          template: { name: "Apertura de sucursal" },
        },
      ],
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
    mocks.selectQueue = [[asignacion()]];

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
    mocks.selectQueue = [[asignacion()]];

    await sendWorkflowReminders();
    mocks.selectIndex = 0;
    await sendWorkflowReminders();

    const ids = sendCalls().map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it("un fallo de encolado no marca el recordatorio como enviado", async () => {
    mocks.selectQueue = [[asignacion()]];
    mocks.send.mockRejectedValueOnce(new Error("Inngest caído"));

    const result = await sendWorkflowReminders();

    expect(result).toMatchObject({ success: true, remindersSent: 0, errors: 1 });
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });
});

describe("imss-deadline-alerts (imss_deadline)", () => {
  // 2026-04-10 en CDMX: la única fecha límite en ventana es el SUA del 17 de
  // abril (7 días). Abril no es mes de modificación bimestral.
  const HOY = new Date("2026-04-10T18:00:00Z");

  it("una fecha límite encola un aviso por destinatario con clave tipo+fecha+ventana", async () => {
    mocks.findUsers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);

    const result = await checkImssDeadlines(HOY);

    expect(result).toMatchObject({
      success: true,
      deadlinesHit: 1,
      recipients: 2,
      notificationsSent: 2,
    });

    const calls = sendCalls();
    expect(calls.map((c) => c.id).sort()).toEqual([
      "notification-dispatch:notif_imss-deadline:SUA_MONTHLY_PAYMENT:2026-4-17:7:u1",
      "notification-dispatch:notif_imss-deadline:SUA_MONTHLY_PAYMENT:2026-4-17:7:u2",
    ]);
    expect(calls[0].data.payload.eventType).toBe("imss_deadline");
    expect(calls[0].data.payload.metadata).toMatchObject({
      deadlineType: "SUA_MONTHLY_PAYMENT",
      daysUntil: 7,
    });
  });

  it("repetir la corrida del día produce los mismos ids (sin duplicar)", async () => {
    mocks.findUsers.mockResolvedValue([{ id: "u1" }]);

    await checkImssDeadlines(HOY);
    await checkImssDeadlines(HOY);

    const ids = sendCalls().map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it("sin fechas límite en ventana no encola nada", async () => {
    // 2026-04-15: el SUA del 17 está a 2 días, fuera de las ventanas 7/3/1.
    const result = await checkImssDeadlines(new Date("2026-04-15T18:00:00Z"));

    expect(result).toMatchObject({ success: true, deadlinesHit: 0, notificationsSent: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("cron-sales-cut-reminder (sales_cut_missing)", () => {
  const fn = cronSalesCutReminder as unknown as {
    handler: (ctx: { step: { run: <T>(id: string, action: () => Promise<T>) => Promise<T> } }) => Promise<unknown>;
  };
  const step = { run: <T,>(_id: string, action: () => Promise<T>) => action() };

  const sucursal = {
    id: "b1",
    name: "Centro",
    companyId: "c1",
    managerId: "m1",
  };

  it("una sucursal sin corte del día encola un aviso con clave sucursal+fecha", async () => {
    mocks.selectQueue = [[sucursal], []]; // branches, luego "sin corte"

    const result = await fn.handler({ step });

    expect(result).toMatchObject({ checked: 1, missingCount: 1 });
    const [call] = sendCalls();
    expect(call.id).toBe("notification-dispatch:notif_sales-cut-missing:b1:2026-10-19");
    expect(call.data.payload.eventType).toBe("sales_cut_missing");
    expect(call.data.payload.metadata).toMatchObject({
      branchName: "Centro",
      dedupeKey: "sales-cut-missing:b1:2026-10-19",
    });
  });

  it("repetir la corrida horaria produce el mismo id (un aviso al día, no uno por hora)", async () => {
    mocks.selectQueue = [[sucursal], []];
    await fn.handler({ step });
    mocks.selectIndex = 0;
    await fn.handler({ step });

    const ids = sendCalls().map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it("si el corte ya existe no encola nada", async () => {
    mocks.selectQueue = [[sucursal], [{ id: "cut1" }]];

    const result = await fn.handler({ step });

    expect(result).toMatchObject({ checked: 1, missingCount: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("una sucursal sin gerente no encola nada", async () => {
    mocks.selectQueue = [[{ ...sucursal, managerId: null }], []];

    const result = await fn.handler({ step });

    expect(result).toMatchObject({ checked: 1, missingCount: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
