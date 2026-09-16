import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  BRANCH_CONDESA,
  COMPANY_ID,
  E2E_TAG,
  USER_SUPER_ADMIN,
} from "./support/constants";
import {
  cleanupForeignTenant,
  deleteTestBranch,
  seedForeignTenant,
  seedTestBranch,
  sql,
} from "./support/db";
import { equipmentService } from "../lib/services/equipment-service";

/**
 * T03 — el expediente y sus recursos no cruzan empresas ni sucursales.
 *
 * Filtrar la sucursal en el listado (`GET /api/equipment`, T02) no protegía el
 * acceso por ID. Antes de T03 las rutas del expediente tomaban el `id` del path
 * —o el `maintenanceId` del cuerpo— y lo pasaban al servicio tal cual:
 * `getEquipmentWithDetails`, `updateEquipment`, `deleteEquipment`,
 * `getWarrantiesByEquipment`, `getMaintenanceHistory` y `completeMaintenance`
 * consultaban **sólo** por `id`. Con el id en la mano se leía y se editaba el
 * equipo de otra empresa, y el cierre de mantenimiento arrastraba además la
 * fecha de último mantenimiento del equipo ajeno.
 *
 * Las dos fronteras se distinguen a propósito, siguiendo `expense-service.ts:52`:
 *
 * - **404** para lo que no existe *en esta empresa* —id inexistente, mal escrito
 *   o de otra empresa—, con el mismo mensaje en los tres casos: si difirieran,
 *   quien prueba ids averiguaría qué equipos tienen las demás empresas.
 * - **403** para un equipo de la empresa que queda fuera del alcance del usuario
 *   (otra sucursal, o un rol acotado sin sucursal asignada).
 *
 * El primer bloque corre sin servidor: llama a los servicios contra la base de
 * desarrollo y comprueba, además del rechazo, que **no quedó fila escrita**. El
 * segundo pega a las rutas HTTP y necesita `next dev` levantado:
 *
 *   pnpm exec playwright test --project=chromium tests/equipment-isolation.spec.ts
 *   pnpm exec playwright test --no-deps --grep "el servicio" tests/equipment-isolation.spec.ts
 *
 * Los casos de sucursal se prueban en el servicio y no por HTTP porque el
 * alcance de la sesión sembrada depende de la cookie de sucursal activa
 * (`tenant.branchId`), que el spec no controla: comprobarlo por HTTP sería
 * frágil, no más cierto.
 */

/** Un UUID bien formado que no corresponde a ningún equipo. */
const EQUIPO_INEXISTENTE = "e9999999-0000-4000-8000-999999999999";

const ALL = { kind: "ALL" as const };
const NONE = { kind: "NONE" as const };

const stamp = Date.now();

type Equipo = Awaited<ReturnType<typeof sembrarEquipo>>;

/** Un equipo de prueba, marcado con `E2E_TAG` para poder borrarlo después. */
async function sembrarEquipo(opts: {
  companyId: string;
  branchId: string;
  label: string;
}) {
  const [row] = await sql`
    INSERT INTO branch_equipments (company_id, branch_id, name, equipment_code, type, created_by)
    VALUES (
      ${opts.companyId},
      ${opts.branchId},
      ${`${E2E_TAG} equipo ${opts.label}`},
      ${`E2E-EQ-${stamp}-${opts.label}`},
      'REFRIGERATOR',
      ${USER_SUPER_ADMIN}
    )
    RETURNING id, company_id, branch_id, name, status
  `;
  return row as { id: string; company_id: string; branch_id: string; name: string; status: string };
}

/** Una garantía colgada de un equipo. */
async function sembrarGarantia(equipmentId: string, companyId: string): Promise<string> {
  const [row] = await sql`
    INSERT INTO equipment_warranties (equipment_id, company_id, provider, start_date, end_date, status, created_by)
    VALUES (
      ${equipmentId}, ${companyId}, ${`${E2E_TAG} proveedor`},
      '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', ${USER_SUPER_ADMIN}
    )
    RETURNING id
  `;
  return row.id as string;
}

/** Un registro de mantenimiento programado sobre un equipo. */
async function sembrarMantenimiento(opts: {
  equipmentId: string;
  companyId: string;
  branchId: string;
}): Promise<string> {
  const [row] = await sql`
    INSERT INTO equipment_maintenance_history
      (equipment_id, company_id, branch_id, maintenance_type, status, scheduled_date, description, created_by)
    VALUES (
      ${opts.equipmentId}, ${opts.companyId}, ${opts.branchId},
      'PREVENTIVE', 'SCHEDULED', '2026-03-01T00:00:00Z', ${`${E2E_TAG} mantenimiento`},
      ${USER_SUPER_ADMIN}
    )
    RETURNING id
  `;
  return row.id as string;
}

