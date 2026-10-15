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
test.beforeEach(async ({ page }) => {
  await page.route("**/api/approval-matrix*", (route) => route.fulfill({ json: { rules: [] } }));
  // C16.2.3: los controles de delegación y el catálogo de sucursales del
  // selector por alcance. El valor de aquí es «empresa sin controles»; las
  // pruebas de la sección de controles vuelven a enrutar lo que necesitan.
  await page.route("**/api/purchase-delegation*", (route) =>
    route.fulfill({
      json: {
        REQUEST: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
        EMIT: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
      },
    }),
  );
  await page.route("**/api/branches*", (route) =>
    route.fulfill({
      json: { success: true, data: [{ id: "a1000001-0000-4000-8000-000000000001", name: "P centro" }] },
    }),
  );
});

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

/* C15 — la clasificación no debe prometer reglas ni romper persistencia. */
const DIMENSIONES = [
  { campo: "purchasingStructure", etiqueta: "Estructura de Compras", estado: "Descriptiva", opciones: ["Centralizada", "Por Sucursal", "Híbrido"], valores: ["CENTRALIZADA", "POR_SUCURSAL", "HIBRIDO"] },
  { campo: "foodProduction", etiqueta: "Producción de Alimentos", estado: "Descriptiva", opciones: ["In Situ", "Comisariato Central", "Mixto / Ensamble"], valores: ["IN_SITU", "COCINA_CENTRAL", "MIXTO"] },
  { campo: "treasuryModel", etiqueta: "Modelo de Tesorería", estado: "Descriptiva", opciones: ["Cuenta Única", "Por Sucursal", "Mixto"], valores: ["CUENTA_UNICA", "CUENTA_POR_SUCURSAL", "MIXTO"] },
  { campo: "supplierPayment", etiqueta: "Pago a Proveedores", estado: "Descriptiva", opciones: ["Centralizado", "Por Sucursal", "Híbrido"], valores: ["CENTRALIZADO", "POR_SUCURSAL", "HIBRIDO"] },
  { campo: "payrollDispersion", etiqueta: "Dispersión de Nómina", estado: "Descriptiva", opciones: ["Consolidada", "Por Razón Social", "Mixto"], valores: ["CONSOLIDADA", "POR_RAZON_SOCIAL", "MIXTO"] },
  { campo: "managerAutonomy", etiqueta: "Autonomía del Gerente de Sucursal", estado: "Se aplica hoy", opciones: ["Alta", "Media", "Baja"], valores: ["ALTA", "MEDIA", "BAJA"] },
  { campo: "tenantType", etiqueta: "Tipo de Estructura del Grupo", estado: "Se aplica hoy", opciones: ["Grupo Propio (100% Unidades Corporativas)", "Mixto con Franquiciatarios"], valores: ["GRUPO_PROPIO", "MIXTO_FRANQUICIAS"] },
] as const;

test("cada dimensión declara su estado y caja chica distingue descripción de regla aplicada", async ({ page }) => {
  const fixture = await abrir(page);
  for (const dimension of DIMENSIONES) {
    const grupo = page.getByRole("radiogroup", { name: dimension.etiqueta, exact: true });
    await expect(grupo.locator("..").getByText(dimension.estado, { exact: true })).toBeVisible();
    await expect(grupo).toHaveAccessibleDescription(dimension.estado === "Se aplica hoy" ? "Un servicio lee este valor y cambia una decisión con él." : dimension.estado === "Descriptiva"
      ? "Se guarda y describe cómo opera el grupo. Ningún servicio lo lee hoy para decidir nada."
      : "Se guarda como descripción. Falta definir su efecto; hoy no cambia permisos ni restricciones.");
  }
  const caja = page.getByLabel("Fondo Fijo de Caja Chica por Sucursal").locator("..").locator("..");
  await expect(caja.getByText("Descriptiva", { exact: true })).toBeVisible();
  await expect(caja).toContainText("Hoy no limita aperturas, reposiciones ni gastos");
  const gerente = page.getByLabel("Límite de Autonomía de Gerente").locator("..").locator("..");
  await expect(gerente.getByText("Se aplica hoy", { exact: true })).toBeVisible();
  expect(fixture.errores).toEqual([]);
});

