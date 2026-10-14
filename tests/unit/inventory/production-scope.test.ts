import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  branches,
  inventoryBatches,
  inventoryItems,
  inventoryMovements,
  productionIngredients,
  productionOrders,
  productionResults,
  recipes,
} from "@/lib/db/schema";
import { ProductionService } from "@/lib/services/production-service";
import { getSession } from "@/lib/auth";
import { GET as getProduccion, POST as postProduccion } from "@/app/api/inventory/production/route";
import { capturarError, crearSimulador, type DbSimulado } from "../../fixtures/db-simulado";
import { EMPRESA_A, EMPRESA_B, SUCURSAL_A_1, SUCURSAL_A_2, SUCURSAL_B_1 } from "../../fixtures/tenant-isolation";

/**
 * C17.2 — producción con empresa verificada.
 *
 * `production_orders` y `production_results` guardan empresa **y** sucursal, y
 * nadie contrastaba ninguna de las dos contra la sesión:
 *
 *  1. `createOrder` aceptaba cualquier `recipeId`. Como `getOrders` une por id,
 *     una orden creada contra una receta foránea devolvía el nombre de esa
 *     receta en la pantalla de producción de esta empresa.
 *  2. La ruta calculaba la sucursal con `enforceBranchScope`, que para los
 *     roles que ven toda la empresa devuelve el id del cuerpo sin comprobarlo:
 *     un ADMIN podía registrar producción contra una sucursal ajena, que
 *     escribía el movimiento con la empresa de esta y el stock de la otra.
 *  3. `recordProduction` con ingredientes explícitos descontaba el `batchId`
 *     que viniera. Ese camino no corre dentro de una transacción, así que un
 *     rechazo a mitad del bucle dejaría lotes descontados a medias: la
 *     comprobación tiene que ocurrir antes del primer `insert`.
 *
 * `db` va simulado con el ejecutor compartido (`tests/fixtures/db-simulado.ts`):
 * así se ve que el rechazo ocurre *antes* de escribir, y no que la escritura
 * se deshizo después.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));

const TABLAS: Array<[string, unknown]> = [
  ["branches", branches],
  ["recipes", recipes],
  ["inventoryItems", inventoryItems],
  ["inventoryBatches", inventoryBatches],
  ["productionOrders", productionOrders],
  ["productionResults", productionResults],
  ["productionIngredients", productionIngredients],
  ["inventoryMovements", inventoryMovements],
];

function simularDb(filas: Record<string, unknown[]>): DbSimulado {
  return crearSimulador(db, TABLAS, filas);
}

const RECETA_A = "eeeeeeee-0000-4000-8000-000000000001";
const RECETA_B = "eeeeeeee-0000-4000-8000-000000000002";
const ARTICULO_A = "aaaaaaaa-0000-4000-8000-000000000011";
const ARTICULO_B = "bbbbbbbb-0000-4000-8000-000000000011";
const LOTE_A = "dddddddd-0000-4000-8000-000000000011";
const LOTE_B = "dddddddd-0000-4000-8000-000000000012";
const ORDEN = "ffffffff-0000-4000-8000-000000000001";

const sucursalesDeA = [
  { id: SUCURSAL_A_1, companyId: EMPRESA_A },
  { id: SUCURSAL_A_2, companyId: EMPRESA_A },
];

const sucursalesDeB = [{ id: SUCURSAL_B_1, companyId: EMPRESA_B }];

/**
 * Empresa A con dos sucursales, su receta y un lote de 20 unidades en A₁.
 * Empresa B trae su receta, su artículo, su lote y su sucursal: todo lo que
 * una prueba necesita para intentar escribir desde la sesión de A.
 */
