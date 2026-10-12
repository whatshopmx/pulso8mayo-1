import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * C13 — V2 de la carga fallida y la recuperación.
 *
 * El defecto era que un `GET` fallado dejaba el formulario montado con los
 * defaults de módulo: un operador podía guardar esos defaults sobre la fila
 * real sin haber visto nada. Aquí la carga y el guardado usan respuestas
 * controladas; la autorización y la validación viven en las pruebas unitarias.
 */

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

const CONFIG = {
  purchasingStructure: "HIBRIDO",
  foodProduction: "COCINA_CENTRAL",
  managerAuthLimitCents: 0,
  doubleApprovalThresholdCents: 250000,
  pettyCashLimitCents: 0,
  emergencyPurchaseCapCents: null,
  courtesyWasteMonthlyCapCents: null,
  foodCostTargetPercent: "0.00",
  foodCostWarnPercent: "35.50",
  laborCostTargetPercent: "28.00",
  laborCostWarnPercent: "32.00",
  healthyMarginTargetPercent: "45.00",
  healthyMarginWarnPercent: "35.00",
  // C14.1 — parámetros con estado null real.
  vatRatePercent: "8.00",
  laborBurdenFactorPercent: null,
  payrollStateTaxPercent: "3.00",
  mermaVarianceThresholdPct: "2.50",
};

const erroresDe = (page: Page) => {
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errores.push(m.text()); });
  return errores;
};

async function abrir(page: Page, guardado: unknown = CONFIG) {
  let guardadas = { ...(guardado as Record<string, unknown>) };
  const enviados: Record<string, unknown>[] = [];
  const errores = erroresDe(page);
  await page.route("**/api/company/operating-config", async (route) => {
    if (route.request().method() === "PUT") {
      enviados.push(JSON.parse(route.request().postData() ?? "{}"));
      guardadas = { ...guardadas, ...(enviados.at(-1) as Record<string, unknown>) };
      return route.fulfill({ json: { success: true, data: guardadas } });
    }
    return route.fulfill({ json: { success: true, data: guardadas } });
  });
  await page.goto(`${harness.url}/config`);
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toBeVisible();
  return { enviados, errores, guardadas: () => guardadas };
}

const guardar = (page: Page) => Promise.all([
  page.waitForResponse((res) => res.url().endsWith('/api/company/operating-config') && res.request().method() === 'PUT'),
  page.getByRole("button", { name: "Guardar Configuración" }).click(),
]);

/** Un cambio real habilita el botón, que se deshabilita mientras no haya nada que guardar. */
const cambiarAlgo = (page: Page) => page.getByLabel("Fondo Fijo de Caja Chica por Sucursal").fill("1");

test("un umbral en cero se ve en cero, no en el default de $1,000", async ({ page }) => {
  const fixture = await abrir(page);
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue("0");
  await expect(page.getByLabel("Fondo Fijo de Caja Chica por Sucursal")).toHaveValue("0");
  await expect(page.getByLabel("Umbral Autorización Dirección General")).toHaveValue("2500");
  await expect(page.getByLabel(/Tope Mensual Compras de Emergencia/)).toHaveValue("");
  expect(fixture.errores).toEqual([]);
});

test("un objetivo en cero se ve en cero y se vuelve a guardar en cero", async ({ page }) => {
  const fixture = await abrir(page);
  await expect(page.getByLabel("Objetivo (Zona Verde hasta)").first()).toHaveValue("0");
  await cambiarAlgo(page);
  await guardar(page);
  expect(fixture.enviados[0]).toMatchObject({ foodCostTargetPercent: 0, managerAuthLimitCents: 0, pettyCashLimitCents: 100, emergencyPurchaseCapCents: null });
  expect(fixture.errores).toEqual([]);
});

test("quitar un tope lo guarda como sin tope, no como cero pesos", async ({ page }) => {
  const fixture = await abrir(page, { ...CONFIG, emergencyPurchaseCapCents: 250000 });
  await expect(page.getByLabel(/Tope Mensual Compras de Emergencia/)).toHaveValue("2500");
  await page.getByLabel(/Tope Mensual Compras de Emergencia/).fill("");
  await guardar(page);
  expect(fixture.enviados[0]).toMatchObject({ emergencyPurchaseCapCents: null });
  expect(fixture.errores).toEqual([]);
});

