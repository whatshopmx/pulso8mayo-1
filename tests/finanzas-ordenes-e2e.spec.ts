import { test, expect } from "@playwright/test";

test.describe("E2E - Flujo Integral de Finanzas, Órdenes y Egresos (finzasordenes.md)", () => {

  test("1. Órdenes de Compra (OC) y Creación", async ({ page }) => {
    await page.goto("/dashboard/inventory/purchase-orders");
    await expect(page).toHaveURL(/\/dashboard\/inventory\/purchase-orders/);

    // Verificar presencia de la cabecera y botón de acción
    const newOrderButton = page.getByRole("button", { name: /nueva orden/i });
    await expect(newOrderButton).toBeVisible();

    // Abrir modal de creación
    await newOrderButton.click();
    const modalTitle = page.getByRole("heading", { name: /nueva orden de compra/i });
    await expect(modalTitle).toBeVisible();

    // Verificar campos requeridos del manual
    await expect(page.locator("label", { hasText: /proveedor/i })).toBeVisible();
    await expect(page.locator("label", { hasText: /fecha requerida/i })).toBeVisible();
    await expect(page.locator("label", { hasText: /productos/i })).toBeVisible();

    // Cerrar modal
    const closeBtn = page.getByRole("button", { name: /cancelar/i });
    await closeBtn.click();
  });

  test("2. Órdenes de Servicio (OS) y Gestión Operativa", async ({ page }) => {
    await page.goto("/dashboard/equipment/compliance/service-orders");
    await expect(page).toHaveURL(/\/dashboard\/equipment\/compliance\/service-orders/);

    // Verificar botón de creación
    const newServiceOrderBtn = page.getByRole("button", { name: /nueva orden/i });
    await expect(newServiceOrderBtn).toBeVisible();

    // Abrir modal de creación de OS
    await newServiceOrderBtn.click();
    const dialogTitle = page.getByRole("heading", { name: /nueva orden de servicio/i });
    await expect(dialogTitle).toBeVisible();

    // Verificar campos de tipo, urgencia y alcance del servicio
    await expect(page.locator("label", { hasText: /tipo/i })).toBeVisible();
    await expect(page.locator("label", { hasText: /urgencia/i })).toBeVisible();

    // Cerrar modal
    await page.getByRole("button", { name: /cancelar/i }).click();
  });

  test("3. Control Interno, Bandeja de Aprobaciones y Matriz de Autorización", async ({ page }) => {
    await page.goto("/dashboard/finance/control-interno");
    await expect(page).toHaveURL(/\/dashboard\/finance\/control-interno/);

    // Verificar las pestañas de control interno
    const tabAudit = page.getByRole("tab", { name: /bitácora/i });
    const tabExceptions = page.getByRole("tab", { name: /excepciones/i });
    const tabApprovals = page.getByRole("tab", { name: "Autorizaciones", exact: true });
    const tabMatrix = page.getByRole("tab", { name: /matriz/i });

    await expect(tabAudit).toBeVisible();
    await expect(tabExceptions).toBeVisible();
    await expect(tabApprovals).toBeVisible();
    await expect(tabMatrix).toBeVisible();

    // Clic en Matriz de Autorización para verificar niveles
    await tabMatrix.click();
    await expect(page.getByText(/rol aprobador/i).first()).toBeVisible();
  });

  test("4. Reporte de Control Gerencial (KPIs del Manual)", async ({ page }) => {
    await page.goto("/dashboard/reports/control");
    await expect(page).toHaveURL(/\/dashboard\/reports\/control/);

    // Verificar tarjetas de KPIs maestros del manual QSR
    await expect(page.getByText(/ejecución presupuestal/i)).toBeVisible();
    await expect(page.getByText(/compras de emergencia/i)).toBeVisible();
    await expect(page.getByText(/correctivo vs preventivo/i).or(page.getByText(/mantenimiento/i).first())).toBeVisible();
    await expect(page.getByText(/food cost/i).first()).toBeVisible();
  });

  test("5. Presupuestos por Partida y Sucursal", async ({ page }) => {
    await page.goto("/dashboard/budgets");
    await expect(page).toHaveURL(/\/dashboard\/budgets/);

    // Verificar tabla de presupuestos
    await expect(page.getByRole("heading", { name: /presupuestos/i })).toBeVisible();
  });

  test("6. Tesorería, Corridas de Pago y Contratos Recurrentes", async ({ page }) => {
    await page.goto("/dashboard/finance/treasury");
    await expect(page).toHaveURL(/\/dashboard\/finance\/treasury/);

    // Verificar tablero de tesorería
    await expect(page.getByRole("heading", { name: /tesorería/i })).toBeVisible();
  });

  test("7. Facturas y Conciliación 3-Way Match", async ({ page }) => {
    await page.goto("/dashboard/inventory/invoices");
    await expect(page).toHaveURL(/\/dashboard\/inventory\/invoices/);

    // Verificar cabecera de facturas
    await expect(page.getByRole("heading", { name: /facturas/i })).toBeVisible();
  });

});
