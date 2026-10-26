import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  branches,
  inventoryBatches,
  inventoryItems,
  inventoryMovements,
  inventoryTransfers,
  inventoryTransferItems,
} from "@/lib/db/schema";
import { InventoryService } from "@/lib/services/inventory-service";
import { getSession } from "@/lib/auth";
import { GET as getTransferRoute, PATCH as patchTransferRoute } from "@/app/api/inventory/transfers/[id]/route";
import { capturarError, crearSimulador, type DbSimulado } from "../../fixtures/db-simulado";
import {
  EMPRESA_A,
  EMPRESA_B,
  SUCURSAL_A_1,
  SUCURSAL_A_2,
  SUCURSAL_B_1,
} from "../../fixtures/tenant-isolation";

/**
 * C17 — el recorrido de abastecimiento entre sucursales, con empresa verificada.
 *
 * `foodProduction` sigue siendo una dimensión descriptiva (C15 y la decisión del
 * 13-10-2026): no hay cocinas designadas. Lo que C17 deja bien es el recorrido
 * que esa dimensión describe — la producción de cada sucursal y el envío de
 * una cocina a otra —, que tenía los mismos huecos que C16 cerró en compras:
 *
 *  1. `createTransfer` aceptaba destino, artículos y lote del cuerpo sin
 *     comprobar de qué empresa eran. Con una sucursal ajena de destino se
 *     montaba una transferencia y `shipTransfer` descontaba el lote que
 *     hallara — el lote de la otra empresa.
 *  2. `getTransfer` y las cuatro transiciones buscaban la transferencia sólo
 *     por id: cualquier usuario autenticado con el UUID leía, aprobaba, enviaba
 *     o recibía una transferencia de otra empresa.
 *  3. La ruta `PATCH` no exigía ningún permiso ni el lado correcto: un
 *     `EMPLEADO` aprobaba y una sucursal que no era el extremo de la
 *     transferencia también.
 *
 * Lo que se comprueba aquí es sobre el servicio y la ruta reales: que un
 * rechazo no escribe nada, que la pertenencia se comprueba antes de calcular o
 * escribir, y que el recorrido completo mueve el stock **una** vez por extremo
 * (un `TRANSFER` negativo en origen, uno positivo en destino) — que es el
 * criterio de C17: el efecto sin duplicar movimientos de inventario.
 *
 * `db` va simulado con un ejecutor mínimo que responde por tabla y anota lo
 * escrito: así se ve que el rechazo ocurre *antes* de tocar nada.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));

const TABLAS: Array<[string, unknown]> = [
  ["branches", branches],
  ["inventoryItems", inventoryItems],
  ["inventoryTransfers", inventoryTransfers],
  ["inventoryTransferItems", inventoryTransferItems],
  ["inventoryBatches", inventoryBatches],
  ["inventoryMovements", inventoryMovements],
];

/**
 * Atajo local al simulador compartido: estas pruebas declaran sus propias
 * tablas y no quieren repetirlas en cada llamada.
 */
function simularDb(filas: Record<string, unknown[]>, lotes: Record<string, number> = {}): DbSimulado {
  return crearSimulador(db, TABLAS, filas, { lotes });
}

const ARTICULO_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ARTICULO_B = "bbbbbbbb-0000-4000-8000-000000000001";
const SUCURSAL_B_2 = "bbbbbbbb-0000-4000-8000-000000000099";
const TRANSFERENCIA = "cccccccc-0000-4000-8000-000000000001";
const LOTE_A = "dddddddd-0000-4000-8000-000000000001";
const LOTE_B = "dddddddd-0000-4000-8000-000000000002";

/** Dos sucursales de A. Cada fila declara su empresa: el filtro es real. */
const sucursalesDeA = [
  { id: SUCURSAL_A_1, companyId: EMPRESA_A },
  { id: SUCURSAL_A_2, companyId: EMPRESA_A },
];

/** Una segunda sucursal de B, para transferencias que no son de A. */
const sucursalesDeB = [
  { id: SUCURSAL_B_1, companyId: EMPRESA_B },
  { id: SUCURSAL_B_2, companyId: EMPRESA_B },
];

