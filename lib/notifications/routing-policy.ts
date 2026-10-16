import type { NotificationPreferencesContract } from "./preferences-contract";

/**
 * C33 — política de enrutamiento de notificaciones.
 *
 * H09: el router calculaba los canales y los metía en `metadata.routedChannels`,
 * pero el dispatcher los ignoraba y volvía a decidir por su cuenta (plantilla +
 * preferencias). El horario se evaluaba con la hora local del proceso.
 *
 * Este módulo es la única decisión. Es puro: recibe el instante, la zona y las
 * preferencias, y devuelve los canales. Lo consumen el router y el dispatcher,
 * así que los canales que el router calcula son, por construcción, los que el
 * dispatcher intenta.
 *
 * Política declarada (decisión de negocio, 16-10-2026):
 *
 * 1. **Zona horaria**: la del contexto (sucursal → empresa), con
 *    `America/Mexico_City` como último recurso. Una zona inválida no rompe el
 *    envío: cae al default. El horario nunca depende de la zona del proceso.
 * 2. **Horario de atención**: lunes a viernes, 09:00–18:00 en la zona resuelta.
 * 3. **Diferido**: un evento marcado `businessHoursOnly` fuera de horario no se
 *    pierde ni se manda por WhatsApp/email; se entrega **sólo in-app**, que el
 *    destinatario ve al abrir. Es la única excepción a los canales de la regla.
 * 4. **Preferencias**: siempre aplican, por canal y por tipo de evento. No hay
 *    eventos que se salten el opt-out del usuario —ni los críticos—; el
 *    producto no decide por la persona que ya dijo que no. Si el usuario quiere
 *    otra cosa para antifraude, es una decisión de negocio nueva, no un defecto.
 * 5. **Canales efectivos** = candidatos de la regla (o `in-app` si se difiere)
 *    ∩ canales con plantilla ∩ canales habilitados por preferencias.
 */

export type NotificationChannel = "whatsapp" | "email" | "in-app";

export type NotificationEventType =
  | "workflow_assignment"
  | "workflow_due_soon"
  | "workflow_overdue"
  | "incident"
  | "stock_alert"
  | "stock_count_variance"
  | "shift_reminder"
  | "schedule_change"
  | "document_expiration"
  | "shift_approval_request"
  | "expense_approval_request"
  | "shift_approval_decision"
  | "shift_change_request"
  | "shift_change_decision"
  | "employee_absence"
  | "announcement_broadcast"
  | "training_assigned"
  | "imss_deadline"
  | "sales_cut_reminder"
  | "sales_cut_missing"
  | "financial_kpi_deviation"
  | "cash_variance_detected"
  | "recurring_shortage_detected"
  | "budget_threshold_reached"
  | "morning_brief"
  | "supplier_bank_account_changed"
  | "payee_bank_account_changed"
  | "workflow_unassigned";

export type RoutingPriority = "low" | "normal" | "high" | "critical";

export const DEFAULT_NOTIFICATION_TIMEZONE = "America/Mexico_City";

/** Lunes a viernes, 09:00–18:00. */
export const BUSINESS_HOURS = {
  firstWeekday: 1,
  lastWeekday: 5,
  startHour: 9,
  endHour: 18,
} as const;

export interface RoutingRule {
  eventType: NotificationEventType;
  priority: RoutingPriority;
  channels: NotificationChannel[];
  retryAttempts: number;
  retryDelayMs: number;
  businessHoursOnly: boolean;
}

export interface RoutingDecision {
  shouldSend: boolean;
  channels: NotificationChannel[];
  priority: RoutingPriority;
  retryConfig: {
    attempts: number;
    delayMs: number;
  };
  /** Por qué no se envía, o por qué se envió distinto (p. ej. diferido). */
  reason?: string;
  /** Se difirió por horario: la regla pedía canales que no se intentaron. */
  outsideBusinessHours: boolean;
  /** Zona efectivamente usada para evaluar el horario. */
  timezone: string;
}