/** La fila del equipo, leída sin filtro de empresa: así se comprueba que no cambió. */
async function leerEquipo(equipmentId: string): Promise<Equipo | null> {
  const rows = await sql`
    SELECT id, company_id, branch_id, name, status
    FROM branch_equipments WHERE id = ${equipmentId}
  `;
  return (rows[0] as Equipo) ?? null;
}

/** El estado del registro de mantenimiento. */
async function leerEstadoMantenimiento(maintenanceId: string): Promise<string | null> {
  const rows = await sql`
    SELECT status FROM equipment_maintenance_history WHERE id = ${maintenanceId}
  `;
  return (rows[0]?.status as string) ?? null;
}

/** Borra los equipos sembrados y todo lo que cuelga de ellos. */
async function borrarEquipos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`DELETE FROM equipment_warranties WHERE equipment_id = ANY(${ids})`;
  await sql`DELETE FROM equipment_alerts WHERE equipment_id = ANY(${ids})`;
  await sql`DELETE FROM equipment_maintenance_schedules WHERE equipment_id = ANY(${ids})`;
  await sql`DELETE FROM equipment_maintenance_history WHERE equipment_id = ANY(${ids})`;
  await sql`DELETE FROM branch_equipments WHERE id = ANY(${ids})`;
}

/** Captura el rechazo de una guarda para revisar su status, sin `expect` dentro. */
async function capturarError(
  accion: Promise<unknown>
): Promise<{ statusCode?: number; message?: string } | null> {
  try {
    await accion;
  } catch (error) {
    return error as { statusCode?: number; message?: string };
  }
  return null;
}

let propio: Equipo;
let otraSucursal: Equipo;
let ajeno: Equipo;
let sucursalDeLaEmpresa = "";
let tenantAjeno: Awaited<ReturnType<typeof seedForeignTenant>>;
let mantenimientoPropio = "";
let mantenimientoAjeno = "";

test.beforeEach(async () => {
  // Una sucursal de la empresa sembrada para el caso "misma empresa, otra
  // sucursal", y el tenant ajeno para el caso "otra empresa".
  sucursalDeLaEmpresa = await seedTestBranch(COMPANY_ID, "equipo-otra-sucursal");
  tenantAjeno = await seedForeignTenant();

  propio = await sembrarEquipo({ companyId: COMPANY_ID, branchId: BRANCH_CONDESA, label: "propio" });
  otraSucursal = await sembrarEquipo({
    companyId: COMPANY_ID,
    branchId: sucursalDeLaEmpresa,
    label: "otra-sucursal",
  });
  ajeno = await sembrarEquipo({
    companyId: tenantAjeno.companyId,
    branchId: tenantAjeno.branchId,
    label: "ajeno",
  });

  await sembrarGarantia(ajeno.id, tenantAjeno.companyId);
  mantenimientoPropio = await sembrarMantenimiento({
    equipmentId: propio.id,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
  });
  mantenimientoAjeno = await sembrarMantenimiento({
    equipmentId: ajeno.id,
    companyId: tenantAjeno.companyId,
    branchId: tenantAjeno.branchId,
  });
});

test.afterEach(async () => {
  await borrarEquipos([propio.id, otraSucursal.id, ajeno.id]);
  if (sucursalDeLaEmpresa) await deleteTestBranch(sucursalDeLaEmpresa);
  sucursalDeLaEmpresa = "";
  await cleanupForeignTenant(tenantAjeno);
});

