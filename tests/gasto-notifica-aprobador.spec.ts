import { test, expect } from "@playwright/test";
import {
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  COMPANY_ID,
  E2E_TAG,
  GERENTE_EMAIL,
  USER_SUPER_ADMIN,
} from "./support/constants";
import {
  deleteExpenseAuthorizationRule,
  deleteTestExpenses,
  deleteNotificationsForUser,
  findNotificationsForUser,
  findUserIdByEmail,
  seedExpenseAuthorizationRule,
} from "./support/db";
import { createOperatingExpense } from "../lib/services/expense-service";

/**
 * Auditoría A12 — la notificación de gasto pendiente no llegaba a nadie.
 *
 * `createOperatingExpense` notificaba con `userId: input.companyId`, que no es
 * un id de usuario. `getUserPreferences` no lo encontraba, registraba
 * "No preferences found" y **retornaba sin enviar nada**. Ningún aprobador se
 * enteró jamás de un gasto pendiente: la cola de autorizaciones dependía por
 * completo de que alguien recordara abrir la pantalla.
 *
 * Es un hallazgo nuevo de la auditoría, no del reporte original — se encontró al
 * leer el servicio a fondo, y explica por qué la cola parecía "olvidada".
 *
 * Corre sin servidor (llama al servicio y lee la base):
 *   pnpm exec playwright test --no-deps --project=chromium tests/gasto-notifica-aprobador.spec.ts
 */
test.describe("A12 · el gasto pendiente le llega a quien puede aprobarlo", () => {
  let gerenteId = "";
  let reglaId = "";

  test.beforeAll(async () => {
    gerenteId = await findUserIdByEmail(GERENTE_EMAIL);
  });

  test.beforeEach(async () => {
    // Con una regla que exige GERENTE, el gasto nace PENDING_APPROVAL cuando lo
    // pide alguien de menor rango, y hay un conjunto de aprobadores concreto.
    reglaId = await seedExpenseAuthorizationRule({
      companyId: COMPANY_ID,
      approverRole: "GERENTE",
      minAmountCents: 0,
      maxAmountCents: 5_000_00,
    });
    await deleteNotificationsForUser(gerenteId);
  });

  test.afterEach(async () => {
    if (reglaId) await deleteExpenseAuthorizationRule(reglaId);
    await deleteTestExpenses();
    await deleteNotificationsForUser(gerenteId);
  });

  test("el GERENTE de la sucursal recibe la notificación del gasto pendiente", async () => {
    const antes = await findNotificationsForUser(gerenteId);

    await createOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA, // la sucursal del GERENTE sembrado
      category: "SERVICIOS",
      amountCents: 1_500_00,
      description: `${E2E_TAG} gasto que debe avisar ${Date.now()}`,
      requestedBy: USER_SUPER_ADMIN,
      // Rol insuficiente para auto-aprobar: así nace PENDING_APPROVAL.
      userRole: "EMPLEADO",
    });

    const despues = await findNotificationsForUser(gerenteId);
    expect(
      despues.length,
      "nadie recibió la notificación: la cola de autorizaciones sigue sin dueño"
    ).toBeGreaterThan(antes.length);

    const aviso = despues[0];
    // El título y el mensaje los arma el despachador desde la plantilla, no el
    // servicio. Antes se reusaba la de turnos y el aviso llegaba encabezado
    // "Nueva Solicitud de Aprobación" con `{approvalType}` sin sustituir.
    expect(aviso.title).toMatch(/Gasto Pendiente/i);
    expect(aviso.message, "el mensaje no dice de qué gasto se trata").toMatch(
      /SERVICIOS/
    );
    expect(aviso.message, "quedaron marcadores sin sustituir").not.toMatch(/\{\w+\}/);
    // `?focus=`, no `?id=`: es el parámetro que la pantalla sabe resaltar.
    expect(aviso.actionUrl, "el enlace no señala cuál fila es").toContain("?focus=");
  });

  test("un GERENTE de otra sucursal no recibe el aviso", async () => {
    // Desde A4 no puede aprobarlo ni por API, así que avisarle sería ruido que
    // además invita a intentar algo que va a dar 403.
    const antes = await findNotificationsForUser(gerenteId);

    await createOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      category: "SERVICIOS",
      amountCents: 1_500_00,
      description: `${E2E_TAG} gasto de otra sucursal ${Date.now()}`,
      requestedBy: USER_SUPER_ADMIN,
      userRole: "EMPLEADO",
    });

    expect(await findNotificationsForUser(gerenteId)).toHaveLength(antes.length);
  });

  test("un gasto auto-aprobado no genera aviso de pendiente", async () => {
    // Si el rol del solicitante ya alcanza, el gasto nace APPROVED y no hay
    // nada que autorizar: avisar sería inventar una cola.
    const antes = await findNotificationsForUser(gerenteId);

    await createOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      category: "SERVICIOS",
      amountCents: 1_500_00,
      description: `${E2E_TAG} gasto auto-aprobado ${Date.now()}`,
      requestedBy: USER_SUPER_ADMIN,
      userRole: "SUPER_ADMIN",
    });

    expect(await findNotificationsForUser(gerenteId)).toHaveLength(antes.length);
  });
});
