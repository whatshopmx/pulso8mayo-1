import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { notificationPreferences } from "@/lib/db/schema";
import {
  NOTIFICATION_CHANNEL_FIELDS,
  NOTIFICATION_EVENT_FIELDS,
  NOTIFICATION_PREFERENCE_DEFAULTS,
  NOTIFICATION_PREFERENCE_FIELDS,
  fromStoredPreferences,
  hasPreferenceInput,
  normalizePreferenceInput,
  toStoredPreferencesPatch,
} from "@/lib/notifications/preferences-contract";

/**
 * C32.1 — el contrato canónico de preferencias.
 *
 * H09: las tres APIs hablaban de campos distintos y la pantalla inventaba
 * `shiftReminders`/`scheduleChanges`. Estas pruebas fijan la semántica sin
 * tocar base de datos: qué se acepta, qué se ignora y qué columna recibe cada
 * campo. La última prueba ata el contrato a la tabla real, así que añadir un
 * campo sin columna (o al revés) rompe aquí.
 */

describe("normalizePreferenceInput", () => {
  it("acepta los campos canónicos booleanos", () => {
    const patch = normalizePreferenceInput({
      whatsappEnabled: false,
      emailEnabled: true,
      inAppEnabled: false,
      workflowAssignments: false,
      workflowDueSoon: true,
      workflowOverdue: false,
      incidents: true,
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
    });

    expect(patch).toEqual({
      whatsappEnabled: false,
      emailEnabled: true,
      inAppEnabled: false,
      workflowAssignments: false,
      workflowDueSoon: true,
      workflowOverdue: false,
      incidents: true,
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
    });
  });

  it("ignora claves desconocidas y valores que no son booleanos", () => {
    const patch = normalizePreferenceInput({
      whatsappEnabled: "sí",
      emailEnabled: 1,
      inAppEnabled: null,
      userId: "otro-usuario",
      admin: true,
      incidents: false,
    });

    expect(patch).toEqual({ incidents: false });
  });

  it("traduce el alias histórico stockAlerts a inventoryAlerts", () => {
    expect(normalizePreferenceInput({ stockAlerts: false })).toEqual({
      inventoryAlerts: false,
    });
  });

  it("prefiere el nombre canónico cuando llegan los dos", () => {
    expect(
      normalizePreferenceInput({ inventoryAlerts: true, stockAlerts: false })
    ).toEqual({ inventoryAlerts: true });
  });

  it("no se rompe con cuerpos que no son objetos", () => {
    expect(normalizePreferenceInput(null)).toEqual({});
    expect(normalizePreferenceInput("texto")).toEqual({});
    expect(normalizePreferenceInput([true])).toEqual({});
    expect(normalizePreferenceInput(undefined)).toEqual({});
  });

  it("hasPreferenceInput distingue un parche vacío de uno con un valor", () => {
    expect(hasPreferenceInput({})).toBe(false);
    expect(hasPreferenceInput(normalizePreferenceInput({ admin: true }))).toBe(false);
    expect(hasPreferenceInput({ emailEnabled: false })).toBe(true);
  });
});

describe("fromStoredPreferences", () => {
  it("devuelve los defaults cuando no hay fila", () => {
    expect(fromStoredPreferences(null)).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
    expect(fromStoredPreferences(undefined)).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
  });

  it("conserva el false guardado en lugar de sustituirlo por el default", () => {
    const resultado = fromStoredPreferences({ emailEnabled: false, incidents: false });
    expect(resultado.emailEnabled).toBe(false);
    expect(resultado.incidents).toBe(false);
    // Lo que no vino cae al default, que es true.
    expect(resultado.whatsappEnabled).toBe(true);
  });

  it("trata una columna null o ausente como default, no como false", () => {
    const resultado = fromStoredPreferences({ inventoryAlerts: null, shiftReminders: undefined });
    expect(resultado.inventoryAlerts).toBe(true);
    expect(resultado.shiftReminders).toBe(true);
  });
});

describe("toStoredPreferencesPatch", () => {
  it("sólo deja pasar columnas que la tabla conoce", () => {
    const patch = toStoredPreferencesPatch({
      emailEnabled: false,
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
    });

    expect(patch).toEqual({
      emailEnabled: false,
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
    });
  });

  it("descarta claves desconocidas antes de llegar a Drizzle", () => {
    const patch = toStoredPreferencesPatch({
      stockAlerts: false,
      userId: "ajeno",
    } as never);
    expect(patch).toEqual({});
  });
});

describe("contrato y tabla", () => {
  it("cada campo del contrato tiene su columna persistida", () => {
    const columnas = Object.keys(getTableColumns(notificationPreferences));
    for (const campo of NOTIFICATION_PREFERENCE_FIELDS) {
      expect(columnas, `falta la columna de ${campo}`).toContain(campo);
    }
  });

  it("canales y tipos de evento cubren el contrato sin solaparse", () => {
    expect([...NOTIFICATION_CHANNEL_FIELDS, ...NOTIFICATION_EVENT_FIELDS].sort()).toEqual(
      [...NOTIFICATION_PREFERENCE_FIELDS].sort()
    );
  });
});
