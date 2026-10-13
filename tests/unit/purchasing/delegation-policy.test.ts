import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { GET, PUT } from "@/app/api/purchase-delegation/route";
import {
  alcanceDe,
  cargarReglasDeDelegacion,
  evaluarDelegacion,
  normalizarCategoria,
  reemplazarReglasDeDelegacion,
  reglaCubre,
  resolverDelegacion,
  validarReglasDeDelegacion,
  type DelegationRule,
} from "@/lib/purchasing/delegation-policy";
import {
  EMPRESA_A,
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  adminA,
  gerenteA1,
  type SessionFixture,
} from "../../fixtures/tenant-isolation";

/**
 * C16.2.1 — los controles de solicitud y emisión se configuran y se resuelven
 * antes de aplicarlos a los caminos de escritura (eso es C16.2.2).
 *
 * Lo que estas pruebas fijan:
 *
 *  1. La resolución pura: sin reglas no hay control adicional; con reglas hace
 *     falta una que cubra la operación y que el actor alcance. Los tres fallos
 *     nombran su causa, porque el mensaje es lo que ve el operador.
 *  2. La ruta real: sesión, ADMIN y permiso `settings:update`; el `companyId`
 *     sale de la sesión; un rechazo de validación no deja reglas a medias.
 *
 * `db` va simulado y `@/lib/branch-scope` también, porque su comprobación de
 * sucursal es una consulta a Postgres que ya tiene sus propias pruebas.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
}));
vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn(), requireTenant: vi.fn() }));
vi.mock("@/lib/branch-scope", () => ({ assertBranchOfCompany: vi.fn(async () => undefined) }));
// `roleIsAtLeast` y la jerarquía se necesitan reales (la resolución los usa);
// `hasPermission` se controla por prueba.
vi.mock("@/lib/permissions", async () => {
  const real = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...real, hasPermission: vi.fn(() => true) };
});

const regla = (parcial: Partial<DelegationRule> & Pick<DelegationRule, "action" | "scope" | "requiredRole">): DelegationRule => ({
  branchId: null,
  category: null,
  active: true,
  ...parcial,
});

const contexto = (parcial: Partial<Parameters<typeof resolverDelegacion>[1]> & { action: "REQUEST" | "EMIT" }) => ({
  role: "GERENTE" as string | null,
  branchId: SUCURSAL_A_1,
  categories: [] as string[],
  ...parcial,
});

describe("delegación — normalización de categoría", () => {
  it("compara el texto libre del artículo sin depender de cómo se escribió", () => {
    // `inventory_items.category` es texto libre: "Abarrotes", " abarrotes " y
    // "ABARROTES" tienen que ser la misma categoría para el control.
    expect(normalizarCategoria("Abarrotes")).toBe(normalizarCategoria("  abarrotes  "));
    expect(normalizarCategoria("ABARROTES")).toBe("ABARROTES");
    expect(normalizarCategoria(null)).toBe("");
    expect(normalizarCategoria("   ")).toBe("");
    expect(normalizarCategoria("Lácteos")).not.toBe(normalizarCategoria("Lacteos"));
  });
});

describe("delegación — cobertura de una regla", () => {
  it("una regla de empresa cubre todo; una de sucursal sólo la suya", () => {
    const empresa = regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "GERENTE" });
    const sucursal = regla({ action: "REQUEST", scope: "BRANCH", requiredRole: "GERENTE", branchId: SUCURSAL_A_1 });

    expect(reglaCubre(empresa, contexto({ action: "REQUEST" }))).toBe(true);
    expect(reglaCubre(sucursal, contexto({ action: "REQUEST", branchId: SUCURSAL_A_1 }))).toBe(true);
    expect(reglaCubre(sucursal, contexto({ action: "REQUEST", branchId: SUCURSAL_A_2 }))).toBe(false);
  });

  it("una regla de categoría cubre si alguno de los artículos es de ella", () => {
    const porCategoria = regla({ action: "REQUEST", scope: "CATEGORY", requiredRole: "SUPERVISOR", category: "ABARROTES" });

    expect(reglaCubre(porCategoria, contexto({ action: "REQUEST", categories: ["Carnes", "Abarrotes"] }))).toBe(true);
    expect(reglaCubre(porCategoria, contexto({ action: "REQUEST", categories: ["Carnes"] }))).toBe(false);
    expect(reglaCubre(porCategoria, contexto({ action: "REQUEST", categories: [] }))).toBe(false);
  });

  it("una regla de categoría sin categoría no cubre nada, ni aunque se guardó", () => {
    const vacia = regla({ action: "REQUEST", scope: "CATEGORY", requiredRole: "GERENTE", category: "   " });
    expect(reglaCubre(vacia, contexto({ action: "REQUEST", categories: ["ABARROTES"] }))).toBe(false);
  });

  it("el ámbito se nombra para el mensaje, sin inventar datos", () => {
    expect(alcanceDe(regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "GERENTE" }))).toBe("toda la empresa");
    expect(alcanceDe(regla({ action: "EMIT", scope: "BRANCH", requiredRole: "ADMIN", branchId: SUCURSAL_A_1 }))).toContain(
      SUCURSAL_A_1,
    );
    expect(alcanceDe(regla({ action: "EMIT", scope: "CATEGORY", requiredRole: "ADMIN", category: "ABARROTES" }))).toContain(
      "ABARROTES",
    );
  });
});

describe("delegación — sin controles configurados", () => {
  it("permite y lo dice: no hay control adicional, no «cualquiera puede»", () => {
    const veredicto = resolverDelegacion([], contexto({ action: "REQUEST" }));
    expect(veredicto.allowed).toBe(true);
    if (veredicto.allowed) {
      expect(veredicto.basis).toBe("sin_controles");
      expect(veredicto.reason).toMatch(/no ha configurado controles/i);
    }
  });

  it("las reglas de otra acción no cuentan como controles de esta", () => {
    const soloEmision = [regla({ action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" })];
    const veredicto = resolverDelegacion(soloEmision, contexto({ action: "REQUEST" }));
    expect(veredicto.allowed).toBe(true);
    if (veredicto.allowed) expect(veredicto.basis).toBe("sin_controles");
  });

  it("una regla inactiva es como si no existiera", () => {
    const inactiva = regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "ADMIN", active: false });
    const veredicto = resolverDelegacion([inactiva], contexto({ action: "REQUEST", role: "SUPERVISOR" }));
    expect(veredicto.allowed).toBe(true);
    if (veredicto.allowed) expect(veredicto.basis).toBe("sin_controles");
  });
});

describe("delegación — con controles configurados", () => {
  const conReglas = (rs: DelegationRule[]) => rs;

  it("permite cuando una regla cubre y el actor alcanza el rol", () => {
    const reglas = conReglas([regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "GERENTE" })]);
    const veredicto = resolverDelegacion(reglas, contexto({ action: "REQUEST", role: "GERENTE" }));
    expect(veredicto.allowed).toBe(true);
    if (veredicto.allowed) {
      expect(veredicto.basis).toBe("regla");
      expect(veredicto.requiredRole).toBe("GERENTE");
    }
  });

  it("un rol superior al exigido también alcanza", () => {
    const reglas = conReglas([regla({ action: "EMIT", scope: "COMPANY", requiredRole: "GERENTE" })]);
    expect(resolverDelegacion(reglas, contexto({ action: "EMIT", role: "OWNER" })).allowed).toBe(true);
  });

  it("rechaza por rol insuficiente y nombra el mínimo", () => {
    const reglas = conReglas([regla({ action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" })]);
    const veredicto = resolverDelegacion(reglas, contexto({ action: "EMIT", role: "SUPERVISOR" }));
    expect(veredicto.allowed).toBe(false);
    if (!veredicto.allowed) {
      expect(veredicto.basis).toBe("rol_insuficiente");
      expect(veredicto.requiredRole).toBe("ADMIN");
      expect(veredicto.reason).toContain("ADMIN");
    }
  });

  it("rechaza cuando las reglas existen pero ninguna cubre la sucursal", () => {
    const reglas = conReglas([
      regla({ action: "REQUEST", scope: "BRANCH", requiredRole: "GERENTE", branchId: SUCURSAL_A_1 }),
    ]);
    const veredicto = resolverDelegacion(reglas, contexto({ action: "REQUEST", branchId: SUCURSAL_A_2 }));
    expect(veredicto.allowed).toBe(false);
    if (!veredicto.allowed) {
      expect(veredicto.basis).toBe("sin_cobertura");
      expect(veredicto.reason).toContain(SUCURSAL_A_2);
      expect(veredicto.uncoveredScopes.join(" ")).toContain(SUCURSAL_A_2);
    }
  });

  it("una regla de empresa cubre una sucursal sin regla propia", () => {
    const reglas = conReglas([
      regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "ADMIN" }),
      regla({ action: "REQUEST", scope: "BRANCH", requiredRole: "GERENTE", branchId: SUCURSAL_A_1 }),
    ]);
    // Sucursal 2 sólo tiene la regla de empresa: alcanza con ADMIN.
    expect(resolverDelegacion(reglas, contexto({ action: "REQUEST", branchId: SUCURSAL_A_2, role: "ADMIN" })).allowed).toBe(true);
    expect(resolverDelegacion(reglas, contexto({ action: "REQUEST", branchId: SUCURSAL_A_2, role: "GERENTE" })).allowed).toBe(false);
    // Sucursal 1 tiene las dos: la de sucursal es más permisiva y GERENTE basta.
    expect(resolverDelegacion(reglas, contexto({ action: "REQUEST", branchId: SUCURSAL_A_1, role: "GERENTE" })).allowed).toBe(true);
  });

  it("con varias reglas que cubren, gana la más permisiva que el actor alcance", () => {
    const reglas = conReglas([
      regla({ action: "EMIT", scope: "COMPANY", requiredRole: "OWNER" }),
      regla({ action: "EMIT", scope: "COMPANY", requiredRole: "GERENTE" }),
    ]);
    const veredicto = resolverDelegacion(reglas, contexto({ action: "EMIT", role: "GERENTE" }));
    expect(veredicto.allowed).toBe(true);
    if (veredicto.allowed) expect(veredicto.requiredRole).toBe("GERENTE");
  });

  it("no inventa cobertura cuando la categoría de los artículos viene vacía", () => {
    const reglas = conReglas([regla({ action: "REQUEST", scope: "CATEGORY", requiredRole: "GERENTE", category: "ABARROTES" })]);
    const veredicto = resolverDelegacion(reglas, contexto({ action: "REQUEST", categories: [] }));
    expect(veredicto.allowed).toBe(false);
    if (!veredicto.allowed) expect(veredicto.reason).toMatch(/artículos sin categoría/);
  });
});

describe("delegación — actor de sistema", () => {
  it("puede dejar un borrador aunque no haya controles", () => {
    const veredicto = resolverDelegacion([], contexto({ action: "REQUEST", role: null }));
    expect(veredicto.allowed).toBe(true);
    if (veredicto.allowed) expect(veredicto.basis).toBe("sistema_borrador");
  });

  it("nunca emite, con controles o sin ellos", () => {
    // Las sugerencias del PAR crean borradores: mandar una orden al proveedor es
    // una decisión de persona, y sin esa línea el flujo automático podría
    // hacerlo si algún día se le agregara `send`.
    for (const reglas of [[], [regla({ action: "EMIT", scope: "COMPANY", requiredRole: "EMPLEADO" })]]) {
      const veredicto = resolverDelegacion(reglas, contexto({ action: "EMIT", role: null }));
      expect(veredicto.allowed).toBe(false);
      if (!veredicto.allowed) expect(veredicto.basis).toBe("sistema_no_emite");
    }
  });
});

describe("delegación — validación del contrato", () => {
  it("una regla por sucursal necesita sucursal, y una de empresa no la admite", async () => {
    await expect(
      validarReglasDeDelegacion(EMPRESA_A, [{ action: "REQUEST", scope: "BRANCH", requiredRole: "GERENTE" }]),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      validarReglasDeDelegacion(EMPRESA_A, [
        { action: "REQUEST", scope: "COMPANY", branchId: SUCURSAL_A_1, requiredRole: "GERENTE" },
      ]),
    ).resolves.toMatchObject({ ok: false });
  });

  it("una regla por categoría necesita categoría", async () => {
    await expect(
      validarReglasDeDelegacion(EMPRESA_A, [
        { action: "REQUEST", scope: "CATEGORY", category: "   ", requiredRole: "GERENTE" },
      ]),
    ).resolves.toMatchObject({ ok: false });
  });

  it("un rol desconocido se rechaza: roleIsAtLeast fallaría cerrado para siempre", async () => {
    await expect(
      validarReglasDeDelegacion(EMPRESA_A, [
        { action: "REQUEST", scope: "COMPANY", requiredRole: "DIRECTOR_COMERCIAL" },
      ]),
    ).resolves.toMatchObject({ ok: false });
  });

  it("una sucursal de otra empresa se rechaza", async () => {
    const { assertBranchOfCompany } = await import("@/lib/branch-scope");
    vi.mocked(assertBranchOfCompany).mockRejectedValueOnce(new Error("no pertenece") as never);

    const resultado = await validarReglasDeDelegacion(EMPRESA_A, [
      { action: "REQUEST", scope: "BRANCH", branchId: SUCURSAL_A_2, requiredRole: "GERENTE" },
    ]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/no pertenece a esta empresa/);
  });

  it("dos reglas activas sobre el mismo ámbito avisan, no rompen", async () => {
    const resultado = await validarReglasDeDelegacion(EMPRESA_A, [
      { action: "EMIT", scope: "COMPANY", requiredRole: "GERENTE" },
      { action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" },
    ]);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.warnings.join(" ")).toMatch(/más permisiva/);
  });

  it("un conjunto coherente pasa sin avisos", async () => {
    const resultado = await validarReglasDeDelegacion(EMPRESA_A, [
      { action: "EMIT", scope: "COMPANY", requiredRole: "GERENTE" },
      { action: "EMIT", scope: "BRANCH", branchId: SUCURSAL_A_1, requiredRole: "ADMIN" },
      { action: "EMIT", scope: "CATEGORY", category: "Abarrotes", requiredRole: "SUPERVISOR" },
    ]);
    expect(resultado).toEqual({ ok: true, warnings: [] });
  });
});

// ── Carga, reemplazo y ruta real ──

/** `db.select().from().where().orderBy()` — el cargador de reglas. */
function encadenarSelect(filas: unknown[] | (() => unknown[])) {
  const resolver = typeof filas === "function" ? filas : () => filas;
  const orderBy = vi.fn(async () => resolver());
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, orderBy };
}

