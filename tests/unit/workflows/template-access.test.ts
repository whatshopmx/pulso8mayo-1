import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/rbac/abac";
import {
  cargarPlantillaDeEmpresa,
  plantillaDeEmpresa,
  requireTemplateAccess,
} from "@/lib/workflows/template-access";
import { GET, PATCH, DELETE } from "@/app/api/workflows/templates/[id]/route";
import { ApiError } from "@/lib/api/error";

/**
 * C03 — las dos rutas de plantilla comparten la misma política (H02).
 *
 * Se prueban las dos capas por separado porque fallaban de forma distinta:
 *
 * - La política (`lib/workflows/template-access.ts`) decide con la matriz de
 *   `lib/rbac/abac.ts`, que es la misma que usa el resto de la aplicación.
 * - Las rutas preguntan a la política. Aquí se comprueba con las funciones
 *   reales del route handler que un turno ajeno devuelve 404 en las tres y que
 *   el permiso de `delete` se traduce en 403 antes de tocar la base.
 *
 * El `WHERE` se traduce con `PgDialect.sqlToQuery` para que quitar el
 * `company_id` de un DELETE truene aquí.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    query: { workflowTemplates: { findFirst: vi.fn() } },
  },
}));

vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: vi.fn() }));

const dialect = new PgDialect();

function traducir(condicion: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condicion as never);
}

const EMPRESA_A = "a1000000-0000-4000-8000-00000000000a";
const PLANTILLA_A = "c3000000-0000-4000-8000-000000000001";
/** Id de una plantilla de la empresa B: existe, pero no es de nadie de A. */
const PLANTILLA_B_ID = "c3000000-0000-4000-8000-0000000000bb";

const filaDePlantilla = {
  id: PLANTILLA_A,
  companyId: EMPRESA_A,
  name: "Recepción",
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
};

/** Sesión simulada para `requirePermissionApi`. */
function sesion(overrides: Record<string, unknown> = {}) {
  vi.mocked(requirePermissionApi).mockResolvedValue({
    session: { id: "sesion" },
    user: {
      id: "user-admin-a",
      role: "ADMIN",
      companyId: EMPRESA_A,
      branchId: null,
      email: "admin@empresa-a.test",
      ...overrides,
    },
    ctx: {},
    decision: { allowed: true },
  } as never);
}

/** `db.select().from().where()` — la forma de `cargarPlantillaDeEmpresa`. */
function encadenarSelect(filas: unknown[]) {
  const where = vi.fn().mockResolvedValue(filas);
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where };
}

/** `db.update().set().where().returning()` */
function encadenarUpdate(filas: unknown[]) {
  const returning = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where, returning };
}

/** `db.delete().where()` */
function encadenarDelete() {
  const where = vi.fn().mockResolvedValue(undefined);
  vi.mocked(db.delete).mockReturnValue({ where } as never);
  return { where };
}

/** Petición con cuerpo JSON, sin necesidad de levantar un servidor. */
function peticion(cuerpo?: unknown): Request {
  return new Request("http://localhost/api/workflows/templates/x", {
    method: "PATCH",
    ...(cuerpo === undefined
      ? {}
      : { body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }),
  });
}

const params = Promise.resolve({ id: PLANTILLA_A });

beforeEach(() => {
  vi.clearAllMocks();
  sesion();
});

describe("requireTemplateAccess", () => {
  it("pide permiso sobre workflows y devuelve la empresa de la sesión", async () => {
    const actor = await requireTemplateAccess("update");

    expect(requirePermissionApi).toHaveBeenCalledWith("workflows", "update");
    expect(actor.companyId).toBe(EMPRESA_A);
  });

  it("cierra a una sesión sin empresa en vez de devolver un vacío ambiguo", async () => {
    sesion({ companyId: null });
    await expect(requireTemplateAccess("read")).rejects.toBeInstanceOf(ApiError);
  });

  it("propaga el rechazo del permiso sin abrir la base", async () => {
    vi.mocked(requirePermissionApi).mockRejectedValue(
      new ApiError("access-denied", 403)
    );
    const select = encadenarSelect([filaDePlantilla]);

    await expect(requireTemplateAccess("delete")).rejects.toBeInstanceOf(ApiError);
    expect(select.from).not.toHaveBeenCalled();
  });
});

