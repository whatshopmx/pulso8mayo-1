import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * C31 — V2: del parámetro configurado al indicador en pantalla, con datos
 * conocidos.
 *
 * El recorrido cruza dos pantallas reales sobre el mismo navegador:
 *  - `/config` (formulario de configuración operativa) guarda el parámetro;
 *  - `/liga` (Liga de Sucursales) presenta la meta y la procedencia que el
 *    servidor declara para el período.
 *
 * El servidor de la prueba es un **fixture controlado**: mantiene la
 * configuración guardada por el `PUT` y deriva de ella la meta de prime cost
 * que devuelve a la Liga. La aritmética del parámetro sobre la métrica vive en
 * V1 (C14.2 sobre el consumidor real y C29/C30 sobre el servicio); aquí se
 * comprueba que la pantalla queda gobernada por ese valor —no por una
 * constante—, que la recarga lo conserva y que un rechazo de autorización no
 * persiste nada.
 *
 * La autorización y el historial (`config_change_logs`) viven en
 * `tests/unit/company/config-history.test.ts`; esta prueba no ejecuta
 * autenticación ni base de datos.
 */

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;

test.beforeAll(async () => {
  harness = await startShiftsBrowserServer();
});
test.afterAll(async () => {
  await harness?.server.close();
});

const CONFIG_BASE = {
  purchasingStructure: "HIBRIDO",
  foodProduction: "COCINA_CENTRAL",
  managerAuthLimitCents: 0,
  doubleApprovalThresholdCents: 250000,
  pettyCashLimitCents: 0,
  emergencyPurchaseCapCents: null,
  courtesyWasteMonthlyCapCents: null,
  foodCostTargetPercent: "30.00",
  foodCostWarnPercent: "35.50",
  laborCostTargetPercent: "28.00",
  laborCostWarnPercent: "32.00",
  healthyMarginTargetPercent: "45.00",
  healthyMarginWarnPercent: "35.00",
  vatRatePercent: "8.00",
  laborBurdenFactorPercent: null,
  payrollStateTaxPercent: "3.00",
  mermaVarianceThresholdPct: "2.50",
};

/** C30 — un renglón medido: la tabla de la Liga lee `quality` por campo. */
const sucursal = (branchId: string, branchName: string, rank: number, food: number, prime: number) => ({
  branchId,
  branchName,
  salesTotalCents: 90_000_000,
  foodCostCents: Math.round((food / 100) * 90_000_000),
  laborCostCents: 21_600_000,
  foodCostPercent: food,
  laborCostPercent: 24,
  primeCostPercent: prime,
  primeCostStatus: (prime < 54 ? "HEALTHY" : prime <= 63 ? "WATCH" : "CRITICAL") as
    | "HEALTHY"
    | "WATCH"
    | "CRITICAL",
  nom251ComplianceRate: 98,
  cashReconciliationRate: 100,
  compositeScore: 95 - rank,
  rank,
  quality: {
    sales: "MEASURED" as const,
    foodCost: "MEASURED" as const,
    laborCost: "MEASURED" as const,
    nom251: "MEASURED" as const,
    cashReconciliation: "MEASURED" as const,
  },
  dataQuality: "MEASURED" as const,
});

const erroresDe = (page: Page) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) errores.push(m.text());
  });
  return errores;
};

interface Fixture {
  /** La configuración que el "servidor" tiene guardada ahora mismo. */
  config: Record<string, unknown>;
  /** Cuerpos de los PUT recibidos. */
  enviados: Record<string, unknown>[];
}

/**
 * Monta los stubs que las dos pantallas necesitan. La Liga deriva su meta de
 * la configuración guardada: food + labor, el mismo contrato que el servidor
 * real. El objetivo se recalcula en cada request, así el cambio se ve.
 */
async function montar(page: Page, opciones: { putForbidden?: boolean } = {}): Promise<Fixture> {
  const fixture: Fixture = { config: { ...CONFIG_BASE }, enviados: [] };

  await page.route("**/api/company/operating-config", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      fixture.enviados.push(body);
      if (opciones.putForbidden) {
        return route.fulfill({
          status: 403,
          json: {
            success: false,
            error: {
              message: "Solo un administrador u owner puede modificar la configuración del modelo operativo.",
            },
          },
        });
      }
      fixture.config = { ...fixture.config, ...body };
      return route.fulfill({ json: { success: true, data: fixture.config } });
    }
    return route.fulfill({ json: { success: true, data: fixture.config } });
  });

  await page.route("**/api/group/branches-qsr*", async (route) => {
    const food = Number(fixture.config.foodCostTargetPercent ?? 30);
    const labor = Number(fixture.config.laborCostTargetPercent ?? 28);
    const target = Math.round((food + labor) * 100) / 100;
    const warn = Math.round(target * 1.15 * 100) / 100;
    const body = {
      periodDays: 30,
      branches: [
        sucursal("b1", "Sucursal Norte", 1, 28, 52),
        sucursal("b2", "Sucursal Sur", 2, 36, 58),
        sucursal("b3", "Franquicia Centro", 3, 30, 70),
      ],
      podiumTop3: [sucursal("b1", "Sucursal Norte", 1, 28, 52)],
      networkAveragePrimeCost: 60,
      networkAverageFoodCost: 31.3,
      networkAverageLaborCost: 24,
      primeCostTargetPercent: target,
      primeCostWarnPercent: warn,
      anomalies: [],
      alcance: { completa: true, visibles: 3, total: 3, motivo: null },
    };
    return route.fulfill({ json: { success: true, data: body } });
  });

  await page.route("**/api/approval-matrix*", (route) => route.fulfill({ json: { rules: [] } }));
  await page.route("**/api/purchase-delegation*", (route) =>
    route.fulfill({
      json: {
        REQUEST: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
        EMIT: { reglas: [], descripcion: "Sin controles: decide el permiso de inventario vigente." },
      },
    }),
  );
  await page.route("**/api/branches*", (route) =>
    route.fulfill({ json: { success: true, data: [{ id: "a1000001-0000-4000-8000-000000000001", name: "P centro" }] } }),
  );

  return fixture;
}

