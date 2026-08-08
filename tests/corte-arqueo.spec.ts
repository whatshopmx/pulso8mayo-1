import { test, expect } from "@playwright/test";
import { BRANCH_CONDESA } from "./support/constants";
import { deleteTestCuts, findLatestCut, today } from "./support/db";

/**
 * Fase 2 — Arqueo de cierre de turno.
 *
 * Escenario del plan: efectivo declarado $1,000 y arqueo $980 ⇒ el dashboard
 * de ventas muestra una diferencia de −$20.00 marcada como "faltante".
 */

const EFECTIVO_CENTS = 100_000; // $1,000.00
const ARQUEO_CENTS = 98_000; //   $980.00
/** Intl puede emitir el signo menos ASCII o U+2212 según la versión de ICU. */
const DIFERENCIA = /[-−]\s?\$\s?20[.,]00/;
const CONTADO = /Contado:\s*\$\s?980[.,]00/;

test.describe("Fase 2 · arqueo de cierre de turno", () => {
  test.beforeEach(async () => {
    await deleteTestCuts(BRANCH_CONDESA, today());
  });

  test.afterAll(async () => {
    await deleteTestCuts(BRANCH_CONDESA, today());
  });

  test("rechaza el corte si hay efectivo y no se captura arqueo", async ({ page }) => {
    // La sesión del storageState viaja en las cookies del contexto.
    const res = await page.request.post("/api/workflows/smart-links/corte-caja", {
      data: {
        branchId: BRANCH_CONDESA,
        efectivo: EFECTIVO_CENTS,
        tarjeta: 0,
        cupones: 0,
        rappi: 0,
        uber: 0,
        didi: 0,
        tickets: 12,
        // sin `arqueo` a propósito
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("arqueo de caja");

    // Y no debe haber quedado ningún corte persistido.
    expect(await findLatestCut(BRANCH_CONDESA, today())).toBeNull();
  });

  test("registra el arqueo y el dashboard muestra la diferencia como faltante", async ({
    page,
    baseURL,
  }) => {
    const res = await page.request.post("/api/workflows/smart-links/corte-caja", {
      data: {
        branchId: BRANCH_CONDESA,
        efectivo: EFECTIVO_CENTS,
        tarjeta: 0,
        cupones: 0,
        rappi: 0,
        uber: 0,
        didi: 0,
        tickets: 12,
        arqueo: ARQUEO_CENTS,
        deposito: ARQUEO_CENTS,
      },
    });
    expect(res.ok()).toBeTruthy();

    // Persistencia: las columnas de la migración 0032 quedaron escritas.
    const cut = await findLatestCut(BRANCH_CONDESA, today());
    expect(cut).not.toBeNull();
    expect(cut.cash_sales).toBe(EFECTIVO_CENTS);
    expect(cut.cash_counted_cents).toBe(ARQUEO_CENTS);
    expect(cut.deposited_cents).toBe(ARQUEO_CENTS);

    // El dashboard filtra por la sucursal en foco, que se guarda en la cookie
    // `pulso_selected_branch` y, si nadie la fijó, cae en la primera sucursal
    // de la lista. Se fija explícitamente: si no, la tabla muestra otra
    // sucursal y el corte recién creado no aparece.
    await page.context().addCookies([
      {
        name: "pulso_selected_branch",
        value: BRANCH_CONDESA,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);

    // Dashboard: la columna "Arqueo/Dif." muestra el faltante de $20.
    await page.goto("/dashboard/sales");
    // La tabla de cortes vive en la segunda pestaña.
    await page.getByRole("tab", { name: /Registro de Cortes/i }).click();

    // La fila del corte recién creado: la que muestra el conteo de $980.
    const fila = page.locator("tr", { hasText: CONTADO }).first();
    await expect(fila).toBeVisible({ timeout: 30_000 });
    await expect(fila).toContainText(CONTADO);
    await expect(fila).toContainText(DIFERENCIA);
    await expect(fila).toContainText("faltante");

    // Y la alerta agregada de cortes con diferencia.
    await expect(
      page.getByText(/corte(s)? con diferencia entre efectivo declarado y arqueo/i)
    ).toBeVisible();
  });
});
