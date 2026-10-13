import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { PurchaseOrderService } from "@/lib/services/purchase-order-service";
import { SuggestedOrderService } from "@/lib/services/suggested-order-service";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { EMPRESA_A, SUCURSAL_A_1, SUCURSAL_A_2, SUCURSAL_B_1 } from "../../fixtures/tenant-isolation";

/**
 * C16.2.2 — solicitud y emisión con pertenencia verificada.
 *
 * Antes de aplicar el control de delegación había que cerrar tres huecos del
 * recorrido, porque una política que decide sobre una sucursal u orden que el
 * actor no controla no decide nada:
 *
 *  1. Las transiciones de estado buscaban la orden sólo por id: un `PATCH` con
 *     el id de otra empresa la cambiaba y la auditaba como propia.
 *  2. Crear una solicitud o una orden aceptaba `branchId`, `supplierId`,
 *     `requisitionId` y artículos del cuerpo sin comprobar de qué empresa eran;
 *     una solicitud ajena quedaba además marcada `CONVERTED`.
 *  3. No había responsable: `inventory:create` para todos al solicitar.
 *
 * Lo que se comprueba aquí, sobre el servicio real y no sobre una reimplementación
 * del recorrido: que un rechazo no escribe nada, que la pertenencia se comprueba
 * antes de calcular o escribir, y que sin controles configurados el
 * comportamiento es el de siempre (permiso vigente), no una puerta cerrada.
 *
 * `db` va simulado con las cadenas exactas que usa el servicio, y la resolución
 * de la delegación se comprueba con el almacén de reglas en memoria de más abajo;
 * las guardas de ruta y la resolución pura ya tienen sus propias pruebas.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    query: { purchaseOrders: { findFirst: vi.fn() } },
  },
}));
vi.mock("@/lib/branch-scope", () => ({ assertBranchOfCompany: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/audit-service", () => ({
  AuditService: { logInventoryAction: vi.fn() },
}));
vi.mock("@/lib/services/folio-generator", () => ({ nextFolio: vi.fn() }));

/** Reglas de delegación que ve la política durante la prueba. */
let reglas: Array<Record<string, unknown>> = [];

vi.mock("@/lib/purchasing/delegation-policy", async () => {
  const real = await vi.importActual<typeof import("@/lib/purchasing/delegation-policy")>(
    "@/lib/purchasing/delegation-policy",
  );
  return {
    ...real,
    categoriasDeArticulos: vi.fn(async () => []),
    /**
     * Se sustituye `evaluarDelegacion`, no el cargador: dentro del módulo real
     * las llamadas internas seguirían apuntando al cargador verdadero, y la
     * prueba habría leído filas de artículos como si fueran reglas. La
     * resolución pura —la parte con reglas— sigue siendo la real.
     */
    evaluarDelegacion: vi.fn(async (_empresa: string, contexto: { action: string }) =>
      real.resolverDelegacion(
        reglas
          .filter((r) => r.action === contexto.action)
          .map((r) => ({
            action: r.action as "REQUEST" | "EMIT",
            scope: r.scope as "COMPANY" | "BRANCH" | "CATEGORY",
            branchId: (r.branchId as string) ?? null,
            category: (r.category as string) ?? null,
            requiredRole: r.requiredRole as string,
            active: r.active !== false,
          })),
        contexto as never,
      ),
    ),
  };
});

const ARTICULO_A = "a1000009-0000-4000-8000-000000000001";
const PROVEEDOR_A = "a1000008-0000-4000-8000-000000000001";
const SOLICITUD_A = "a1000007-0000-4000-8000-000000000001";

/**
 * Encadena las consultas del servicio en el orden en que las hace. Cada
 * `select().from().where().limit()` devuelve la fila que le toca; sin esto, un
 * mock que devuelve todo haría pasar una prueba cuya lógica real filtra.
 */
const dondes: unknown[] = [];