function sesion(de: SessionFixture) {
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: de.id, role: de.role, companyId: de.companyId } } as never);
  vi.mocked(requireTenant).mockResolvedValue({ id: de.companyId, branchId: de.branchId } as never);
}

const request = (body: unknown) => ({ json: async () => body }) as never;

describe("delegación — carga desde la base", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve las reglas de la empresa y la acción pedidas, con su forma", async () => {
    encadenarSelect([
      {
        action: "EMIT",
        scope: "BRANCH",
        branchId: SUCURSAL_A_1,
        category: null,
        requiredRole: "ADMIN",
        active: true,
      },
    ]);

    const reglas = await cargarReglasDeDelegacion(EMPRESA_A, "EMIT");
    expect(reglas).toEqual([
      { action: "EMIT", scope: "BRANCH", branchId: SUCURSAL_A_1, category: null, requiredRole: "ADMIN", active: true },
    ]);
  });

  it("un error de lectura no se convierte en «sin controles»", async () => {
    vi.mocked(db.select).mockImplementation(() => {
      throw new Error("connection reset");
    });
    await expect(evaluarDelegacion(EMPRESA_A, contexto({ action: "EMIT" }))).rejects.toThrow("connection reset");
  });
});

describe("delegación — reemplazo de los controles de una acción", () => {
  let insertados: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    insertados = [];
    const values = vi.fn((filas: Record<string, unknown>[]) => {
      insertados.push(...filas);
      return { returning: vi.fn() };
    });
    vi.mocked(db.insert).mockReturnValue({ values } as never);
    vi.mocked(db.delete).mockReturnValue({ where: vi.fn() } as never);
    vi.mocked(db.transaction).mockImplementation(
      async (fn) =>
        fn({
          delete: vi.fn(() => ({ where: vi.fn() })),
          insert: vi.fn(() => ({ values })),
        }) as never,
    );
  });

  it("borra lo de la acción y guarda lo nuevo con la empresa de la llamada", async () => {
    await reemplazarReglasDeDelegacion(EMPRESA_A, "REQUEST", [
      { action: "REQUEST", scope: "BRANCH", branchId: SUCURSAL_A_1, requiredRole: "GERENTE" },
      { action: "REQUEST", scope: "CATEGORY", category: "  abarrotes ", requiredRole: "SUPERVISOR" },
    ]);

    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
    expect(insertados).toEqual([
      {
        companyId: EMPRESA_A,
        action: "REQUEST",
        scope: "BRANCH",
        branchId: SUCURSAL_A_1,
        category: null,
        requiredRole: "GERENTE",
        active: true,
      },
      {
        companyId: EMPRESA_A,
        action: "REQUEST",
        scope: "CATEGORY",
        branchId: null,
        category: "ABARROTES",
        requiredRole: "SUPERVISOR",
        active: true,
      },
    ]);
  });

  it("guardar una lista vacía deja la acción sin controles, sin fallar", async () => {
    await reemplazarReglasDeDelegacion(EMPRESA_A, "EMIT", []);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });
});