test("una carga fallida avisa y no monta el formulario con valores inventados", async ({ page }) => {
  const errores = erroresDe(page);
  let intentos = 0;
  await page.route("**/api/company/operating-config", (route) => {
    intentos += 1;
    if (intentos === 1) return route.fulfill({ status: 500, json: { success: false, error: { message: "La base no responde." } } });
    return route.fulfill({ json: { success: true, data: CONFIG } });
  });
  await page.goto(`${harness.url}/config`);

  const aviso = page.getByRole("alert").filter({ hasText: "No se pudo cargar" });
  await expect(aviso).toContainText("La base no responde.");
  await expect(aviso).toContainText("No se muestran valores de ejemplo");
  // Ningún input del formulario existe: nada se puede guardar por accidente.
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Guardar/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue("0");
  await expect(aviso).toHaveCount(0);
  expect(intentos).toBe(2);
  expect(errores).toEqual([]);
});

test("guardar y recargar recupera los valores persistidos", async ({ page }) => {
  const fixture = await abrir(page);
  await expect(page.getByLabel("Umbral Autorización Dirección General")).toHaveValue("2500");
  await cambiarAlgo(page);
  await guardar(page);
  expect(fixture.enviados).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue("0");
  expect(fixture.errores).toEqual([]);
});

test("un error del servidor se muestra junto al campo que lo provocó", async ({ page }) => {
  const fixture = await abrir(page);
  await page.route("**/api/company/operating-config", (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { success: true, data: CONFIG } }) : route.fulfill({
      status: 400,
      json: {
        success: false,
        error: {
          message: "Validation Error",
          details: { formErrors: [], fieldErrors: {
            managerAuthLimitCents: ["El monto no puede ser negativo."],
            foodCostWarnPercent: ["El porcentaje no puede ser mayor a 100."],
          } },
        },
      },
    })
  );
  await cambiarAlgo(page);
  await guardar(page);

  const limite = page.getByLabel("Límite de Autonomía de Gerente");
  await expect(limite).toHaveAttribute("aria-invalid", "true");
  await expect(limite).toHaveAccessibleDescription("El monto no puede ser negativo.");
  await expect(page.locator('#managerAuthLimit-error')).toContainText("El monto no puede ser negativo.");

  const foodWarn = page.getByLabel("Precaución (Zona Amarilla hasta)").first();
  await expect(foodWarn).toHaveAttribute("aria-invalid", "true");
  await expect(foodWarn).toHaveAccessibleDescription("El porcentaje no puede ser mayor a 100.");

  await expect(page.getByRole('alert').filter({ hasText: 'Revisa los campos marcados' })).toBeVisible();
  // Un rechazo por campo no borra nada: lo escrito sigue ahí.
  await expect(limite).toHaveValue("0");
  expect(fixture.enviados).toHaveLength(0);
  await limite.fill('10');
  await expect(limite).toHaveAttribute('aria-invalid', 'false');
  expect(fixture.errores).toEqual([]);
});

test("los umbrales sin tope siguen vacíos después de guardar y recargar", async ({ page }) => {
  const fixture = await abrir(page, { ...CONFIG, managerAuthLimitCents: null,
    doubleApprovalThresholdCents: null, pettyCashLimitCents: null });
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue('');
  await page.getByLabel(/Tope Mensual Compras de Emergencia/).fill('1');
  await guardar(page);
  expect(fixture.enviados[0]).toMatchObject({ managerAuthLimitCents: null,
    doubleApprovalThresholdCents: null, pettyCashLimitCents: null });
  await page.reload();
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue('');
  await expect(page.getByLabel("Umbral Autorización Dirección General")).toHaveValue('');
  expect(fixture.errores).toEqual([]);
});

test("un fallo de red impide editar y permite recuperar la carga", async ({ page }) => {
  let fallar = true;
  await page.route('**/api/company/operating-config', (route) => fallar
    ? route.abort('failed') : route.fulfill({ json: { success: true, data: CONFIG } }));
  await page.goto(`${harness.url}/config`);
  await expect(page.getByRole('alert')).toContainText('No se pudo cargar');
  await expect(page.getByRole('button', { name: 'Guardar Configuración' })).toHaveCount(0);
  fallar = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue('0');
});