function encadenarSelects(respuestas: unknown[][]) {
  let i = 0;
  dondes.length = 0;
  /**
   * Un resultado que sirve para las dos cadenas que usa el servicio:
   * `await select().from().where()` —que espera un arreglo— y
   * `select().from().where().limit()`. Sin esto, el folio y el conteo de
   * artículos —que no llevan `limit`— recibirían el objeto de la cadena y la
   * prueba fallaría por el mock, no por la lógica.
   */
  const resultado = (filas: unknown[]) => {
    const valor = filas as unknown[] & { limit: unknown; orderBy: unknown };
    valor.limit = vi.fn(() => valor);
    valor.orderBy = vi.fn(() => valor);
    return valor;
  };

  vi.mocked(db.select).mockImplementation((() => {
    const filas = respuestas[Math.min(i, respuestas.length - 1)] ?? [];
    i += 1;
    const where = vi.fn((condicion?: unknown) => {
      dondes.push(condicion);
      return resultado(filas);
    });
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  }) as never);
}

/** Filas que intentó escribir, para comprobar que un rechazo no dejó nada. */
let insertados: unknown[] = [];
let actualizados: Array<Record<string, unknown>> = [];

function encadenarEscrituras() {
  insertados = [];
  actualizados = [];
  const valores = vi.fn((filas: unknown) => {
    insertados.push(...(Array.isArray(filas) ? filas : [filas]));
    return { returning: vi.fn().mockResolvedValue([{ id: "nuevo" }]) };
  });
  vi.mocked(db.insert).mockReturnValue({ values: valores } as never);
  const set = vi.fn((datos: Record<string, unknown>) => {
    actualizados.push(datos);
    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "orden", ...datos }]) }) };
  });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  vi.mocked(db.transaction).mockImplementation(async (fn) => fn({ insert: vi.fn(() => ({ values: valores, returning: vi.fn().mockResolvedValue([{ id: "nuevo" }]) })) }) as never);
}

