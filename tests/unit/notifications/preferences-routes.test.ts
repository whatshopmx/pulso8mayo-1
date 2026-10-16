import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as canonicalGet, PATCH as canonicalPatch } from "@/app/api/notifications/preferences/route";
import {
  GET as profileGet,
  PUT as profilePut,
} from "@/app/api/profile/notification-preferences/route";
import {
  GET as userGet,
  PATCH as userPatch,
} from "@/app/api/users/profile/preferences/route";

/**
 * C32.2 — las tres entradas de preferencias comparten contrato.
 *
 * H09 encontró tres APIs con nombres de campo distintos y una que inventaba
 * `shiftReminders`/`scheduleChanges` en cada lectura. Estas pruebas corren las
 * rutas reales con la base simulada y comprueban: misma semántica de campos,
 * el usuario sale de la sesión y nunca del cuerpo, y un campo omitido conserva
 * lo guardado en vez de resetearse.
 */

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      notificationPreferences: { findFirst: vi.fn() },
      users: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

const USUARIO = "usuario-en-sesion";

const FILA_COMPLETA = {
  userId: USUARIO,
  whatsappEnabled: true,
  emailEnabled: false,
  inAppEnabled: true,
  workflowAssignments: true,
  workflowDueSoon: true,
  workflowOverdue: true,
  incidents: false,
  inventoryAlerts: false,
  shiftReminders: false,
  scheduleChanges: true,
};

/** Captura lo que cada ruta intenta escribir. */
let valoresEscritos: Record<string, unknown> | null = null;
let insertLlamado = false;

function programarInsertConRetorno(fila: unknown = { userId: USUARIO }) {
  const returning = vi.fn().mockResolvedValue([fila]);
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn((v: Record<string, unknown>) => {
    insertLlamado = true;
    valoresEscritos = v;
    return { onConflictDoUpdate, returning };
  });
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  return { values, onConflictDoUpdate, returning };
}

function programarUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where };
}

function preferenciasGuardadas(fila: unknown) {
  vi.mocked(db.query.notificationPreferences.findFirst).mockResolvedValue(fila as never);
}

const request = (body?: unknown) =>
  ({ json: async () => body, headers: new Headers() }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  valoresEscritos = null;
  insertLlamado = false;
  vi.mocked(getSession).mockResolvedValue({ user: { id: USUARIO } } as never);
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USUARIO } } as never);
  vi.mocked(db.query.users.findFirst).mockResolvedValue({ whatsappPhone: "+5215500000000" } as never);
});

describe("GET — misma forma en las tres entradas", () => {
  it("la ruta canónica devuelve el contrato y no el alias stockAlerts", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    const res = await canonicalGet(request());
    const body = await res.json();

    expect(body).toMatchObject({
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
      emailEnabled: false,
    });
    expect(body).not.toHaveProperty("stockAlerts");
    expect(Object.keys(body).sort()).toEqual([
      "emailEnabled",
      "inAppEnabled",
      "incidents",
      "inventoryAlerts",
      "scheduleChanges",
      "shiftReminders",
      "whatsappEnabled",
      "workflowAssignments",
      "workflowDueSoon",
      "workflowOverdue",
    ]);
  });

  it("la ruta de perfil devuelve el mismo contrato dentro de { data }", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    const res = await profileGet(request());
    const body = await res.json();

    expect(body.data).toMatchObject({
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
    });
    expect(body.data).not.toHaveProperty("stockAlerts");
  });

  it("la ruta de usuario devuelve el contrato más el teléfono", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    const res = await userGet(request());
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      inventoryAlerts: false,
      shiftReminders: false,
      scheduleChanges: true,
      whatsappPhone: "+5215500000000",
    });
    expect(body.data).not.toHaveProperty("stockAlerts");
  });

  it("sin fila guardada, las tres devuelven los mismos defaults", async () => {
    preferenciasGuardadas(undefined);

    const canonica = await (await canonicalGet(request())).json();
    const perfil = await (await profileGet(request())).json();
    // La ruta de usuario crea la fila; el insert devuelve el default completo.
    programarInsertConRetorno({ userId: USUARIO });
    const usuario = await (await userGet(request())).json();

    const prefsUsuario = { ...(usuario.data as Record<string, unknown>) };
    delete prefsUsuario.whatsappPhone;
    expect(canonica).toEqual(perfil.data);
    expect(canonica).toEqual(prefsUsuario);
    expect(canonica.inventoryAlerts).toBe(true);
  });
});

describe("escritura — usuario de la sesión y campos conservados", () => {
  it("un campo omitido conserva lo guardado en vez de resetearse a true", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    const { onConflictDoUpdate } = programarInsertConRetorno();

    const res = await canonicalPatch(request({ incidents: true }));
    expect(res.status).toBe(200);

    expect(valoresEscritos).toMatchObject({
      userId: USUARIO,
      emailEnabled: false,
      inventoryAlerts: false,
      shiftReminders: false,
      incidents: true,
    });
    const config = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(config.set.emailEnabled).toBe(false);
    expect(config.set.incidents).toBe(true);
  });

  it("traduce el alias stockAlerts al guardar", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    programarInsertConRetorno();

    await canonicalPatch(request({ stockAlerts: true }));
    expect(valoresEscritos?.inventoryAlerts).toBe(true);
    expect(valoresEscritos).not.toHaveProperty("stockAlerts");
  });

  it("ignora un userId del cuerpo: el dueño es el de la sesión", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    programarInsertConRetorno();

    await canonicalPatch(request({ userId: "otro-usuario", incidents: false }));
    expect(valoresEscritos?.userId).toBe(USUARIO);
  });

  it("rechaza un cuerpo sin preferencias válidas y no escribe", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    programarInsertConRetorno();

    const res = await canonicalPatch(request({ admin: true }));
    expect(res.status).toBe(400);
    expect(insertLlamado).toBe(false);
  });

  it("la ruta de perfil guarda el contrato completo", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    programarInsertConRetorno();

    const res = await profilePut(request({ shiftReminders: true }));
    expect(res.status).toBe(200);
    expect(valoresEscritos).toMatchObject({
      userId: USUARIO,
      shiftReminders: true,
      scheduleChanges: true,
      inventoryAlerts: false,
    });
  });

  it("la ruta de usuario permite guardar sólo el teléfono y devuelve las preferencias", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    programarInsertConRetorno();
    const { set } = programarUpdate();

    const res = await userPatch(request({ whatsappPhone: "+5215511111111" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ whatsappPhone: "+5215511111111" })
    );
    expect(body.data).toMatchObject({
      inventoryAlerts: false,
      whatsappPhone: "+5215500000000",
    });
  });

  it("la ruta de usuario rechaza un cuerpo vacío sin teléfono ni preferencias", async () => {
    preferenciasGuardadas(FILA_COMPLETA);
    programarInsertConRetorno();

    const res = await userPatch(request({ admin: true }));
    expect(res.status).toBe(400);
    expect(insertLlamado).toBe(false);
  });
});
