import { test, expect } from "@playwright/test";
import { BRANCH_CONDESA } from "./support/constants";
import { deleteTestCuts, findLatestCut, today } from "./support/db";
import { computeCashVariance } from "../lib/sales/cash-variance";

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

    // Dashboard: la columna "Arqueo efectivo" muestra el faltante de $20.
    // (Se llamaba "Arqueo/Dif." hasta que la Fase 4 le puso al lado la columna
    // de terminal y hubo que decir cuál de las dos diferencias es cuál.)
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

/**
 * Auditoría A9 — un cero capturado no es un campo vacío.
 *
 * El `INSERT` de `/api/sales/cuts` guardaba cada monto con `data.campo || null`.
 * En JavaScript `0 || null` es `null`, así que **un cero que alguien capturó a
 * propósito se guardaba como "no se capturó"**. Zod ya distingue `undefined` de
 * `0`; el `||` era lo único que borraba la diferencia (AD-A7).
 *
 * No es cosmético: `computeCashVariance` devuelve `null` si falta cualquiera de
 * los dos lados, así que un turno que declaró $0 de efectivo y contó dinero en
 * el cajón —una venta en efectivo que nadie registró— desaparecía del banner de
 * diferencias en vez de saltar como sobrante.
 *
 *   pnpm exec playwright test --no-deps --project=chromium tests/corte-arqueo.spec.ts
 */
test.describe("A9 · un cero capturado se guarda como cero", () => {
  /** Fecha propia, para no chocar con los casos de arriba. */
  const FECHA = "2019-05-09";

  test.beforeEach(async () => {
    await deleteTestCuts(BRANCH_CONDESA, FECHA);
  });

  test.afterEach(async () => {
    await deleteTestCuts(BRANCH_CONDESA, FECHA);
  });

  test("cero efectivo declarado con dinero contado se guarda y arroja sobrante", async ({
    request,
  }) => {
    const res = await request.post("/api/sales/cuts", {
      data: {
        branchId: BRANCH_CONDESA,
        businessDate: FECHA,
        shift: "COMPLETO",
        channel: "TOTAL",
        totalSales: 80_000,
        cashSales: 0,
        cardSales: 80_000,
        otherPayments: 0,
        cashCountedCents: 5_000,
        depositedCents: 0,
      },
    });
    expect(res.ok(), await res.text()).toBe(true);

    const cut = await findLatestCut(BRANCH_CONDESA, FECHA);
    expect(cut).not.toBeNull();
    // El corazón de A9: cero, no `null`.
    expect(cut.cash_sales, "el cero capturado se guardó como `null`").toBe(0);
    expect(cut.deposited_cents).toBe(0);
    expect(cut.cash_counted_cents).toBe(5_000);

    // Y con los dos lados presentes, el arqueo sí tiene diferencia que reportar.
    const arqueo = computeCashVariance({
      cashSales: cut.cash_sales,
      cashCountedCents: cut.cash_counted_cents,
    });
    expect(arqueo, "sin los dos lados, el corte desaparece del banner").not.toBeNull();
    expect(arqueo!.direction).toBe("sobrante");
    expect(arqueo!.varianceCents).toBe(5_000);
  });

  test("un campo omitido sigue guardándose como null", async ({ request }) => {
    // La otra mitad: `??` no debe convertir una ausencia en cero, que sería
    // inventar un dato tan falso como el anterior.
    const res = await request.post("/api/sales/cuts", {
      data: {
        branchId: BRANCH_CONDESA,
        businessDate: FECHA,
        shift: "MATUTINO",
        channel: "TOTAL",
        totalSales: 40_000,
        cardSales: 40_000,
        // sin cashSales, sin cashCountedCents, sin depositedCents
      },
    });
    expect(res.ok(), await res.text()).toBe(true);

    const cut = await findLatestCut(BRANCH_CONDESA, FECHA);
    expect(cut.cash_sales).toBeNull();
    expect(cut.cash_counted_cents).toBeNull();
    expect(cut.deposited_cents).toBeNull();

    // Sin los dos lados no hay diferencia que reportar, y no debe pintarse $0.00.
    expect(
      computeCashVariance({
        cashSales: cut.cash_sales,
        cashCountedCents: cut.cash_counted_cents,
      })
    ).toBeNull();
  });
});

