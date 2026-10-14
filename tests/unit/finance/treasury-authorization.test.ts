import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { branches, paymentRunItems, paymentRuns, recurringContracts } from "@/lib/db/schema";
import { TreasuryService } from "@/lib/services/treasury-service";
import {
  filtroDeRol,
  pasosDeCorrida,
  puedeEjecutarPaso,
  ROLES_TESORERIA,
  type PasoCorrida,
} from "@/lib/treasury/disbursement-policy";
import { getSession } from "@/lib/auth";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { PATCH as patchEstado } from "@/app/api/finance/treasury/runs/[id]/status/route";
import { GET as getCorrida } from "@/app/api/finance/treasury/runs/[id]/route";
import { POST as postLiquidar } from "@/app/api/finance/treasury/runs/[id]/items/[itemId]/settle/route";
import { capturarError, crearSimulador, type DbSimulado } from "../../fixtures/db-simulado";
import { EMPRESA_A, EMPRESA_B } from "../../fixtures/tenant-isolation";

/**
 * C18 — el filtro de la operación de tesorería vive donde se escribe.
 *
 * La corrida de pago es la única operación del producto que mueve dinero, y su
 * filtro de rol estaba **en la ruta**: `updatePaymentRunStatus` y
 * `settlePaymentRunItem` recibían `userId` y nada más. Tres consecuencias, y
 * las tres se comprueban aquí:
 *
 *  1. Cualquier otra entrada al servicio saltaba el filtro: una acción de
 *     servidor, un script o un workflow cambiaban el estado de una corrida sin
 *     ser administrador. Ahora `actorRole` es un parámetro obligatorio.
 *  2. La pantalla no sabía qué puede el operador: un `GERENTE` veía «Aprobar
 *     Corrida (Firma)» porque el botón dependía sólo del estado, y el clic
 *     volvía con un 403. El mismo módulo calcula los dos veredictos.
 *  3. El detalle de la corrida se armaba entero —partidas, facturas, nómina,
 *     gastos— y la ruta comparaba la empresa **después**, respondiendo 403: la
 *     respuesta ajena ya estaba construida y el código confirmaba que el id
 *     existía.
 *
 * Y el criterio 3 de aceptación: endurecer el filtro no reescribe estados
 * históricos. No hay ninguna escritura de estado en estos casos.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn(), query: {} },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));

vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: vi.fn() }));

const TABLAS: Array<[string, unknown]> = [
  ["paymentRuns", paymentRuns],
  ["paymentRunItems", paymentRunItems],
  ["recurringContracts", recurringContracts],
  ["branches", branches],
];

function simularDb(filas: Record<string, unknown[]>): DbSimulado {
  return crearSimulador(db, TABLAS, filas);
}

const CORRIDA = "abababab-0000-4000-8000-000000000001";
const PARTIDA = "cdcdcdcd-0000-4000-8000-000000000001";
const RAMA = "eeeeeeee-0000-4000-8000-000000000001";

/** Corrida de A en el estado que cada caso necesita. */
function corrida(estado: string, preparadoPor = "user-admin-a1"): Record<string, unknown> {
  return {
    id: CORRIDA,
    companyId: EMPRESA_A,
    branchId: RAMA,
    title: "Quincena 20",
    status: estado,
    preparedBy: preparadoPor,
    totalAmountCents: 100000,
    runDate: new Date("2026-10-20"),
  };
}

function partida(estado = "PENDING"): Record<string, unknown> {
  return {
    id: PARTIDA,
    paymentRunId: CORRIDA,
    itemType: "INVOICE",
    referenceId: "f0f0f0f0-0000-4000-8000-000000000001",
    amountCents: 100000,
    settlementStatus: estado,
  };
}

