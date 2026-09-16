import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { branchEquipments } from "@/lib/db/schema/equipment";
import { ApiError } from "@/lib/api/error";
import { equipmentService } from "../equipment-service";
import { GET } from "@/app/api/equipment/route";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import {
  assertScopeCoversBranch,
  resolveEquipmentScope,
  scopeCoversBranch,
} from "@/lib/equipment/scope";

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

// La sesión y el alcance del tenant son lo único que no se puede fabricar dentro
// de la prueba: la ruta los lee de la cookie y del encabezado. Todo lo demás —la
// guarda de sucursal, el adaptador de alcance y el servicio— corre de verdad.
vi.mock("@/lib/tenant-context", () => ({
  requireAuth: vi.fn(),
  requireTenant: vi.fn(),
}));

/**
 * Alcance del inventario de equipos — la lectura cruzada entre empresas.
 *
 * Antes de T02, `GET /api/equipment` tomaba el `branchId` del query tal cual y
 * `getEquipmentByBranch` filtraba **sólo** por sucursal. La sucursal de otra
 * empresa existe —sólo que no es tuya—, así que adivinarla bastaba para leer su
 * inventario. No era una carencia de filtros: era una lectura cruzada.
 *
 * Vive en `lib/services/__tests__/` porque la segunda mitad prueba al servicio
 * con el mismo arnés que sus vecinos (`vi.mock("@/lib/db")`); la primera mitad
 * prueba el adaptador puro, que no toca la base.
 *
 * El WHERE se revisa con `PgDialect.sqlToQuery`, la misma traducción que Drizzle
 * usa para hablar con Postgres, en vez de mirar el código y confiar: si alguien
 * deja de sumar `company_id` a las condiciones, aquí truena.
 *
 * La tercera parte llama al `GET` real con la sesión simulada, para probar la
 * barrera que no vive en el servicio: que la ruta valide la sucursal pedida
 * contra la empresa **antes** de construir la consulta.
 */

const EMPRESA_A = "a1000000-0000-4000-8000-00000000000a";
const EMPRESA_B = "b2000000-0000-4000-8000-00000000000b";
const SUCURSAL_A1 = "b1000001-0000-4000-8000-000000000001";
const SUCURSAL_A2 = "b1000001-0000-4000-8000-000000000002";
const SUCURSAL_B1 = "b2000001-0000-4000-8000-00000000000b";
/** Un UUID bien formado que no corresponde a ninguna sucursal. */
const SUCURSAL_INEXISTENTE = "b9999999-0000-4000-8000-999999999999";

const dialect = new PgDialect();

/** El SQL que Drizzle mandaría a Postgres para una condición capturada. */
function traducir(condicion: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condicion as never);
}

/** Arma la cadena `select().from().where().orderBy()` del servicio. */
function mockSelect(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });

  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where, orderBy };
}

/** La condición que llegó al `WHERE` del primer `select`. */
function condicionEnviada(where: ReturnType<typeof mockSelect>["where"]) {
  expect(where).toHaveBeenCalledTimes(1);
  return traducir(where.mock.calls[0][0]);
}
/** Captura el `ApiError` que lanza una guarda, para revisar status y mensaje. */
function capturarError(accion: () => void): ApiError {
  try {
    accion();
  } catch (error) {
    return error as ApiError;
  }

  throw new Error("La guarda no lanzó: se esperaba un rechazo.");
}

/** Una consulta registrada por la base falsa, con la tabla que la recibió. */
type Consulta = { tabla: unknown; where: unknown };

/**
 * Base falsa que responde **por tabla**, no por orden de llamadas.
 *
 * La ruta consulta el catálogo de sucursales (para validar la pedida) y luego el
 * inventario. Responder por orden volvería la prueba frágil: si alguien mueve la
 * guarda, la prueba fallaría por el orden y no por el hallazgo.
 */
