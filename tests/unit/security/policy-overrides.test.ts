import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  assertPuedeConcederExcepcion,
  concederExcepcion,
  hayExcepcionVigente,
  revocarExcepcion,
  type OverrideTarget,
} from "@/lib/security/policy-overrides";
import { ApiError } from "@/lib/api/error";
import { EMPRESA_A, EMPRESA_B } from "../../fixtures/tenant-isolation";

/**
 * Excepciones auditadas — `lib/security/policy-overrides.ts`.
 *
 * Lo que se prueba aquí es la promesa que sostiene la tabla: una excepción
 * existe sólo con motivo, sólo la concede quien tiene ese poder, y se revoca
 * sin borrarse para que el rastro siga respondiendo.
 *
 * El filtro de **empresa** aparece en las tres consultas, y eso es lo que
 * impide que un id de excepción de otra empresa conceda nada aquí.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: { policyOverrides: { findFirst: vi.fn(), findMany: vi.fn() } },
  },
}));

const dialect = new PgDialect();

function traducir(condicion: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condicion as never);
}

/** `db.select().from().where().limit()` */
function encadenarSelect(filas: unknown[]) {
  const limit = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

/** `db.insert(tabla).values({...}).returning()` */
function encadenarInsert(filas: unknown[]) {
  const returning = vi.fn().mockResolvedValue(filas);
  const values = vi.fn().mockReturnValue({ returning });
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  return { values, returning };
}

/** `db.update(tabla).set({...}).where(...)` */
function encadenarUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where };
}

const OBJETIVO: OverrideTarget = {
  domain: "SHIFT_VALIDATION",
  rule: "MAX_DAILY_HOURS",
  resourceType: "planned_shift",
  resourceId: "3000000-0000-4000-8000-000000000001",
};

const FILA = {
  id: "override-1",
  companyId: EMPRESA_A,
  domain: "SHIFT_VALIDATION",
  rule: "MAX_DAILY_HOURS",
  resourceType: "planned_shift",
  resourceId: OBJETIVO.resourceId,
  grantedBy: "user-owner-a",
  reason: "Temporada alta, cobertura de fechamento con dos turnos.",
  grantedAt: new Date("2026-10-01T00:00:00.000Z"),
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.query.policyOverrides.findFirst).mockResolvedValue(undefined as never);
});

describe("assertPuedeConcederExcepcion — un poder distinto del de operar", () => {
  it("el dueño y el super admin pueden", () => {
    for (const rol of ["OWNER", "SUPER_ADMIN"] as const) {
      expect(() => assertPuedeConcederExcepcion(rol)).not.toThrow();
    }
  });

  it("un admin no puede, aunque administre la empresa", () => {
    // ADMIN ejecuta y ve; redefinir la política que lo ata es otro poder.
    const error = (() => {
      try {
        assertPuedeConcederExcepcion("ADMIN");
      } catch (e) {
        return e as ApiError;
      }
      throw new Error("debió rechazar");
    })();

    expect(error.statusCode).toBe(403);
  });

  it("gerencia y empleados no pueden", () => {
    for (const rol of ["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"] as const) {
      expect(() => assertPuedeConcederExcepcion(rol)).toThrow();
    }
  });
});