describe("C18.2 — el filtro de rol es puro y el mismo para todos", () => {
  it("sólo los tres roles de tesorería pasan cualquier paso", () => {
    for (const paso of ["SOLICITAR", "APROBAR", "DISPERSAR", "LIQUIDAR", "CERRAR", "CANCELAR", "DESCARGAR"] as PasoCorrida[]) {
      for (const rol of ROLES_TESORERIA) {
        expect(filtroDeRol(paso, { role: rol }).permitido, `${paso} con ${rol}`).toBe(true);
      }
      for (const rol of ["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"] as const) {
        const veredicto = filtroDeRol(paso, { role: rol });
        expect(veredicto.permitido, `${paso} con ${rol}`).toBe(false);
        expect(veredicto.motivo).toMatch(/administrador/i);
      }
    }
  });

  it("quien preparó la corrida no puede firmarla, aunque sea administrador", () => {
    expect(filtroDeRol("APROBAR", { role: "ADMIN", esPreparador: true }).permitido).toBe(false);
    expect(
      filtroDeRol("APROBAR", { role: "ADMIN", esPreparador: true }).motivo,
    ).toMatch(/doble firma/i);
    // La regla es del paso de firma: preparar y liquidar siguen siendo suyos.
    expect(filtroDeRol("SOLICITAR", { role: "ADMIN", esPreparador: true }).permitido).toBe(true);
    expect(filtroDeRol("LIQUIDAR", { role: "ADMIN", esPreparador: true }).permitido).toBe(true);
  });

  it("sin rol no hay operación, ni siquiera para el estado que la admite", () => {
    expect(puedeEjecutarPaso("SOLICITAR", { role: null, status: "DRAFT" }).permitido).toBe(false);
    expect(puedeEjecutarPaso("SOLICITAR", { role: undefined, status: "DRAFT" }).permitido).toBe(false);
  });

  it("el estado va antes que el rol: una corrida cerrada no admite pasos", () => {
    const cerrada = puedeEjecutarPaso("DISPERSAR", { role: "ADMIN", status: "COMPLETED" });
    expect(cerrada.permitido).toBe(false);
    expect(cerrada.motivo).toMatch(/no admite/i);
  });

  it("las partidas pendientes bloquean el cierre y sólo el cierre", () => {
    const conPendientes = { role: "ADMIN", status: "PROCESSING", pendientes: 2 } as const;
    expect(puedeEjecutarPaso("CERRAR", conPendientes).permitido).toBe(false);
    expect(puedeEjecutarPaso("CERRAR", conPendientes).motivo).toBe("Faltan 2 partidas por liquidar.");
    expect(puedeEjecutarPaso("CERRAR", { ...conPendientes, pendientes: 0 }).permitido).toBe(true);
    expect(puedeEjecutarPaso("LIQUIDAR", conPendientes).permitido).toBe(true);
  });

  it("la pantalla ofrece exactamente los pasos del estado, con su veredicto", () => {
    const borrador = pasosDeCorrida("DRAFT", "ADMIN");
    expect(borrador.map((p) => p.paso)).toEqual(["SOLICITAR", "CANCELAR"]);
    expect(borrador.every((p) => p.permitido)).toBe(true);

    // Un gerente ve los mismos botones, todos desactivados y con el motivo: el
    // 403 tiene que poder leerse antes de hacer clic.
    const paraGerente = pasosDeCorrida("DRAFT", "GERENTE");
    expect(paraGerente.map((p) => p.paso)).toEqual(borrador.map((p) => p.paso));
    expect(paraGerente.every((p) => !p.permitido && p.motivo)).toBe(true);

    // Firmar sin ser segundo par no se ofrece.
    const firma = pasosDeCorrida("PENDING_APPROVAL", "ADMIN", { esPreparador: true }).find(
      (p) => p.paso === "APROBAR",
    );
    expect(firma?.permitido).toBe(false);
  });
});

