import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  E2E_TAG,
  EMPLEADO_EMAIL,
  GERENTE_EMAIL,
} from "./support/constants";
import {
  deleteTestExpenses,
  deleteTestPayees,
  findExpenseByDescription,
  findPayeeByName,
} from "./support/db";

/**
 * Fase 1 — Contrapartes (payees) para gastos operativos.
 *
 * Escenario del plan (`tasks/plan-payees-contrapartes.md`): el gasto deja de
 * decir solo "RENTA" y empieza a decir a QUIÉN se le paga ("Inmobiliaria X");
 * la CxP agrupa por contraparte real en vez de por categoría, y el gasto
 * casual sigue agrupándose por categoría sin forzar el catálogo.
 *
 * El payee se crea AL VUELO desde el propio form de gasto — eso ejercita la
 * creación rápida (Task 5) y deja la contraparte seleccionada.
 */

test.describe("Fase 1 · contrapartes (payees)", () => {
  test.afterAll(async () => {
    // Los gastos primero (FK operating_expenses.payee_id → payees.id).
    await deleteTestExpenses();
    await deleteTestPayees();
  });

  test("crea contraparte al vuelo, registra gasto con payee y CxP agrupa por contraparte", async ({ page }) => {
    const nombrePayee = `${E2E_TAG} Inmobiliaria Condesa ${Date.now()}`;
    const descripcion = `${E2E_TAG} Renta bimestre ${Date.now()}`;

    await page.goto("/dashboard/finance/expenses");

    await page.getByRole("button", { name: /Nuevo Gasto Operativo/i }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();

    // Sucursal (Radix Select: abrir y escoger la primera opción real).
    await dialogo.locator("#expense-branch").click();
    await page.getByRole("option").first().click();

    // Categoría RENTA es el default; no hace falta tocarla.

    // "A quién le pagas": crear la contraparte al vuelo.
    await dialogo.getByRole("button", { name: /Nueva/i }).click();
    await dialogo.locator("#quick-payee-name").fill(nombrePayee);
    await dialogo.getByRole("button", { name: /Crear y seleccionar/i }).click();

    // La contraparte creada quedó seleccionada: el trigger del Select la muestra.
    await expect(dialogo.locator("#expense-payee")).toContainText(nombrePayee);

    await dialogo.locator("#expense-amount").fill("45000.00");
    await dialogo.locator("#expense-desc").fill(descripcion);

    await dialogo.getByRole("button", { name: /Guardar Gasto/i }).click();
    // El form solo se cierra cuando la API respondió OK.
    await expect(dialogo).toBeHidden({ timeout: 30_000 });

    // Persistencia: payee creado y gasto ligado a él.
    const payee = await findPayeeByName(nombrePayee);
    expect(payee).not.toBeNull();
    expect(payee.active).toBe(true);

    const gasto = await findExpenseByDescription(descripcion);
    expect(gasto).not.toBeNull();
    expect(gasto.payee_id).toBe(payee.id);

    // El GET de gastos devuelve el nombre de la contraparte junto al gasto.
    const getExp = await page.request.get("/api/expenses");
    const expJson = await getExp.json();
    const apiRow = expJson.data.items.find((e: any) => e.id === gasto.id);
    expect(apiRow).toBeTruthy();
    expect(apiRow.payeeId).toBe(payee.id);
    expect(apiRow.payeeName).toBe(nombrePayee);

    // La tabla de gastos muestra la contraparte en su columna. El gasto se
    // creó en la sucursal elegida en el form; el encabezado estaba scoped a
    // la sucursal de la sesión, así que se cambia a "Todas" para ver la fila.
    await page.getByRole("button", { name: /Sucursal:/ }).click();
    await page.getByRole("menuitem", { name: "Todas" }).click();

    // Y también el estatus: la pantalla abre en la cola de pendientes y este
    // spec no depende de en qué estatus nazca el gasto — con A16 nace pendiente,
    // antes nacía auto-aprobado. "Todos los estatus" lo encuentra en los dos
    // casos, que es lo que aquí importa: la columna de Contraparte.
    await page.getByLabel("Filtrar por estatus").click();
    await page.getByRole("option", { name: "Todos los estatus" }).click();

    await expect(page.getByRole("columnheader", { name: "Contraparte" })).toBeVisible();
    await expect(page.getByRole("cell", { name: nombrePayee })).toBeVisible();

    // CxP (por API, misma sesión): el gasto entra como partida con la
    // contraparte real y el agregado agrupa bajo el payee, no bajo "RENTA".
    const res = await page.request.get("/api/finance/payables");
    const json = await res.json();
    expect(json.success).toBe(true);

    const item = json.data.items.find((i: any) => i.id === gasto.id);
    expect(item).toBeTruthy();
    expect(item.counterparty).toBe(nombrePayee);
    expect(item.payeeId).toBe(payee.id);

    const total = json.data.byCounterparty.find((r: any) => r.payeeId === payee.id);
    expect(total).toBeTruthy();
    expect(total.name).toBe(nombrePayee);
    expect(total.totalCents).toBe(4_500_000);
    expect(total.count).toBe(1);
  });

  test("gasto casual sin contraparte sigue agrupándose por categoría", async ({ page }) => {
    const descripcion = `${E2E_TAG} Hielo para barra ${Date.now()}`;

    await page.goto("/dashboard/finance/expenses");

    await page.getByRole("button", { name: /Nuevo Gasto Operativo/i }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();

    await dialogo.locator("#expense-branch").click();
    await page.getByRole("option").first().click();

    await dialogo.locator("#expense-cat").click();
    await page.getByRole("option", { name: /Otros Gastos/i }).click();

    // No se toca el select "A quién le pagas": el campo es opcional.
    await dialogo.locator("#expense-amount").fill("250.00");
    await dialogo.locator("#expense-desc").fill(descripcion);

    await dialogo.getByRole("button", { name: /Guardar Gasto/i }).click();
    await expect(dialogo).toBeHidden({ timeout: 30_000 });

    const gasto = await findExpenseByDescription(descripcion);
    expect(gasto).not.toBeNull();
    expect(gasto.payee_id).toBeNull();

    // La CxP sigue agrupando el gasto casual por categoría (comportamiento
    // anterior): el item no tiene payee y su contraparte es la categoría.
    const res = await page.request.get("/api/finance/payables");
    const json = await res.json();
    expect(json.success).toBe(true);

    const item = json.data.items.find((i: any) => i.id === gasto.id);
    expect(item).toBeTruthy();
    expect(item.payeeId).toBeNull();
    expect(item.counterparty).toBe("OTROS");
    expect(item.supplierId).toBeNull();
  });

  test("el catálogo crea una contraparte y da de baja sin tocar gastos históricos", async ({ page }) => {
    const nombrePayee = `${E2E_TAG} Inmobiliaria Polanco ${Date.now()}`;

    await page.goto("/dashboard/finance/payees");
    await page.getByRole("button", { name: /Nueva Contraparte/i }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();

    await dialogo.locator("#payee-name").fill(nombrePayee);
    await dialogo.locator("#payee-taxid").fill("CUE120101AA1");
    await dialogo.getByRole("button", { name: /Crear Contraparte/i }).click();
    await expect(dialogo).toBeHidden({ timeout: 30_000 });

    const payee = await findPayeeByName(nombrePayee);
    expect(payee).not.toBeNull();
    expect(payee.active).toBe(true);

    // La fila aparece en el catálogo.
    const fila = page.locator("tbody tr").filter({ hasText: nombrePayee }).first();
    await expect(fila).toBeVisible();

    // Dar de baja con confirmación.
    await fila.getByRole("button", { name: /Dar de baja/i }).click();
    const confirmacion = page.getByRole("alertdialog");
    await expect(confirmacion).toBeVisible();
    await confirmacion.getByRole("button", { name: /Sí, dar de baja/i }).click();
    await expect(confirmacion).toBeHidden({ timeout: 30_000 });

    const trasBaja = await findPayeeByName(nombrePayee);
    expect(trasBaja.active).toBe(false);
  });
});
/**
 * Auditoría A13 — las contrapartes exigen rol, no sólo sesión.
 *
 * `/api/finance/payees` y su `[id]` eran de las últimas rutas del módulo en
 * `lib/tenant-context.ts` con `requireTenant`/`requireAuth` a secas: autentican,
 * pero no miran el rol. La pantalla `/dashboard/finance/payees` sí estaba
 * cerrada, así que la fuga era la misma que A2 encontró en Ventas — un `fetch`
 * desde la consola no pasa por el camino del navegador.
 *
 * Un EMPLEADO podía dar de alta **a quién se le paga** y dar de baja
 * contrapartes existentes, además de leerse el catálogo completo de proveedores
 * de la empresa.
 */
test.describe("A13 · contrapartes exigen rol de finanzas", () => {
  const estados = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

  test.beforeAll(async ({ browser }) => {
    // Una sesión por rol y reintento sobre 429: better-auth limita
    // `/sign-in/email` a 3 intentos cada 10 s, y sólo en modo producción — que
    // es como se verifica esto. Mismo patrón que `ventas-rbac`.
    for (const email of [EMPLEADO_EMAIL, GERENTE_EMAIL]) {
      const contexto = await browser.newContext({ storageState: undefined });
      try {
        let login = await contexto.request.post("/api/auth/sign-in/email", {
          data: { email, password: ADMIN_PASSWORD },
        });
        for (let intento = 0; intento < 3 && login.status() === 429; intento++) {
          await new Promise((r) => setTimeout(r, 11_000));
          login = await contexto.request.post("/api/auth/sign-in/email", {
            data: { email, password: ADMIN_PASSWORD },
          });
        }
        expect(login.ok(), `no se pudo iniciar sesión como ${email} (HTTP ${login.status()})`).toBe(
          true
        );
        estados.set(email, await contexto.storageState());
      } finally {
        await contexto.close();
      }
    }
  });

  async function sesionDe(browser: Browser, email: string) {
    return await browser.newContext({ storageState: estados.get(email) });
  }

  test("un EMPLEADO no da de alta una contraparte", async ({ browser }) => {
    const ctx = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await ctx.request.post("/api/finance/payees", {
        data: { name: `${E2E_TAG} contraparte no autorizada` },
      });
      expect(res.status(), "un EMPLEADO dio de alta un beneficiario de pago").toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test("un EMPLEADO tampoco lee el catálogo de contrapartes", async ({ browser }) => {
    const ctx = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await ctx.request.get("/api/finance/payees");
      expect(res.status(), "la API le entregó el catálogo de proveedores a un EMPLEADO").toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test("un EMPLEADO no da de baja una contraparte", async ({ browser }) => {
    const ctx = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      // El id no importa: el rol se revisa antes de mirar el cuerpo.
      const res = await ctx.request.delete(
        "/api/finance/payees/b9999999-0000-4000-8000-999999999999"
      );
      expect(res.status()).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test("un GERENTE conserva el acceso a las contrapartes", async ({ browser }) => {
    // El otro lado del cambio: cerrar de más deja sin trabajar a quien registra
    // los gastos de su sucursal.
    const ctx = await sesionDe(browser, GERENTE_EMAIL);
    try {
      expect((await ctx.request.get("/api/finance/payees")).status()).toBe(200);
    } finally {
      await ctx.close();
    }
  });
});
