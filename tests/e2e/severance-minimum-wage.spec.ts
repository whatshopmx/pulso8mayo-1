import { test, expect, type Page } from "@playwright/test";
import { startSeveranceBrowserServer } from "../support/severance-browser-server";
import path from "node:path";

let harness: Awaited<ReturnType<typeof startSeveranceBrowserServer>>;
test.beforeAll(async () => { harness = await startSeveranceBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

async function openCalculator(page: Page, employee = {}) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/employees") return route.fulfill({ json: { data: [
      { id: "emp-test", userName: "Empleado prueba", userEmail: "empleado@example.test",
        contractBaseSalary: 100_000, hireDate: "2024-01-01", ...employee },
    ] } });
    if (url.pathname === "/api/branches") return route.fulfill({ json: { data: [{ id: "branch-test", name: "Sucursal prueba" }] } });
    // Ninguna solicitud de escritura llega a un backend real.
    return route.fulfill({ status: 409, json: { error: "Escritura simulada" } });
  });
  await page.goto(harness.url);
  await page.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: "Empleado prueba" }).click();
  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: /Despido Injustificado/ }).click();
  await page.locator('input[type="date"]').nth(1).fill("2026-01-01");
  return errors;
}

test("exige zona, aplica mínimo por fecha y bloquea un año desconocido sin conservar total anterior", async ({ page }) => {
  const errors = await openCalculator(page);
  const save = page.getByRole("button", { name: "Finalizar y Guardar Baja" });
  await expect(page.getByRole("alert")).toContainText("zona salarial");
  await expect(save).toBeDisabled();
  await page.getByLabel("Zona salarial del lugar de trabajo").selectOption("GENERAL");
  await expect(page.getByTestId("seniority-amount")).toHaveText("$15,121.92");
  await expect(page.getByText("01 ene 2024", { exact: true })).toBeVisible();
  await expect(page.getByText("01 ene 2026", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fuente CONASAMI" })).toHaveAttribute("href", /5775534$/);
  await expect(save).toBeEnabled();
  await page.getByLabel("Zona salarial del lugar de trabajo").selectOption("ZLFN");
  await expect(page.getByTestId("seniority-amount")).toHaveText("$21,161.76");
  await page.locator('input[type="date"]').nth(1).fill("2025-12-31");
  await expect(page.getByRole("link", { name: "Fuente CONASAMI" })).toHaveAttribute("href", /5745678$/);
  await page.locator('input[type="date"]').nth(1).fill("2027-01-01");
  await expect(page.getByRole("alert")).toContainText("No hay salario mínimo publicado");
  await expect(page.getByText("Total Estimado", { exact: true })).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(errors).toEqual([]);
});

test("muestra el gap efectivo y no genera importes cuando falta salario", async ({ page }) => {
  await openCalculator(page, { contractBaseSalary: 31_504, effectiveSalaryCents: 100_000 });
  await page.getByLabel("Zona salarial del lugar de trabajo").selectOption("GENERAL");
  await expect(page.getByTestId("seniority-amount")).toHaveText("$15,121.92");
  await expect(page.getByText("Base real:", { exact: false })).toBeVisible();
  await openCalculator(page, { contractBaseSalary: null });
  await page.getByLabel("Zona salarial del lugar de trabajo").selectOption("GENERAL");
  await expect(page.getByRole("alert")).toContainText("salario diario");
  await expect(page.getByRole("button", { name: "Finalizar y Guardar Baja" })).toBeDisabled();
});

test("selector por teclado y bloqueo visibles en escritorio y móvil", async ({ page }) => {
  const errors = await openCalculator(page);
  const zone = page.getByLabel("Zona salarial del lugar de trabajo");
  await zone.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(zone).toHaveValue("GENERAL");
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(zone).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.resolve(`tasks/evidencia/consolidado-2026-10-22/FIS-03/screen-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
