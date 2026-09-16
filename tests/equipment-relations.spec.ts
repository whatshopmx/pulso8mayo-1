import { test, expect, request as playwrightRequest } from "@playwright/test";
import { E2E_TAG, USER_SUPER_ADMIN } from "./support/constants";
import { sql } from "./support/db";
import {
  createDraft,
  getOrderDetail,
  transitionOrder,
  updateDraft,
  type ServiceOrderRow,
} from "../lib/services/service-order-service";
import { equipmentService } from "../lib/services/equipment-service";

/**
 * T04 — las referencias de una Orden de Servicio no cruzan empresas ni sucursales.
 *
 * `equipmentId` era la única FK del payload de una OS que `validateReferences`
 * no miraba: la llave foránea alcanzaba, así que una orden de la empresa A podía
 * nacer apuntando al equipo de la empresa B, y el detalle de la orden quedaba
 * como puerta de lectura hacia un expediente ajeno. Lo mismo aplicaba a la
 * edición (`updateDraft`) y a `createComplianceService`, que insertaba el
 * `branchId` y el `providerId` del cuerpo tal cual.
 *
 * Las fronteras siguen la convención de T03 (`expense-service.ts:52`):
 *
 * - **400** para referencias que no existen *en esta empresa* o que no
 *   corresponden a la sucursal de la orden.
 * - **403** para una orden de la empresa que queda fuera del alcance del actor
 *   (otra sucursal); **404** si la orden ni siquiera es de la empresa.
 *
 * El primer bloque corre sin servidor: llama a los servicios contra la base de
 * desarrollo y comprueba, además del rechazo, que **no quedó fila escrita**.
 * El segundo pega a las rutas HTTP y necesita `next dev` levantado.
 */

const stamp = Date.now();

const ALL = { kind: "ALL" as const };

interface Empresa {
  id: string;
  branchA1: string;
  branchA2: string;
  equipoA1: string;
  equipoA2: string;
  supplierA: string;
  proveedorA: string;
  servicioA1: string;
}
interface Ajeno {
  id: string;
  branchB1: string;
  equipoB1: string;
  proveedorB: string;
}

let A: Empresa;
let B: Ajeno;

const empresaIds = () => [A.id, B.id];

/** Una empresa propia con dos sucursales, equipo en cada una y sus catálogos. */
async function sembrarEmpresa(): Promise<Empresa> {
  const [company] = await sql`
    INSERT INTO companies (name) VALUES (${`${E2E_TAG} empresa A ${stamp}`}) RETURNING id
  `;
  const companyId = company.id as string;
  const [a1] = await sql`
    INSERT INTO branches (company_id, name)
    VALUES (${companyId}, ${`${E2E_TAG} A1 ${stamp}`}) RETURNING id
  `;
  const [a2] = await sql`
    INSERT INTO branches (company_id, name)
    VALUES (${companyId}, ${`${E2E_TAG} A2 ${stamp}`}) RETURNING id
  `;
  const branchA1 = a1.id as string;
  const branchA2 = a2.id as string;

  const equipo = async (branchId: string, label: string) => {
    const [row] = await sql`
      INSERT INTO branch_equipments (company_id, branch_id, name, equipment_code, type, created_by)
      VALUES (
        ${companyId}, ${branchId},
        ${`${E2E_TAG} equipo ${label}`},
        ${`E2E-REL-${stamp}-${label}`},
        'REFRIGERATOR',
        ${USER_SUPER_ADMIN}
      )
      RETURNING id
    `;
    return row.id as string;
  };
  const equipoA1 = await equipo(branchA1, "A1");
  const equipoA2 = await equipo(branchA2, "A2");

  const [supplier] = await sql`
    INSERT INTO suppliers (company_id, name)
    VALUES (${companyId}, ${`${E2E_TAG} proveedor A ${stamp}`}) RETURNING id
  `;
  const [proveedor] = await sql`
    INSERT INTO service_providers (company_id, name, services, created_by)
    VALUES (
      ${companyId}, ${`${E2E_TAG} proveedor de servicio A ${stamp}`},
      '["FUMIGATION"]'::jsonb, ${USER_SUPER_ADMIN}
    )
    RETURNING id
  `;
  const [servicio] = await sql`
    INSERT INTO branch_compliance_services
      (company_id, branch_id, service_type, service_name, frequency, created_by)
    VALUES (
      ${companyId}, ${branchA1}, 'FUMIGATION',
      ${`${E2E_TAG} fumigación mensual ${stamp}`}, 'MONTHLY', ${USER_SUPER_ADMIN}
    )
    RETURNING id
  `;

  return {
    id: companyId,
    branchA1,
    branchA2,
    equipoA1,
    equipoA2,
    supplierA: supplier.id as string,
    proveedorA: proveedor.id as string,
    servicioA1: servicio.id as string,
  };
}

