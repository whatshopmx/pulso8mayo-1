import { test, expect } from "@playwright/test";

test("sidebar muestra sección Control y la lista de OS renderiza datos reales", async ({ page }) => {
  // Login
  await page.goto("http://localhost:3000/sign-in");
  await page.fill('input[name="email"], input[type="email"]', "maria@pulso.mx");
  await page.fill('input[name="password"], input[type="password"]', "123456");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });

  // Sidebar contiene la sección Control y el ítem Órdenes de Servicio
  await expect(page.getByText("Órdenes de Servicio", { exact: true }).first()).toBeVisible({ timeout: 15000 });

  // Navegar a la lista
  await page.goto("http://localhost:3000/dashboard/service-orders");
  await expect(page.getByRole("heading", { name: "Órdenes de Servicio" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("OS-CDMX01-2026-0001")).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "scratch/ui-lista-os.png", fullPage: true });

  // Detalle de la orden cerrada (timeline + conformidad)
  await page.goto("http://localhost:3000/dashboard/service-orders/b6bcfe38-c303-405b-bb73-3cd9b2a4f6da");
  await expect(page.getByText("OS-CDMX01-2026-0001").first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Autorización")).toBeVisible();
  await expect(page.getByText("Firmada por María García").or(page.getByText("María García"))).toBeVisible();
  await page.screenshot({ path: "scratch/ui-detalle-os.png", fullPage: true });
});
