import { test, expect, type Page } from "@playwright/test";
import { startAccountingBrowserServer } from "../support/accounting-browser-server";

let harness: Awaited<ReturnType<typeof startAccountingBrowserServer>>;
test.beforeAll(async () => { harness = await startAccountingBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
const branchId = "20000000-0000-4000-8000-000000000001";
const row = (cents = 10000) => ({ cents, source: "MEASURED", coveragePercent: 100, percentOfSales: 10, note: "Dato sintético" });
const branch = { branchId, branchName: "Centro", sales: row(116000), foodCost: row(), waste: row(), labor: row(),
  operatingExpenses: row(), commissions: row(), pettyCash: row(), operatingProfit: row(), weakestLine: "MEASURED" };

async function prepare(page: Page, options: { denied?: boolean; failOnce?: boolean; empty?: boolean } = {}) {
  const queries: URLSearchParams[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let failed = false;
  await page.route("**/api/finance/pnl**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/finance/pnl") return route.fulfill({ json: { success: true, data: {
      branches: [branch], meta: { period: { startDate: url.searchParams.get("startDate"), endDate: url.searchParams.get("endDate"), days: 31 } },
    } } });
    queries.push(url.searchParams);
    if (options.denied) return route.fulfill({ status: 403, json: { success: false, error: "No tienes acceso a esta sucursal." } });
    if (options.failOnce && !failed) { failed = true; return route.fulfill({ status: 409, json: { success: false, error: "Los datos cambiaron. Vuelve a consultar el detalle." } }); }
    const line = url.searchParams.get("line")!;
    const period = { startDate: url.searchParams.get("startDate"), endDate: url.searchParams.get("endDate"), days: 31 };
    const pageNumber = Number(url.searchParams.get("page"));
    const derived = ["labor", "commissions", "operatingProfit"].includes(line);
    const items = options.empty || derived ? [] : [{ id: `synthetic-${pageNumber}`, date: "2026-10-15", label: "Movimiento sintético",
      cents: pageNumber === 1 ? 8000 : 2000, status: "APPROVED", costCenter: null }];
    return route.fulfill({ json: { success: true, data: { branchId, line, period, page: pageNumber, pageSize: 25,
      totalCount: options.empty || derived ? 0 : 26, totalCents: options.empty ? 0 : 10000,
      hasMore: !options.empty && !derived && pageNumber === 1, source: options.empty ? "NO_DATA" : "MEASURED", coveragePercent: options.empty ? 0 : 100,
      items, ...(derived ? { basis: "CALCULATION", calculation: { kind: "PROFIT_BRIDGE", cents: 10000,
        note: "Cálculo sintético", components: [{ key: "salesBase", label: "Venta base", cents: 12000, source: "MEASURED" },
          { key: "cost", label: "Costo", cents: -2000, source: "MEASURED" }] } } : {}),
    } } });
  });
  await page.goto(harness.url);
  return { queries, errors };
}

test("opens with keyboard, preserves filters through pages, and restores focus", async ({ page }) => {
  const { queries, errors } = await prepare(page);
  const trigger = page.getByRole("button", { name: "Ver detalle de gastos operativos de Centro" });
  await trigger.focus(); await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "Gastos operativos · Centro" });
  await expect(panel.getByRole("heading", { level: 3 })).toBeFocused();
  await expect(panel.getByText("26 movimientos · Página 1 de 2")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Abrir gasto y evidencia autorizada" })).toHaveAttribute("href", /focus=synthetic-1/);
  await panel.getByRole("button", { name: "Siguiente detalle" }).click();
  await expect(panel.getByText("26 movimientos · Página 2 de 2")).toBeVisible();
  expect(queries.map(query => [query.get("branchId"), query.get("startDate"), query.get("endDate"), query.get("page")]))
    .toEqual([[branchId, "2026-10-01", "2026-10-31", "1"], [branchId, "2026-10-01", "2026-10-31", "2"]]);
  await panel.getByRole("button", { name: "Cerrar detalle" }).click(); await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test("retry keeps filters and switching line resets pagination", async ({ page }) => {
  const { queries } = await prepare(page, { failOnce: true });
  await page.getByRole("button", { name: "Ver detalle de ventas de Centro" }).click();
  await expect(page.getByRole("alert")).toContainText("Los datos cambiaron");
  await page.getByRole("button", { name: "Reintentar detalle" }).click();
  await expect(page.getByRole("navigation", { name: "Páginas del detalle" })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente detalle" }).click();
  await page.getByLabel("Renglón", { exact: true }).selectOption("operatingProfit");
  await expect(page.getByRole("heading", { name: "Cómo se calcula" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Venta base" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Movimientos del periodo" })).toHaveCount(0);
  expect(queries.at(-1)?.get("page")).toBe("1");
  expect(queries[0].toString()).toBe(queries[1].toString());
});

test("denied reads reveal no previous data; empty detail is not measured zero", async ({ page }) => {
  await prepare(page, { denied: true });
  await page.getByRole("button", { name: "Ver detalle de ventas de Centro" }).click();
  await expect(page.getByRole("alert")).toContainText("No tienes acceso");
  await expect(page.getByText("Total del periodo", { exact: true })).toHaveCount(0);
  await page.unrouteAll(); await prepare(page, { empty: true });
  await page.getByRole("button", { name: "Ver detalle de ventas de Centro" }).click();
  await expect(page.getByText("No hay movimientos para este renglón en el periodo.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Ventas · Centro" }).getByText("Sin datos", { exact: true })).toHaveCount(2);
});

test("period changes close stale detail and mobile panel stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await prepare(page);
  await page.getByRole("button", { name: "Ver detalle de ventas de Centro" }).click();
  const panel = page.getByRole("region", { name: "Ventas · Centro" });
  await expect(panel.getByText("Total del periodo", { exact: true })).toBeVisible();
  const box = await panel.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const control of await panel.locator('button, select, a').all()) {
      const rect = await control.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    }
    if (width === 320 || width === 1440) await page.screenshot({ path: `.tmp/fc04-${width === 320 ? "mobile" : "desktop"}-confirmed.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Periodo noviembre (prueba)" }).click();
  await expect(panel).toHaveCount(0);
});

test("a newly denied line clears the previously displayed amounts", async ({ page }) => {
  const options = { denied: false };
  await prepare(page, options);
  await page.getByRole("button", { name: "Ver detalle de ventas de Centro" }).click();
  await expect(page.getByText("Total del periodo", { exact: true })).toBeVisible();
  options.denied = true;
  await page.getByLabel("Renglón", { exact: true }).selectOption("labor");
  await expect(page.getByRole("alert")).toContainText("No tienes acceso");
  await expect(page.getByText("Total del periodo", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Movimientos del periodo" })).toHaveCount(0);
});

test.describe("touch viewport", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 800 } });
  test("touch activates sales and a right-hand figure without sticky overlap", async ({ page }) => {
    await prepare(page);
    const table = page.locator('[data-slot="table-container"]');
    await table.hover(); await page.mouse.wheel(120, 0);
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    for (const name of ["Ver detalle de ventas de Centro", "Ver detalle de gastos operativos de Centro"]) {
      const trigger = page.getByRole("button", { name });
      await trigger.scrollIntoViewIfNeeded();
      expect(await trigger.evaluate(button => {
        const box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await trigger.tap({ timeout: 8000 });
      await expect(page.getByText("Total del periodo", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cerrar detalle" }).tap();
      await expect(trigger).toBeFocused();
    }
  });
});