/** Cuántas órdenes existen entre las empresas sembradas (antes/después). */
async function contarOrdenes(): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM service_orders WHERE company_id = ANY(${empresaIds()})
  `;
  return rows[0].n;
}

/** Limpieza completa, ordenada por FKs. */
async function limpiar(): Promise<void> {
  await sql`DELETE FROM service_order_quotes WHERE service_order_id IN (SELECT id FROM service_orders WHERE company_id = ANY(${empresaIds()}))`;
  await sql`DELETE FROM service_order_evidence WHERE service_order_id IN (SELECT id FROM service_orders WHERE company_id = ANY(${empresaIds()}))`;
  await sql`DELETE FROM approval_requests WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM service_orders WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM compliance_service_history WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM branch_compliance_services WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM service_providers WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM suppliers WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM equipment_warranties WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM equipment_alerts WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM equipment_maintenance_schedules WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM equipment_maintenance_history WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM branch_equipments WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM branches WHERE company_id = ANY(${empresaIds()})`;
  await sql`DELETE FROM companies WHERE id = ANY(${empresaIds()})`;
}

/** Una empresa ajena con una sucursal, un equipo y un proveedor de servicio. */
async function sembrarAjeno(): Promise<Ajeno> {
  const [company] = await sql`
    INSERT INTO companies (name) VALUES (${`${E2E_TAG} empresa B ${stamp}`}) RETURNING id
  `;
  const companyId = company.id as string;
  const [b1] = await sql`
    INSERT INTO branches (company_id, name)
    VALUES (${companyId}, ${`${E2E_TAG} B1 ${stamp}`}) RETURNING id
  `;
  const [equipo] = await sql`
    INSERT INTO branch_equipments (company_id, branch_id, name, equipment_code, type, created_by)
    VALUES (
      ${companyId}, ${b1.id}, ${`${E2E_TAG} equipo B1`},
      ${`E2E-REL-${stamp}-B1`}, 'REFRIGERATOR', ${USER_SUPER_ADMIN}
    )
    RETURNING id
  `;
  const [proveedor] = await sql`
    INSERT INTO service_providers (company_id, name, services, created_by)
    VALUES (
      ${companyId}, ${`${E2E_TAG} proveedor de servicio B ${stamp}`},
      '["FUMIGATION"]'::jsonb, ${USER_SUPER_ADMIN}
    )
    RETURNING id
  `;
  return {
    id: companyId,
    branchB1: b1.id as string,
    equipoB1: equipo.id as string,
    proveedorB: proveedor.id as string,
  };
}

/** Una orden sembrada a mano con folio único y estado dado. */
async function sembrarOrden(opts: {
  companyId: string;
  branchId: string;
  equipmentId?: string | null;
  status: ServiceOrderRow["status"];
}): Promise<ServiceOrderRow> {
  const [row] = await sql`
    INSERT INTO service_orders
      (company_id, branch_id, folio, type, status, equipment_id, created_by)
    VALUES (
      ${opts.companyId}, ${opts.branchId},
      ${`E2E-REL-${stamp}-${globalThis.crypto.randomUUID().slice(0, 8)}`},
      'CORRECTIVO', ${opts.status}, ${opts.equipmentId ?? null}, ${USER_SUPER_ADMIN}
    )
    RETURNING *
  `;
  return row as unknown as ServiceOrderRow;
}

test.describe("T04 · el servicio contra la base", () => {
  test.beforeAll(async () => {
    A = await sembrarEmpresa();
    B = await sembrarAjeno();
  });

  test.afterEach(async () => {
    await limpiar();
  });

  test("createDraft con equipo ajeno responde 400 y no crea la orden", async () => {
    const antes = await contarOrdenes();
    await expect(
      createDraft(
        { branchId: A.branchA1, type: "CORRECTIVO", equipmentId: B.equipoB1 },
        A.id,
        USER_SUPER_ADMIN,
      ),
    ).rejects.toThrow("El equipo indicado no pertenece a la empresa");
    expect(await contarOrdenes()).toBe(antes);
  });

  test("createDraft con equipo de otra sucursal de la misma empresa responde 400", async () => {
    const antes = await contarOrdenes();
    await expect(
      createDraft(
        { branchId: A.branchA1, type: "CORRECTIVO", equipmentId: A.equipoA2 },
        A.id,
        USER_SUPER_ADMIN,
      ),
    ).rejects.toThrow("El equipo indicado no pertenece a la sucursal de la orden");
    expect(await contarOrdenes()).toBe(antes);
  });

  test("createDraft válido con equipo propio crea la orden", async () => {
    const orden = await createDraft(
      { branchId: A.branchA1, type: "CORRECTIVO", equipmentId: A.equipoA1 },
      A.id,
      USER_SUPER_ADMIN,
    );
    expect(orden.status).toBe("DRAFT");
    expect(orden.equipmentId).toBe(A.equipoA1);
    expect(orden.folio).toMatch(/^DRAFT-/);
  });

  test("createDraft con sucursal o proveedor ajeno responde 400 (regresión)", async () => {
    await expect(
      createDraft({ branchId: B.branchB1, type: "CORRECTIVO" }, A.id, USER_SUPER_ADMIN),
    ).rejects.toThrow("La sucursal indicada no pertenece a la empresa");
    await expect(
      createDraft(
        { branchId: A.branchA1, type: "CORRECTIVO", supplierId: B.equipoB1 },
        A.id,
        USER_SUPER_ADMIN,
      ),
    ).rejects.toThrow("El proveedor indicado no pertenece a la empresa");
  });

  test("updateDraft con equipo ajeno responde 400 y la orden conserva el suyo", async () => {
    const orden = await sembrarOrden({
      companyId: A.id,
      branchId: A.branchA1,
      equipmentId: A.equipoA1,
      status: "DRAFT",
    });

    await expect(
      updateDraft(orden.id, { equipmentId: B.equipoB1 }, A.id, ALL),
    ).rejects.toThrow("El equipo indicado no pertenece a la empresa");

    const detallada = await getOrderDetail(A.id, orden.id, ALL);
    expect(detallada?.order.equipmentId).toBe(A.equipoA1);
  });

  test("updateDraft de otra sucursal con alcance acotado responde 403 sin cambios", async () => {
    const orden = await sembrarOrden({
      companyId: A.id,
      branchId: A.branchA2,
      status: "DRAFT",
    });

    await expect(
      updateDraft(
        orden.id,
        { justification: `${E2E_TAG} secuestro` },
        A.id,
        { kind: "BRANCH", branchId: A.branchA1 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const intacta = await getOrderDetail(A.id, orden.id, ALL);
    expect(intacta?.order.justification).toBeNull();
  });

  test("getOrderDetail aplica el alcance: 403 en otra sucursal, detalle completo con ALL", async () => {
    const orden = await sembrarOrden({
      companyId: A.id,
      branchId: A.branchA2,
      status: "DRAFT",
    });

    await expect(
      getOrderDetail(A.id, orden.id, { kind: "BRANCH", branchId: A.branchA1 }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const detallada = await getOrderDetail(A.id, orden.id, ALL);
    expect(detallada?.order.id).toBe(orden.id);
    expect(detallada?.order.branchId).toBe(A.branchA2);
    expect(detallada?.quotes).toEqual([]);
    expect(detallada?.evidence).toEqual([]);
  });

  test("transitionOrder respeta el alcance y programa una orden aprobada propia", async () => {
    const orden = await sembrarOrden({
      companyId: A.id,
      branchId: A.branchA2,
      status: "APPROVED",
    });

    await expect(
      transitionOrder(A.id, orden.id, "schedule", undefined, {
        kind: "BRANCH",
        branchId: A.branchA1,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const programada = await transitionOrder(A.id, orden.id, "schedule", undefined, ALL);
    expect(programada.status).toBe("SCHEDULED");
  });

  test("createComplianceService valida sucursal y proveedor antes de insertar", async () => {
    const contarServicios = async () => {
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM branch_compliance_services
        WHERE company_id = ANY(${empresaIds()})
      `;
      return rows[0].n;
    };
    const antes = await contarServicios();

    await expect(
      equipmentService.createComplianceService(
        {
          companyId: A.id,
          branchId: B.branchB1,
          serviceType: "FUMIGATION",
          serviceName: `${E2E_TAG} cruzado`,
          frequency: "MONTHLY",
        },
        USER_SUPER_ADMIN,
      ),
    ).rejects.toThrow("La sucursal seleccionada no existe para esta empresa");

    await expect(
      equipmentService.createComplianceService(
        {
          companyId: A.id,
          branchId: A.branchA1,
          serviceType: "FUMIGATION",
          serviceName: `${E2E_TAG} con proveedor ajeno`,
          frequency: "MONTHLY",
          providerId: B.proveedorB,
        },
        USER_SUPER_ADMIN,
      ),
    ).rejects.toThrow("El proveedor de servicio indicado no pertenece a la empresa");

    expect(await contarServicios()).toBe(antes);

    const creado = await equipmentService.createComplianceService(
      {
        companyId: A.id,
        branchId: A.branchA1,
        serviceType: "FUMIGATION",
        serviceName: `${E2E_TAG} válido`,
        frequency: "MONTHLY",
        providerId: A.proveedorA,
      },
      USER_SUPER_ADMIN,
    );
    expect(creado.branchId).toBe(A.branchA1);
  });
});