const routingRules: Record<NotificationEventType, RoutingRule> = {
  workflow_assignment: {
    eventType: "workflow_assignment",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 5000,
    businessHoursOnly: false,
  },
  workflow_due_soon: {
    eventType: "workflow_due_soon",
    priority: "normal",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  workflow_overdue: {
    eventType: "workflow_overdue",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false,
  },
  incident: {
    eventType: "incident",
    priority: "critical",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 5,
    retryDelayMs: 1000,
    businessHoursOnly: false,
  },
  stock_alert: {
    eventType: "stock_alert",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: true,
  },
  shift_reminder: {
    eventType: "shift_reminder",
    priority: "low",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 5000,
    businessHoursOnly: true,
  },
  schedule_change: {
    eventType: "schedule_change",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  document_expiration: {
    eventType: "document_expiration",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false,
  },
  shift_approval_request: {
    eventType: "shift_approval_request",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  /**
   * Gasto esperando autorización. Mismo trato que la aprobación de turno: es
   * dinero detenido, pero no una urgencia que justifique despertar a nadie —
   * `businessHoursOnly: false` porque la cola se atiende cuando se abre.
   */
  expense_approval_request: {
    eventType: "expense_approval_request",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  shift_approval_decision: {
    eventType: "shift_approval_decision",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  stock_count_variance: {
    eventType: "stock_count_variance",
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: true,
  },
  shift_change_request: {
    eventType: "shift_change_request",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  shift_change_decision: {
    eventType: "shift_change_decision",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  employee_absence: {
    eventType: "employee_absence",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false,
  },
  announcement_broadcast: {
    eventType: "announcement_broadcast",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  training_assigned: {
    eventType: "training_assigned",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  imss_deadline: {
    eventType: "imss_deadline",
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false,
  },
  sales_cut_reminder: {
    eventType: "sales_cut_reminder",
    priority: "normal",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  sales_cut_missing: {
    eventType: "sales_cut_missing",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false,
  },
  financial_kpi_deviation: {
    eventType: "financial_kpi_deviation",
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  cash_variance_detected: {
    eventType: "cash_variance_detected",
    // Un faltante de caja se avisa mientras la caja todavía se puede recontar:
    // `businessHoursOnly` lo reencolaría al día siguiente, que es justo cuando
    // ya no sirve. Los cortes ocurren al cierre, fuera de horario de oficina.
    priority: "critical",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  recurring_shortage_detected: {
    eventType: "recurring_shortage_detected",
    // `high` y no `critical`: a diferencia del faltante del día, el patrón no
    // se investiga a las 11 de la noche. Sí sale fuera de horario porque se
    // detecta al cerrar el corte, y retenerlo hasta mañana lo despega del
    // hecho que lo disparó.
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  budget_threshold_reached: {
    eventType: "budget_threshold_reached",
    // `high` y no `critical`: es dinero que ya se gastó, no una fuga en curso.
    // `businessHoursOnly` en false porque el gasto se captura a cualquier hora y
    // retener el aviso hasta la mañana lo desconecta de la captura que lo causó.
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false,
  },
  morning_brief: {
    eventType: "morning_brief",
    priority: "normal",
    // El cron ya dispara a las 7:00 locales; `businessHoursOnly` lo reencolaría
    // fuera de esa ventana y el brief dejaría de ser "de la mañana".
    channels: ["whatsapp", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 5000,
    businessHoursOnly: false,
  },
  supplier_bank_account_changed: {
    eventType: "supplier_bank_account_changed",
    // `critical` y no `high`: es la señal de que alguien pudo estar redirigiendo
    // un pago. Un cambio de CLABE a las 3 a.m. es MÁS sospechoso, no menos, así
    // que `businessHoursOnly` queda en false a propósito — retenerlo hasta la
    // mañana le regalaría al atacante la noche entera.
    priority: "critical",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 5,
    retryDelayMs: 1000,
    businessHoursOnly: false,
  },
  // Mismo control antifraude que supplier_bank_account_changed, aplicado al
  // catálogo de payees: la contraparte cambia, el riesgo de redirigir un
  // pago es idéntico.
  payee_bank_account_changed: {
    eventType: "payee_bank_account_changed",
    priority: "critical",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 5,
    retryDelayMs: 1000,
    businessHoursOnly: false,
  },
  workflow_unassigned: {
    eventType: "workflow_unassigned",
    // Plan 5.2: una programación sin destinatario es un hueco operativo que
    // necesita a un gerente actuando — si el turno de cierre a las 21:00 no
    // encontró nadie, avisar en la mañana es tarde. `high`, no `critical`
    // (no es incidente/fraude), y fuera de horario a propósito.
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false,
  },
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hora de pared del instante en la zona dada. Devuelve el índice de día
 * (0=domingo) y la hora 0–23, sin depender de la zona del proceso.
 */
export function zonedDayAndHour(
  now: Date,
  timezone: string = DEFAULT_NOTIFICATION_TIMEZONE
): { day: number; hour: number } {
  const zone = isValidTimezone(timezone) ? timezone : DEFAULT_NOTIFICATION_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");

  return { day: WEEKDAY_INDEX[weekday] ?? 0, hour };
}

/** Lunes a viernes, 09:00–18:00, en la zona indicada. */
export function isWithinBusinessHours(
  now: Date,
  timezone: string = DEFAULT_NOTIFICATION_TIMEZONE
): boolean {
  const { day, hour } = zonedDayAndHour(now, timezone);
  return (
    day >= BUSINESS_HOURS.firstWeekday &&
    day <= BUSINESS_HOURS.lastWeekday &&
    hour >= BUSINESS_HOURS.startHour &&
    hour < BUSINESS_HOURS.endHour
  );
}

/** Preferencia por tipo de evento. */
export function eventTypeEnabled(
  eventType: NotificationEventType,
  preferences: NotificationPreferencesContract
): boolean {
  switch (eventType) {
    case "workflow_assignment":
      return preferences.workflowAssignments;
    case "workflow_due_soon":
      return preferences.workflowDueSoon;
    case "workflow_overdue":
      return preferences.workflowOverdue;
    case "incident":
      return preferences.incidents;
    // El conteo con varianza es una alerta de inventario: misma preferencia.
    case "stock_alert":
    case "stock_count_variance":
      return preferences.inventoryAlerts;
    case "shift_reminder":
      return preferences.shiftReminders;
    case "schedule_change":
      return preferences.scheduleChanges;
    default:
      return true;
  }
}

/** Preferencia por canal. */
export function channelEnabled(
  channel: NotificationChannel,
  preferences: NotificationPreferencesContract
): boolean {
  switch (channel) {
    case "whatsapp":
      return preferences.whatsappEnabled;
    case "email":
      return preferences.emailEnabled;
    case "in-app":
      return preferences.inAppEnabled;
  }
}

export function getRoutingRule(eventType: NotificationEventType): RoutingRule | undefined {
  return routingRules[eventType];
}

export function getRoutingRules(): Record<NotificationEventType, RoutingRule> {
  return routingRules;
}

/** Sólo para compatibilidad; permite ajustar una regla en caliente. */
export function updateRoutingRule(
  eventType: NotificationEventType,
  updates: Partial<RoutingRule>
): void {
  if (routingRules[eventType]) {
    routingRules[eventType] = { ...routingRules[eventType], ...updates };
  }
}

/**
 * La decisión única: qué canales se intentan para este evento, en este
 * instante, con estas preferencias y esta plantilla.
 */
export function decideNotificationChannels(input: {
  eventType: NotificationEventType;
  preferences: NotificationPreferencesContract;
  templateChannels: NotificationChannel[];
  now: Date;
  timezone?: string;
}): RoutingDecision {
  const timezone =
    input.timezone && isValidTimezone(input.timezone)
      ? input.timezone
      : DEFAULT_NOTIFICATION_TIMEZONE;

  const rule = getRoutingRule(input.eventType);
  if (!rule) {
    return {
      shouldSend: false,
      channels: [],
      priority: "normal",
      retryConfig: { attempts: 0, delayMs: 0 },
      reason: `No routing rule found for event type: ${input.eventType}`,
      outsideBusinessHours: false,
      timezone,
    };
  }

  const retryConfig = { attempts: rule.retryAttempts, delayMs: rule.retryDelayMs };

  if (!eventTypeEnabled(input.eventType, input.preferences)) {
    return {
      shouldSend: false,
      channels: [],
      priority: rule.priority,
      retryConfig,
      reason: `El usuario desactivó las notificaciones de tipo ${input.eventType}`,
      outsideBusinessHours: false,
      timezone,
    };
  }

  const outsideBusinessHours =
    rule.businessHoursOnly && !isWithinBusinessHours(input.now, timezone);

  const candidates: NotificationChannel[] = outsideBusinessHours ? ["in-app"] : rule.channels;

  const channels = candidates.filter(
    (channel) =>
      input.templateChannels.includes(channel) &&
      channelEnabled(channel, input.preferences)
  );

  if (channels.length === 0) {
    return {
      shouldSend: false,
      channels,
      priority: rule.priority,
      retryConfig,
      reason: outsideBusinessHours
        ? "Fuera de horario y sin canal in-app disponible"
        : "Ningún canal habilitado por preferencias o plantilla",
      outsideBusinessHours,
      timezone,
    };
  }

  return {
    shouldSend: true,
    channels,
    priority: rule.priority,
    retryConfig,
    reason: outsideBusinessHours
      ? "Fuera de horario: se envía sólo in-app y el resto se omite"
      : undefined,
    outsideBusinessHours,
    timezone,
  };
}
