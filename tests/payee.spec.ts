import { test, expect } from "@playwright/test";
import { E2E_TAG } from "./support/constants";
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
    const apiRow = expJson.data.find((e: any) => e.id === gasto.id);
    expect(apiRow).toBeTruthy();
    expect(apiRow.payeeId).toBe(payee.id);
    expect(apiRow.payeeName).toBe(nombrePayee);

    // La tabla de gastos muestra la contraparte en su columna. El gasto se
    // creó en la sucursal elegida en el form; el encabezado estaba scoped a
    // la sucursal de la sesión, así que se cambia a "Todas" para ver la fila.
    await page.getByRole("button", { name: /Sucursal:/ }).click();
    await page.getByRole("menuitem", { name: "Todas" }).click();
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