const guardarConfig = (page: Page) =>
  Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith("/api/company/operating-config") && res.request().method() === "PUT",
    ),
    page.getByRole("button", { name: "Guardar Configuración" }).click(),
  ]);

async function abrirLiga(page: Page) {
  await page.goto(`${harness.url}/liga`);
  await expect(page.getByRole("heading", { name: "Liga de Sucursales" })).toBeVisible();
}

test("cambiar el objetivo en configuración mueve la meta de la Liga y sobrevive a la recarga", async ({
  page,
}) => {
  const fixture = await montar(page);
  const errores = erroresDe(page);

  // Punto de partida: 30 + 28 = 58.
  await abrirLiga(page);
  await expect(page.getByText("Meta ≤58%")).toBeVisible();
  await expect(page.getByText("Salud de Red (≤58%)")).toBeVisible();
  // El indicador nombra su unidad y su procedencia (C29/C30).
  await expect(page.getByText("Food Cost % · merma")).toBeVisible();
  await expect(page.getByText("Labor Cost % · carga")).toBeVisible();

  // Cambiar el objetivo de food cost en la configuración.
  await page.goto(`${harness.url}/config`);
  const objetivoFood = page.getByLabel("Objetivo (Zona Verde hasta)").first();
  await expect(objetivoFood).toHaveValue("30");
  await objetivoFood.fill("26");
  await guardarConfig(page);
  expect(fixture.enviados[0]).toMatchObject({ foodCostTargetPercent: 26, laborCostTargetPercent: 28 });

  // La Liga toma el valor declarado (26 + 28 = 54), no la constante 60.
  await abrirLiga(page);
  await expect(page.getByText("Meta ≤54%")).toBeVisible();
  await expect(page.getByText("Salud de Red (≤54%)")).toBeVisible();
  await expect(page.getByText("<54% Saludable")).toBeVisible();
  await expect(page.getByText("54-62.1% Observación")).toBeVisible();
  await expect(page.getByText(">62.1% Crítico")).toBeVisible();
  await expect(page.getByText("Meta ≤60%")).toHaveCount(0);
  await expect(page.getByText("<60% Saludable")).toHaveCount(0);

  // La recarga conserva configuración, procedencia y unidad.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Liga de Sucursales" })).toBeVisible();
  await expect(page.getByText("Meta ≤54%")).toBeVisible();
  await expect(page.getByText("Food Cost % · merma")).toBeVisible();

  expect(errores).toEqual([]);
});

test("un parámetro con estado nulo se recarga como vacío, no como default", async ({ page }) => {
  const fixture = await montar(page);
  const errores = erroresDe(page);

  await page.goto(`${harness.url}/config`);
  // La unidad y el contrato del vacío se declaran junto al campo.
  await expect(page.getByLabel("Tasa de IVA estimada")).toHaveValue("8");
  await expect(page.getByText("Vacío = no estimar")).toBeVisible();
  await expect(page.getByLabel("Carga patronal sobre nómina bruta")).toHaveValue("");
  await expect(page.getByText("Vacío = sin factor")).toBeVisible();

  await page.getByLabel("Tasa de IVA estimada").fill("16");
  await guardarConfig(page);
  expect(fixture.enviados[0]).toMatchObject({ vatRatePercent: 16, laborBurdenFactorPercent: null });

  await page.reload();
  await expect(page.getByLabel("Tasa de IVA estimada")).toHaveValue("16");
  // El null persistido sigue vacío: no revive como 0 ni como el default 16.
  await expect(page.getByLabel("Carga patronal sobre nómina bruta")).toHaveValue("");

  expect(errores).toEqual([]);
});

test("un usuario no autorizado no cambia parámetros: el rechazo no persiste tras recargar", async ({
  page,
}) => {
  const fixture = await montar(page, { putForbidden: true });
  const errores = erroresDe(page);

  await page.goto(`${harness.url}/config`);
  const objetivoFood = page.getByLabel("Objetivo (Zona Verde hasta)").first();
  await expect(objetivoFood).toHaveValue("30");
  await objetivoFood.fill("20");

  const [respuesta] = await guardarConfig(page);
  // El servidor es autoritativo: rechaza y lo dice.
  expect(respuesta.status()).toBe(403);
  expect(fixture.enviados).toHaveLength(1);
  // El intento no borra lo que el usuario escribió.
  await expect(objetivoFood).toHaveValue("20");

  // Nada persistió: la recarga vuelve al valor guardado por el servidor.
  await page.reload();
  await expect(page.getByLabel("Objetivo (Zona Verde hasta)").first()).toHaveValue("30");

  expect(errores).toEqual([]);
});
