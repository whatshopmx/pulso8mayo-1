/**
 * C32 — contrato canónico de preferencias de notificación.
 *
 * H09 encontró tres APIs de preferencias para la misma área con contratos
 * distintos: una devolvía `stockAlerts`, otra `inventoryAlerts`, otra inventaba
 * `shiftReminders`/`scheduleChanges` como `true` sin persistirlos. El
 * dispatcher, por su parte, lee `inventoryAlerts`.
 *
 * Este módulo es la única definición de qué es una preferencia y cómo viaja.
 * No toca base de datos ni React: las rutas y la pantalla lo consumen, y así
 * los tres puntos de entrada hablan del mismo usuario y de los mismos campos.
 *
 * Decisiones:
 *
 * - El nombre canónico del aviso de stock es `inventoryAlerts`, porque es el
 *   que ya vive en la tabla y el que lee el dispatcher. `stockAlerts` se
 *   acepta como alias de entrada (nombre histórico de la pantalla y de
 *   `/api/notifications/preferences`) y no se emite.
 * - Todo campo es booleano. Un valor ausente, `null` o de otro tipo se ignora;
 *   nunca se convierte en `false` por accidente.
 */

/** Campos que forman el contrato. El orden es el de la interfaz. */
export const NOTIFICATION_PREFERENCE_FIELDS = [
  "whatsappEnabled",
  "emailEnabled",
  "inAppEnabled",
  "workflowAssignments",
  "workflowDueSoon",
  "workflowOverdue",
  "incidents",
  "inventoryAlerts",
  "shiftReminders",
  "scheduleChanges",
] as const;

export type NotificationPreferenceField = (typeof NOTIFICATION_PREFERENCE_FIELDS)[number];

export type NotificationPreferencesContract = Record<NotificationPreferenceField, boolean>;

/** Canales de entrega. */
export const NOTIFICATION_CHANNEL_FIELDS = [
  "whatsappEnabled",
  "emailEnabled",
  "inAppEnabled",
] as const;

/** Preferencias por tipo de evento. */
export const NOTIFICATION_EVENT_FIELDS = [
  "workflowAssignments",
  "workflowDueSoon",
  "workflowOverdue",
  "incidents",
  "inventoryAlerts",
  "shiftReminders",
  "scheduleChanges",
] as const;

/** Valor por defecto de una cuenta sin fila guardada. */
export const NOTIFICATION_PREFERENCE_DEFAULTS: NotificationPreferencesContract = {
  whatsappEnabled: true,
  emailEnabled: true,
  inAppEnabled: true,
  workflowAssignments: true,
  workflowDueSoon: true,
  workflowOverdue: true,
  incidents: true,
  inventoryAlerts: true,
  shiftReminders: true,
  scheduleChanges: true,
};

/**
 * Nombres históricos aceptados al escribir. `stockAlerts` es el nombre que usó
 * la pantalla y `/api/notifications/preferences` antes de C32; se traduce a
 * `inventoryAlerts`. El canónico siempre gana si vienen los dos.
 */
export const NOTIFICATION_PREFERENCE_ALIASES: Record<string, NotificationPreferenceField> = {
  stockAlerts: "inventoryAlerts",
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Normaliza un cuerpo de solicitud arbitrario al subconjunto de preferencias
 * conocido. Ignora claves desconocidas, valores no booleanos y el alias si el
 * canónico también está presente.
 */
export function normalizePreferenceInput(input: unknown): Partial<NotificationPreferencesContract> {
  if (!esObjeto(input)) return {};

  const resultado: Partial<NotificationPreferencesContract> = {};

  for (const campo of NOTIFICATION_PREFERENCE_FIELDS) {
    const valor = input[campo];
    if (typeof valor === "boolean") resultado[campo] = valor;
  }

  for (const [alias, campo] of Object.entries(NOTIFICATION_PREFERENCE_ALIASES)) {
    if (resultado[campo] !== undefined) continue;
    const valor = input[alias];
    if (typeof valor === "boolean") resultado[campo] = valor;
  }

  return resultado;
}

/** ¿El parche trae al menos una preferencia válida? */
export function hasPreferenceInput(patch: Partial<NotificationPreferencesContract>): boolean {
  return NOTIFICATION_PREFERENCE_FIELDS.some((campo) => patch[campo] !== undefined);
}

/**
 * Preferencias completas a partir de una fila guardada (o su ausencia). Una
 * columna `null`/ausente cae al default del contrato; una columna en `false` se
 * conserva como `false`.
 */
export function fromStoredPreferences(
  row: Partial<Record<NotificationPreferenceField, boolean | null | undefined>> | null | undefined
): NotificationPreferencesContract {
  const resultado = { ...NOTIFICATION_PREFERENCE_DEFAULTS };
  if (!row) return resultado;

  for (const campo of NOTIFICATION_PREFERENCE_FIELDS) {
    const valor = row[campo];
    if (typeof valor === "boolean") resultado[campo] = valor;
  }

  return resultado;
}

/**
 * Convierte un parche del contrato a las columnas que la tabla conoce. Evita
 * que una clave desconocida (p. ej. el alias `stockAlerts`) llegue al `set` de
 * Drizzle, que es lo que hoy rompe `NotificationService.updateNotificationPreferences`.
 */
export function toStoredPreferencesPatch(
  patch: Partial<NotificationPreferencesContract>
): Partial<Record<NotificationPreferenceField, boolean>> {
  const resultado: Partial<Record<NotificationPreferenceField, boolean>> = {};
  for (const campo of NOTIFICATION_PREFERENCE_FIELDS) {
    const valor = patch[campo];
    if (typeof valor === "boolean") resultado[campo] = valor;
  }
  return resultado;
}
