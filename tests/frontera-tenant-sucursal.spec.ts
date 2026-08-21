import { test, expect } from "@playwright/test";
import { COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import {
  cleanupForeignTenant,
  deleteTestBranch,
  deleteTestCuts,
  findLatestCut,
  findPettyCashFund,
  seedForeignTenant,
  seedTestBranch,
} from "./support/db";
import {
  openFund,
  registerOutflow,
  replenishFund,
} from "../lib/services/petty-cash-service";

/**
 * Auditoría A3 — una sucursal que no es de la empresa no se puede escribir.
 *
 * `companyId` siempre sale de la sesión, pero `branchId` llega del cuerpo de la
 * petición y nadie comprobaba que ese par existiera junto. Un `branchId` de otro
 * tenant se insertaba tal cual: el fondo de caja chica quedaba con el
 * `company_id` de quien escribió y el `branch_id` de la empresa ajena, y el
 * corte de ventas igual. La llave foránea no lo impide —la sucursal existe, solo
 * que no es tuya— así que el dato quedaba cruzado entre empresas.
 *
 * `assertBranchOfCompany` sigue el patrón de `getPayeeForCompany`
 * (`expense-service.ts:61`): rechaza sin distinguir "no es tuya" de "no existe",
 * para no confirmarle a nadie qué sucursales tienen las demás empresas.
 *
 * Los casos de servicio corren en segundos y sin servidor:
 *   pnpm exec playwright test --no-deps --project=chromium tests/frontera-tenant-sucursal.spec.ts
 * Los que pegan a `/api/sales/cuts` y al `GET` de caja chica necesitan el
 * servidor levantado, porque ahí la guarda vive en la ruta: ventas no tiene
 * servicio y el `GET` no debe volverse una escritura para validarse.
 */

/** Un UUID bien formado que no es de ninguna sucursal. */
const SUCURSAL_INEXISTENTE = "b9999999-0000-4000-8000-999999999999";

/** Fecha de negocio propia de este spec, para no chocar con datos sembrados. */
const FECHA = "2019-03-07";

let ajeno: Awaited<ReturnType<typeof seedForeignTenant>>;
let sucursalPropia = "";

test.describe("A3 · la sucursal de una escritura pertenece al tenant", () => {
  test.beforeEach(async () => {
    ajeno = await seedForeignTenant();
    sucursalPropia = await seedTestBranch(COMPANY_ID, "frontera");
  });

  test.afterEach(async () => {
    await deleteTestCuts(ajeno.branchId, FECHA);
    await deleteTestCuts(sucursalPropia, FECHA);
    if (sucursalPropia) await deleteTestBranch(sucursalPropia);
    sucursalPropia = "";
    await cleanupForeignTenant(ajeno);
  });

  // ── Caja chica: la guarda vive en el servicio (AD-A2) ─────────────────────

  test("abrir un fondo sobre la sucursal de otra empresa se rechaza y no escribe nada", async () => {
    await expect(
      openFund({
        companyId: COMPANY_ID,
        branchId: ajeno.branchId,
        fundAmountCents: 250_000,
        openedBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/sucursal .*no existe para esta empresa/i);

    // Ni bajo el tenant que escribió ni bajo el dueño real de la sucursal.
    expect(await findPettyCashFund(COMPANY_ID, ajeno.branchId)).toBeNull();
    expect(await findPettyCashFund(ajeno.companyId, ajeno.branchId)).toBeNull();
  });

  test("abrir un fondo sobre una sucursal inexistente se rechaza antes de la llave foránea", async () => {
    // El error tiene que ser el nuestro, legible, no el 23503 de Postgres
    // burbujeando como 500.
    await expect(
      openFund({
        companyId: COMPANY_ID,
        branchId: SUCURSAL_INEXISTENTE,
        fundAmountCents: 250_000,
        openedBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/sucursal .*no existe para esta empresa/i);

    expect(await findPettyCashFund(COMPANY_ID, SUCURSAL_INEXISTENTE)).toBeNull();
  });

  test("un retiro sobre una sucursal ajena falla por la sucursal, no por el fondo", async () => {
    // Sin la guarda esto ya fallaba, pero con "no tiene un fondo abierto": un
    // mensaje que invita a abrirle fondo a la sucursal de otra empresa.
    await expect(
      registerOutflow({
        companyId: COMPANY_ID,
        branchId: ajeno.branchId,
        amountCents: 10_000,
        concept: "[E2E] retiro cruzado",
        registeredBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/sucursal .*no existe para esta empresa/i);
  });

  test("una reposición sobre una sucursal ajena falla por la sucursal", async () => {
    await expect(
      replenishFund({
        companyId: COMPANY_ID,
        branchId: ajeno.branchId,
        amountCents: 10_000,
        registeredBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/sucursal .*no existe para esta empresa/i);
  });

  test("la escritura válida no cambia: el fondo de una sucursal propia se abre igual", async () => {
    const fondo = await openFund({
      companyId: COMPANY_ID,
      branchId: sucursalPropia,
      fundAmountCents: 82_500,
      openedBy: USER_SUPER_ADMIN,
    });

    expect(fondo.branchId).toBe(sucursalPropia);
    expect((await findPettyCashFund(COMPANY_ID, sucursalPropia))!.fundAmount).toBe(82_500);
  });

  // ── Ventas y el GET: la guarda vive en la ruta ────────────────────────────

  test("un corte sobre la sucursal de otra empresa se rechaza con 400 y no queda fila", async ({
    request,
  }) => {
    const res = await request.post("/api/sales/cuts", {
      data: {
        branchId: ajeno.branchId,
        businessDate: FECHA,
        shift: "COMPLETO",
        channel: "TOTAL",
        totalSales: 500_00,
      },
    });

    expect(res.status()).toBe(400);
    expect(await findLatestCut(ajeno.branchId, FECHA)).toBeNull();
  });

  test("un corte sobre una sucursal inexistente se rechaza con 400, no con un 500 de Postgres", async ({
    request,
  }) => {
    const res = await request.post("/api/sales/cuts", {
      data: {
        branchId: SUCURSAL_INEXISTENTE,
        businessDate: FECHA,
        shift: "COMPLETO",
        channel: "TOTAL",
        totalSales: 500_00,
      },
    });

    expect(res.status()).toBe(400);
  });

  test("el corte de una sucursal propia sigue guardándose", async ({ request }) => {
    const res = await request.post("/api/sales/cuts", {
      data: {
        branchId: sucursalPropia,
        businessDate: FECHA,
        shift: "COMPLETO",
        channel: "TOTAL",
        totalSales: 500_00,
      },
    });

    expect(res.ok(), await res.text()).toBe(true);
    expect(await findLatestCut(sucursalPropia, FECHA)).not.toBeNull();
  });

  test("leer la caja chica de una sucursal ajena se rechaza en vez de responder 'sin fondo'", async ({
    request,
  }) => {
    const res = await request.get(`/api/petty-cash?branchId=${ajeno.branchId}`);

    expect(res.status()).toBe(400);
    // Y la lectura sigue sin escribir: A1 no se deshace al añadir la guarda.
    expect(await findPettyCashFund(COMPANY_ID, ajeno.branchId)).toBeNull();
  });
});
