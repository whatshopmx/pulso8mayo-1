import { test, expect } from "@playwright/test";
import { E2E_TAG } from "./support/constants";
import { deleteTestExpenses, findExpenseByDescription } from "./support/db";

/**
 * Fase 1 — Evidencia (foto del ticket) en gastos operativos.
 *
 * Escenario del plan: registrar un gasto adjuntando la foto y comprobar que
 * `operating_expenses.evidence_url` (migración 0031) queda persistido.
 */

// PNG 1×1 transparente — suficiente para el upload sin depender de fixtures.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("Fase 1 · gasto con evidencia", () => {
  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("guarda el gasto con la foto del ticket y persiste evidence_url", async ({ page }) => {
    const descripcion = `${E2E_TAG} Hielo para barra ${Date.now()}`;

    await page.goto("/dashboard/finance/expenses");

    await page.getByRole("button", { name: /Nuevo Gasto Operativo/i }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();

    // Sucursal (Radix Select: abrir y escoger la primera opción real).
    await dialogo.locator("#expense-branch").click();
    await page.getByRole("option").first().click();

    // Categoría.
    await dialogo.locator("#expense-cat").click();
    await page.getByRole("option", { name: /Otros Gastos/i }).click();

    await dialogo.locator("#expense-amount").fill("350.50");
    await dialogo.locator("#expense-desc").fill(descripcion);

    // Adjuntar la foto: el input es sr-only, se llena directamente.
    await dialogo.locator("#expense-evidence").setInputFiles({
      name: "ticket.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });

    // El upload a R2 confirma cambiando la etiqueta del control.
    await expect(dialogo.getByText("Foto adjunta")).toBeVisible({ timeout: 30_000 });

    await dialogo.getByRole("button", { name: /Guardar Gasto/i }).click();
    // El formulario solo se cierra cuando la API respondió OK (el toast es
    // efímero y no sirve como señal estable).
    await expect(dialogo).toBeHidden({ timeout: 30_000 });

    // Persistencia: monto en centavos y evidencia guardada.
    const gasto = await findExpenseByDescription(descripcion);
    expect(gasto).not.toBeNull();
    expect(gasto.amount_cents).toBe(35_050);
    expect(gasto.evidence_url).toBeTruthy();
    expect(String(gasto.evidence_url)).toMatch(/^https?:\/\//);
  });
});
