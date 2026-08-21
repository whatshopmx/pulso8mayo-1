import { test, expect } from "@playwright/test";

/**
 * A20 y A21 — Lo que la pantalla dice cuando algo sale mal, y lo que declara
 * a quien no la ve.
 *
 * Tres invariantes que la auditoría encontró rotos en distintas pantallas por
 * la misma razón: la UI daba por hecho el camino feliz.
 *
 *  - **A21 · Cuentas Bancarias.** El fallo de `/api/inventory/suppliers` no
 *    tenía rama `else`. El `Select` quedaba vacío —no se podía registrar una
 *    cuenta— y las cuentas existentes se rotulaban "Proveedor desconocido",
 *    que se lee como base de datos corrupta y no como una petición que falló.
 *  - **A20 · Plantillas POS.** `AlertDialogAction` cierra el diálogo por su
 *    cuenta. Era la única de las cinco confirmaciones del módulo sin
 *    `preventDefault`: el borrado salía volando y, si fallaba, el diálogo se
 *    cerraba igual dejando la plantilla en su sitio sin explicación.
 *  - **A20 · Cuentas por Pagar.** El `TableCaption` —lo único que oye un lector
 *    de pantalla antes de entrar a la tabla— anunciaba una "acción de pago"
 *    que no existe, justo donde la nota visible dice que la vista es de consulta.
 *
 * Los tres se prueban interceptando la red: es la única forma de ver el estado
 * de error sin romper el servidor.
 */

test.describe("A21 · el catálogo de proveedores que no cargó se dice", () => {
  test("un 500 en /api/inventory/suppliers se muestra y no se confunde con «sin proveedores»", async ({
    page,
  }) => {
    // Predicado, no glob: en los patrones de `page.route` el `?` es comodín de
    // un carácter y "**/api/inventory/suppliers?**" no filtra lo que aparenta.
    await page.route(
      (url) => url.pathname === "/api/inventory/suppliers",
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: { message: "Falla simulada del catálogo." } }),
        })
    );

    await page.goto("/dashboard/finance/supplier-bank-accounts");

    // El motivo se ve, con su reintento, junto al control que quedó inservible.
    await expect(page.getByText(/Falla simulada del catálogo/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Reintentar/i })).toBeVisible();

    // Y el desplegable declara por qué está vacío en vez de fingir que la
    // empresa no tiene proveedores.
    const selector = page.locator("#supplier");
    await expect(selector).toBeDisabled();
    await expect(selector).toContainText(/no disponible/i);
  });
});

test.describe("A20 · el diálogo de borrado espera al servidor", () => {
  test("un DELETE con 500 deja el diálogo abierto con el error dentro", async ({ page }) => {
    const PLANTILLA = "Plantilla POS de prueba A20";

    await page.route(
      (url) => url.pathname === "/api/sales/mapping-templates",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                name: PLANTILLA,
                posSystem: "Soft Restaurant",
                mapping: { total: "TOTAL" },
                isDefault: false,
                createdByName: null,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        })
    );

    await page.route(
      (url) => url.pathname.startsWith("/api/sales/mapping-templates/"),
      (route) =>
        route.request().method() === "DELETE"
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                success: false,
                error: { message: "El servidor no pudo eliminar la plantilla." },
              }),
            })
          : route.continue()
    );

    await page.goto("/dashboard/sales/mapping");
    // Por el título de la tarjeta, no por el texto suelto: el nombre también
    // aparece dentro del diálogo de confirmación una vez abierto.
    const tarjeta = page.locator('[data-slot="card-title"]', { hasText: PLANTILLA });
    await expect(tarjeta).toBeVisible();

    await page.getByRole("button", { name: `Eliminar la plantilla ${PLANTILLA}` }).click();

    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: "Eliminar", exact: true }).click();

    // Sigue abierto, con el motivo que dio el servidor, y la plantilla no se
    // borró de la lista de fondo.
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByText(/no pudo eliminar la plantilla/i)).toBeVisible();
    await expect(tarjeta).toBeVisible();

    // Y se puede salir sin haber roto nada.
    await dialogo.getByRole("button", { name: /Cancelar/i }).click();
    await expect(dialogo).toBeHidden();
  });
});

test.describe("A20 · la leyenda de Cuentas por Pagar describe la tabla que existe", () => {
  test("no anuncia una acción de pago en una vista de consulta", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/finance/payables",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  source: "OPERATING_EXPENSE",
                  reference: "Renta agosto",
                  counterparty: "Inmobiliaria de prueba",
                  supplierId: null,
                  payeeId: null,
                  branchId: null,
                  branchName: "Condesa",
                  amountCents: 4_500_000,
                  dueDate: "2026-09-01",
                  daysUntilDue: 11,
                  bucket: "DUE_LATER",
                  matchStatus: null,
                  hasDiscrepancy: false,
                },
              ],
              totalCents: 4_500_000,
              overdueCents: 0,
              overdueCount: 0,
              dueThisWeekCents: 0,
              buckets: [{ bucket: "DUE_LATER", cents: 4_500_000, count: 1 }],
              byCounterparty: [
                {
                  supplierId: null,
                  payeeId: null,
                  name: "Inmobiliaria de prueba",
                  totalCents: 4_500_000,
                  overdueCents: 0,
                  count: 1,
                },
              ],
              missingDueDateCount: 0,
            },
          }),
        })
    );

    await page.goto("/dashboard/finance/payables");
    // Aparece dos veces —en "Por contraparte" y en el detalle de partidas—, que
    // es justamente por qué hay dos leyendas que revisar.
    await expect(page.getByText("Inmobiliaria de prueba").first()).toBeVisible();

    // La leyenda es `sr-only`: se lee del DOM, no de la pantalla.
    const leyendas = await page.locator("caption").allTextContents();
    const detalle = leyendas.find((t) => /Partidas por pagar/i.test(t));

    expect(detalle, "no se encontró la leyenda del detalle de partidas").toBeTruthy();
    expect(detalle, "la leyenda sigue prometiendo una acción que no existe").not.toMatch(
      /acción de pago/i
    );
    expect(detalle).toMatch(/consulta/i);
    // Las seis columnas que sí existen.
    for (const columna of [/referencia/i, /contraparte/i, /sucursal/i, /origen/i, /vencimiento/i, /monto/i]) {
      expect(detalle).toMatch(columna);
    }
  });
});