describe("concederExcepcion — el motivo no es opcional", () => {
  it("sin motivo no se escribe la fila", async () => {
    const insert = encadenarInsert([FILA]);

    await expect(
      concederExcepcion({
        companyId: EMPRESA_A,
        ...OBJETIVO,
        grantedBy: "user-owner-a",
        reason: "   ",
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("un motivo de un carácter no es un motivo", async () => {
    const insert = encadenarInsert([FILA]);

    await expect(
      concederExcepcion({
        companyId: EMPRESA_A,
        ...OBJETIVO,
        grantedBy: "user-owner-a",
        reason: "porque sí",
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(insert.values).not.toHaveBeenCalled();
  });

  it("concede guardando empresa, actor y motivo", async () => {
    const insert = encadenarInsert([FILA]);

    await concederExcepcion({
      companyId: EMPRESA_A,
      branchId: "a1000001-0000-4000-8000-000000000001",
      ...OBJETIVO,
      grantedBy: "user-owner-a",
      reason: "Temporada alta, cobertura de fechamento con dos turnos.",
    });

    const fila = insert.values.mock.calls[0][0] as Record<string, unknown>;
    expect(fila.companyId).toBe(EMPRESA_A);
    expect(fila.grantedBy).toBe("user-owner-a");
    expect(fila.reason).toContain("Temporada alta");
  });

  it("devuelve la excepción vigente en lugar de reescribirla", async () => {
    // Cambiar el motivo de una excepción ya concedida debe ser un acto
    // explícito de revocación, o el rastro deja de explicar por qué se concedió.
    const existente = { ...FILA, reason: "Motivo original: temporada alta" };
    vi.mocked(db.query.policyOverrides.findFirst).mockResolvedValue(existente as never);
    const insert = encadenarInsert([FILA]);

    const resultado = await concederExcepcion({
      companyId: EMPRESA_A,
      ...OBJETIVO,
      grantedBy: "user-owner-a",
      reason: "Un motivo distinto y más largo.",
    });

    expect(resultado.reason).toBe("Motivo original: temporada alta");
    expect(insert.values).not.toHaveBeenCalled();
  });
});

describe("hayExcepcionVigente — concede el paso o no", () => {
  it("filtra por empresa, dominio, regla, recurso y estado", async () => {
    const select = encadenarSelect([{ id: "override-1" }]);

    await hayExcepcionVigente(EMPRESA_A, OBJETIVO, new Date("2026-10-11T00:00:00.000Z"));

    const { sql, params } = traducir(select.where.mock.calls[0][0]);
    for (const columna of [
      '"company_id"',
      '"domain"',
      '"rule"',
      '"resource_type"',
      '"resource_id"',
    ]) {
      expect(sql, columna).toContain(columna);
    }
    // Vigente = no revocada y (sin caducidad o dentro de plazo).
    expect(sql).toContain('"revoked_at" is null');
    expect(sql).toContain('"expires_at"');
    expect(params).toContain(EMPRESA_A);
    expect(params).toContain(OBJETIVO.resourceId);
  });

  it("devuelve falso cuando no hay fila", async () => {
    encadenarSelect([]);
    await expect(hayExcepcionVigente(EMPRESA_A, OBJETIVO)).resolves.toBe(false);
  });

  it("la empresa es parte de la pregunta, no un detalle", async () => {
    // Una excepción de B sobre el mismo recurso no habilita nada en A.
    const select = encadenarSelect([{ id: "override-1" }]);

    await hayExcepcionVigente(EMPRESA_B, OBJETIVO);

    const { params } = traducir(select.where.mock.calls[0][0]);
    expect(params).toContain(EMPRESA_B);
    expect(params).not.toContain(EMPRESA_A);
  });
});

describe("revocarExcepcion — se marca, no se borra", () => {
  it("escribe quién, cuándo y por qué, y acota a la excepción viva", async () => {
    const update = encadenarUpdate();

    await revocarExcepcion(
      EMPRESA_A,
      OBJETIVO,
      "user-owner-a",
      "Terminó la temporada alta."
    );

    const { revokedBy, revokedReason, revokedAt } = (
      update.set.mock.calls[0][0] as Record<string, unknown>
    );
    expect(revokedBy).toBe("user-owner-a");
    expect(revokedReason).toBe("Terminó la temporada alta.");
    expect(revokedAt).toBeInstanceOf(Date);

    const { sql } = traducir(update.where.mock.calls[0][0]);
    expect(sql).toContain('"revoked_at" is null');
  });

  it("no se revoca sin motivo, por simetría con conceder", async () => {
    const update = encadenarUpdate();

    await expect(
      revocarExcepcion(EMPRESA_A, OBJETIVO, "user-owner-a", "x")
    ).rejects.toBeInstanceOf(ApiError);

    expect(update.set).not.toHaveBeenCalled();
  });
});