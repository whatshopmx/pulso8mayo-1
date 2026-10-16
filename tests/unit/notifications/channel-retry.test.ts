import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_PREFERENCE_DEFAULTS } from "@/lib/notifications/preferences-contract";
import type { DurableStep } from "@/lib/inngest/functions/notification-dispatch";

/**
 * C34.2 — reintento por canal sin reenviar lo exitoso.
 *
 * El plan es un paso memoizado y cada canal es su propio paso. Un fallo
 * transitorio lanza dentro del paso del canal para que Inngest no lo memoice;
 * los canales ya completados quedan cacheados y no se repiten en el reintento.
 * El `step` de prueba emula esa memoización sin levantar el runtime.
 */

const prefs = (overrides: Partial<typeof NOTIFICATION_PREFERENCE_DEFAULTS> = {}) => ({
  ...NOTIFICATION_PREFERENCE_DEFAULTS,
  ...overrides,
});

const DENTRO_MX = new Date("2026-10-19T16:00:00Z"); // lunes 10:00 en CDMX

const mocks = vi.hoisted(() => ({
  sendStockAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getActiveSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
  insertValues: vi.fn().mockResolvedValue(undefined),
  findPrefs: vi.fn(),
  findUser: vi.fn(),
  findBranch: vi.fn(),
}));

vi.mock("@/lib/services/email-service", () => ({
  sendWorkflowAssignmentEmail: vi.fn().mockResolvedValue(undefined),
  sendWorkflowReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendWorkflowOverdueEmail: vi.fn().mockResolvedValue(undefined),
  sendIncidentAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendStockAlertEmail: mocks.sendStockAlertEmail,
  sendShiftReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendDocumentExpirationEmail: vi.fn().mockResolvedValue(undefined),
  sendWorkflowUnassignedEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/whatsapp/client-factory", () => ({
  whatsappClient: { sendMessage: mocks.sendMessage },
}));
vi.mock("@/lib/whatsapp/session-manager", () => ({
  sessionManager: { getActiveSession: mocks.getActiveSession },
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      notificationPreferences: { findFirst: mocks.findPrefs },
      users: { findFirst: mocks.findUser },
      branches: { findFirst: mocks.findBranch },
    },
    insert: vi.fn(() => ({ values: mocks.insertValues })),
  },
}));

const { runNotificationDispatch } = await import("@/lib/inngest/functions/notification-dispatch");

const PAYLOAD = {
  userId: "u1",
  title: "Stock bajo",
  message: "El tomate está bajo",
  type: "warning" as const,
  eventType: "stock_alert" as const,
};

const USUARIO = {
  id: "u1",
  name: "Ana",
  email: "ana@example.com",
  phone: null,
  whatsappPhone: "+5215500000000",
  role: "GERENTE",
  companyId: "c1",
  branchId: "b1",
};

/** `step` que memoiza por id, como Inngest entre reintentos de la función. */
function memoStep() {
  const cache = new Map<string, unknown>();
  const runs: string[] = [];
  const step: DurableStep = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      runs.push(id);
      if (cache.has(id)) return cache.get(id) as T;
      const value = await fn();
      cache.set(id, value);
      return value;
    },
  };
  return { step, cache, runs, resetRuns: () => { runs.length = 0; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(DENTRO_MX);
  mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs() });
  mocks.findUser.mockResolvedValue({ ...USUARIO });
  mocks.findBranch.mockResolvedValue({ timezone: "America/Mexico_City" });
  mocks.getActiveSession.mockResolvedValue({ sessionId: "s1" });
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.sendStockAlertEmail.mockResolvedValue(undefined);
  mocks.sendMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runNotificationDispatch", () => {
  it("todo exitoso: un paso por canal y resultados enviados", async () => {
    const harness = memoStep();

    const outcome = await runNotificationDispatch(PAYLOAD, harness.step, "n1");

    expect(outcome.success).toBe(true);
    expect(outcome.results?.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(harness.runs).toEqual([
      "plan-delivery",
      "deliver-whatsapp",
      "deliver-email",
      "deliver-in-app",
    ]);
  });

  it("reintento: los canales exitosos no se reenvían, sólo el que falló", async () => {
    const harness = memoStep();
    mocks.sendStockAlertEmail.mockRejectedValueOnce(new Error("SMTP caído"));

    await expect(runNotificationDispatch(PAYLOAD, harness.step, "n1")).rejects.toThrow(/email/i);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.sendStockAlertEmail).toHaveBeenCalledTimes(1);

    // Reintento con la misma memoización.
    harness.resetRuns();
    const outcome = await runNotificationDispatch(PAYLOAD, harness.step, "n1");

    expect(outcome.success).toBe(true);
    expect(outcome.results?.every((r) => r.status === "sent")).toBe(true);
    // WhatsApp e in-app salieron una sola vez en total; el correo se reintentó.
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.sendStockAlertEmail).toHaveBeenCalledTimes(2);
  });

  it("agotamiento: el canal que falla se reintenta y los demás no", async () => {
    const harness = memoStep();
    mocks.sendStockAlertEmail.mockRejectedValue(new Error("SMTP caído"));

    for (let intento = 0; intento < 3; intento += 1) {
      await expect(runNotificationDispatch(PAYLOAD, harness.step, "n1")).rejects.toThrow();
    }

    expect(mocks.sendStockAlertEmail).toHaveBeenCalledTimes(3);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it("un fallo terminal (sin teléfono) no reintenta y queda registrado", async () => {
    const harness = memoStep();
    mocks.findUser.mockResolvedValue({ ...USUARIO, phone: null, whatsappPhone: null });

    const outcome = await runNotificationDispatch(PAYLOAD, harness.step, "n1");

    expect(outcome.success).toBe(true);
    expect(outcome.results).toEqual([
      expect.objectContaining({ channel: "whatsapp", status: "skipped", kind: "terminal" }),
      { channel: "email", status: "sent" },
      { channel: "in-app", status: "sent" },
    ]);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("una preferencia de tipo apagada no ejecuta ningún canal", async () => {
    const harness = memoStep();
    mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs({ inventoryAlerts: false }) });

    const outcome = await runNotificationDispatch(PAYLOAD, harness.step, "n1");

    expect(outcome.success).toBe(true);
    expect(outcome.results).toEqual([]);
    expect(harness.runs).toEqual(["plan-delivery"]);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("un payload inválido no ejecuta pasos", async () => {
    const harness = memoStep();
    const outcome = await runNotificationDispatch({ ...PAYLOAD, userId: "" }, harness.step, "n1");
    expect(outcome.success).toBe(false);
    expect(harness.runs).toEqual([]);
  });
});