const regla = (parcial: Record<string, unknown>) => ({ active: true, ...parcial });

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` no deshace un `spyOn`: el de `createPO` de la última prueba
  // se filtraría a las siguientes si no se restaura explícitamente.
  vi.restoreAllMocks();
  reglas = [];
  encadenarEscrituras();
  vi.mocked(assertBranchOfCompany).mockResolvedValue(undefined);
});

describe("C16.2.2 — alta de solicitud", () => {
  it("sin controles configurados se crea: decide el permiso vigente, como antes", async () => {
    encadenarSelects([[]]);

    const resultado = await PurchaseOrderService.createRequisition({
      companyId: EMPRESA_A,
      branchId: SUCURSAL_A_1,
      requestedBy: "gerente-a1",
      actorRole: "GERENTE",
      items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
    });

    expect(resultado).toBeTruthy();
    expect(assertBranchOfCompany).toHaveBeenCalledWith(EMPRESA_A, SUCURSAL_A_1);
  });

  it("una sucursal de otra empresa se rechaza antes de escribir", async () => {
    vi.mocked(assertBranchOfCompany).mockRejectedValueOnce(new Error("no pertenece") as never);

    await expect(
      PurchaseOrderService.createRequisition({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_B_1,
        requestedBy: "gerente-a1",
        actorRole: "GERENTE",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    ).rejects.toThrow();

    expect(insertados).toEqual([]);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("un control que exige ADMIN rechaza al gerente y no deja requisición", async () => {
    reglas = [regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "ADMIN" })];

    await expect(
      PurchaseOrderService.createRequisition({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_A_1,
        requestedBy: "gerente-a1",
        actorRole: "GERENTE",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(insertados).toEqual([]);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("el rechazo nombra el rol mínimo, no un error genérico", async () => {
    reglas = [regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "ADMIN" })];
    const error = await PurchaseOrderService.createRequisition({
      companyId: EMPRESA_A,
      branchId: SUCURSAL_A_1,
      requestedBy: "gerente-a1",
      actorRole: "GERENTE",
      items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
    }).catch((e: unknown) => e as Error);
    expect((error as Error).message).toContain("ADMIN");
  });

  it("el control de otra sucursal no decide por la sucursal 2", async () => {
    reglas = [regla({ action: "REQUEST", scope: "BRANCH", branchId: SUCURSAL_A_1, requiredRole: "ADMIN" })];
    encadenarSelects([[]]);

    // Sucursal 2 no está cubierta por la regla de la 1: se rechaza por hueco.
    await expect(
      PurchaseOrderService.createRequisition({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_A_2,
        requestedBy: "gerente-a2",
        actorRole: "GERENTE",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    // La sucursal 1 sí, y con el mismo rol.
    await expect(
      PurchaseOrderService.createRequisition({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_A_1,
        requestedBy: "gerente-a1",
        actorRole: "ADMIN",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    ).resolves.toBeTruthy();
  });
});

describe("C16.2.2 — alta de orden", () => {
  const datos = {
    companyId: EMPRESA_A,
    branchId: SUCURSAL_A_1,
    supplierId: PROVEEDOR_A,
    requestedBy: "gerente-a1",
    actorRole: "GERENTE" as string | null,
    items: [{ itemId: ARTICULO_A, orderedQuantity: 5, unitCost: 10 }],
  };

  /** artículos → proveedor → [filas que la política devuelva] */
  function selectsDeAlta(respuestas: unknown[] = [[{ id: ARTICULO_A, taxRate: 16, iepsRate: 0 }], [{ id: PROVEEDOR_A }]]) {
    encadenarSelects(respuestas);
  }

  it("verifica sucursal, artículos y proveedor antes de calcular el total", async () => {
    selectsDeAlta();

    const resultado = await PurchaseOrderService.createPO(datos);
    expect(resultado).toBeTruthy();
    expect(assertBranchOfCompany).toHaveBeenCalledWith(EMPRESA_A, SUCURSAL_A_1);
    expect(insertados.length).toBeGreaterThan(0);
  });

  it("un artículo de otra empresa no entra en la orden", async () => {
    // La consulta acotada por empresa no devuelve nada para ese artículo.
    selectsDeAlta([[], [{ id: PROVEEDOR_A }]]);

    await expect(PurchaseOrderService.createPO(datos)).rejects.toMatchObject({ statusCode: 400 });
    expect(insertados).toEqual([]);
  });

  it("un proveedor de otra empresa se rechaza", async () => {
    selectsDeAlta([[{ id: ARTICULO_A, taxRate: 16, iepsRate: 0 }], []]);

    const error = await PurchaseOrderService.createPO(datos).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(/proveedor/i);
    expect(insertados).toEqual([]);
  });

  it("una solicitud de otra empresa no se convierte ni se marca CONVERTED", async () => {
    selectsDeAlta([[{ id: ARTICULO_A, taxRate: 16, iepsRate: 0 }], [{ id: PROVEEDOR_A }], []]);

    const error = await PurchaseOrderService.createPO({ ...datos, requisitionId: SOLICITUD_A }).catch(
      (e: unknown) => e as Error,
    );
    expect((error as Error).message).toMatch(/solicitud/i);
    // Ni la orden ni el `status: 'CONVERTED'` de la solicitud ajena.
    expect(insertados).toEqual([]);
  });

  it("el control de solicitud también gobierna la orden en borrador", async () => {
    reglas = [regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "OWNER" })];
    selectsDeAlta();

    await expect(PurchaseOrderService.createPO(datos)).rejects.toMatchObject({ statusCode: 403 });
    expect(insertados).toEqual([]);
  });
});

describe("C16.2.2 — emisión", () => {
  /**
   * `sendPO` lee la orden, luego sus artículos, y `transitionStatus` vuelve a
   * leer la orden: tres consultas distintas. Sin la tercera, la transición
   * recibiría la fila del artículo y fallaría con un error de estado en vez de
   * probar lo que la prueba dice.
   */
  const selectsDeEnvio = (orden: Record<string, unknown>) =>
    encadenarSelects([[orden], [{ itemId: ARTICULO_A }], [orden]]);

  const ORDEN_APROBADA = {
    id: "orden-1",
    companyId: EMPRESA_A,
    branchId: SUCURSAL_A_1,
    status: "APPROVED",
  };

  it("con controles, un rol que alcanza emite y la orden queda enviada", async () => {
    reglas = [regla({ action: "EMIT", scope: "COMPANY", requiredRole: "ADMIN" })];
    selectsDeEnvio(ORDEN_APROBADA);

    await PurchaseOrderService.sendPO("orden-1", "admin-a", EMPRESA_A, "ADMIN");

    expect(actualizados.at(-1)).toMatchObject({ status: "SENT" });
  });

  it("sin controles, emitir conserva el comportamiento previo", async () => {
    selectsDeEnvio(ORDEN_APROBADA);
    await PurchaseOrderService.sendPO("orden-1", "supervisor-a1", EMPRESA_A, "SUPERVISOR");
    expect(actualizados.at(-1)).toMatchObject({ status: "SENT" });
  });

  it("por debajo del rol exigido se rechaza y la orden no cambia de estado", async () => {
    reglas = [regla({ action: "EMIT", scope: "COMPANY", requiredRole: "OWNER" })];
    selectsDeEnvio(ORDEN_APROBADA);

    await expect(
      PurchaseOrderService.sendPO("orden-1", "gerente-a1", EMPRESA_A, "GERENTE"),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(actualizados).toEqual([]);
  });

  it("una orden que la consulta no devuelve responde 404 y no toca el estado", async () => {
    // El filtro por empresa vive en el SQL, no en JavaScript: aquí se simula su
    // efecto, que es una consulta sin filas para una orden de otra empresa.
    encadenarSelects([[], []]);
    await expect(PurchaseOrderService.sendPO("orden-1", "admin-a", EMPRESA_A, "ADMIN")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(actualizados).toEqual([]);
  });

  it("toda consulta de la orden incluye la empresa, no sólo el id", async () => {
    selectsDeEnvio(ORDEN_APROBADA);
    await PurchaseOrderService.sendPO("orden-1", "admin-a", EMPRESA_A, "ADMIN");

    // Un mock que devuelve filas pasa igual con o sin filtro, así que la
    // pertenencia se comprueba sobre el SQL que realmente se envía: cada
    // `where` que habla de `purchase_orders` tiene que traer `company_id`.
    const dialecto = new PgDialect();
    const sobreOrdenes = dondes
      .map((condicion) => dialecto.sqlToQuery(condicion as SQL).sql)
      .filter((sql) => sql.includes("purchase_orders"));

    expect(sobreOrdenes.length).toBeGreaterThanOrEqual(2);
    for (const sql of sobreOrdenes) {
      expect(sql, sql).toContain("company_id");
    }
  });

  it("un actor de sistema nunca emite, ni con controles que se lo permitan", async () => {
    reglas = [regla({ action: "EMIT", scope: "COMPANY", requiredRole: "EMPLEADO" })];
    selectsDeEnvio(ORDEN_APROBADA);

    await expect(PurchaseOrderService.sendPO("orden-1", "system", EMPRESA_A, null)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(actualizados).toEqual([]);
  });

  it("la transición inválida se conserva: no toda orden aprobada puede enviarse", async () => {
    selectsDeEnvio({ ...ORDEN_APROBADA, status: "DRAFT" });
    await expect(PurchaseOrderService.sendPO("orden-1", "admin-a", EMPRESA_A, "ADMIN")).rejects.toThrow();
    expect(actualizados).toEqual([]);
  });
});

describe("C16.2.2 — la entrada alternativa no evita la política", () => {
  it("las sugerencias del PAR declaran su rol y pasan por el mismo control", async () => {
    // El control exige OWNER y el rol que llega es GERENTE: la orden no se crea.
    reglas = [regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "OWNER" })];
    encadenarSelects([
      [{ id: ARTICULO_A, supplierId: PROVEEDOR_A, lastCost: 10 }],
    ]);

    await expect(
      SuggestedOrderService.generatePurchaseOrders(
        EMPRESA_A,
        SUCURSAL_A_1,
        [{ itemId: ARTICULO_A, suggestedQty: 5 }],
        "gerente-a1",
        "GERENTE",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("sin usuario la orden es del sistema: borrador permitido", async () => {
    // El control de solicitud exige OWNER y el actor es de sistema: la política
    // permite el borrador, y createPO sigue verificando sucursal y artículos.
    reglas = [regla({ action: "REQUEST", scope: "COMPANY", requiredRole: "OWNER" })];
    encadenarSelects([
      [{ id: ARTICULO_A, supplierId: PROVEEDOR_A, lastCost: 10 }],
    ]);
    vi.spyOn(PurchaseOrderService, "createPO").mockResolvedValue({ po: { id: "borrador" } } as never);

    const ordenes = await SuggestedOrderService.generatePurchaseOrders(
      EMPRESA_A,
      SUCURSAL_A_1,
      [{ itemId: ARTICULO_A, suggestedQty: 5 }],
    );

    expect(ordenes).toHaveLength(1);
    expect(vi.mocked(PurchaseOrderService.createPO).mock.calls[0][0]).toMatchObject({ actorRole: null });
  });
});
