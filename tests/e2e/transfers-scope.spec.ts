import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * C17.3 — V2 del recorrido de transferencias: el rechazo del servidor se ve.
 *
 * Las pruebas unitarias de C17.3 comprueban que la ruta responde 403 con el
 * motivo y que no escribe nada. Lo que no mostraban es lo único que importa
 * para quien opera: que ese motivo llegue a la pantalla con su texto, y que la
 * pantalla ofrezca exactamente las acciones que su sucursal puede ejecutar —
 * el destino aprueba, el origen envía, el destino recibe.
 *
 * Esta prueba encontró el hueco que justificaba el recorrido: una transferencia
 * `APPROVED` no aparecía en ninguna pestaña, así que el origen no tenía forma
 * de enviarla. Ahora vive en «Por Enviar» y hay una prueba que lo fija.
 *
 * La pantalla y sus componentes son los reales; la API responde lo que cada
 * prueba enruta. La autorización vive en `transfer-scope.test.ts`.
 */

const RAMA_A1 = "a1000001-0000-4000-8000-000000000001";
const RAMA_A2 = "a1000001-0000-4000-8000-000000000002";
const RAMA_A3 = "a1000001-0000-4000-8000-000000000003";
const TRANSFERENCIA = "cccccccc-0000-4000-8000-000000000001";

const RAMAS = [
  { id: RAMA_A1, name: "P centro" },
  { id: RAMA_A2, name: "P norte" },
  { id: RAMA_A3, name: "P sur" },
];

const MENSAJE_LADO =
  "Esta transferencia no pertenece a tu sucursal: el lado que ejecuta esta acción es el otro extremo.";

const MENSAJE_SUCURSAL =
  "La sucursal seleccionada no existe para esta empresa. Recarga el catálogo e inténtalo de nuevo.";

const linea = () => ({
  id: "linea-1",
  itemId: "aaaaaaaa-0000-4000-8000-000000000001",
  itemName: "Pollo",
  itemSku: "POL-01",
  itemUnit: "KG",
  requestedQuantity: 5,
  approvedQuantity: null,
  shippedQuantity: null,
  receivedQuantity: null,
});

const transferencia = (estado: string, desde: string, hacia: string, id = TRANSFERENCIA) => ({
  transfer: {
    id,
    transferNumber: `TRF-202610-${id === TRANSFERENCIA ? "0007" : "0008"}`,
    fromBranchId: desde,
    toBranchId: hacia,
    status: estado,
    requestedBy: "user-gerente-a1",
    requestedAt: "2026-10-13T10:00:00.000Z",
  },
  items: [linea()],
});

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

const erroresDe = (page: Page) => {
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) errores.push(m.text());
  });
  return errores;
};

/** Enruta el listado con las transferencias que la prueba necesita. */
async function listar(page: Page, Transfers: unknown[]) {
  await page.route("**/api/inventory/transfers?*", (route) =>
    route.fulfill({ json: { transfers: Transfers } }),
  );
}

/** Enruta la transición de una transferencia con el status que se le pida. */
async function transicion(page: Page, status: number, error: string) {
  await page.route("**/api/inventory/transfers/**", (route) =>
    route.fulfill({ status, json: { error } }),
  );
}

