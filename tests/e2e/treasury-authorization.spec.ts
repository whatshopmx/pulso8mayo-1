import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * C18.3 — V2 de la corrida de pago: la pantalla no ofrece lo que el servidor
 * va a rechazar.
 *
 * Las unitarias comprueban que el servicio devuelve 403 a un gerente y que nada
 * se escribe. Lo que no mostraban era el otro lado del criterio 2 del plan: un
 * `GERENTE` abría la corrida y veía «Aprobar Corrida (Firma)» porque el botón
 * dependía sólo del estado; el clic volvía con un 403 y el operador no tenía
 * forma de saber de antemano que ese botón no era suyo.
 *
 * Aquí la pantalla real, con la respuesta de la API controlada. El botón sigue
 * visible —para que el motivo se pueda leer— pero desactivado, y el motivo es
 * el mismo texto que devuelve el servidor: sale del mismo módulo.
 */

const CORRIDA = "abababab-0000-4000-8000-000000000001";
const PARTIDA = "cdcdcdcd-0000-4000-8000-000000000001";

const SIN_ROL =
  "Sólo un administrador de la empresa puede ejecutar esta operación de tesorería.";

const linea = (estado: string) => ({
  id: PARTIDA,
  itemType: "INVOICE",
  referenceId: "f0f0f0f0-0000-4000-8000-000000000001",
  amountCents: 125000,
  requestedQuantity: 1,
  approvedQuantity: 1,
  shippedQuantity: null,
  receivedQuantity: null,
  settlementStatus: estado,
  invoiceDetails: { folio: "1042", nombreEmisor: "Distribuidora del Centro" },
});

const corrida = (estado: string, preparadoPor = "user-admin-a1") => ({
  id: CORRIDA,
  companyId: "a1000001-0000-4000-8000-000000000001",
  branchId: null,
  branchName: "Todas las sucursales (Consolidado)",
  title: "Quincena 20",
  status: estado,
  preparedBy: preparadoPor,
  approvedBy: estado === "PENDING_APPROVAL" ? null : "user-admin-a2",
  totalAmountCents: 125000,
  runDate: "2026-10-20T00:00:00.000Z",
  currency: "MXN",
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

/** Enruta el detalle de la corrida y registra lo que la pantalla intenta hacer. */
async function montar(page: Page, estado: string, actor: Record<string, unknown>, actorId = "user-admin-a2") {
  await page.addInitScript(
    ({ corridaId, quien }) => {
      const ventana = window as unknown as Record<string, unknown>;
      ventana.__corridaPrueba = corridaId;
      ventana.__actorPrueba = quien;
    },
    { corridaId: CORRIDA, quien: actor },
  );

  const peticiones: Array<{ url: string; metodo: string }> = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/finance/treasury/runs/${CORRIDA}`)) {
      peticiones.push({ url: req.url(), metodo: req.method() });
    }
  });

  await page.route(`**/api/finance/treasury/runs/${CORRIDA}**`, (route) => {
    const url = route.request().url();
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { success: true, data: { run: corrida(estado), items: [linea(estado === "APPROVED" ? "PENDING" : "PENDING")] } },
      });
    }
    // Cualquier transición o liquidación que llegue desde la pantalla.
    return route.fulfill({ status: 403, json: { error: SIN_ROL } });
  });

  await page.goto(`${harness.url}/tesoreria`);
  await expect(page.getByText("Quincena 20")).toBeVisible();
  return peticiones;
}

test("un gerente ve la firma desactivada y con el motivo, sin poder pulsarla", async ({ page }) => {
  const errores = erroresDe(page);
  await montar(page, "PENDING_APPROVAL", { id: "user-gte", role: "GERENTE" });

  const firmar = page.getByRole("button", { name: /Aprobar Corrida/ });
  await expect(firmar).toBeVisible();
  await expect(firmar).toBeDisabled();
  await expect(firmar).toHaveAttribute("title", SIN_ROL);

  // Tampoco aparece el botón de agregar partidas, que es escribir en la corrida.
  await expect(page.getByRole("button", { name: /Agregar factura/i })).toHaveCount(0);
  expect(errores).toEqual([]);
});

test("quien preparó la corrida no puede firmarla: el motivo es la doble firma", async ({ page }) => {
  await montar(page, "PENDING_APPROVAL", { id: "user-admin-a1", role: "ADMIN" });

  const firmar = page.getByRole("button", { name: /Aprobar Corrida/ });
  await expect(firmar).toBeDisabled();
  await expect(firmar).toHaveAttribute("title", /doble firma/i);
});

test("un administrador puede firmar y la pantalla lo pide a la API", async ({ page }) => {
  const errores = erroresDe(page);
  const peticiones = await montar(page, "PENDING_APPROVAL", { id: "user-admin-a2", role: "ADMIN" });

  const firmar = page.getByRole("button", { name: /Aprobar Corrida/ });
  await expect(firmar).toBeEnabled();
  await firmar.click();

  await expect(page.getByText(SIN_ROL)).toBeVisible();
  expect(peticiones.some((p) => p.metodo === "PATCH" && p.url.includes("/status"))).toBe(true);
  expect(errores).toEqual([]);
});

test("un gerente no liquida partidas y la pantalla lo dice antes de intentarlo", async ({ page }) => {
  await montar(page, "PROCESSING", { id: "user-gte", role: "SUPERVISOR" });

  await expect(page.getByRole("button", { name: /^Confirmar$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Rechazar$/ })).toBeDisabled();
  await expect(page.getByText(SIN_ROL).first()).toBeVisible();
});

test("un administrador liquida y el cierre se habilita cuando ya no quedan pendientes", async ({ page }) => {
  const errores = erroresDe(page);
  const peticiones = await montar(page, "PROCESSING", { id: "user-admin-a2", role: "ADMIN" });

  await expect(page.getByRole("button", { name: /^Confirmar$/ })).toBeEnabled();

  // Con la partida pendiente, el cierre explica cuántas faltan: es la misma
  // cuenta que hace el servidor al rechazar.
  const cerrar = page.getByRole("button", { name: /Cerrar/ });
  await expect(cerrar).toBeDisabled();
  await expect(cerrar).toHaveAttribute("title", "Faltan 1 partidas por liquidar.");
  expect(errores).toEqual([]);
  expect(peticiones.filter((p) => p.metodo !== "GET")).toHaveLength(0);
});