function base(): Record<string, unknown[]> {
  return {
    branches: [...sucursalesDeA, ...sucursalesDeB],
    recipes: [
      { id: RECETA_A, companyId: EMPRESA_A, name: "Salsa de la casa", holdTimeMinutes: null },
      { id: RECETA_B, companyId: EMPRESA_B, name: "Receta ajena", holdTimeMinutes: null },
    ],
    inventoryItems: [
      { id: ARTICULO_A, companyId: EMPRESA_A, name: "Chile" },
      { id: ARTICULO_B, companyId: EMPRESA_B, name: "Chile de otra empresa" },
    ],
    inventoryBatches: [
      { id: LOTE_A, branchId: SUCURSAL_A_1, itemId: ARTICULO_A, currentQuantity: "20" },
      { id: LOTE_B, branchId: SUCURSAL_B_1, itemId: ARTICULO_B, currentQuantity: "50" },
    ],
    productionOrders: [
      {
        id: ORDEN,
        companyId: EMPRESA_A,
        branchId: SUCURSAL_A_1,
        recipeId: RECETA_A,
        status: "PLANNED",
      },
    ],
    productionResults: [],
    productionIngredients: [],
    inventoryMovements: [],
  };
}

const sesion = (usuario: Record<string, unknown>) =>
  vi.mocked(getSession).mockResolvedValue({ user: usuario } as never);