test.describe("T04 · las rutas HTTP · sin servidor no corren, con servidor sí", () => {
  test.beforeAll(async () => {
    A = await sembrarEmpresa();
    B = await sembrarAjeno();
  });

  test.afterEach(async () => {
    await limpiar();
  });

  test("POST /api/service-orders con equipo ajeno responde 400 y no crea fila", async ({
    request,
  }) => {
    const antes = await contarOrdenes();

    const res = await request.post("/api/service-orders", {
      data: { branchId: A.branchA1, type: "CORRECTIVO", equipmentId: B.equipoB1 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json())?.error).toBe("El equipo indicado no pertenece a la empresa");

    expect(await contarOrdenes()).toBe(antes);
  });

  test("PATCH {action} sobre una orden de otra empresa no cambia el estado", async ({
    request,
  }) => {
    const ordenAjena = await sembrarOrden({
      companyId: B.id,
      branchId: B.branchB1,
      status: "APPROVED",
    });

    const res = await request.patch(`/api/service-orders/${ordenAjena.id}`, {
      data: { action: "schedule" },
    });
    // La sesión autenticada pertenece a otra empresa: la orden no es suya y la
    // respuesta es 404 con el mensaje único, sin confirmar en qué estado está.
    expect(res.status()).toBe(404);

    const [fila] = await sql`
      SELECT status FROM service_orders WHERE id = ${ordenAjena.id}
    `;
    expect(fila.status).toBe("APPROVED");
  });

  test("sin sesión no hay creación de órdenes: 401", async () => {
    const anonimo = await playwrightRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    });
    try {
      const res = await anonimo.post("/api/service-orders", {
        data: { branchId: A.branchA1, type: "CORRECTIVO" },
      });
      expect(res.status()).toBe(401);
    } finally {
      await anonimo.dispose();
    }
  });
});