/** Abre la pantalla con la sucursal activa fijada antes de cargar el módulo. */
async function abrir(page: Page, sucursal: string) {
  await page.addInitScript(
    ({ ramas, seleccion }) => {
      const ventana = window as unknown as Record<string, unknown>;
      ventana.__ramasPrueba = ramas;
      ventana.__sucursalPrueba = seleccion;
    },
    { ramas: RAMAS, seleccion: sucursal },
  );
  await page.goto(`${harness.url}/transfers`);
  await expect(page.getByRole("tab", { name: /Pendientes/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // La pantalla usa el hook real de sucursales: se enruta su respuesta.
  await page.route("**/api/branches*", (route) =>
    route.fulfill({ json: { success: true, data: RAMAS } }),
  );
  await listar(page, []);
  await transicion(page, 403, MENSAJE_LADO);
  await page.route("**/api/inventory/transfers", (route) =>
    route.fulfill({ status: 403, json: { error: MENSAJE_LADO } }),
  );
});

test("el motivo del 403 del servidor aparece en pantalla al aprobar desde el lado que no toca", async ({ page }) => {
  const errores = erroresDe(page);
  // El listado sitúa la sucursal activa como destino, así que la pantalla
  // habilita «Aprobar»; el servidor la rechaza porque la sesión del operador
  // está en la otra punta de la transferencia. El motivo tiene que llegar.
  await listar(page, [transferencia("PENDING", RAMA_A1, RAMA_A2)]);
  await abrir(page, RAMA_A2);

  await page.getByRole("tab", { name: /Por Aprobar/ }).click();
  await page.getByRole("button", { name: "Ver Detalle" }).first().click();
  await page.getByRole("button", { name: /^Aprobar$/ }).click();

  await expect(page.getByText(MENSAJE_LADO)).toBeVisible();
  expect(errores).toEqual([]);
});

test("el origen ve la transferencia aprobada esperando envío y la envía", async ({ page }) => {
  const errores = erroresDe(page);
  await transicion(page, 200, "");
  await page.route("**/api/inventory/transfers/**", (route) =>
    route.fulfill({ json: { success: true, transfer: transferencia("APPROVED", RAMA_A1, RAMA_A2).transfer } }),
  );
  await listar(page, [transferencia("APPROVED", RAMA_A1, RAMA_A2)]);
  await abrir(page, RAMA_A1);

  // Antes de C17.3 esto no existía: la aprobada no salía en ninguna pestaña y
  // el botón «Enviar» no tenía por dónde pulsarse.
  const pestana = page.getByRole("tab", { name: "Por Enviar (1)" });
  await expect(pestana).toBeVisible();
  await pestana.click();

  await page.getByRole("button", { name: "Ver Detalle" }).first().click();
  await page.getByRole("button", { name: /^Enviar$/ }).click();

  await expect(page.getByText(/Transferencia enviada exitosamente/)).toBeVisible();
  expect(errores).toEqual([]);
});

test("la pantalla no ofrece enviar una transferencia cuyo origen es otra sucursal", async ({ page }) => {
  await listar(page, [transferencia("APPROVED", RAMA_A1, RAMA_A2)]);
  await abrir(page, RAMA_A2);

  await page.getByRole("tab", { name: /Por Enviar/ }).click();
  await expect(page.getByText("Sin transferencias")).toBeVisible();

  // Y tampoco aparece en la del destino, que sólo trae lo pendiente de aprobar:
  // una aprobada es del origen hasta que sale.
  await page.getByRole("tab", { name: /Por Aprobar/ }).click();
  await expect(page.getByText("Sin transferencias")).toBeVisible();
  await expect(page.getByRole("button", { name: /Enviar/ })).toHaveCount(0);
});

test("una lista que el servidor rechaza no muestra transferencias y nombra el motivo", async ({ page }) => {
  await page.route("**/api/inventory/transfers?*", (route) =>
    route.fulfill({ status: 400, json: { error: MENSAJE_SUCURSAL } }),
  );
  await abrir(page, RAMA_A2);

  await page.getByRole("tab", { name: /Por Aprobar/ }).click();
  await expect(page.getByText("Sin transferencias")).toBeVisible();
  await expect(page.getByText(MENSAJE_SUCURSAL)).toBeVisible();
});

test("cada pestaña cuenta sólo lo que la sucursal ve", async ({ page }) => {
  await listar(page, [
    // P norte (activa) es el destino: aparece en «Por Aprobar».
    transferencia("PENDING", RAMA_A1, RAMA_A2),
    // Otra sucursal: el servidor no debería devolverla, y si lo hiciera la
    // pantalla no la filtraría por su cuenta.
    transferencia("PENDING", RAMA_A1, RAMA_A3, "ajena"),
  ]);
  await abrir(page, RAMA_A2);

  await expect(page.getByRole("tab", { name: "Por Aprobar (1)" })).toBeVisible();
  await page.getByRole("tab", { name: "Por Aprobar (1)" }).click();
  await expect(page.getByText("TRF-202610-0007")).toBeVisible();
  await expect(page.getByText("TRF-202610-0008")).toHaveCount(0);
});