test("todos los valores de las siete dimensiones sobreviven al guardado y recarga", async ({ page }) => {
  const fixture = await abrir(page);
  for (const dimension of DIMENSIONES) {
    for (let i = 0; i < dimension.valores.length; i++) {
      const grupo = page.getByRole("radiogroup", { name: dimension.etiqueta, exact: true });
      // El nombre incluye la descripción: «Consolidada» también aparece en
      // la opción Mixto. Anclar el título evita seleccionar ambas opciones.
      const opcion = grupo.getByRole("radio", { name: new RegExp(`^${dimension.opciones[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `) });
      await opcion.click();
      // Un valor ya seleccionado no requiere escritura.
      if (await page.getByRole("button", { name: "Guardar Configuración" }).isEnabled()) {
        await guardar(page);
        expect(fixture.enviados.at(-1)?.[dimension.campo]).toBe(dimension.valores[i]);
      }
      await page.reload();
      await expect(opcion).toHaveAttribute("aria-checked", "true");
      await expect(grupo.locator("..").getByText(dimension.estado, { exact: true })).toBeVisible();
    }
  }
  expect(fixture.errores).toEqual([]);
});

test("las dimensiones se seleccionan con flechas y conservan el foco", async ({ page }) => {
  const fixture = await abrir(page);
  const grupo = page.getByRole("radiogroup", { name: "Estructura de Compras", exact: true });
  const hibrido = grupo.getByRole("radio", { name: "Híbrido" });
  const centralizada = grupo.getByRole("radio", { name: "Centralizada" });
  await hibrido.focus();
  await page.keyboard.press("ArrowRight");
  await expect(centralizada).toBeFocused();
  await expect(centralizada).toHaveAttribute("aria-checked", "true");
  await expect(centralizada).toHaveAttribute("tabindex", "0");
  await expect(hibrido).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowLeft");
  await expect(hibrido).toBeFocused();
  await expect(hibrido).toHaveAttribute("aria-checked", "true");
  expect(fixture.errores).toEqual([]);
});

test("los estados de política caben en móvil, tablet y escritorio", async ({ page }) => {
  const fixture = await abrir(page);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const grupo = page.getByRole("radiogroup", { name: "Tipo de Estructura del Grupo", exact: true });
    await grupo.scrollIntoViewIfNeeded();
    await expect(grupo.locator("..").getByText("Se aplica hoy", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(fixture.errores).toEqual([]);
});

const REGLA_COMPRA = { id: "regla-oc", amountMin: 0, amountMax: 100000, requiredRole: "GERENTE", minQuotes: 1, sequence: 1, active: true };

test("la empresa elige aprobador y rango desde configuración y la matriz sobrevive al recargar", async ({ page }) => {
  let rules = [REGLA_COMPRA];
  const enviados: Record<string, unknown>[] = [];
  await page.route("**/api/approval-matrix*", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      enviados.push(body);
      rules = body.rules;
    }
    return route.fulfill({ json: { rules, warnings: [] } });
  });
  const fixture = await abrir(page);
  const matriz = page.getByRole("region", { name: "Aprobaciones de compras" });
  await matriz.getByLabel("Regla 1: monto máximo").fill("2500");
  await matriz.getByRole("combobox", { name: "Regla 1: rol aprobador" }).click();
  await page.getByRole("option", { name: "OWNER", exact: true }).click();
  await matriz.getByRole("button", { name: "Guardar matriz de compras" }).click();
  await expect(matriz.getByRole("status")).toContainText("Matriz OC guardada");
  expect(enviados).toEqual([{ docType: "OC", rules: [expect.objectContaining({ amountMin: 0, amountMax: 250000, requiredRole: "OWNER", sequence: 1 })] }]);
  expect(fixture.enviados).toEqual([]);
  await page.reload();
  await expect(matriz.getByLabel("Regla 1: monto máximo")).toHaveValue("2500");
  await expect(matriz.getByRole("combobox", { name: "Regla 1: rol aprobador" })).toHaveText("OWNER");
  await expect(matriz.getByRole("button", { name: "Guardar matriz de compras" })).toBeDisabled();
  expect(fixture.errores).toEqual([]);
});