describe("cargarPlantillaDeEmpresa", () => {
  it("filtra por id y empresa a la vez", async () => {
    const select = encadenarSelect([filaDePlantilla]);

    const plantilla = await cargarPlantillaDeEmpresa(
      { userId: "u", role: "ADMIN", companyId: EMPRESA_A },
      PLANTILLA_A
    );

    const { sql, params: valores } = traducir(select.where.mock.calls[0][0]);
    expect(sql).toContain('"id" =');
    expect(sql).toContain('"company_id" =');
    expect(valores).toEqual(expect.arrayContaining([PLANTILLA_A, EMPRESA_A]));
    expect(plantilla.id).toBe(PLANTILLA_A);
  });

  it("responde 404 —no 403— cuando la plantilla es de otra empresa", async () => {
    // Distinguir "no existe" de "es de otra empresa" sólo se lo confirma a quien
    // ya tiene el id: ese 403 es medio mapa de las demás empresas.
    encadenarSelect([]);

    await expect(
      cargarPlantillaDeEmpresa({ userId: "u", role: "ADMIN", companyId: EMPRESA_A }, PLANTILLA_B_ID)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("plantillaDeEmpresa — la condición de escritura", () => {
  it("siempre lleva las dos columnas", () => {
    const { sql, params } = traducir(plantillaDeEmpresa(PLANTILLA_A, EMPRESA_A));
    expect(sql).toContain('"id" =');
    expect(sql).toContain('"company_id" =');
    expect(params).toEqual([PLANTILLA_A, EMPRESA_A]);
  });
});

describe("Ruta corta /api/workflows/templates/[id] — las tres operaciones", () => {
  it("GET 404 para una plantilla de otra empresa", async () => {
    encadenarSelect([]);

    const res = await GET(peticion(), { params });

    expect(res.status).toBe(404);
  });

  it("GET devuelve la plantilla de la propia empresa", async () => {
    encadenarSelect([filaDePlantilla]);

    const res = await GET(peticion(), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: PLANTILLA_A });
  });

  it("PATCH escribe acotado a la empresa", async () => {
    const update = encadenarUpdate([filaDePlantilla]);

    const res = await PATCH(peticion({ name: "Recepción v2" }), { params });

    expect(res.status).toBe(200);
    const { sql, params: valores } = traducir(update.where.mock.calls[0][0]);
    expect(sql).toContain('"id" =');
    expect(sql).toContain('"company_id" =');
    expect(valores).toEqual(expect.arrayContaining([PLANTILLA_A, EMPRESA_A]));
  });

  it("PATCH 404 cuando no actualiza ninguna fila (plantilla ajena)", async () => {
    encadenarUpdate([]);

    const res = await PATCH(peticion({ name: "x" }), { params });

    expect(res.status).toBe(404);
  });

  it("DELETE de otra empresa no borra nada", async () => {
    encadenarSelect([]); // la carga acotada no la encuentra
    const borrar = encadenarDelete();

    const res = await DELETE(peticion(), { params });

    expect(res.status).toBe(404);
    expect(borrar.where).not.toHaveBeenCalled();
  });

  it("DELETE borra acotado a la empresa", async () => {
    encadenarSelect([filaDePlantilla]);
    const borrar = encadenarDelete();

    const res = await DELETE(peticion(), { params });

    expect(res.status).toBe(200);
    const { sql, params: valores } = traducir(borrar.where.mock.calls[0][0]);
    expect(sql).toContain('"company_id" =');
    expect(valores).toContain(EMPRESA_A);
  });

  it("sin permiso de borrado devuelve 403 antes de consultar", async () => {
    vi.mocked(requirePermissionApi).mockRejectedValue(new ApiError("access-denied", 403));
    const select = encadenarSelect([filaDePlantilla]);
    const borrar = encadenarDelete();

    const res = await DELETE(peticion(), { params });

    expect(res.status).toBe(403);
    expect(select.from).not.toHaveBeenCalled();
    expect(borrar.where).not.toHaveBeenCalled();
  });
});