test("un objetivo vacío no se guarda como cero", async ({ page }) => {
  const fixture = await abrir(page);
  const foodTarget = page.getByLabel("Objetivo (Zona Verde hasta)").first();
  await foodTarget.fill("");
  await expect(page.getByRole("button", { name: "Guardar Configuración" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Corrige 1 campo");
  expect(fixture.enviados).toEqual([]);
  expect(fixture.errores).toEqual([]);
});

test("guardar y recargar conserva cero, sin tope y los porcentajes", async ({ page }) => {
  const fixture = await abrir(page);
  await page.getByLabel("Límite de Autonomía de Gerente").fill("0");
  await page.getByLabel(/Tope Mensual Compras de Emergencia/).fill("1500");
  await page.getByLabel("Precaución (Zona Amarilla desde)").fill("40");
  await guardar(page);
  expect(fixture.enviados[0]).toMatchObject({ managerAuthLimitCents: 0, emergencyPurchaseCapCents: 150000, healthyMarginWarnPercent: 40 });

  await page.reload();
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toHaveValue("0");
  await expect(page.getByLabel(/Tope Mensual Compras de Emergencia/)).toHaveValue("1500");
  expect(fixture.errores).toEqual([]);
});

test("descartar devuelve los valores guardados, no los de módulo", async ({ page }) => {
  const fixture = await abrir(page);
  await page.getByLabel("Fondo Fijo de Caja Chica por Sucursal").fill("9000");
  await page.getByRole("button", { name: "Descartar Cambios" }).click();
  await expect(page.getByLabel("Fondo Fijo de Caja Chica por Sucursal")).toHaveValue("0");
  expect(fixture.enviados).toEqual([]);
  expect(fixture.errores).toEqual([]);
});

/* ── C14.1 — los cuatro parámetros fiscales/nómina/merma ─────────────── */

test("los cuatro parámetros muestran lo guardado, incluido el null como vacío", async ({ page }) => {
  const fixture = await abrir(page);
  await expect(page.getByLabel("Tasa de IVA estimada")).toHaveValue("8");
  // null se ve vacío, no como 0 ni como el default 16 del módulo.
  await expect(page.getByLabel("Carga patronal sobre nómina bruta")).toHaveValue("");
  await expect(page.getByLabel("Impuesto estatal sobre nóminas (ISN)")).toHaveValue("3");
  await expect(page.getByLabel("Umbral de varianza para merma automática")).toHaveValue("2.5");
  // Cada campo declara qué significa su vacío junto al input.
  await expect(page.getByText("Vacío = no estimar")).toBeVisible();
  await expect(page.getByText("Vacío = sin factor")).toBeVisible();
  expect(fixture.errores).toEqual([]);
});

test("editar un parámetro lo guarda, lo recarga y lo mantiene", async ({ page }) => {
  const fixture = await abrir(page);
  await page.getByLabel("Tasa de IVA estimada").fill("16");
  await page.getByLabel("Carga patronal sobre nómina bruta").fill("25.5");
  await guardar(page);
  expect(fixture.enviados[0]).toMatchObject({ vatRatePercent: 16, laborBurdenFactorPercent: 25.5, payrollStateTaxPercent: 3, mermaVarianceThresholdPct: 2.5 });

  await page.reload();
  await expect(page.getByLabel("Tasa de IVA estimada")).toHaveValue("16");
  await expect(page.getByLabel("Carga patronal sobre nómina bruta")).toHaveValue("25.5");
  expect(fixture.errores).toEqual([]);
});

test("vaciar un parámetro lo guarda como null, no como cero ni como default", async ({ page }) => {
  const fixture = await abrir(page, { ...CONFIG, vatRatePercent: "16.00" });
  await expect(page.getByLabel("Tasa de IVA estimada")).toHaveValue("16");
  await page.getByLabel("Tasa de IVA estimada").fill("");
  await guardar(page);
  expect(fixture.enviados[0]).toMatchObject({ vatRatePercent: null });

  await page.reload();
  // El null persistido vuelve a verse vacío: el viaje es estable.
  await expect(page.getByLabel("Tasa de IVA estimada")).toHaveValue("");
  expect(fixture.errores).toEqual([]);
});

test("un parámetro fuera de rango se rechaza en servidor y el error nombra su campo", async ({ page }) => {
  const fixture = await abrir(page);
  await page.route("**/api/company/operating-config", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { success: true, data: CONFIG } })
      : route.fulfill({
          status: 400,
          json: {
            success: false,
            error: {
              message: "Validation Error",
              details: { formErrors: [], fieldErrors: { vatRatePercent: ["El porcentaje no puede ser mayor a 100."] } },
            },
          },
        })
  );
  await page.getByLabel("Tasa de IVA estimada").fill("150");
  await guardar(page);

  const vat = page.getByLabel("Tasa de IVA estimada");
  await expect(vat).toHaveAttribute("aria-invalid", "true");
  // La descripción accesible concatena hint y error: ambos deben estar enlazados.
  await expect(vat).toHaveAttribute("aria-describedby", /vatRate-hint vatRate-error/);
  await expect(page.locator("#vatRate-error")).toHaveText("El porcentaje no puede ser mayor a 100.");
  await expect(page.getByRole("alert").filter({ hasText: "mayor a 100" }).first()).toBeVisible();
  // El rechazo no borra lo escrito: el operador corrige sobre su propio valor.
  await expect(vat).toHaveValue("150");
  expect(fixture.errores).toEqual([]);
});
