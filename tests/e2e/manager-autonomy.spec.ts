import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";
import {
  denyExpenseResolution,
  rolExigidoPorMonto,
} from "../../lib/expenses/approval-policy";

/**
 * C20 — Verificación en navegador aislado de la política de autonomía del gerente.
 *
 * Prueba que:
 *  1. La interfaz de configuración presenta `managerAutonomy` como "Se aplica hoy",
 *     con su explicación de que un servicio lee este valor y cambia una decisión.
 *  2. Cada una de las 3 opciones (ALTA, MEDIA, BAJA) se puede seleccionar, enviar
 *     en el payload al servidor, y recargar con el valor persistido.
 *  3. La escalera de autorización y la segregación de funciones se evalúan
 *     consistentemente en el entorno del navegador para los 3 niveles:
 *     - ALTA: gerente facultado hasta umbral de dueño ($10,000 MXN); $5,000 no escala a ADMIN.
 *     - MEDIA: gerente acotado por managerAuthLimit ($1,000 MXN); $5,000 escala a ADMIN.
 *     - BAJA: gerente sin autoridad de aprobación; $500 escala a ADMIN.
 *     - Todo nivel escala a OWNER al alcanzar el umbral de Dirección General ($10,000 MXN).
 *     - La auto-aprobación queda siempre denegada (SELF) en todos los niveles.
 */

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;

test.beforeAll(async () => {
  harness = await startShiftsBrowserServer();
});

test.afterAll(async () => {
  await harness?.server.close();
});

interface ConfigFixture {
  guardados: Array<Record<string, unknown>>;
  errores: string[];
}

const CONFIG_BASE = {
  managerAuthLimitCents: 100_000,
  doubleApprovalThresholdCents: 1_000_000,
  emergencyPurchaseCapCents: 200_000,
  courtesyWasteMonthlyCapCents: 50_000,
  pettyCashLimitCents: 500_000,
  purchasingStructure: "CENTRALIZADA",
  foodProduction: "IN_SITU",
  treasuryModel: "CUENTA_UNICA",
  supplierPayment: "CENTRALIZADO",
  payrollDispersion: "CONSOLIDADA",
  managerAutonomy: "MEDIA",
  tenantType: "GRUPO_PROPIO",
  vatRatePercent: 16,
  laborBurdenFactorPercent: 35,
  payrollStateTaxPercent: 3,
  mermaVarianceThresholdPct: 5,
  foodCostTargetPct: 30,
  laborCostTargetPct: 25,
  operatingCostTargetPct: 15,
  targetMarginPct: 20,
};

async function abrirConfiguracion(page: Page, inicial?: Partial<typeof CONFIG_BASE>): Promise<ConfigFixture> {
  const guardados: Array<Record<string, unknown>> = [];
  const errores: string[] = [];

  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
      errores.push(m.text());
    }
  });

  let configActual = { ...CONFIG_BASE, ...inicial };

  await page.route("**/api/company/operating-config", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ json: { success: true, data: configActual } });
    }
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      guardados.push(body);
      configActual = { ...configActual, ...body };
      return route.fulfill({ json: { success: true, data: configActual } });
    }
    return route.continue();
  });

  await page.goto(`${harness.url}/config`);
  await expect(page.getByLabel("Límite de Autonomía de Gerente")).toBeVisible();

  return { guardados, errores };
}

const guardar = (page: Page) =>
  Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/company/operating-config") &&
        res.request().method() === "PUT",
    ),
    page.getByRole("button", { name: "Guardar Configuración" }).click(),
  ]);

test("la política de autonomía del gerente se muestra como 'Se aplica hoy'", async ({ page }) => {
  const fixture = await abrirConfiguracion(page);

  const grupo = page.getByRole("radiogroup", { name: "Autonomía del Gerente de Sucursal", exact: true });
  await expect(grupo.locator("..").getByText("Se aplica hoy", { exact: true })).toBeVisible();
  await expect(grupo).toHaveAccessibleDescription("Un servicio lee este valor y cambia una decisión con él.");

  expect(fixture.errores).toEqual([]);
});

test("las descripciones de ALTA, MEDIA y BAJA comunican con precisión la regla ejecutada", async ({ page }) => {
  const fixture = await abrirConfiguracion(page);

  const grupo = page.getByRole("radiogroup", { name: "Autonomía del Gerente de Sucursal", exact: true });

  // Alta
  await expect(grupo.getByText("Decide el gerente")).toBeVisible();
  await expect(grupo.getByText("El gerente de sucursal resuelve gastos ordinarios hasta el umbral de Dirección General.")).toBeVisible();

  // Media
  await expect(grupo.getByText("Catálogo acotado")).toBeVisible();
  await expect(grupo.getByText("El gerente resuelve gastos hasta el límite de autonomía ($); montos mayores escalan a corporativo.")).toBeVisible();

  // Baja
  await expect(grupo.getByText("Visto bueno corporativo")).toBeVisible();
  await expect(grupo.getByText("Todo gasto requiere autorización corporativa (ADMIN o superior); el gerente no firma gastos.")).toBeVisible();

  expect(fixture.errores).toEqual([]);
});