/**
 * Auditoría A7 — "falló" y "no hay" no se dicen con la misma pantalla.
 *
 * Ventas pintaba la misma tabla vacía —"No se encontraron cortes de ventas en el
 * período"— cuando la petición fallaba que cuando de verdad no había ventas. El
 * único aviso del fallo era un toast que se va solo a los segundos, así que
 * quien llegaba tarde a mirar leía "no vendiste nada" sobre un error de red.
 *
 * Peor: en el `catch` no se tocaba `cuts`, de modo que un fallo **al cambiar de
 * sucursal** dejaba en pantalla las filas de la anterior bajo la etiqueta de
 * alcance nueva. Cifras reales, sucursal equivocada.
 */
test.describe("A7 · Ventas distingue un fallo de un período vacío", () => {
  test.afterEach(async () => {
    await deleteTestCuts(BRANCH_CONDESA, today());
  });

  test("un fallo de red muestra error con reintento, no una tabla vacía", async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([
      {
        name: "pulso_selected_branch",
        value: BRANCH_CONDESA,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);

    // Predicado y no glob: en los patrones de Playwright `?` es un comodín de un
    // carácter, así que `**/api/sales/cuts?**` no intercepta lo que aparenta.
    let fallar = true;
    await page.route(
      (url) => url.pathname === "/api/sales/cuts",
      async (route) => {
        if (fallar) return route.fulfill({ status: 500, body: "boom" });
        return route.continue();
      }
    );

    await page.goto("/dashboard/sales");
    await page.getByRole("tab", { name: /Registro de Cortes/i }).click();

    // El mensaje del fallo, no el de "no hay cortes".
    await expect(
      page.getByText("No se pudieron cargar los cortes", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/No se encontraron cortes de ventas en el período/i)
    ).toHaveCount(0);

    // Y el reintento es un botón, no recargar la página a mano.
    const reintentar = page.getByRole("button", { name: /Reintentar/i });
    await expect(reintentar).toBeVisible();

    // Al reintentar con la red sana, la pantalla se recupera sola.
    fallar = false;
    await reintentar.click();
    await expect(
      page.getByText("No se pudieron cargar los cortes", { exact: true })
    ).toHaveCount(0, { timeout: 30_000 });
  });

  test("tras un fallo no quedan las filas del alcance anterior", async ({ page, baseURL }) => {
    // El corte existe y se ve; luego la siguiente petición falla. Lo que no
    // puede pasar es que sus filas sigan ahí bajo el alcance nuevo.
    await page.request.post("/api/sales/cuts", {
      data: {
        branchId: BRANCH_CONDESA,
        businessDate: today(),
        shift: "VESPERTINO",
        channel: "TOTAL",
        totalSales: 60_000,
        cardSales: 60_000,
      },
    });

    await page.context().addCookies([
      {
        name: "pulso_selected_branch",
        value: BRANCH_CONDESA,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);

    await page.goto("/dashboard/sales");
    await page.getByRole("tab", { name: /Registro de Cortes/i }).click();

    const filas = page.locator("table tbody tr");
    await expect(filas.first()).toBeVisible({ timeout: 30_000 });

    // Ahora se corta la red y se recarga: la petición nueva falla.
    await page.route(
      (url) => url.pathname === "/api/sales/cuts",
      (route) => route.fulfill({ status: 500, body: "boom" })
    );
    await page.reload();
    await page.getByRole("tab", { name: /Registro de Cortes/i }).click();

    await expect(
      page.getByText("No se pudieron cargar los cortes", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    // Ninguna fila de datos sobrevivió al fallo.
    await expect(page.locator("table tbody tr")).toHaveCount(0);
  });
});