describe("C18.2 — el servicio aplica el filtro y no sólo la ruta", () => {
  let estado: DbSimulado;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const transicion = (estadoInicial: string, rol: never, actor = "user-admin-a1", destino = "APPROVED") =>
    TreasuryService.updatePaymentRunStatus(CORRIDA, EMPRESA_A, destino as never, actor, rol);

  it("un gerente no firma una corrida aunque llegue por el servicio", async () => {
    estado = simularDb({ paymentRuns: [corrida("PENDING_APPROVAL")], paymentRunItems: [] });

    const error = await capturarError(() => transicion("PENDING_APPROVAL", "GERENTE" as never));

    expect(error.statusCode).toBe(403);
    expect(error.message).toMatch(/administrador/i);
    expect(estado.escrituras, "el rechazo no escribe el estado").toHaveLength(0);
  });

  it("un gerente no dispersa, no cierra y no cancela", async () => {
    for (const [estadoInicial, destino] of [
      ["APPROVED", "PROCESSING"],
      ["PROCESSING", "COMPLETED"],
      ["DRAFT", "CANCELLED"],
    ] as const) {
      estado = simularDb({ paymentRuns: [corrida(estadoInicial)], paymentRunItems: [] });
      const error = await capturarError(() =>
        TreasuryService.updatePaymentRunStatus(CORRIDA, EMPRESA_A, destino as never, "user-gte", "GERENTE" as never),
      );
      expect(error.statusCode, `${estadoInicial} → ${destino}`).toBe(403);
      expect(estado.escrituras).toHaveLength(0);
    }
  });

  it("un administrador sí: el estado avanza y queda registrado quién lo firmó", async () => {
    estado = simularDb({ paymentRuns: [corrida("PENDING_APPROVAL")], paymentRunItems: [] });

    const resultado = await transicion("PENDING_APPROVAL", "ADMIN" as never, "user-admin-a2");

    expect(resultado).toBeTruthy();
    const escritura = estado.escrituras.find((e) => e.tabla === "paymentRuns");
    expect(escritura?.valores.status).toBe("APPROVED");
    expect(escritura?.valores.approvedBy).toBe("user-admin-a2");
  });

  it("el filtro no oculta un estado imposible: primero quién eres, después qué puedes pedir", async () => {
    estado = simularDb({ paymentRuns: [corrida("DRAFT")], paymentRunItems: [] });

    // Un gerente que pide cerrar una corrida en borrador recibe 403 por rol…
    const porRol = await capturarError(() => transicion("DRAFT", "GERENTE" as never, "user-gte", "COMPLETED"));
    expect(porRol.statusCode).toBe(403);

    // …y un administrador que pide lo mismo recibe 400 por el estado, con el
    // motivo de la máquina de transiciones y no un problema de permisos.
    const porEstado = await capturarError(() => transicion("DRAFT", "ADMIN" as never, "user-admin-a2", "COMPLETED"));
    expect(porEstado.statusCode).toBe(400);
    expect(porEstado.message).toMatch(/transición no permitida/i);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("liquidar una partida exige el mismo rol que firma la corrida", async () => {
    estado = simularDb({ paymentRuns: [corrida("PROCESSING")], paymentRunItems: [partida()] });

    const error = await capturarError(() =>
      TreasuryService.settlePaymentRunItem({
        paymentRunId: CORRIDA,
        itemId: PARTIDA,
        companyId: EMPRESA_A,
        settlementStatus: "CONFIRMED",
        userId: "user-gte",
        actorRole: "GERENTE",
        reference: "SPEI-001",
      }),
    );

    expect(error.statusCode).toBe(403);
    expect(estado.escrituras, "un rechazo no liquida ni saldo").toHaveLength(0);
  });

  it("un administrador sí liquida: la partida queda con su estado y su motivo", async () => {
    estado = simularDb({ paymentRuns: [corrida("PROCESSING")], paymentRunItems: [partida()] });

    const resultado = await TreasuryService.settlePaymentRunItem({
      paymentRunId: CORRIDA,
      itemId: PARTIDA,
      companyId: EMPRESA_A,
      settlementStatus: "FAILED",
      userId: "user-admin-a2",
      actorRole: "ADMIN",
      failureReason: "Rechazado por el banco",
    });

    expect(resultado.accion).toBe("RECHAZAR");
    const escritura = estado.escrituras.find((e) => e.tabla === "paymentRunItems");
    expect(escritura?.valores.settlementStatus).toBe("FAILED");
    expect(escritura?.valores.failureReason).toBe("Rechazado por el banco");
  });

  it("bajar el layout con las CLABEs en claro exige rol de tesorería en el servicio", async () => {
    estado = simularDb({ paymentRuns: [corrida("APPROVED")], paymentRunItems: [partida()] });

    const error = await capturarError(() =>
      TreasuryService.generateBankDisbursementLayout(CORRIDA, EMPRESA_A, "SUPERVISOR"),
    );

    expect(error.statusCode).toBe(403);
    expect(error.message).toMatch(/administrador/i);
  });
});

describe("C18.3 — el detalle de la corrida se acota en la consulta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sesion = (rol: string, empresa: string) =>
    vi.mocked(requirePermissionApi).mockResolvedValue({
      ctx: { userId: "user-admin-a", userRole: rol, userCompanyId: empresa, userBranchId: null },
    } as never);
  vi.mocked(getSession).mockResolvedValue({ user: { id: "user-admin-a" } } as never);

  it("la corrida de otra empresa se lee como no encontrada, no como prohibida", async () => {
    simularDb({ paymentRuns: [corrida("APPROVED")], paymentRunItems: [partida()] });
    sesion("ADMIN", EMPRESA_B);

    const error = await capturarError(() => TreasuryService.getPaymentRunDetails(CORRIDA, EMPRESA_B));
    expect(error.statusCode).toBe(404);

    const res = await getCorrida(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: CORRIDA }),
    });
    expect(res.status).toBe(404);
  });

  it("la propia corrida se lee con sus partidas", async () => {
    simularDb({ paymentRuns: [corrida("APPROVED")], paymentRunItems: [partida()] });
    sesion("ADMIN", EMPRESA_A);

    const detalle = await TreasuryService.getPaymentRunDetails(CORRIDA, EMPRESA_A);
    expect(detalle.run.id).toBe(CORRIDA);
    expect(detalle.items).toHaveLength(1);
  });
});

describe("C18.2 — la ruta pasa el rol de la sesión al servicio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sesion = (rol: string) =>
    vi.mocked(requirePermissionApi).mockResolvedValue({
      ctx: { userId: "user-gte", userRole: rol, userCompanyId: EMPRESA_A, userBranchId: null },
    } as never);

  it("un gerente recibe 403 al pedir la firma por la ruta", async () => {
    const estado = simularDb({ paymentRuns: [corrida("PENDING_APPROVAL")], paymentRunItems: [] });
    sesion("GERENTE");

    const res = await patchEstado(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "APPROVED" }),
        headers: { "content-type": "application/json" },
      }) as never,
      { params: Promise.resolve({ id: CORRIDA }) },
    );

    expect(res.status).toBe(403);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("liquidar por la ruta con un gerente también se rechaza", async () => {
    const estado = simularDb({ paymentRuns: [corrida("PROCESSING")], paymentRunItems: [partida()] });
    sesion("SUPERVISOR");

    const res = await postLiquidar(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ settlementStatus: "CONFIRMED", reference: "SPEI-1" }),
        headers: { "content-type": "application/json" },
      }) as never,
      { params: Promise.resolve({ id: CORRIDA, itemId: PARTIDA }) },
    );

    expect(res.status).toBe(403);
    expect(estado.escrituras).toHaveLength(0);
  });
});