/** Filas base: empresa A con dos sucursales y una transferencia de A₁ hacia A₂. */
function baseA(): Record<string, unknown[]> {
  return {
    branches: [...sucursalesDeA],
    inventoryItems: [{ id: ARTICULO_A, companyId: EMPRESA_A, name: "Pollo" }],
    inventoryTransfers: [
      {
        id: TRANSFERENCIA,
        transferNumber: "TRF-202610-0001",
        fromBranchId: SUCURSAL_A_1,
        toBranchId: SUCURSAL_A_2,
        status: "PENDING",
      },
    ],
    inventoryTransferItems: [
      {
        id: "linea-1",
        transferId: TRANSFERENCIA,
        itemId: ARTICULO_A,
        requestedQuantity: 5,
        approvedQuantity: null,
        shippedQuantity: null,
        receivedQuantity: null,
      },
    ],
    inventoryBatches: [{ id: LOTE_A, branchId: SUCURSAL_A_1, currentQuantity: "20" }],
    inventoryMovements: [],
  };
}

describe("C17.3 — la creación de una transferencia comprueba de qué empresa es lo que mueve", () => {
  let estado: DbSimulado;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza un destino de otra empresa antes de escribir", async () => {
    estado = simularDb({
      ...baseA(),
      branches: [{ id: SUCURSAL_A_1, companyId: EMPRESA_A }, { id: SUCURSAL_B_1, companyId: EMPRESA_B }],
    });

    const error = await capturarError(() =>
      InventoryService.createTransfer({
        companyId: EMPRESA_A,
        fromBranchId: SUCURSAL_A_1,
        toBranchId: SUCURSAL_B_1,
        requestedBy: "user-gerente-a1",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(estado.escrituras.filter((e) => e.tabla === "inventoryTransfers")).toHaveLength(0);
    expect(estado.escrituras.filter((e) => e.tabla === "inventoryTransferItems")).toHaveLength(0);
  });

  it("rechaza un origen de otra empresa antes de escribir", async () => {
    estado = simularDb({
      ...baseA(),
      branches: [{ id: SUCURSAL_A_2, companyId: EMPRESA_A }, { id: SUCURSAL_B_1, companyId: EMPRESA_B }],
    });

    const error = await capturarError(() =>
      InventoryService.createTransfer({
        companyId: EMPRESA_A,
        fromBranchId: SUCURSAL_B_1,
        toBranchId: SUCURSAL_A_2,
        requestedBy: "user-admin-a",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("rechaza artículos de otra empresa", async () => {
    // El catálogo de artículos de A sólo conoce ARTICULO_A: ARTICULO_B es de B.
    estado = simularDb({ ...baseA() });

    const error = await capturarError(() =>
      InventoryService.createTransfer({
        companyId: EMPRESA_A,
        fromBranchId: SUCURSAL_A_1,
        toBranchId: SUCURSAL_A_2,
        requestedBy: "user-gerente-a1",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }, { itemId: ARTICULO_B, requestedQuantity: 1 }],
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toContain("artículos");
    expect(estado.escrituras).toHaveLength(0);
  });

  it("rechaza una transferencia a la misma sucursal", async () => {
    estado = simularDb({ ...baseA() });

    const error = await capturarError(() =>
      InventoryService.createTransfer({
        companyId: EMPRESA_A,
        fromBranchId: SUCURSAL_A_1,
        toBranchId: SUCURSAL_A_1,
        requestedBy: "user-gerente-a1",
        items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("registra la transferencia cuando origen, destino y artículos son de la empresa", async () => {
    estado = simularDb({ ...baseA() });

    const resultado = await InventoryService.createTransfer({
      companyId: EMPRESA_A,
      fromBranchId: SUCURSAL_A_1,
      toBranchId: SUCURSAL_A_2,
      requestedBy: "user-gerente-a1",
      items: [{ itemId: ARTICULO_A, requestedQuantity: 5 }],
      notes: "Comisariato del lunes",
    });

    expect(resultado).toBeTruthy();
    const cabecera = estado.escrituras.find((e) => e.tabla === "inventoryTransfers");
    expect(cabecera?.valores.status).toBe("PENDING");
    expect(cabecera?.valores.fromBranchId).toBe(SUCURSAL_A_1);
    expect(cabecera?.valores.toBranchId).toBe(SUCURSAL_A_2);
    expect(estado.escrituras.filter((e) => e.tabla === "inventoryTransferItems")).toHaveLength(1);
  });
});

describe("C17.3 — el detalle de una transferencia no se lee por id pelado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve null cuando las sucursales son de otra empresa", async () => {
    // Empresa B ve una transferencia que cruza dos sucursales suyas: el id no
    // dice de quién es, y sin la guarda el detalle era legible.
    simularDb({
      branches: sucursalesDeB,
      inventoryTransfers: [
        {
          id: TRANSFERENCIA,
          transferNumber: "TRF-202610-0001",
          fromBranchId: SUCURSAL_B_1,
          toBranchId: SUCURSAL_B_2,
          status: "PENDING",
        },
      ],
      inventoryTransferItems: [],
    });

    const resultado = await InventoryService.getTransfer(TRANSFERENCIA, EMPRESA_A);
    expect(resultado).toBeNull();
  });

  it("devuelve la transferencia con sus artículos cuando es de la empresa", async () => {
    simularDb(baseA());

    const resultado = await InventoryService.getTransfer(TRANSFERENCIA, EMPRESA_A);
    expect(resultado).toBeTruthy();
    expect(resultado?.transferNumber).toBe("TRF-202610-0001");
    expect(resultado?.items).toHaveLength(1);
  });
});

describe("C17.3 — las transiciones rechazan lo ajeno antes de tocar la fila", () => {
  let estado: DbSimulado;

  /** Filas donde la transferencia vive entre dos sucursales de otra empresa. */
  function baseAjena(): Record<string, unknown[]> {
    return {
      ...baseA(),
      branches: sucursalesDeB,
      inventoryTransfers: [
        {
          id: TRANSFERENCIA,
          transferNumber: "TRF-202610-0001",
          fromBranchId: SUCURSAL_B_1,
          toBranchId: SUCURSAL_B_2,
          status: "APPROVED",
        },
      ],
      inventoryTransferItems: [
        {
          id: "linea-1",
          transferId: TRANSFERENCIA,
          itemId: ARTICULO_B,
          batchId: LOTE_B,
          requestedQuantity: 5,
          approvedQuantity: 5,
          shippedQuantity: null,
          receivedQuantity: null,
        },
      ],
      inventoryBatches: [{ id: LOTE_B, branchId: SUCURSAL_B_1, currentQuantity: "20" }],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aprobar, rechazar, enviar y recibir una transferencia ajena responde 404 sin escribir", async () => {
    const acciones: Array<(id: string, empresa: string) => Promise<unknown>> = [
      (id, empresa) => InventoryService.approveTransfer(id, empresa, "user-admin-b"),
      (id, empresa) => InventoryService.rejectTransfer(id, empresa, "user-admin-b", "no aplica"),
      (id, empresa) => InventoryService.shipTransfer(id, empresa, "user-admin-b"),
      (id, empresa) => InventoryService.receiveTransfer(id, empresa, "user-admin-b"),
    ];

    for (const accion of acciones) {
      estado = simularDb(baseAjena());
      const error = await capturarError(() => accion(TRANSFERENCIA, EMPRESA_A));
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Transferencia no encontrada");
      expect(estado.escrituras, "una transición ajena no escribe nada").toHaveLength(0);
    }
  });

  it("aprobar una transferencia propia cambia el estado y registra quién aprobó", async () => {
    estado = simularDb(baseA());

    const resultado = await InventoryService.approveTransfer(TRANSFERENCIA, EMPRESA_A, "user-admin-a");

    expect(resultado).toBeTruthy();
    const actualizacion = estado.escrituras.find((e) => e.tabla === "inventoryTransfers");
    expect(actualizacion?.valores.status).toBe("APPROVED");
    expect(actualizacion?.valores.approvedBy).toBe("user-admin-a");
  });
});

describe("C17.4 — el recorrido completo no duplica movimientos", () => {
  // El recorrido exitoso pasó a transfer-fefo-db.test.ts: SQL real comprueba
  // saldo/kardex y creación única en destino con el allocator y sus locks.

  it("un envío entre empresas no mueve ningún lote ni registra movimiento", async () => {
    const estado = simularDb({
      branches: sucursalesDeB,
      inventoryTransfers: [
        {
          id: TRANSFERENCIA,
          transferNumber: "TRF-202610-0001",
          fromBranchId: SUCURSAL_B_1,
          toBranchId: SUCURSAL_B_2,
          status: "APPROVED",
        },
      ],
      inventoryTransferItems: [
        {
          id: "linea-1",
          transferId: TRANSFERENCIA,
          itemId: ARTICULO_B,
          batchId: LOTE_B,
          requestedQuantity: 5,
          approvedQuantity: 5,
          shippedQuantity: null,
          receivedQuantity: null,
        },
      ],
      inventoryBatches: [{ id: LOTE_B, branchId: SUCURSAL_B_1, currentQuantity: "20" }],
      inventoryMovements: [],
    }, { [LOTE_B]: 20 });

    const error = await capturarError(() => InventoryService.shipTransfer(TRANSFERENCIA, EMPRESA_A, "user-admin-a"));

    expect(error.statusCode).toBe(404);
    expect(estado.escrituras).toHaveLength(0);
  });
});

describe("C17.3 — la ruta de transiciones traduce a status HTTP", () => {
  const sesion = (usuario: Record<string, unknown>) =>
    vi.mocked(getSession).mockResolvedValue({ user: usuario } as never);

  const patch = (cuerpo: Record<string, unknown>) =>
    patchTransferRoute(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify(cuerpo),
        headers: { "content-type": "application/json" },
      }) as never,
      { params: Promise.resolve({ id: TRANSFERENCIA }) },
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("un admin de otra empresa recibe 404 y la transferencia no cambia", async () => {
    simularDb({
      branches: sucursalesDeB,
      inventoryTransfers: [
        {
          id: TRANSFERENCIA,
          transferNumber: "TRF-202610-0001",
          fromBranchId: SUCURSAL_B_1,
          toBranchId: SUCURSAL_B_2,
          status: "PENDING",
        },
      ],
      inventoryTransferItems: [],
    });
    sesion({ id: "user-admin-a", role: "ADMIN", companyId: EMPRESA_A, branchId: SUCURSAL_A_1 });

    const res = await patch({ action: "approve" });

    expect(res.status).toBe(404);
  });

  it("un gerente no aprueba una transferencia cuyo destino es otra sucursal", async () => {
    const estado = simularDb(baseA());
    sesion({ id: "user-gerente-a1", role: "GERENTE", companyId: EMPRESA_A, branchId: SUCURSAL_A_1 });

    const res = await patch({ action: "approve" });

    expect(res.status).toBe(403);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("un empleado sin permiso de escritura no aprueba aunque sea la sucursal destino", async () => {
    const estado = simularDb(baseA());
    sesion({ id: "empleado-a2", role: "EMPLEADO", companyId: EMPRESA_A, branchId: SUCURSAL_A_2 });

    const res = await patch({ action: "approve" });

    expect(res.status).toBe(403);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("el gerente del destino sí aprueba: la llamada llega al servicio", async () => {
    const estado = simularDb(baseA());
    sesion({ id: "user-gerente-a2", role: "GERENTE", companyId: EMPRESA_A, branchId: SUCURSAL_A_2 });

    const res = await patch({ action: "approve" });

    expect(res.status).toBe(200);
    expect(estado.escrituras.some((e) => e.tabla === "inventoryTransfers" && e.valores.status === "APPROVED")).toBe(true);
  });

  // El caso HTTP de origen/destino también se verifica con SQL real en
  // transfer-fefo-db.test.ts; no se simula FOR UPDATE ni los joins de alcance.

  it("el detalle de una transferencia ajena responde 404", async () => {
    simularDb({
      branches: sucursalesDeB,
      inventoryTransfers: [
        {
          id: TRANSFERENCIA,
          transferNumber: "TRF-202610-0001",
          fromBranchId: SUCURSAL_B_1,
          toBranchId: SUCURSAL_B_2,
          status: "PENDING",
        },
      ],
      inventoryTransferItems: [],
    });
    sesion({ id: "user-admin-a", role: "ADMIN", companyId: EMPRESA_A, branchId: null });

    const res = await getTransferRoute(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: TRANSFERENCIA }),
    });

    expect(res.status).toBe(404);
  });
});
