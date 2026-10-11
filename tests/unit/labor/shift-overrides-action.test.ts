import { describe, it, expect, vi, beforeEach } from "vitest";

import { db } from "@/lib/db";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { concederExcepcion, historialDeExcepcion, revocarExcepcion } from "@/lib/security/policy-overrides";
import {
  concederExcepcionJornada,
  historialDeExcepcionJornada,
  puedeAutorizarExcepciones,
  revocarExcepcionJornada,
} from "@/app/actions/shift-overrides";
import { EMPLEADO_A_1, EMPLEADO_A_2, EMPRESA_A, adminA } from "../../fixtures/tenant-isolation";

/**
 * La puerta para levantar el bloqueo de la jornada de 8 horas.
 *
 * Lo que importa aquí no es que la fila se escriba —eso ya lo cubre
 * `policy-overrides.test.ts`—, sino **quién** puede abrirla y sobre **qué
 * recurso**: un dueño puede levantar la jornada de su gente, no la de un
 * empleado de otra empresa.
 *
 * El recurso es `usuario:AAAA-MM-DD` porque en el momento de conceder la
 * excepción el turno todavía no existe.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

vi.mock("@/lib/api/with-auth", () => ({ requireTenantAuth: vi.fn() }));

vi.mock("@/lib/security/policy-overrides", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/security/policy-overrides")>();
  return {
    ...real,
    concederExcepcion: vi.fn(),
    revocarExcepcion: vi.fn(),
    historialDeExcepcion: vi.fn(),
  };
});

/** Sesión simulada con el rol que sea. `OWNER` no está en `UserRole`. */
function sesion(role: string) {
  vi.mocked(requireTenantAuth).mockResolvedValue({
    user: {
      id: "user-owner-a",
      role,
      companyId: EMPRESA_A,
      branchId: null,
      email: "owner@empresa-a.test",
    },
    tenantId: EMPRESA_A,
    branchId: null,
  } as never);
}

/** `db.select().from().where().limit()` — el empleado existe en esta empresa. */
function encadenarSelect(filas: unknown[]) {
  const limit = vi.fn().mockResolvedValue(filas);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, limit };
}

const CONCESION = {
  userId: EMPLEADO_A_1,
  shiftDate: "2026-03-16",
  reason: "Temporada alta con cierre doble los sábados.",
};

beforeEach(() => {
  vi.clearAllMocks();
  sesion("OWNER");
  encadenarSelect([{ id: EMPLEADO_A_1 }]);
  vi.mocked(concederExcepcion).mockResolvedValue({ id: "override-1" } as never);
  vi.mocked(revocarExcepcion).mockResolvedValue(undefined);
  vi.mocked(historialDeExcepcion).mockResolvedValue([]);
});

describe("puedeAutorizarExcepciones — para no ofrecer un botón que va a fallar", () => {
  it("es cierta para dueño y super admin", async () => {
    sesion("OWNER");
    await expect(puedeAutorizarExcepciones()).resolves.toBe(true);

    sesion("SUPER_ADMIN");
    await expect(puedeAutorizarExcepciones()).resolves.toBe(true);
  });

  it("es falsa para el resto", async () => {
    for (const rol of ["ADMIN", "GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"]) {
      sesion(rol);
      await expect(puedeAutorizarExcepciones(), rol).resolves.toBe(false);
    }
  });
});

describe("concederExcepcionJornada", () => {
  it("concede sobre el empleado y el día, con motivo y caducidad opcional", async () => {
    await concederExcepcionJornada({ ...CONCESION, expiresInDays: 30 });

    expect(concederExcepcion).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: EMPRESA_A,
        grantedBy: "user-owner-a",
        reason: CONCESION.reason,
        domain: "SHIFT_VALIDATION",
        rule: "MAX_DAILY_HOURS",
        resourceType: "employee_day",
        resourceId: `${EMPLEADO_A_1}:2026-03-16`,
      })
    );
  });

  it("sin caducidad por defecto: una excepción permanente es política disfrazada", async () => {
    await concederExcepcionJornada(CONCESION);

    expect(concederExcepcion).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null })
    );
  });

  it("un motivo corto no abre nada", async () => {
    await expect(
      concederExcepcionJornada({ ...CONCESION, reason: "ok" })
    ).rejects.toBeTruthy();

    expect(concederExcepcion).not.toHaveBeenCalled();
  });

  it("un admin no concede, aunque administre la empresa", async () => {
    sesion("ADMIN");

    await expect(concederExcepcionJornada(CONCESION)).rejects.toBeTruthy();
    expect(concederExcepcion).not.toHaveBeenCalled();
  });

  it("un empleado de otra empresa no recibe la excepción", async () => {
    encadenarSelect([]);

    await expect(concederExcepcionJornada(CONCESION)).rejects.toBeTruthy();
    expect(concederExcepcion).not.toHaveBeenCalled();
  });

  it("una fecha con otro formato no abre nada", async () => {
    await expect(
      concederExcepcionJornada({ ...CONCESION, shiftDate: "16/03/2026" })
    ).rejects.toBeTruthy();

    expect(concederExcepcion).not.toHaveBeenCalled();
  });
});

describe("revocarExcepcionJornada", () => {
  it("revoca el mismo recurso y exige motivo", async () => {
    await revocarExcepcionJornada({ ...CONCESION, reason: "Terminó la temporada alta." });

    expect(revocarExcepcion).toHaveBeenCalledWith(
      EMPRESA_A,
      expect.objectContaining({
        domain: "SHIFT_VALIDATION",
        rule: "MAX_DAILY_HOURS",
        resourceId: `${EMPLEADO_A_1}:2026-03-16`,
      }),
      "user-owner-a",
      "Terminó la temporada alta."
    );
  });

  it("no revoca un empleado de otra empresa", async () => {
    encadenarSelect([]);

    await expect(
      revocarExcepcionJornada({ ...CONCESION, reason: "Ya no aplica la excepción." })
    ).rejects.toBeTruthy();
    expect(revocarExcepcion).not.toHaveBeenCalled();
  });
});

describe("historialDeExcepcionJornada — la explicación, no un secreto", () => {
  it("lo puede leer un gerente: no concede, pero explica", async () => {
    sesion("GERENTE");
    encadenarSelect([{ id: EMPLEADO_A_1 }]);

    await historialDeExcepcionJornada({
      userId: EMPLEADO_A_1,
      shiftDate: "2026-03-16",
    });

    expect(historialDeExcepcion).toHaveBeenCalledWith(
      EMPRESA_A,
      expect.objectContaining({
        resourceId: `${EMPLEADO_A_1}:2026-03-16`,
      })
    );
  });

  it("sin sesión no hay historial", async () => {
    vi.mocked(requireTenantAuth).mockRejectedValue(new Error("sin sesión"));

    await expect(
      historialDeExcepcionJornada({ userId: EMPLEADO_A_2, shiftDate: "2026-03-16" })
    ).rejects.toBeTruthy();

    expect(historialDeExcepcion).not.toHaveBeenCalled();
  });
});