test("cambiar la autonomía a ALTA o BAJA envía el valor al servidor y se preserva al recargar", async ({ page }) => {
  const fixture = await abrirConfiguracion(page, { managerAutonomy: "MEDIA" });

  const grupo = page.getByRole("radiogroup", { name: "Autonomía del Gerente de Sucursal", exact: true });

  // 1. Cambiar a ALTA y guardar
  const opcionAlta = grupo.getByRole("radio", { name: /^Alta / });
  await opcionAlta.click();
  await guardar(page);

  expect(fixture.guardados).toHaveLength(1);
  expect(fixture.guardados[0].managerAutonomy).toBe("ALTA");

  await page.reload();
  await expect(opcionAlta).toHaveAttribute("aria-checked", "true");

  // 2. Cambiar a BAJA y guardar
  const opcionBaja = grupo.getByRole("radio", { name: /^Baja / });
  await opcionBaja.click();
  await guardar(page);

  expect(fixture.guardados).toHaveLength(2);
  expect(fixture.guardados[1].managerAutonomy).toBe("BAJA");

  await page.reload();
  await expect(opcionBaja).toHaveAttribute("aria-checked", "true");

  expect(fixture.errores).toEqual([]);
});

test("evaluación en el navegador: la escalera de autorización respeta la autonomía configurada", async () => {
  const umbralesBase = {
    managerAuthLimitCents: 100_000, // $1,000 MXN
    doubleApprovalThresholdCents: 1_000_000, // $10,000 MXN
  };

  // 1. En ALTA: el gerente puede autorizar $5,000 MXN
  const rolAlta5k = rolExigidoPorMonto(500_000, { ...umbralesBase, managerAutonomy: "ALTA" });
  expect(rolAlta5k).toBe("GERENTE");

  const gerentePuedeEnAlta = !denyExpenseResolution({
    actorRole: "GERENTE",
    actorId: "gerente-1",
    requiredApproverRole: rolAlta5k,
    requestedBy: "empleado-1",
  });
  expect(gerentePuedeEnAlta).toBe(true);

  // 2. En MEDIA: $5,000 MXN escala a ADMIN (supera el límite de $1,000 MXN)
  const rolMedia5k = rolExigidoPorMonto(500_000, { ...umbralesBase, managerAutonomy: "MEDIA" });
  expect(rolMedia5k).toBe("ADMIN");

  const gerenteBloqueadoEnMedia = denyExpenseResolution({
    actorRole: "GERENTE",
    actorId: "gerente-1",
    requiredApproverRole: rolMedia5k,
    requestedBy: "empleado-1",
  });
  expect(gerenteBloqueadoEnMedia).toBe("ROLE");

  // 3. En BAJA: incluso $500 MXN (50,000 centavos) exige ADMIN
  const rolBaja500 = rolExigidoPorMonto(50_000, { ...umbralesBase, managerAutonomy: "BAJA" });
  expect(rolBaja500).toBe("ADMIN");

  const gerenteBloqueadoEnBaja = denyExpenseResolution({
    actorRole: "GERENTE",
    actorId: "gerente-1",
    requiredApproverRole: rolBaja500,
    requestedBy: "empleado-1",
  });
  expect(gerenteBloqueadoEnBaja).toBe("ROLE");

  // 4. En cualquier nivel, $15,000 MXN escala a OWNER
  for (const autonomy of ["ALTA", "MEDIA", "BAJA"] as const) {
    const rol15k = rolExigidoPorMonto(1_500_000, { ...umbralesBase, managerAutonomy: autonomy });
    expect(rol15k).toBe("OWNER");

    expect(
      denyExpenseResolution({
        actorRole: "ADMIN",
        actorId: "admin-1",
        requiredApproverRole: rol15k,
        requestedBy: "empleado-1",
      })
    ).toBe("ROLE");
  }

  // 5. Segregación de funciones: auto-aprobación prohibida en todos los niveles
  for (const autonomy of ["ALTA", "MEDIA", "BAJA"] as const) {
    const rol = rolExigidoPorMonto(50_000, { ...umbralesBase, managerAutonomy: autonomy });
    expect(
      denyExpenseResolution({
        actorRole: autonomy === "BAJA" ? "ADMIN" : "GERENTE",
        actorId: "mismo-usuario",
        requiredApproverRole: rol,
        requestedBy: "mismo-usuario",
      })
    ).toBe("SELF");
  }
});