test("el rechazo de matriz conserva el borrador y permite reintentar con advertencias de cobertura", async ({ page }) => {
  let intentos = 0;
  await page.route("**/api/approval-matrix*", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: { rules: [REGLA_COMPRA] } });
    intentos++;
    if (intentos === 1) return route.fulfill({ status: 400, json: { error: "Revisa los rangos de aprobación." } });
    return route.fulfill({ json: { rules: route.request().postDataJSON().rules, warnings: ["Hay montos sin cobertura."] } });
  });
  const fixture = await abrir(page);
  const matriz = page.getByRole("region", { name: "Aprobaciones de compras" });
  await matriz.getByLabel("Regla 1: monto máximo").fill("3000");
  await matriz.getByRole("button", { name: "Guardar matriz de compras" }).click();
  // El `Alert` y su descripción declaran ambos `role="alert"`.
  await expect(matriz.getByRole("alert").first()).toContainText("Revisa los rangos");
  await expect(matriz.getByLabel("Regla 1: monto máximo")).toHaveValue("3000");
  await matriz.getByRole("button", { name: "Guardar matriz de compras" }).click();
  await expect(matriz.getByRole("status")).toContainText("Matriz OC guardada");
  await expect(matriz).toContainText("Los montos sin una regla activa que los cubra no podrán enviarse a aprobación.");
  expect(fixture.errores).toEqual([]);
});

test("una carga rechazada de matriz no permite guardar reglas vacías y recupera al reintentar", async ({ page }) => {
  let intentos = 0;
  await page.route("**/api/approval-matrix*", (route) => {
    intentos++;
    if (intentos === 1) return route.fulfill({ status: 403, json: { error: "Solo ADMIN o rol superior puede editar la matriz." } });
    return route.fulfill({ json: { rules: [REGLA_COMPRA] } });
  });
  const fixture = await abrir(page);
  const matriz = page.getByRole("region", { name: "Aprobaciones de compras" });
  await expect(matriz).toContainText("Solo ADMIN o rol superior");
  await expect(matriz.getByRole("button", { name: "Guardar matriz de compras" })).toHaveCount(0);
  await matriz.getByRole("button", { name: "Reintentar matriz" }).click();
  await expect(matriz.getByLabel("Regla 1: monto máximo")).toHaveValue("1000");
  await expect(matriz.getByRole("button", { name: "Guardar matriz de compras" })).toBeDisabled();
  expect(fixture.errores).toEqual([]);
});

