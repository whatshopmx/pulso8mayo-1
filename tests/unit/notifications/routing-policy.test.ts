import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_PREFERENCE_DEFAULTS } from "@/lib/notifications/preferences-contract";
import {
  DEFAULT_NOTIFICATION_TIMEZONE,
  decideNotificationChannels,
  eventTypeEnabled,
  isWithinBusinessHours,
  isValidTimezone,
  zonedDayAndHour,
} from "@/lib/notifications/routing-policy";

/**
 * C33 — una sola decisión de canal.
 *
 * H09: el router calculaba canales que el dispatcher ignoraba, y el horario se
 * medía con la zona del proceso. La primera mitad prueba la política pura con
 * reloj y zona controlados; la segunda, que el dispatcher intente exactamente
 * los canales que la decisión devuelve.
 */

const prefs = (overrides: Partial<typeof NOTIFICATION_PREFERENCE_DEFAULTS> = {}) => ({
  ...NOTIFICATION_PREFERENCE_DEFAULTS,
  ...overrides,
});

// Instantes verificados contra America/Mexico_City y Europe/Madrid:
//   2026-10-19T16:00:00Z → MX lunes 10:00 (dentro) · Madrid lunes 18:00 (fuera)
//   2026-10-20T04:00:00Z → MX lunes 22:00 (fuera)
//   2026-10-19T14:00:00Z → MX lunes 08:00 (fuera) · Madrid lunes 16:00 (dentro)
const DENTRO_MX = new Date("2026-10-19T16:00:00Z");
const FUERA_MX = new Date("2026-10-20T04:00:00Z");
const MANANA_TEMPRANO_MX = new Date("2026-10-19T14:00:00Z");

const TODOS = ["whatsapp", "email", "in-app"] as const;

describe("isWithinBusinessHours / zonedDayAndHour", () => {
  it("usa la zona indicada, no la del proceso", () => {
    expect(zonedDayAndHour(DENTRO_MX, "America/Mexico_City")).toEqual({ day: 1, hour: 10 });
    expect(zonedDayAndHour(DENTRO_MX, "Europe/Madrid")).toEqual({ day: 1, hour: 18 });

    expect(isWithinBusinessHours(DENTRO_MX, "America/Mexico_City")).toBe(true);
    expect(isWithinBusinessHours(DENTRO_MX, "Europe/Madrid")).toBe(false);
    expect(isWithinBusinessHours(MANANA_TEMPRANO_MX, "America/Mexico_City")).toBe(false);
    expect(isWithinBusinessHours(MANANA_TEMPRANO_MX, "Europe/Madrid")).toBe(true);
  });

  it("respeta los bordes 09:00 y 18:00 y excluye el fin de semana", () => {
    // MX lunes 09:00 dentro; MX lunes 18:00 fuera; MX sábado 10:00 fuera.
    expect(isWithinBusinessHours(new Date("2026-10-19T15:00:00Z"), "America/Mexico_City")).toBe(true);
    expect(isWithinBusinessHours(new Date("2026-10-20T00:00:00Z"), "America/Mexico_City")).toBe(false);
    expect(isWithinBusinessHours(new Date("2026-10-17T16:00:00Z"), "America/Mexico_City")).toBe(false);
  });

  it("una zona inválida no rompe: cae al default", () => {
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("America/Mexico_City")).toBe(true);
    expect(isWithinBusinessHours(DENTRO_MX, "Not/AZone")).toBe(true);
  });
});

describe("eventTypeEnabled", () => {
  it("asigna cada tipo a su preferencia", () => {
    expect(eventTypeEnabled("stock_alert", prefs({ inventoryAlerts: false }))).toBe(false);
    expect(eventTypeEnabled("stock_count_variance", prefs({ inventoryAlerts: false }))).toBe(false);
    expect(eventTypeEnabled("shift_reminder", prefs({ shiftReminders: false }))).toBe(false);
    expect(eventTypeEnabled("schedule_change", prefs({ scheduleChanges: false }))).toBe(false);
    expect(eventTypeEnabled("workflow_assignment", prefs({ workflowAssignments: false }))).toBe(false);
    expect(eventTypeEnabled("incident", prefs({ incidents: false }))).toBe(false);
    // Un tipo sin preferencia propia no se bloquea por accidente.
    expect(eventTypeEnabled("supplier_bank_account_changed", prefs())).toBe(true);
  });
});

