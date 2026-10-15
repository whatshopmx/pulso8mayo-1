import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * C22 — V2 de la vista de grupo (Liga de Sucursales) en navegador aislado.
 *
 * La pantalla sólo habla con `/api/group/branches-qsr`, que aquí intercepta
 * con respuestas construidas con la forma real del servicio. Lo que se
 * comprueba es que la vista **presenta** lo que la política de tipo de empresa
 * decide, sin reinterpretarlo:
 *
 *  1. Red segmentada → panel «Dos redes» con los promedios de cada red y el
 *     hallazgo etiquetado con su red.
 *  2. Grupo propio con franquicia capturada → contradicción a la vista y
 *     veredicto que no le atribuye al grupo una declaración que no hizo.
 *  3. Alcance parcial del actor → el aviso del servidor llega a la pantalla
 *     con sus cuentas; red única → el consolidado se explica como una sola red.
 *
 * La autorización y la segmentación en sí viven en V1
 * (`tests/unit/company/tenant-network-*.test.ts`); esta prueba no ejecuta
 * autenticación ni base de datos.
 */

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;

test.beforeAll(async () => {
  harness = await startShiftsBrowserServer();
});

test.afterAll(async () => {
  await harness?.server.close();
});

const sucursal = (
  branchId: string,
  branchName: string,
  rank: number,
  food: number,
  prime: number,
) => ({
  branchId,
  branchName,
  salesTotalCents: 90_000_000,
  foodCostCents: Math.round((food / 100) * 90_000_000),
  laborCostCents: 21_600_000,
  foodCostPercent: food,
  laborCostPercent: 24,
  primeCostPercent: prime,
  primeCostStatus: (prime < 60 ? "HEALTHY" : prime <= 65 ? "WATCH" : "CRITICAL") as
    | "HEALTHY"
    | "WATCH"
    | "CRITICAL",
  nom251ComplianceRate: 98,
  cashReconciliationRate: 100,
  compositeScore: 95 - rank,
  rank,
  dataQuality: "VERIFIED" as const,
});

const veredicto = (titulo: string, detalle: string) => ({ segmentada: true, titulo, detalle });

async function abrirLiga(page: Page, body: unknown): Promise<string[]> {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
      errores.push(m.text());
    }
  });
  await page.route("**/api/group/branches-qsr*", (route) =>
    route.fulfill({ json: { success: true, data: body } }),
  );
  await page.goto(`${harness.url}/liga`);
  await expect(page.getByRole("heading", { name: "Liga de Sucursales" })).toBeVisible();
  return errores;
}

test("red segmentada: dos redes con sus promedios y el hallazgo etiquetado con su red", async ({
  page,
}) => {
  const errores = await abrirLiga(page, {
    periodDays: 30,
    branches: [
      sucursal("b1", "Sucursal Norte", 1, 28, 52),
      sucursal("b2", "Sucursal Sur", 2, 36, 60),
      sucursal("b3", "Franquicia Centro", 3, 30, 54),
    ],
    podiumTop3: [
      sucursal("b1", "Sucursal Norte", 1, 28, 52),
      sucursal("b2", "Sucursal Sur", 2, 36, 60),
      sucursal("b3", "Franquicia Centro", 3, 30, 54),
    ],
    networkAveragePrimeCost: 55.3,
    networkAverageFoodCost: 31.3,
    networkAverageLaborCost: 24,
    anomalies: [
      {
        id: "food-cost-variance-b2",
        type: "FOOD_COST_DISCREPANCY",
        severity: "critical",
        title: "Desviación de Food Cost en Sucursal Sur",
        narrative:
          "Sucursal Sur reporta un costo de alimentos de 36.0%, que supera por 8.0 puntos a Sucursal Norte (28.0%) dentro de la red propia.",
        affectedBranchId: "b2",
        affectedBranchName: "Sucursal Sur",
        benchmarkBranchName: "Sucursal Norte",
        variancePoints: 8,
        estimatedImpactMxn: 72000,
        suggestedAction: "Auditar rendimiento de porciones en recetas.",
        red: "PROPIA",
      },
    ],
    red: {
      tipoEmpresa: "MIXTO_FRANQUICIAS",
      segmentada: true,
      veredicto: veredicto(
        "Dos redes · Red propia y Red de franquicias",
        "El grupo declara franquiciatarios: cada red se promedia y se compara con las suyas, no con el consolidado.",
      ),
      segmentos: [
        {
          tipo: "PROPIA",
          etiqueta: "Red propia",
          branchIds: ["b1", "b2"],
          sucursales: 2,
          promedios: { primeCost: 56, foodCost: 32, laborCost: 24 },
          podiumTop3: [],
          anomalias: [],
        },
        {
          tipo: "FRANQUICIAS",
          etiqueta: "Red de franquicias",
          branchIds: ["b3"],
          sucursales: 1,
          promedios: { primeCost: 54, foodCost: 30, laborCost: 24 },
          podiumTop3: [],
          anomalias: [],
        },
      ],
      contradicciones: [],
    },
    alcance: { completa: true, visibles: 3, total: 3, motivo: null },
  });

  const panel = page.getByTestId("redes-del-grupo");
  await expect(panel).toContainText("Dos redes · Red propia y Red de franquicias");
  await expect(panel).toContainText(
    "El grupo declara franquiciatarios: cada red se promedia y se compara con las suyas",
  );

  // Cada red con su cuenta y sus promedios, presentados por la pantalla.
  await expect(panel.getByText("Red propia", { exact: true })).toBeVisible();
  await expect(panel.getByText("Red de franquicias", { exact: true })).toBeVisible();
  await expect(panel.getByText("2 sucursales")).toBeVisible();
  await expect(panel.getByText("1 sucursal")).toBeVisible();
  await expect(panel.getByText("56.0%")).toBeVisible();
  await expect(panel.getByText("30.0%")).toBeVisible();

  // Sin alcance parcial no hay aviso: el actor ve la red completa.
  await expect(page.getByTestId("aviso-alcance")).toHaveCount(0);

  // El hallazgo lleva la etiqueta de su red junto al título.
  const hallazgo = page
    .getByText("Desviación de Food Cost en Sucursal Sur")
    .locator("..");
  await expect(hallazgo.getByText("Red propia", { exact: true })).toBeVisible();

  expect(errores).toEqual([]);
});

