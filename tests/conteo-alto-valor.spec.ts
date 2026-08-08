import { test, expect, type Page } from "@playwright/test";
import { BRANCH_ROMA, COMPANY_ID } from "./support/constants";
import {
  countItemsInCategory,
  createTestSkus,
  deleteActiveCounts,
  deleteTestSkus,
  getInstanceData,
} from "./support/db";

/**
 * Fase 4 — Conteo semanal dirigido a SKUs de alto valor.
 *
 * Escenario del plan: el conteo arranca filtrado por alto valor y el toggle
 * "ver todos" (desmarcar la casilla) amplía el universo a toda la categoría.
 */

const CATEGORIA = "Otro";

/** Arranca un conteo desde la UI y devuelve el ID de la instancia creada. */
async function iniciarConteo(page: Page, opts: { soloAltoValor: boolean }) {
  await deleteActiveCounts(BRANCH_ROMA);

  await page.goto("/dashboard/inventory/stock-count");

  await page.locator("#branchId").selectOption(BRANCH_ROMA);
  await page.locator("#category").selectOption(CATEGORIA);

  const casilla = page.locator("#highValueOnly");
  await expect(casilla).toBeChecked(); // por defecto: solo alto valor
  if (!opts.soloAltoValor) {
    await casilla.uncheck();
  }

  await page.getByRole("button", { name: /Iniciar Conteo/i }).click();
  await page.waitForURL(/\/dashboard\/workflows\/[0-9a-f-]+\/execute/, { timeout: 30_000 });

  const match = page.url().match(/workflows\/([0-9a-f-]+)\/execute/);
  expect(match).not.toBeNull();
  return match![1];
}

test.describe("Fase 4 · conteo filtrado por SKUs de alto valor", () => {
  test.beforeAll(async () => {
    await deleteTestSkus();
    // 3 de alto valor + 5 normales, todos en la misma categoría.
    await createTestSkus(COMPANY_ID, 3, { isHighValue: true, category: CATEGORIA });
    await createTestSkus(COMPANY_ID, 5, { isHighValue: false, category: CATEGORIA });
  });

  test.afterAll(async () => {
    await deleteActiveCounts(BRANCH_ROMA);
    await deleteTestSkus();
  });

  test("por defecto cuenta solo los SKUs de alto valor", async ({ page }) => {
    const esperados = await countItemsInCategory(COMPANY_ID, CATEGORIA, true);
    expect(esperados).toBeGreaterThan(0);

    const instanceId = await iniciarConteo(page, { soloAltoValor: true });

    const instancia = await getInstanceData(instanceId);
    expect(instancia).not.toBeNull();
    expect(instancia.data.highValueOnly).toBe(true);
    expect(instancia.data.productCount).toBe(esperados);
  });

  test('el toggle "ver todos" amplía el conteo a toda la categoría', async ({ page }) => {
    const soloAlto = await countItemsInCategory(COMPANY_ID, CATEGORIA, true);
    const todos = await countItemsInCategory(COMPANY_ID, CATEGORIA, false);
    expect(todos).toBeGreaterThan(soloAlto);

    const instanceId = await iniciarConteo(page, { soloAltoValor: false });

    const instancia = await getInstanceData(instanceId);
    expect(instancia).not.toBeNull();
    expect(instancia.data.highValueOnly).toBe(false);
    expect(instancia.data.productCount).toBe(todos);
  });
});