function mockDb(respuestas: { sucursales?: unknown[]; equipos?: unknown[] } = {}) {
  const consultas: Consulta[] = [];

  const filasDe = (tabla: unknown) =>
    tabla === branches ? respuestas.sucursales ?? [] : respuestas.equipos ?? [];

  vi.mocked(db.select).mockImplementation(() => {
    const registro: Consulta = { tabla: null, where: null };
    const encadenar = {
      from: (tabla: unknown) => {
        registro.tabla = tabla;
        return encadenar;
      },
      where: (cond: unknown) => {
        registro.where = cond;
        return encadenar;
      },
      limit: async () => {
        consultas.push(registro);
        return filasDe(registro.tabla);
      },
      orderBy: async () => {
        consultas.push(registro);
        return filasDe(registro.tabla);
      },
    };

    return encadenar as never;
  });

  const inventario = () => consultas.find((c) => c.tabla === branchEquipments);

  return {
    consultas,
    /** La consulta de inventario, si la ruta llegó a construirla. */
    inventario,
    /** El SQL del inventario con sus parámetros. Falla si no hubo consulta. */
    whereInventario: () => traducir(inventario()!.where),
  };
}

/** Fija la sesión que verá la ruta: empresa A, rol y sucursal asignada. */
function sesionDe(rol: string, branchId: string | null) {
  vi.mocked(requireAuth).mockResolvedValue({
    user: {
      id: "usuario-1",
      role: rol,
      companyId: EMPRESA_A,
      branchId,
      email: "qa@pulso.test",
    },
    session: {} as never,
  } as never);
}

/** El alcance que ya resolvió `requireTenant()` (cookie de sucursal / "Todas"). */
function tenantConAlcance(branchId: string | null) {
  vi.mocked(requireTenant).mockResolvedValue({
    id: EMPRESA_A,
    userId: "usuario-1",
    branchId,
  } as never);
}

/** Llama al GET real de la ruta. Sólo se lee `req.url`, de ahí el `Request`. */
async function pedirInventario(query: string = "") {
  const res = await GET(new Request(`http://localhost/api/equipment${query}`) as never);

  return { status: res.status, body: (await res.json()) as any };
}



