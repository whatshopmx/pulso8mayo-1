import { test, expect } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * B2 — al seleccionar la categoría aparece el conteo inline.
 *
 * Monta el componente real con `fetch` interceptado (sin Next, sesión ni
 * Postgres). Verifica que el formulario de la categoría lista los productos con
 * su lote y vencimiento, y que lo capturado viaja al crear el conteo.
 */

const ROWS = [
  { itemId: "i1", batchId: "b1", name: "Tomate", sku: "TOM", unit: "KG", lotNumber: "LOTE-A", expirationDate: "2026-10-20", systemQuantity: 2.2 },
  { itemId: "i1", batchId: "b2", name: "Tomate", sku: "TOM", unit: "KG", lotNumber: "LOTE-B", expirationDate: "2026-11-01", systemQuantity: 3 },
];

const PROPS = {
  branches: [{ id: "b1", name: "Sucursal Centro" }],
  scopedBranch: { id: "b1", name: "Sucursal Centro" },
  categories: [{ value: "Verduras", label: "Verduras", count: 2 }],
  hasHighValueItems: false,
  blindCount: false,
};

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test.describe("B2 — conteo inline por categoría (V2 aislada)", () => {
  test("seleccionar la categoría muestra sus productos, lotes y vencimientos", async ({ page }) => {
    await page.addInitScript((props) => { (window as unknown as { __stockCountPrueba: unknown }).__stockCountPrueba = props; }, PROPS);
    await page.route("**/api/inventory/stock-count/rows**", (route) => route.fulfill({ status: 200, json: { rows: ROWS } }));

    await page.goto(`${harness.url}/stock-count`);

    // Antes de seleccionar, el formulario no está.
    await expect(page.getByText("LOTE-A")).toHaveCount(0);

    await page.getByRole("checkbox", { name: /Verduras/ }).check();

    await expect(page.getByText("Conteo · Verduras")).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /LOTE-A/ })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /LOTE-B/ })).toBeVisible();
    await expect(page.getByText("Vence 2026-10-20").last()).toBeVisible();
    await expect(page.getByText("Sistema: 2.2 KG")).toBeVisible();
    await expect(page.locator("[data-count-input]")).toHaveCount(2);
  });

  test("lo capturado antes de iniciar viaja como captura previa validada", async ({ page }) => {
    let postBody: { initialValues?: Record<string, string> } | null = null;

    await page.addInitScript((props) => { (window as unknown as { __stockCountPrueba: unknown }).__stockCountPrueba = props; }, PROPS);
    await page.route("**/api/inventory/stock-count/rows**", (route) => route.fulfill({ status: 200, json: { rows: ROWS } }));
    await page.route("**/api/inventory/stock-count", async (route) => {
      postBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, json: { instance: { id: "inst-1" } } });
    });

    await page.goto(`${harness.url}/stock-count`);
    await page.getByRole("checkbox", { name: /Verduras/ }).check();
    await page.getByRole("spinbutton", { name: /LOTE-A/ }).fill("2.5");
    await page.getByRole("button", { name: /Iniciar Conteo/ }).click();

    await expect.poll(() => postBody !== null).toBe(true);
    const value = JSON.parse(postBody!.initialValues!.Verduras);
    expect(value.kind).toBe("stock_count");
    expect(value.rows[0]).toMatchObject({ batchId: "b1" });
    // El cliente envía la cantidad como texto del input; el servidor la
    // normaliza a número (cubierto en B1).
    expect(Number(value.rows[0].countedQuantity)).toBe(2.5);
  });
});