describe("decideNotificationChannels", () => {
  const base = {
    preferences: prefs(),
    templateChannels: [...TODOS],
    now: DENTRO_MX,
    timezone: "America/Mexico_City",
  };

  it("sin regla para el evento no envía", () => {
    const decision = decideNotificationChannels({
      ...base,
      eventType: "evento_inexistente" as never,
    });
    expect(decision.shouldSend).toBe(false);
    expect(decision.channels).toEqual([]);
  });

  it("dentro de horario devuelve los canales de la regla", () => {
    const decision = decideNotificationChannels({ ...base, eventType: "stock_alert" });
    expect(decision.shouldSend).toBe(true);
    expect(decision.channels).toEqual(["whatsapp", "email", "in-app"]);
    expect(decision.outsideBusinessHours).toBe(false);
    expect(decision.timezone).toBe("America/Mexico_City");
  });

  it("fuera de horario difiere a in-app en lugar de perder el aviso", () => {
    const decision = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      now: FUERA_MX,
    });
    expect(decision.shouldSend).toBe(true);
    expect(decision.channels).toEqual(["in-app"]);
    expect(decision.outsideBusinessHours).toBe(true);
    expect(decision.reason).toMatch(/in-app/i);
  });

  it("la zona del contexto cambia la decisión del mismo instante", () => {
    const enMexico = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      timezone: "America/Mexico_City",
    });
    const enMadrid = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      timezone: "Europe/Madrid",
    });
    expect(enMexico.channels).toEqual(["whatsapp", "email", "in-app"]);
    expect(enMadrid.channels).toEqual(["in-app"]);
  });

  it("una zona inválida cae al default y lo declara", () => {
    const decision = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      timezone: "Not/AZone",
    });
    expect(decision.timezone).toBe(DEFAULT_NOTIFICATION_TIMEZONE);
    expect(decision.channels).toEqual(["whatsapp", "email", "in-app"]);
  });

  it("respeta la preferencia por tipo de stock y turno", () => {
    const stock = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      preferences: prefs({ inventoryAlerts: false }),
    });
    expect(stock.shouldSend).toBe(false);
    expect(stock.channels).toEqual([]);

    const turno = decideNotificationChannels({
      ...base,
      eventType: "shift_reminder",
      preferences: prefs({ shiftReminders: false }),
    });
    expect(turno.shouldSend).toBe(false);
  });

  it("respeta la preferencia por canal", () => {
    const decision = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      preferences: prefs({ emailEnabled: false }),
    });
    expect(decision.channels).toEqual(["whatsapp", "in-app"]);
  });

  it("no intenta un canal sin plantilla", () => {
    const decision = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      templateChannels: ["whatsapp", "in-app"],
    });
    expect(decision.channels).toEqual(["whatsapp", "in-app"]);
  });

  it("un evento crítico no se difiere por horario, pero sí respeta preferencias", () => {
    const fuera = decideNotificationChannels({
      ...base,
      eventType: "supplier_bank_account_changed",
      now: FUERA_MX,
    });
    expect(fuera.shouldSend).toBe(true);
    expect(fuera.channels).toEqual(["whatsapp", "in-app"]);
    expect(fuera.outsideBusinessHours).toBe(false);

    const optOut = decideNotificationChannels({
      ...base,
      eventType: "supplier_bank_account_changed",
      now: FUERA_MX,
      preferences: prefs({ whatsappEnabled: false }),
    });
    expect(optOut.channels).toEqual(["in-app"]);
  });

  it("si todas las preferencias de canal están apagadas no envía", () => {
    const decision = decideNotificationChannels({
      ...base,
      eventType: "stock_alert",
      preferences: prefs({ whatsappEnabled: false, emailEnabled: false, inAppEnabled: false }),
    });
    expect(decision.shouldSend).toBe(false);
    expect(decision.channels).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El dispatcher intenta exactamente lo decidido.
// ─────────────────────────────────────────────────────────────────────────────

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(DENTRO_MX);
  mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs() });
  mocks.findUser.mockResolvedValue({
    id: "u1",
    name: "Ana",
    email: "ana@example.com",
    phone: null,
    whatsappPhone: "+5215500000000",
    role: "GERENTE",
    companyId: "c1",
    branchId: "b1",
  });
  mocks.findBranch.mockResolvedValue({ timezone: "America/Mexico_City" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationDispatcher — canales intentados = canales decididos", () => {
  it("dentro de horario intenta WhatsApp, email e in-app", async () => {
    const decision = await NotificationDispatcher.decideChannels(PAYLOAD);
    expect(decision.channels).toEqual(["whatsapp", "email", "in-app"]);

    await NotificationDispatcher.sendNotification(PAYLOAD);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendStockAlertEmail).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it("fuera de horario sólo intenta in-app", async () => {
    vi.setSystemTime(FUERA_MX);

    const decision = await NotificationDispatcher.decideChannels(PAYLOAD);
    expect(decision.channels).toEqual(["in-app"]);

    await NotificationDispatcher.sendNotification(PAYLOAD);

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.sendStockAlertEmail).not.toHaveBeenCalled();
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it("la zona de la sucursal, no la del proceso, decide el horario", async () => {
    // Mismo instante: en Madrid ya son las 18:00, fuera de horario.
    mocks.findBranch.mockResolvedValue({ timezone: "Europe/Madrid" });

    const decision = await NotificationDispatcher.decideChannels(PAYLOAD);
    expect(decision.timezone).toBe("Europe/Madrid");
    expect(decision.channels).toEqual(["in-app"]);
  });

  it("metadata.timezone sobreescribe la de la sucursal", async () => {
    const decision = await NotificationDispatcher.decideChannels({
      ...PAYLOAD,
      metadata: { timezone: "Europe/Madrid" },
    });
    expect(decision.timezone).toBe("Europe/Madrid");
    expect(decision.channels).toEqual(["in-app"]);
  });

  it("una preferencia de tipo apagada no intenta ningún canal", async () => {
    mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs({ inventoryAlerts: false }) });

    const decision = await NotificationDispatcher.decideChannels(PAYLOAD);
    expect(decision.shouldSend).toBe(false);

    await NotificationDispatcher.sendNotification(PAYLOAD);

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.sendStockAlertEmail).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("una preferencia de canal apagada quita ese canal del intento", async () => {
    mocks.findPrefs.mockResolvedValue({ userId: "u1", ...prefs({ emailEnabled: false }) });

    const decision = await NotificationDispatcher.decideChannels(PAYLOAD);
    expect(decision.channels).toEqual(["whatsapp", "in-app"]);

    await NotificationDispatcher.sendNotification(PAYLOAD);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendStockAlertEmail).not.toHaveBeenCalled();
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });
});