describe("C17.2 — crear la orden comprueba receta y sucursal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza una receta de otra empresa antes de escribir la orden", async () => {
    const estado = simularDb(base());

    const error = await capturarError(() =>
      ProductionService.createOrder({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_A_1,
        recipeId: RECETA_B,
        plannedQuantity: 5,
        unit: "PORCIÓN",
        plannedDate: new Date("2026-10-14"),
        createdBy: "user-admin-a",
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toContain(RECETA_B);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("rechaza una sucursal de otra empresa antes de escribir la orden", async () => {
    const estado = simularDb(base());

    const error = await capturarError(() =>
      ProductionService.createOrder({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_B_1,
        recipeId: RECETA_A,
        plannedQuantity: 5,
        unit: "PORCIÓN",
        plannedDate: new Date("2026-10-14"),
        createdBy: "user-admin-a",
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/sucursal/i);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("con receta y sucursal propias, la orden se escribe", async () => {
    const estado = simularDb(base());

    const orden = await ProductionService.createOrder({
      companyId: EMPRESA_A,
      branchId: SUCURSAL_A_1,
      recipeId: RECETA_A,
      plannedQuantity: 5,
      unit: "PORCIÓN",
      plannedDate: new Date("2026-10-14"),
      createdBy: "user-admin-a",
    });

    expect(orden).toBeTruthy();
    expect(estado.escrituras).toHaveLength(1);
    expect(estado.escrituras[0].tabla).toBe("productionOrders");
  });
});

describe("C17.2 — registrar producción no descuenta nada de lo ajeno", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const registrar = (extra: Record<string, unknown> = {}) =>
    ProductionService.recordProduction({
      companyId: EMPRESA_A,
      branchId: SUCURSAL_A_1,
      orderId: ORDEN,
      recipeId: RECETA_A,
      producedQuantity: 5,
      unit: "PORCIÓN",
      recordedBy: "user-admin-a",
      ingredients: [
        {
          itemId: ARTICULO_A,
          batchId: LOTE_A,
          expectedQuantity: 5,
          actualQuantity: 5,
          unit: "KG",
          unitCost: 20,
        },
      ],
      ...extra,
    });

  it("un lote de otra sucursal se rechaza nombrándolo, sin descuento parcial", async () => {
    const estado = simularDb(base());

    const error = await capturarError(() => registrar({ recipeId: RECETA_B }));

    expect(error.statusCode).toBe(400);
    expect(estado.escrituras, "una receta ajena se rechaza antes de tocar lotes").toHaveLength(0);
  });

  it("un lote de otra sucursal con receta propia se rechaza y no descuenta nada", async () => {
    const estado = simularDb(base());

    const error = await capturarError(() =>
      ProductionService.recordProduction({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_A_1,
        recipeId: RECETA_A,
        producedQuantity: 5,
        unit: "PORCIÓN",
        recordedBy: "user-admin-a",
        ingredients: [
          {
            itemId: ARTICULO_B,
            batchId: LOTE_B,
            expectedQuantity: 5,
            actualQuantity: 5,
            unit: "KG",
          },
        ],
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toContain(LOTE_B);
    // Ni el resultado de producción, ni el descuento, ni el movimiento: el
    // camino de ingredientes manuales no está en una transacción, así que un
    // rechazo tardío dejaría el lote a medias. El lote ajeno tampoco fue
    // tocado, y eso se lee en la fila que el simulador dejó sin modificar.
    expect(estado.escrituras).toHaveLength(0);
    expect(Object.keys((estado.filas.inventoryBatches[1] as Record<string, unknown>))).toEqual([
      "id",
      "branchId",
      "itemId",
      "currentQuantity",
    ]);
  });

  it("producir contra una sucursal ajena se rechaza antes de escribir", async () => {
    const estado = simularDb(base());

    const error = await capturarError(() =>
      ProductionService.recordProduction({
        companyId: EMPRESA_A,
        branchId: SUCURSAL_B_1,
        recipeId: RECETA_A,
        producedQuantity: 5,
        unit: "PORCIÓN",
        recordedBy: "user-admin-a",
        ingredients: [
          {
            itemId: ARTICULO_B,
            batchId: LOTE_B,
            expectedQuantity: 5,
            actualQuantity: 5,
            unit: "KG",
          },
        ],
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/sucursal/i);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("con receta, sucursal y lote propios, descuenta una vez y cierra la orden", async () => {
    const estado = simularDb(base());

    const resultado = await registrar();

    expect(resultado).toBeTruthy();
    const descuentos = estado.escrituras.filter(
      (e) => e.tabla === "inventoryBatches" && e.valores.currentQuantity !== undefined,
    );
    expect(descuentos).toHaveLength(1);
    // El resultado se abre con costo 0 y se cierra con el costo real: un
    // insert y un update, no dos inserciones.
    const resultados = estado.escrituras.filter((e) => e.tabla === "productionResults");
    expect(resultados).toHaveLength(2);
    expect(resultados.filter((e) => e.valores.ingredientCost === 0)).toHaveLength(1);
    expect(resultados.filter((e) => e.valores.ingredientCost === 100)).toHaveLength(1);
    expect(estado.escrituras.filter((e) => e.tabla === "productionIngredients")).toHaveLength(1);
    expect(
      estado.escrituras.some((e) => e.tabla === "productionOrders" && e.valores.status === "COMPLETED"),
    ).toBe(true);
  });
});

describe("C17.2 — la ruta de producción traduce los rechazos a status HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const post = (cuerpo: Record<string, unknown>) =>
    postProduccion(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(cuerpo),
        headers: { "content-type": "application/json" },
      }) as never,
    );

  it("un admin no registra producción contra una sucursal de otra empresa", async () => {
    const estado = simularDb(base());
    sesion({ id: "user-admin-a", role: "ADMIN", companyId: EMPRESA_A, branchId: null });

    const res = await post({
      branchId: SUCURSAL_B_1,
      recipeId: RECETA_A,
      plannedQuantity: 5,
      unit: "PORCIÓN",
      plannedDate: "2026-10-14",
    });

    expect(res.status).toBe(400);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("un admin no crea la orden con una receta de otra empresa", async () => {
    const estado = simularDb(base());
    sesion({ id: "user-admin-a", role: "ADMIN", companyId: EMPRESA_A, branchId: null });

    const res = await post({
      branchId: SUCURSAL_A_1,
      recipeId: RECETA_B,
      plannedQuantity: 5,
      unit: "PORCIÓN",
      plannedDate: "2026-10-14",
    });

    expect(res.status).toBe(400);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("el listado de órdenes no responde para una sucursal ajena", async () => {
    simularDb(base());
    sesion({ id: "user-admin-a", role: "ADMIN", companyId: EMPRESA_A, branchId: null });

    const res = await getProduccion(
      new Request(`http://localhost/api/inventory/production?branchId=${SUCURSAL_B_1}`) as never,
    );

    expect(res.status).toBe(400);
  });

  it("la vista previa de una receta ajena responde 404 sin devolver su estructura", async () => {
    simularDb(base());
    sesion({ id: "user-admin-a", role: "ADMIN", companyId: EMPRESA_A, branchId: null });

    const res = await getProduccion(
      new Request(
        `http://localhost/api/inventory/production?preview=true&branchId=${SUCURSAL_A_1}&recipeId=${RECETA_B}&quantity=5`,
      ) as never,
    );

    expect(res.status).toBe(404);
    const cuerpo = await res.json();
    expect(cuerpo.preview).toBeUndefined();
  });
});