test.describe("T03 · el servicio · frontera de empresa y sucursal", () => {
  test("la empresa A alcanza su equipo y no el de la empresa B", async () => {
    const alcanzado = await equipmentService.getEquipmentInScope({
      equipmentId: propio.id,
      companyId: COMPANY_ID,
      scope: ALL,
    });
    expect(alcanzado.id).toBe(propio.id);

    const error = await capturarError(
      equipmentService.getEquipmentInScope({
        equipmentId: ajeno.id,
        companyId: COMPANY_ID,
        scope: ALL,
      })
    );
    expect(error?.statusCode).toBe(404);
  });

  test("un id inexistente y uno ajeno responden exactamente lo mismo", async () => {
    // Si difirieran, probar ids diría qué equipos tienen las demás empresas.
    const ajenoError = await capturarError(
      equipmentService.getEquipmentInScope({
        equipmentId: ajeno.id,
        companyId: COMPANY_ID,
        scope: ALL,
      })
    );
    const inexistenteError = await capturarError(
      equipmentService.getEquipmentInScope({
        equipmentId: EQUIPO_INEXISTENTE,
        companyId: COMPANY_ID,
        scope: ALL,
      })
    );

    expect(ajenoError?.statusCode).toBe(404);
    expect(inexistenteError?.statusCode).toBe(404);
    expect(inexistenteError?.message).toBe(ajenoError?.message);
  });

  test("una sucursal no alcanza el equipo de otra sucursal de la misma empresa", async () => {
    const alcanceCondesa = { kind: "BRANCH" as const, branchId: BRANCH_CONDESA };

    await expect(
      equipmentService.getEquipmentInScope({
        equipmentId: propio.id,
        companyId: COMPANY_ID,
        scope: alcanceCondesa,
      })
    ).resolves.toMatchObject({ id: propio.id });

    const error = await capturarError(
      equipmentService.getEquipmentInScope({
        equipmentId: otraSucursal.id,
        companyId: COMPANY_ID,
        scope: alcanceCondesa,
      })
    );
    expect(error?.statusCode).toBe(403);
  });

  test("un alcance nulo no alcanza ni el equipo propio", async () => {
    const error = await capturarError(
      equipmentService.getEquipmentInScope({
        equipmentId: propio.id,
        companyId: COMPANY_ID,
        scope: NONE,
      })
    );
    expect(error?.statusCode).toBe(403);
  });
});

test.describe("T03 · el servicio · escrituras y recursos por ID", () => {
  test("editar un equipo ajeno no escribe una sola fila", async () => {
    const resultado = await equipmentService.updateEquipment(
      ajeno.id,
      COMPANY_ID,
      { name: `${E2E_TAG} secuestrado` },
      USER_SUPER_ADMIN
    );

    expect(resultado).toBeUndefined();
    expect((await leerEquipo(ajeno.id))!.name).toBe(ajeno.name);
  });

  test("dar de baja un equipo ajeno no escribe una sola fila", async () => {
    const resultado = await equipmentService.deleteEquipment(ajeno.id, COMPANY_ID, USER_SUPER_ADMIN);

    expect(resultado).toBeUndefined();
    expect((await leerEquipo(ajeno.id))!.status).toBe("ACTIVE");
  });

  test("las garantías y el historial del equipo ajeno no se listan desde la empresa A", async () => {
    // La fila existe: su dueño sí la ve. Sin esta comprobación, un `[]` podría
    // venir de que la siembra no escribió nada.
    expect(await equipmentService.getWarrantiesByEquipment(ajeno.id, COMPANY_ID)).toEqual([]);
    expect(
      await equipmentService.getWarrantiesByEquipment(ajeno.id, tenantAjeno.companyId)
    ).toHaveLength(1);

    expect(await equipmentService.getMaintenanceHistory(ajeno.id, COMPANY_ID)).toEqual([]);
    expect(
      await equipmentService.getMaintenanceHistory(ajeno.id, tenantAjeno.companyId, 10)
    ).toHaveLength(1);
  });

  test("el cierre de mantenimiento no se puede cruzar ni desatar del equipo", async () => {
    const cruzado = await capturarError(
      equipmentService.getMaintenanceInScope({
        maintenanceId: mantenimientoAjeno,
        equipmentId: ajeno.id,
        companyId: COMPANY_ID,
        scope: ALL,
      })
    );
    expect(cruzado?.statusCode).toBe(404);

    // El registro es de la empresa B y el equipo del URL es de la empresa A: no
    // se cierra colgándolo de otro equipo.
    const desatado = await capturarError(
      equipmentService.getMaintenanceInScope({
        maintenanceId: mantenimientoAjeno,
        equipmentId: propio.id,
        companyId: tenantAjeno.companyId,
        scope: ALL,
      })
    );
    expect(desatado?.statusCode).toBe(404);
  });

  test("cerrar el mantenimiento de otra empresa no cambia el registro ni el equipo", async () => {
    const resultado = await equipmentService.completeMaintenance(
      mantenimientoAjeno,
      COMPANY_ID,
      { workPerformed: `${E2E_TAG} secuestrado` },
      USER_SUPER_ADMIN
    );

    expect(resultado).toBeUndefined();
    expect(await leerEstadoMantenimiento(mantenimientoAjeno)).toBe("SCHEDULED");
    expect((await leerEquipo(ajeno.id))!.name).toBe(ajeno.name);
  });

  test("el camino válido sigue escribiendo: editar, cerrar y dar de baja lo propio", async () => {
    const editado = await equipmentService.updateEquipment(
      propio.id,
      COMPANY_ID,
      { name: `${E2E_TAG} propio editado` },
      USER_SUPER_ADMIN
    );
    expect(editado?.name).toBe(`${E2E_TAG} propio editado`);

    const detalle = await equipmentService.getEquipmentWithDetails(editado!);
    expect(detalle.id).toBe(propio.id);

    const cerrado = await equipmentService.completeMaintenance(
      mantenimientoPropio,
      COMPANY_ID,
      { workPerformed: `${E2E_TAG} cerrado` },
      USER_SUPER_ADMIN
    );
    expect(cerrado?.status).toBe("COMPLETED");
    expect((await leerEquipo(propio.id))!.status).toBe("ACTIVE");

    const baja = await equipmentService.deleteEquipment(propio.id, COMPANY_ID, USER_SUPER_ADMIN);
    expect(baja?.status).toBe("DISPOSED");
  });
});