test("la matriz de compras con reglas cabe en los cuatro tamaños de pantalla", async ({ page }) => {
  await page.route("**/api/approval-matrix*", (route) => route.fulfill({ json: { rules: [REGLA_COMPRA] } }));
  const fixture = await abrir(page);
  const matriz = page.getByRole("region", { name: "Aprobaciones de compras" });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await matriz.scrollIntoViewIfNeeded();
    await expect(matriz.getByLabel("Regla 1: monto máximo")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await matriz.screenshot({ path: ".tmp/c16-approvals-desktop.png" });
  expect(fixture.errores).toEqual([]);
});


/* ── C16.2.3 — controles de solicitud y emisión ── */

const controles = (page: Page) => page.getByRole("region", { name: "Quién solicita y quién emite" });

const SIN_CONTROLES = {
  REQUEST: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
  EMIT: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
};

test("la tarjeta dice que sin reglas decide el permiso vigente, no que cualquiera puede", async ({ page }) => {
  const fixture = await abrir(page);
  const seccion = controles(page);
  await expect(seccion.getByText(/Sin controles: decide el permiso de inventario vigente/)).toHaveCount(2);
  await expect(seccion).toContainText("no es una puerta abierta, es ausencia de política");
  await expect(seccion).toContainText("no concede permisos");
  await expect(seccion.getByRole("button", { name: "Guardar controles de solicitar" })).toBeDisabled();
  await expect(seccion.getByRole("button", { name: "Guardar controles de emitir" })).toBeDisabled();
  expect(fixture.errores).toEqual([]);
});

test("una regla por sucursal guarda, recarga y muestra su efecto", async ({ page }) => {
  let respuesta = SIN_CONTROLES;
  const enviados: Record<string, unknown>[] = [];
  await page.route("**/api/purchase-delegation*", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      enviados.push(body);
      respuesta = {
        ...SIN_CONTROLES,
        [body.action]: {
          reglas: body.rules,
          descripcion: "GERENTE puede solicitar en la sucursal a1000001-0000-4000-8000-000000000001",
        },
      };
    }
    return route.fulfill({ json: respuesta });
  });

  const fixture = await abrir(page);
  const seccion = controles(page);
  await seccion.getByRole("button", { name: "Agregar regla" }).first().click();
  await seccion.getByLabel("Regla 1: alcance").first().click();
  await page.getByRole("option", { name: "Una sucursal" }).click();
  await seccion.getByLabel("Regla 1: sucursal").first().click();
  await page.getByRole("option", { name: "P centro" }).click();
  await seccion.getByRole("button", { name: "Guardar controles de solicitar" }).click();

  await expect(seccion.getByRole("status").first()).toContainText("1 reglas");
  expect(enviados).toEqual([
    {
      action: "REQUEST",
      rules: [
        expect.objectContaining({
          action: "REQUEST",
          scope: "BRANCH",
          branchId: "a1000001-0000-4000-8000-000000000001",
          requiredRole: "GERENTE",
          active: true,
        }),
      ],
    },
  ]);
  expect(fixture.enviados).toEqual([]);

  await page.reload();
  await expect(seccion.getByLabel("Regla 1: alcance").first()).toHaveText("Una sucursal");
  await expect(seccion.getByLabel("Regla 1: sucursal").first()).toHaveText("P centro");
  await expect(seccion.getByLabel("Regla 1: rol").first()).toHaveText("GERENTE");
  await expect(seccion.getByRole("button", { name: "Guardar controles de solicitar" })).toBeDisabled();
  expect(fixture.errores).toEqual([]);
});

test("cada acción se guarda por separado: emitir no toca lo de solicitar", async ({ page }) => {
  const acciones: string[] = [];
  let deSolicitud: Array<Record<string, unknown>> = [];
  await page.route("**/api/purchase-delegation*", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      acciones.push(body.action);
      if (body.action === "REQUEST") deSolicitud = body.rules;
    }
    return route.fulfill({
      json: {
        REQUEST: { reglas: deSolicitud, descripcion: "ADMIN puede solicitar en toda la empresa" },
        EMIT: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
        warnings: [],
      },
    });
  });

  const fixture = await abrir(page);
  const seccion = controles(page);

  await seccion.getByRole("button", { name: "Agregar regla" }).first().click();
  await seccion.getByLabel("Regla 1: rol").first().click();
  await page.getByRole("option", { name: "ADMIN", exact: true }).click();
  await seccion.getByRole("button", { name: "Guardar controles de solicitar" }).click();
  await expect(seccion.getByRole("status").first()).toContainText("guardados");

  await seccion.getByRole("button", { name: "Agregar regla" }).nth(1).click();
  await seccion.getByLabel("Regla 1: rol").nth(1).click();
  await page.getByRole("option", { name: "OWNER", exact: true }).click();
  await seccion.getByRole("button", { name: "Guardar controles de emitir" }).click();

  expect(acciones).toEqual(["REQUEST", "EMIT"]);
  await page.reload();
  await expect(seccion.getByLabel("Regla 1: rol").first()).toHaveText("ADMIN");
  expect(fixture.errores).toEqual([]);
});

test("un rechazo del servidor conserva el borrador y muestra el motivo", async ({ page }) => {
  let intentos = 0;
  await page.route("**/api/purchase-delegation*", (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: SIN_CONTROLES });
    intentos++;
    return intentos === 1
      ? route.fulfill({
          status: 400,
          json: { error: "Alguna de las sucursales no pertenece a esta empresa." },
        })
      : route.fulfill({ json: { ...SIN_CONTROLES, warnings: [] } });
  });

  const fixture = await abrir(page);
  const seccion = controles(page);
  await seccion.getByRole("button", { name: "Agregar regla" }).first().click();
  await seccion.getByLabel("Regla 1: alcance").first().click();
  await page.getByRole("option", { name: "Una sucursal" }).click();
  await seccion.getByLabel("Regla 1: sucursal").first().click();
  await page.getByRole("option", { name: "P centro" }).click();
  await seccion.getByRole("button", { name: "Guardar controles de solicitar" }).click();

  await expect(seccion.getByRole("alert").first()).toContainText("no pertenece a esta empresa");
  await expect(seccion.getByLabel("Regla 1: sucursal").first()).toHaveText("P centro");
  await seccion.getByRole("button", { name: "Guardar controles de solicitar" }).click();
  await expect(seccion.getByRole("status").first()).toContainText("guardados");
  expect(intentos).toBe(2);
  expect(fixture.errores).toEqual([]);
});

