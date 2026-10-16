import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_PREFERENCE_DEFAULTS } from "@/lib/notifications/preferences-contract";

/**
 * C34.1 — resultado verificable por canal.
 *
 * Antes, cada canal capturaba su error y el dispatcher usaba `Promise.allSettled`
 * sin mirar el resultado: un email fallido era indistinguible de uno enviado, y
 * el fallback de correo registraba el texto sin enviarlo. Estas pruebas fijan
 * que cada canal devuelva `sent`/`skipped`/`failed`, con `transient` o
 * `terminal` para poder reintentar sólo lo que sirve.
 */

const prefs = (overrides: Partial<typeof NOTIFICATION_PREFERENCE_DEFAULTS> = {}) => ({
  ...NOTIFICATION_PREFERENCE_DEFAULTS,
  ...overrides,
});

const DENTRO_MX = new Date("2026-10-19T16:00:00Z"); // lunes 10:00 en CDMX

const mocks = vi.hoisted(() => ({
  sendWorkflowAssignmentEmail: vi.fn().mockResolvedValue(undefined),
  sendStockAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getActiveSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
  insertValues: vi.fn().mockResolvedValue(undefined),
  findPrefs: vi.fn(),
  findUser: vi.fn(),
  findBranch: vi.fn(),
}));

vi.mock("@/lib/services/email-service", () => ({
  sendWorkflowAssignmentEmail: mocks.sendWorkflowAssignmentEmail,
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

const { NotificationDispatcher } = await import("@/lib/services/notification-dispatcher");

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(DENTRO_MX);
  mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs() });
  mocks.findUser.mockResolvedValue({ ...USUARIO });
  mocks.findBranch.mockResolvedValue({ timezone: "America/Mexico_City" });
  mocks.getActiveSession.mockResolvedValue({ sessionId: "s1" });
  mocks.insertValues.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deliverChannel — clasificación de resultados", () => {
  it("WhatsApp sin teléfono se omite (terminal), no falla", async () => {
    mocks.findUser.mockResolvedValue({ ...USUARIO, phone: null, whatsappPhone: null });
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);

    const result = await NotificationDispatcher.deliverChannel(
      "whatsapp",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "whatsapp", status: "skipped", kind: "terminal" });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("WhatsApp sin sesión activa falla como transitorio", async () => {
    mocks.getActiveSession.mockResolvedValue(null);
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);

    const result = await NotificationDispatcher.deliverChannel(
      "whatsapp",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "whatsapp", status: "failed", kind: "transient" });
  });

  it("un error del proveedor de WhatsApp es fallo transitorio", async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error("proveedor caído"));
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);

    const result = await NotificationDispatcher.deliverChannel(
      "whatsapp",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "whatsapp", status: "failed", kind: "transient" });
    expect(result.reason).toMatch(/proveedor caído/);
  });

  it("email sin dirección se omite (terminal)", async () => {
    mocks.findUser.mockResolvedValue({ ...USUARIO, email: null });
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);

    const result = await NotificationDispatcher.deliverChannel(
      "email",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "email", status: "skipped", kind: "terminal" });
  });

  it("un tipo sin remitente de correo se declara omitido, no enviado", async () => {
    // `shift_approval_request` tiene plantilla de correo pero ningún remitente
    // real: antes se registraba el texto y se contaba como enviado.
    const payload = { ...PAYLOAD, eventType: "shift_approval_request" as const };
    const plan = await NotificationDispatcher.planDelivery(payload);

    const result = await NotificationDispatcher.deliverChannel(
      "email",
      payload,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "email", status: "skipped", kind: "terminal" });
    expect(result.reason).toMatch(/Sin remitente/);
    expect(mocks.sendStockAlertEmail).not.toHaveBeenCalled();
  });

  it("un error del proveedor de correo es fallo transitorio", async () => {
    mocks.sendStockAlertEmail.mockRejectedValueOnce(new Error("SMTP caído"));
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);

    const result = await NotificationDispatcher.deliverChannel(
      "email",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "email", status: "failed", kind: "transient" });
  });

  it("un error al insertar in-app es fallo transitorio", async () => {
    mocks.insertValues.mockRejectedValueOnce(new Error("db caída"));
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);

    const result = await NotificationDispatcher.deliverChannel(
      "in-app",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );

    expect(result).toMatchObject({ channel: "in-app", status: "failed", kind: "transient" });
  });

  it("in-app exitoso se marca sent", async () => {
    const plan = await NotificationDispatcher.planDelivery(PAYLOAD);
    const result = await NotificationDispatcher.deliverChannel(
      "in-app",
      PAYLOAD,
      plan!.template,
      plan!.userData
    );
    expect(result).toEqual({ channel: "in-app", status: "sent" });
  });
});

describe("sendNotification — fallo parcial no se presenta como éxito total", () => {
  it("devuelve un resultado por canal decidido, en orden", async () => {
    const results = await NotificationDispatcher.sendNotification(PAYLOAD);
    expect(results.map((r) => r.channel)).toEqual(["whatsapp", "email", "in-app"]);
    expect(results.every((r) => r.status === "sent")).toBe(true);
  });

  it("si el correo falla, WhatsApp e in-app conservan su éxito", async () => {
    mocks.sendStockAlertEmail.mockRejectedValueOnce(new Error("SMTP caído"));

    const results = await NotificationDispatcher.sendNotification(PAYLOAD);

    expect(results).toEqual([
      { channel: "whatsapp", status: "sent" },
      expect.objectContaining({ channel: "email", status: "failed", kind: "transient" }),
      { channel: "in-app", status: "sent" },
    ]);
  });

  it("si la preferencia de tipo está apagada no hay resultados", async () => {
    mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs({ inventoryAlerts: false }) });
    const results = await NotificationDispatcher.sendNotification(PAYLOAD);
    expect(results).toEqual([]);
  });
});