test.describe("T03 · las rutas HTTP · sin servidor no corren, con servidor sí", () => {
  test("leer el equipo de otra empresa responde 404 y no confirma que exista", async ({
    request,
  }) => {
    const ajenoRes = await request.get(`/api/equipment/${ajeno.id}`);
    const inexistenteRes = await request.get(`/api/equipment/${EQUIPO_INEXISTENTE}`);

    expect(ajenoRes.status()).toBe(404);
    expect(inexistenteRes.status()).toBe(404);
    // Misma respuesta exacta: probar ids no revela qué equipos existen fuera.
    expect(await ajenoRes.json()).toEqual(await inexistenteRes.json());
  });

  test("editar y dar de baja por HTTP no toca el equipo de otra empresa", async ({ request }) => {
    const put = await request.put(`/api/equipment/${ajeno.id}`, {
      data: { name: `${E2E_TAG} secuestrado por HTTP` },
    });
    const del = await request.delete(`/api/equipment/${ajeno.id}`);

    expect(put.status()).toBe(404);
    expect(del.status()).toBe(404);
    expect((await leerEquipo(ajeno.id))!.name).toBe(ajeno.name);
    expect((await leerEquipo(ajeno.id))!.status).toBe("ACTIVE");
  });

  test("garantías y mantenimiento del equipo ajeno responden 404 y no escriben", async ({
    request,
  }) => {
    const garantias = await request.get(`/api/equipment/${ajeno.id}/warranty`);
    expect(garantias.status()).toBe(404);

    const mantenimiento = await request.post(`/api/equipment/${ajeno.id}/maintenance`, {
      data: {
        maintenanceType: "PREVENTIVE",
        scheduledDate: "2026-12-01T00:00:00.000Z",
        description: `${E2E_TAG} mantenimiento cruzado`,
      },
    });
    expect(mantenimiento.status()).toBe(404);

    const filas = await sql`
      SELECT COUNT(*)::int AS n FROM equipment_maintenance_history
      WHERE equipment_id = ${ajeno.id}
    `;
    // La siembra creó exactamente una; el POST rechazado no añadió ninguna.
    expect(filas[0].n).toBe(1);
  });

  test("sin sesión no hay expediente: 401 en leer, editar y borrar", async () => {
    const anonimo = await playwrightRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    });
    try {
      expect((await anonimo.get(`/api/equipment/${propio.id}`)).status()).toBe(401);
      expect((await anonimo.put(`/api/equipment/${propio.id}`, { data: {} })).status()).toBe(401);
      expect((await anonimo.delete(`/api/equipment/${propio.id}`)).status()).toBe(401);
      expect((await anonimo.get(`/api/equipment/${propio.id}/warranty`)).status()).toBe(401);
      expect(
        (await anonimo.get(`/api/equipment/${propio.id}/maintenance`)).status()
      ).toBe(401);
    } finally {
      await anonimo.dispose();
    }
  });

  test("el expediente de un equipo alcanzable se lee igual que antes", async ({ request }) => {
    // El equipo que se lee sale del listado propio: el caso correcto depende de
    // la sucursal activa de la sesión, y el listado ya la aplica (T02).
    const lista = await (await request.get("/api/equipment")).json();
    const alcanzable = lista?.data?.[0];
    test.skip(!alcanzable, "La sesión no ve ningún equipo: nada que leer por ID.");

    const res = await request.get(`/api/equipment/${alcanzable.id}`);
    expect(res.status()).toBe(200);
    expect((await res.json())?.data?.id).toBe(alcanzable.id);
  });
});