test("grupo propio con franquicia capturada: contradicción a la vista y aviso de alcance parcial", async ({
  page,
}) => {
  const errores = await abrirLiga(page, {
    periodDays: 30,
    branches: [
      sucursal("b1", "Sucursal Norte", 1, 28, 52),
      sucursal("b3", "Franquicia Centro", 2, 30, 54),
    ],
    podiumTop3: [
      sucursal("b1", "Sucursal Norte", 1, 28, 52),
      sucursal("b3", "Franquicia Centro", 2, 30, 54),
    ],
    networkAveragePrimeCost: 53,
    networkAverageFoodCost: 29,
    networkAverageLaborCost: 24,
    anomalies: [],
    red: {
      tipoEmpresa: "GRUPO_PROPIO",
      segmentada: true,
      veredicto: veredicto(
        "Dos redes · Red propia y Red de franquicias",
        "El grupo declara red propia, pero hay sucursales marcadas como franquicia: se miden aparte para no atribuirle al grupo dinero de un tercero.",
      ),
      segmentos: [
        {
          tipo: "PROPIA",
          etiqueta: "Red propia",
          branchIds: ["b1"],
          sucursales: 1,
          promedios: { primeCost: 52, foodCost: 28, laborCost: 24 },
          podiumTop3: [],
          anomalias: [],
        },
        {
          tipo: "FRANQUICIAS",
          etiqueta: "Red de franquicias",
          branchIds: ["b3"],
          sucursales: 1,
          promedios: { primeCost: 54, foodCost: 30, laborCost: 24 },
          podiumTop3: [],
          anomalias: [],
        },
      ],
      contradicciones: [
        "El grupo declara red propia y tiene 1 sucursal(es) marcadas como franquicia: se miden aparte igual.",
      ],
    },
    alcance: {
      completa: false,
      visibles: 2,
      total: 4,
      motivo:
        "Estás viendo sólo las sucursales que te corresponden: las cifras no son el consolidado del grupo.",
    },
  });

  // El aviso del servidor llega a la pantalla con sus cuentas.
  const aviso = page.getByTestId("aviso-alcance");
  await expect(aviso).toContainText(
    "Estás viendo sólo las sucursales que te corresponden",
  );
  await expect(aviso).toContainText("Tus cifras cubren 2 de 4 sucursales del grupo.");

  // La contradicción de captura queda a la vista, nombrada.
  const panel = page.getByTestId("redes-del-grupo");
  await expect(panel.getByRole("alert")).toContainText("Captura inconsistente");
  await expect(panel).toContainText(
    "El grupo declara red propia y tiene 1 sucursal(es) marcadas como franquicia",
  );
  // El veredicto no le atribuye al grupo una declaración que no hizo.
  await expect(panel).toContainText("El grupo declara red propia, pero hay sucursales marcadas");

  expect(errores).toEqual([]);
});

test("red única: el consolidado se explica como una sola red y no hay contradicciones", async ({
  page,
}) => {
  const errores = await abrirLiga(page, {
    periodDays: 30,
    branches: [
      sucursal("b1", "Sucursal Norte", 1, 28, 52),
      sucursal("b2", "Sucursal Sur", 2, 36, 60),
    ],
    podiumTop3: [
      sucursal("b1", "Sucursal Norte", 1, 28, 52),
      sucursal("b2", "Sucursal Sur", 2, 36, 60),
    ],
    networkAveragePrimeCost: 56,
    networkAverageFoodCost: 32,
    networkAverageLaborCost: 24,
    anomalies: [],
    red: {
      tipoEmpresa: "GRUPO_PROPIO",
      segmentada: false,
      veredicto: {
        segmentada: false,
        titulo: "Red única · Red propia",
        detalle:
          "El grupo declara red propia: los promedios comparan todas sus sucursales entre sí.",
      },
      segmentos: [
        {
          tipo: "PROPIA",
          etiqueta: "Red propia",
          branchIds: ["b1", "b2"],
          sucursales: 2,
          promedios: { primeCost: 56, foodCost: 32, laborCost: 24 },
          podiumTop3: [],
          anomalias: [],
        },
      ],
      contradicciones: [],
    },
    alcance: { completa: true, visibles: 2, total: 2, motivo: null },
  });

  const panel = page.getByTestId("redes-del-grupo");
  await expect(panel).toContainText("Red única · Red propia");
  await expect(panel).toContainText("los promedios comparan todas sus sucursales entre sí");
  await expect(panel.getByText("2 sucursales")).toBeVisible();

  await expect(page.getByTestId("aviso-alcance")).toHaveCount(0);
  await expect(page.getByText("Captura inconsistente")).toHaveCount(0);

  expect(errores).toEqual([]);
});