describe("delegación — GET /api/purchase-delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesion(adminA);
  });

  it("devuelve los controles de las dos acciones", async () => {
    encadenarSelect([]);
    const respuesta = await GET({} as never);
    const cuerpo = await respuesta.json();
    expect(respuesta.status).toBe(200);
    expect(cuerpo.REQUEST.descripcion).toMatch(/Sin controles/);
    expect(cuerpo.EMIT.reglas).toEqual([]);
  });

  it("sin sesión de administrador responde 403 y no consulta la base", async () => {
    sesion({ ...adminA, role: "SUPERVISOR" });
    const respuesta = await GET({} as never);
    expect(respuesta.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("un gerente de sucursal tampoco entra", async () => {
    sesion(gerenteA1);
    const respuesta = await GET({} as never);
    expect(respuesta.status).toBe(403);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringMatching(/ADMIN/) });
  });
});

describe("delegación — PUT /api/purchase-delegation", () => {
  /**
   * Filas que la base "tiene". El `PUT` borra y escribe dentro de la
   * transacción, y después vuelve a leer para el resumen: si el mock no
   * reflejara lo escrito, la respuesta describiría un estado que nadie guardó.
   */
  let guardadas: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    sesion(adminA);
    guardadas = [];
    encadenarSelect(() => guardadas);
    const values = vi.fn((filas: Record<string, unknown>[]) => {
      guardadas = filas;
      return { returning: vi.fn() };
    });
    vi.mocked(db.delete).mockReturnValue({ where: vi.fn() } as never);
    vi.mocked(db.transaction).mockImplementation(
      async (fn) =>
        fn({
          delete: vi.fn(() => {
            guardadas = [];
            return { where: vi.fn() };
          }),
          insert: vi.fn(() => ({ values })),
        }) as never,
    );
  });

  it("guarda en la empresa de la sesión, no en la del cuerpo", async () => {
    const respuesta = await PUT(
      request({ action: "EMIT", rules: [{ action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" }] }) as never,
    );
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo.EMIT.descripcion).toContain("ADMIN");
    expect(cuerpo.EMIT.reglas).toEqual([
      expect.objectContaining({ action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" }),
    ]);
  });

  it("rechaza reglas de otra acción y no toca la base", async () => {
    const respuesta = await PUT(
      request({
        action: "EMIT",
        rules: [
          { action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" },
          { action: "REQUEST", scope: "COMPANY", requiredRole: "GERENTE" },
        ],
      }) as never,
    );
    expect(respuesta.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("un error de validación no deja reglas a medias", async () => {
    const respuesta = await PUT(
      request({ action: "EMIT", rules: [{ action: "EMIT", scope: "BRANCH", requiredRole: "ADMIN" }] }) as never,
    );
    expect(respuesta.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(await respuesta.json()).toMatchObject({ error: expect.stringMatching(/sucursal/i) });
  });

  it("un rol sin permiso de configuración no escribe aunque sea ADMIN por jerarquía", async () => {
    const { hasPermission } = await import("@/lib/permissions");
    vi.mocked(hasPermission).mockReturnValueOnce(false);
    const respuesta = await PUT(request({ action: "EMIT", rules: [] }) as never);
    expect(respuesta.status).toBe(403);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringMatching(/configuración/i) });
  });
});