test("una regla sin destino no llega al servidor", async ({ page }) => {
  const enviados: unknown[] = [];
  await page.route("**/api/purchase-delegation*", async (route) => {
    if (route.request().method() === "PUT") enviados.push(route.request().postDataJSON());
    return route.fulfill({ json: SIN_CONTROLES });
  });

  const fixture = await abrir(page);
  const seccion = controles(page);
  await seccion.getByRole("button", { name: "Agregar regla" }).first().click();
  await seccion.getByLabel("Regla 1: alcance").first().click();
  await page.getByRole("option", { name: "Una sucursal" }).click();
  await seccion.getByRole("button", { name: "Guardar controles de solicitar" }).click();

  await expect(seccion.getByRole("alert").first()).toContainText("Elige la sucursal");
  expect(enviados).toEqual([]);
  expect(fixture.errores).toEqual([]);
});

test("una carga rechazada no monta reglas vacías y recupera al reintentar", async ({ page }) => {
  let intentos = 0;
  await page.route("**/api/purchase-delegation*", (route) => {
    intentos++;
    return intentos === 1
      ? route.fulfill({
          status: 403,
          json: { error: "Sólo ADMIN o rol superior puede consultar los controles de compras" },
        })
      : route.fulfill({
          json: {
            REQUEST: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
            EMIT: {
              reglas: [
                {
                  id: "e1",
                  action: "EMIT",
                  scope: "CATEGORY",
                  branchId: null,
                  category: "ABARROTES",
                  requiredRole: "ADMIN",
                  active: true,
                },
              ],
              descripcion: "ADMIN puede emitir en la categoría ABARROTES",
            },
          },
        });
  });

  const fixture = await abrir(page);
  const seccion = controles(page);
  await expect(seccion).toContainText("Sólo ADMIN o rol superior");
  await expect(seccion.getByRole("button", { name: "Guardar controles de solicitar" })).toHaveCount(0);
  // Hay un reintento por acción: el de solicitud es el primero.
  await seccion.getByRole("button", { name: "Reintentar controles" }).first().click();
  await expect(seccion.getByLabel("Regla 1: categoría").last()).toHaveValue("ABARROTES");
  await expect(seccion.getByLabel("Regla 1: rol").last()).toHaveText("ADMIN");
  expect(fixture.errores).toEqual([]);
});

test("los avisos de cobertura se muestran y no bloquean el guardado", async ({ page }) => {
  await page.route("**/api/purchase-delegation*", async (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          json: {
            ...SIN_CONTROLES,
            warnings: [
              "Dos reglas activas cubren toda la empresa con roles distintos (ADMIN y GERENTE): se aplica la más permisiva.",
            ],
          },
        })
      : route.fulfill({ json: SIN_CONTROLES }),
  );

  const fixture = await abrir(page);
  const seccion = controles(page);
  await seccion.getByRole("button", { name: "Agregar regla" }).first().click();
  await seccion.getByRole("button", { name: "Guardar controles de solicitar" }).click();
  await expect(seccion).toContainText("Dos reglas activas cubren toda la empresa");
  await expect(seccion).toContainText("Se guardaron igual: son avisos, no errores");
  expect(fixture.errores).toEqual([]);
});

test("los controles de compras caben en los cuatro tamaños de pantalla", async ({ page }) => {
  const fixture = await abrir(page);
  const seccion = controles(page);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await seccion.scrollIntoViewIfNeeded();
    await expect(seccion.getByRole("button", { name: "Agregar regla" }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await seccion.screenshot({ path: ".tmp/c16-delegacion-desktop.png" });
  expect(fixture.errores).toEqual([]);
});