describe("T02 · el inventario de equipos respeta empresa y sucursal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Adaptador puro: qué alcance le toca al usuario ────────────────────────

  describe("resolveEquipmentScope", () => {
    it("un ADMIN sin sucursal en el query ve Todas, que es el grupo entero", () => {
      expect(resolveEquipmentScope("ADMIN", null, null)).toEqual({ kind: "ALL" });
    });

    it("un ADMIN con sucursal elegida en la app ve esa sucursal, no el grupo", () => {
      // La intención llega ya resuelta por `requireTenant()` (cookie de sucursal
      // o "Todas"); el rol no acotado la respeta tal cual.
      expect(resolveEquipmentScope("ADMIN", null, SUCURSAL_A1)).toEqual({
        kind: "BRANCH",
        branchId: SUCURSAL_A1,
      });
    });

    it("un GERENTE pidiendo otra sucursal recibe la suya: no amplía por query", () => {
      expect(resolveEquipmentScope("GERENTE", SUCURSAL_A1, SUCURSAL_B1)).toEqual({
        kind: "BRANCH",
        branchId: SUCURSAL_A1,
      });
    });

    it("un GERENTE sin sucursal asignada no recibe el grupo ni pidiendo una sucursal", () => {
      // El caso que `enforceBranchScope` colapsaba con "ve toda la empresa".
      expect(resolveEquipmentScope("GERENTE", null, SUCURSAL_B1)).toEqual({ kind: "NONE" });
      expect(resolveEquipmentScope("SUPERVISOR", null, null)).toEqual({ kind: "NONE" });
    });

    it("un `branchId` en blanco no se convierte en una sucursal fantasma", () => {
      // `?branchId=%20` llega decodificado como " ": sin el trim no coincidía
      // con ninguna sucursal y el resultado era un vacío silencioso que la
      // pantalla leía como "no hay equipos". En blanco significa "sin filtro".
      expect(resolveEquipmentScope("ADMIN", null, " ")).toEqual({ kind: "ALL" });
      expect(resolveEquipmentScope("ADMIN", null, "")).toEqual({ kind: "ALL" });
      expect(resolveEquipmentScope("ADMIN", null, null)).toEqual({ kind: "ALL" });
    });

    it("un `branchId` con forma inválida no se descarta aquí, se rechaza en la ruta", () => {
      // Del alcance sale tal cual para que `assertBranchOfCompany` lo rechace
      // con 400 (`UUID_RE`), en vez de degradar a "Todas" en silencio — que es
      // como un id mal escrito se convertía en el grupo entero.
      expect(resolveEquipmentScope("ADMIN", null, "no-es-uuid")).toEqual({
        kind: "BRANCH",
        branchId: "no-es-uuid",
      });
    });

    it("el alcance no recorta la empresa: eso lo hace `assertBranchOfCompany` y el WHERE", () => {
      // Documentado a propósito. Un ADMIN de la empresa A que pide la sucursal
      // de la empresa B obtiene `BRANCH(B)`, y quien impide la lectura cruzada
      // es el par (companyId de la sesión + branchId) validado en la ruta.
      // Filtrar por empresa aquí escondería el hueco en vez de cerrarlo.
      expect(resolveEquipmentScope("ADMIN", null, SUCURSAL_B1)).toEqual({
        kind: "BRANCH",
        branchId: SUCURSAL_B1,
      });
    });
  });

  // ─ El equipo concreto: listar no es alcanzar ─────────────────────────────

  describe("assertScopeCoversBranch", () => {
    it("un alcance de grupo alcanza cualquier sucursal", () => {
      expect(scopeCoversBranch({ kind: "ALL" }, SUCURSAL_B1)).toBe(true);
      expect(() => assertScopeCoversBranch({ kind: "ALL" }, SUCURSAL_A1)).not.toThrow();
    });

    it("un alcance de sucursal alcanza la suya y ninguna otra", () => {
      const propio = { kind: "BRANCH", branchId: SUCURSAL_A1 } as const;

      expect(scopeCoversBranch(propio, SUCURSAL_A1)).toBe(true);
      expect(() => assertScopeCoversBranch(propio, SUCURSAL_A1)).not.toThrow();

      expect(scopeCoversBranch(propio, SUCURSAL_A2)).toBe(false);
      expect(scopeCoversBranch(propio, SUCURSAL_B1)).toBe(false);
    });

    it("la sucursal ajena y la inexistente se rechazan igual, sin confirmar cuál existe", () => {
      const propio = { kind: "BRANCH", branchId: SUCURSAL_A1 } as const;

      const ajena = capturarError(() => assertScopeCoversBranch(propio, SUCURSAL_B1));
      const inexistente = capturarError(() => assertScopeCoversBranch(propio, "no-es-uuid"));

      expect(ajena).toBeInstanceOf(ApiError);
      expect(ajena.statusCode).toBe(403);
      expect(ajena.message).toMatch(/otra sucursal/i);
      // Mismo mensaje a propósito: distinguir "no es tuya" de "no existe" le
      // confirmaría a quien prueba ids qué equipos tienen las demás empresas.
      expect(inexistente.statusCode).toBe(403);
      expect(inexistente.message).toBe(ajena.message);
    });

    it("un rol acotado sin sucursal asignada se niega, no pasa como si fuera Todas", () => {
      const nula = { kind: "NONE" } as const;

      expect(scopeCoversBranch(nula, SUCURSAL_A1)).toBe(false);
      expect(scopeCoversBranch(nula, null)).toBe(false);

      const error = capturarError(() => assertScopeCoversBranch(nula, SUCURSAL_A1));
      expect(error.statusCode).toBe(403);
      // El mensaje dice la causa real —falta la asignación—, no "otra sucursal":
      // es algo que el usuario sí puede arreglar.
      expect(error.message).toMatch(/no tiene una sucursal asignada/i);
    });

    it("un equipo sin sucursal no queda al alcance de nadie acotado", () => {
      // `branch_equipments.branch_id` es NOT NULL; si alguna vez llegara un
      // `null`, la comparación no debe dejarlo pasar.
      const propio = { kind: "BRANCH", branchId: SUCURSAL_A1 } as const;

      expect(scopeCoversBranch(propio, null)).toBe(false);
      expect(scopeCoversBranch(propio, undefined)).toBe(false);
      expect(capturarError(() => assertScopeCoversBranch(propio, null)).statusCode).toBe(403);
    });
  });
// ─ La consulta: el WHERE que sale hacia Postgres ─────────────────────────

  describe("getEquipmentByScope", () => {
    it("alcance nulo no consulta: devuelve vacío en vez de caer en 'sin filtro'", async () => {
      const { where } = mockSelect([{ id: "eq-1" }]);

      const filas = await equipmentService.getEquipmentByScope({
        companyId: EMPRESA_A,
        scope: { kind: "NONE" },
      });

      expect(filas).toEqual([]);
      // Lo que importa no es el vacío, es que **no hubo consulta**: un `select`
      // sin filtro de sucursal devolvería el inventario de toda la empresa, que
      // es justo el fallo que este trabajo cierra.
      expect(db.select).not.toHaveBeenCalled();
      expect(where).not.toHaveBeenCalled();
    });

    it("alcance Todas sigue acotado a la empresa de la sesión", async () => {
      const { where } = mockSelect([]);

      await equipmentService.getEquipmentByScope({
        companyId: EMPRESA_A,
        scope: { kind: "ALL" },
      });

      const { sql, params } = condicionEnviada(where);
      expect(sql).toContain('"branch_equipments"."company_id"');
      expect(sql).not.toContain('"branch_equipments"."branch_id"');
      expect(params).toEqual([EMPRESA_A]);
    });

    it("con una sucursal ajena, la empresa de la sesión viaja en el WHERE", async () => {
      // El caso exacto del hallazgo: `GET /api/equipment?branchId=<sucursal de
      // otra empresa>`. La ruta rechaza el par con `assertBranchOfCompany`
      // (400, antes de consultar); esto prueba la segunda barrera: la empresa de
      // quien pregunta va en la condición, así que la sucursal ajena —que sí
      // existe— no puede arrastrar las filas de su verdadero dueño.
      const { where } = mockSelect([]);

      const filas = await equipmentService.getEquipmentByScope({
        companyId: EMPRESA_A,
        scope: { kind: "BRANCH", branchId: SUCURSAL_B1 },
      });

      const { sql, params } = condicionEnviada(where);
      expect(sql).toContain('"branch_equipments"."company_id"');
      expect(sql).toContain('"branch_equipments"."branch_id"');
      expect(params).toEqual([EMPRESA_A, SUCURSAL_B1]);
      expect(filas).toEqual([]);
    });

    it("la sucursal propia se consulta con su empresa y devuelve lo que responde la base", async () => {
      const propias = [{ id: "eq-condesa", branchId: SUCURSAL_A1 }];
      const { where } = mockSelect(propias);

      const filas = await equipmentService.getEquipmentByScope({
        companyId: EMPRESA_A,
        scope: { kind: "BRANCH", branchId: SUCURSAL_A1 },
      });

      expect(condicionEnviada(where).params).toEqual([EMPRESA_A, SUCURSAL_A1]);
      expect(filas).toBe(propias);
    });

    it("los filtros se suman al alcance, no lo reemplazan", async () => {
      const { where } = mockSelect([]);

      await equipmentService.getEquipmentByScope({
        companyId: EMPRESA_B,
        scope: { kind: "BRANCH", branchId: SUCURSAL_B1 },
        filters: { status: "UNDER_MAINTENANCE", isCritical: true },
      });

      const { sql, params } = condicionEnviada(where);
      expect(sql).toContain('"branch_equipments"."company_id"');
      expect(sql).toContain('"branch_equipments"."branch_id"');
      expect(sql).toContain('"branch_equipments"."status"');
      expect(sql).toContain('"branch_equipments"."is_critical"');
      expect(params).toEqual([EMPRESA_B, SUCURSAL_B1, "UNDER_MAINTENANCE", true]);
    });
  });

  // ─ La ruta: la barrera que corre antes de mirar el inventario ────────────

  describe("GET /api/equipment", () => {
    it("pedir la sucursal de otra empresa se rechaza con 400 y sin listar una sola fila", async () => {
      sesionDe("ADMIN", null);
      tenantConAlcance(null);
      // La sucursal existe, pero es de la empresa B: el par (empresa de la
      // sesión, sucursal pedida) no está en el catálogo.
      const base = mockDb({ sucursales: [] });

      const { status, body } = await pedirInventario(`?branchId=${SUCURSAL_B1}`);

      expect(status).toBe(400);
      expect(body.error.message).toMatch(/no existe para esta empresa/i);
      // Y lo que de verdad importa: el inventario nunca se consultó, así que no
      // hay filas ajenas que devolver ni que filtrar después.
      expect(body.data).toBeUndefined();
      expect(base.inventario()).toBeUndefined();
    });

    it("la sucursal ajena y la inexistente responden lo mismo: no se confirma cuál existe", async () => {
      sesionDe("ADMIN", null);
      tenantConAlcance(null);

      mockDb({ sucursales: [] });
      const ajena = await pedirInventario(`?branchId=${SUCURSAL_B1}`);

      mockDb({ sucursales: [] });
      const inexistente = await pedirInventario(`?branchId=${SUCURSAL_INEXISTENTE}`);

      // Misma respuesta exacta: si difirieran, quien prueba ids averiguaría qué
      // sucursales tienen las demás empresas.
      expect(ajena.status).toBe(400);
      expect(ajena.body).toEqual(inexistente.body);
    });

    it("la sucursal propia se lista con la empresa de la sesión, no con otra", async () => {
      sesionDe("ADMIN", null);
      tenantConAlcance(null);
      const equipos = [{ id: "eq-1", branchId: SUCURSAL_A1 }];
      const base = mockDb({ sucursales: [{ id: SUCURSAL_A1 }], equipos });

      const { status, body } = await pedirInventario(`?branchId=${SUCURSAL_A1}`);

      expect(status).toBe(200);
      expect(body.data).toEqual(equipos);
      // Primero la guarda contra el catálogo de sucursales, luego el inventario.
      expect(base.consultas.map((c) => c.tabla)).toEqual([branches, branchEquipments]);
      expect(base.whereInventario().params).toEqual([EMPRESA_A, SUCURSAL_A1]);
    });
    it("sin sucursal pedida, ve la empresa entera sin tocar el catálogo de sucursales", async () => {
      sesionDe("ADMIN", null);
      tenantConAlcance(null);
      const base = mockDb({ equipos: [{ id: "eq-1" }, { id: "eq-2" }] });

      const { status, body } = await pedirInventario();

      expect(status).toBe(200);
      expect(body.data).toHaveLength(2);
      // "Todas" no necesita validar ninguna sucursal: no hay ninguna pedida.
      expect(base.consultas.map((c) => c.tabla)).toEqual([branchEquipments]);
      const { sql, params } = base.whereInventario();
      expect(sql).toContain('"branch_equipments"."company_id"');
      expect(params).toEqual([EMPRESA_A]);
    });

    it("un gerente que pide otra sucursal recibe la suya, con su empresa", async () => {
      // El query no amplía el alcance de un rol acotado, y la guarda valida la
      // sucursal que de verdad se va a usar —la suya—, no la que pidió.
      sesionDe("GERENTE", SUCURSAL_A1);
      tenantConAlcance(null);
      const base = mockDb({ sucursales: [{ id: SUCURSAL_A1 }], equipos: [] });

      const { status } = await pedirInventario(`?branchId=${SUCURSAL_B1}`);

      expect(status).toBe(200);
      expect(base.whereInventario().params).toEqual([EMPRESA_A, SUCURSAL_A1]);
    });

    it("un gerente sin sucursal asignada recibe vacío, no el grupo", async () => {
      sesionDe("GERENTE", null);
      tenantConAlcance(null);
      const base = mockDb({ equipos: [{ id: "eq-de-la-empresa" }] });

      const { status, body } = await pedirInventario();

      expect(status).toBe(200);
      expect(body.data).toEqual([]);
      // Ni una consulta: `NONE` no se traduce a "sin filtro".
      expect(base.consultas).toEqual([]);
    });

    it("un rol acotado sin sucursal no se libera pidiendo una sucursal en el query", async () => {
      sesionDe("SUPERVISOR", null);
      tenantConAlcance(null);
      const base = mockDb({ sucursales: [{ id: SUCURSAL_B1 }], equipos: [{ id: "eq-ajeno" }] });

      const { status, body } = await pedirInventario(`?branchId=${SUCURSAL_B1}`);

      expect(status).toBe(200);
      expect(body.data).toEqual([]);
      expect(base.consultas).toEqual([]);
    });
  });

});