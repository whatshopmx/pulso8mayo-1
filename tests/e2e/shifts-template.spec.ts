import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";
import { readFile } from "node:fs/promises";
import { SUCURSAL_A_1, SUCURSAL_A_2, SUCURSAL_B_1, shiftCompleto } from "../fixtures/tenant-isolation";

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

interface Operation {
  branchId: string; role: string; employeeIds: string[];
  startDate: string; endDate: string; pattern: string; daysOfWeek?: number[];
  shiftType: string; customStartTime?: string; customEndTime?: string;
}

const employees = [
  { id: "emp-ana", name: "Ana" },
  { id: "emp-pedro", name: "Pedro" },
];
const persistidos: ReturnType<typeof shiftCompleto>[] = [];

const operationOf = (url: string): Operation =>
  JSON.parse(new URL(url).searchParams.get("operation")!);

/** Filas de la vista previa: lo que el servidor simula, sin escribir nada. */
function filas(operation: Operation) {
  return operation.employeeIds.flatMap((employeeId) => {
    const turno = shiftCompleto({
      id: `${employeeId}-${operation.startDate}`,
      userId: employeeId,
      userName: employeeId === "emp-b" ? "Empresa B" : employees.find((employee) => employee.id === employeeId)?.name ?? employeeId,
      branchId: operation.branchId,
      branchName: operation.branchId === SUCURSAL_B_1 ? "Sur B" : operation.branchId === SUCURSAL_A_2 ? "Norte" : "Café Centro",
      role: operation.role,
      shiftDate: operation.startDate,
      startTime: operation.customStartTime ?? "07:00",
      endTime: operation.customEndTime ?? "15:00",
    });
    // Ana ya tiene un turno el 5: esa fila no se puede aplicar.
    const choca = employeeId === "emp-ana" && operation.startDate === "2026-10-05";
    return [{
      ...turno, date: turno.shiftDate, employeeId, canApply: !choca, warnings: [],
      error: choca ? "El turno solapa con uno existente [SHIFT_OVERLAP]" : undefined,
    }];
  });
}

async function abrirPlantillas(page: Page, empresaB = false, fallaPlantillas = false) {
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errores.push(message.text()); });
  await page.clock.install({ time: new Date("2026-10-07T12:00:00-06:00") });
  const catalogos = empresaB
    ? { branches: [{ id: SUCURSAL_B_1, name: "Sur B" }], employees: [{ id: "emp-b", name: "Empresa B" }] }
    : { branches: [{ id: SUCURSAL_A_1, name: "Café Centro" }, { id: SUCURSAL_A_2, name: "Norte" }], employees };
  await page.route("**/fixture/catalog", (route) => route.fulfill({ json: { ...catalogos, roles: ["CAJERO", "MESERO"], sinAlcance: false } }));
  await page.route("**/fixture/shifts?*", (route) => route.fulfill({ json: persistidos }));
  let falla = fallaPlantillas;
  await page.route("**/fixture/templates", (route) => {
    if (falla) { falla = false; return route.fulfill({ status: 500 }); }
    return route.fulfill({ json: [
    { name: "Turno Mañana", description: "07:00–15:00 de lunes a viernes", branchId: "", role: "CAJERO", startTime: "07:00", endTime: "15:00", daysOfWeek: [1, 2, 3, 4, 5], isActive: true },
    ] });
  });
  await page.route("**/fixture/template-preview?*", (route) => {
    const operation = operationOf(route.request().url());
    return route.fulfill({ json: filas(operation) });
  });
  await page.route("**/fixture/template-apply?*", (route) => {
    const operation = operationOf(route.request().url());
    const resultado = filas(operation);
    const created = resultado.filter((fila) => fila.canApply);
    persistidos.push(...created);
    return route.fulfill({ json: {
      created: created.map((fila) => ({ ...fila, status: "DRAFT" })),
      failed: resultado.filter((fila) => !fila.canApply).map((fila) => ({ date: fila.shiftDate, employeeId: fila.employeeId, error: fila.error })),
    } });
  });
  await page.goto(harness.url);
  await expect(page.getByRole("tab", { name: "Plantillas" })).toBeEnabled();
  await page.getByRole("tab", { name: "Plantillas" }).click();
  if (!fallaPlantillas) await expect(page.getByRole("combobox", { name: "Plantilla" })).toBeEnabled();
  return errores;
}

async function elegirDestino(page: Page, empleadosSeleccionados: string[]) {
  await page.getByRole("combobox", { name: "Plantilla" }).selectOption({ label: "Turno Mañana (07:00–15:00)" });
  await page.getByRole("combobox", { name: "Sucursal" }).selectOption({ label: "Café Centro" });
  await page.getByRole("combobox", { name: "Rol del turno" }).selectOption("CAJERO");
  await page.getByLabel("Desde").fill("2026-10-05");
  await page.getByLabel("Hasta").fill("2026-10-05");
  for (const nombre of empleadosSeleccionados) await page.getByRole("checkbox", { name: nombre }).check();
}

test.beforeEach(() => { persistidos.length = 0; });

test("la vista previa identifica turnos y conflictos antes de confirmar", async ({ page }) => {
  const errores = await abrirPlantillas(page);
  await elegirDestino(page, ["Ana", "Pedro"]);
  await page.getByRole("button", { name: "Vista previa" }).click();
  const tabla = page.getByRole("table");
  await expect(tabla).toBeVisible();
  await expect(tabla.getByRole("row")).toHaveCount(3);
  await expect(tabla.getByText("2026-10-05")).toHaveCount(2);
  await expect(page.getByRole("status")).toContainText("1 turnos disponibles");
  await expect(page.getByRole("status")).toContainText("1 rechazados");
  await expect(tabla.getByText(/solapa/)).toHaveCount(1);
  await expect(page.getByText("Café Centro / CAJERO")).toHaveCount(2);
  expect(persistidos).toEqual([]);
  expect(errores).toEqual([]);
});

test("sin empleados seleccionados la vista previa no se puede pedir", async ({ page }) => {
  const errores = await abrirPlantillas(page);
  await page.getByRole("combobox", { name: "Plantilla" }).selectOption({ label: "Turno Mañana (07:00–15:00)" });
  await expect(page.getByRole("button", { name: "Vista previa" })).toBeDisabled();
  expect(errores).toEqual([]);
});

test("confirmar informa lo aplicado y lo rechazado, y la vista semanal lo refleja", async ({ page }) => {
  const errores = await abrirPlantillas(page);
  await elegirDestino(page, ["Ana", "Pedro"]);
  await page.getByRole("button", { name: "Vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();
  const resultado = page.getByRole("region", { name: "Resultado de aplicación" });
  await expect(resultado).toBeVisible();
  await expect(resultado.getByRole("status")).toContainText("1 turnos creados");
  await expect(resultado.getByRole("status")).toContainText("1 rechazados");
  await expect(resultado.getByText(/Pedro · Café Centro \/ CAJERO · 07:00–15:00: Creado/)).toBeVisible();
  await expect(resultado.getByText(/2026-10-05 · Ana: Rechazado/)).toBeVisible();
  await expect(resultado.getByText("SHIFT_OVERLAP")).toHaveCount(0);
  expect(persistidos).toEqual([expect.objectContaining({ userName: "Pedro", shiftDate: "2026-10-05", branchName: "Café Centro" })]);
  await resultado.getByRole("button", { name: "Ver turnos en Vista Semanal" }).click();
  await expect(page.getByRole("tab", { name: "Vista Semanal" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Pedro", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pedro", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const csv = await readFile((await (await downloaded).path())!, "utf8");
  expect(csv).toContain('"Pedro","Café Centro"');
  expect(csv).not.toContain('"Ana"');
  expect(errores).toEqual([]);
});

test("un fallo al aplicar conserva el aviso y no inventa un resultado", async ({ page }) => {
  const errores = await abrirPlantillas(page);
  await page.route("**/fixture/template-apply?*", (route) => route.fulfill({ status: 500 }));
  await elegirDestino(page, ["Pedro"]);
  await page.getByRole("button", { name: "Vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos confirmar el resultado");
  await expect(page.getByRole("region", { name: "Resultado de aplicación" })).toHaveCount(0);
  expect(persistidos).toEqual([]);
  expect(errores).toEqual([]);
});

test("un destino rechazado por el servidor se informa y no se aplica", async ({ page }) => {
  const errores = await abrirPlantillas(page);
  await elegirDestino(page, ["Pedro"]);
  await page.route("**/fixture/template-preview?*", (route) => route.fulfill({ status: 400, json: { error: "Selecciona sucursal, rol y empleados de tu catálogo vigente." } }));
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("region", { name: "Vista previa de turnos" })).toHaveCount(0);
  expect(persistidos).toEqual([]);
  expect(errores).toEqual([]);
});

test("cambiar el destino descarta la vista previa anterior", async ({ page }) => {
  const errores = await abrirPlantillas(page);
  await elegirDestino(page, ["Pedro"]);
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByRole("region", { name: "Vista previa de turnos" })).toBeVisible();
  await page.getByRole("combobox", { name: "Sucursal" }).selectOption({ label: "Norte" });
  await expect(page.getByRole("region", { name: "Vista previa de turnos" })).toHaveCount(0);
  expect(errores).toEqual([]);
});

test("la plantilla que no carga se avisa y se puede reintentar", async ({ page }) => {
  const errores = await abrirPlantillas(page, false, true);
  await expect(page.getByRole("alert")).toContainText("No pudimos cargar las plantillas");
  await page.getByRole("button", { name: "Reintentar plantillas" }).click();
  await expect(page.getByRole("combobox", { name: "Plantilla" })).toBeEnabled();
  expect(errores).toEqual([]);
});

test("la segunda empresa sólo ve y aplica su propio catálogo", async ({ page }) => {
  const errores = await abrirPlantillas(page, true);
  const sucursal = page.getByRole("combobox", { name: "Sucursal" });
  await expect(sucursal.locator("option")).toHaveCount(2);
  await sucursal.selectOption({ label: "Sur B" });
  await expect(page.getByRole("checkbox", { name: "Empresa B" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Ana" })).toHaveCount(0);
  await elegirDestinoEmpresaB(page);
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByRole("region", { name: "Vista previa de turnos" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();
  await expect(page.getByRole("region", { name: "Resultado de aplicación" })).toContainText("1 turnos creados");
  expect(persistidos).toEqual([expect.objectContaining({ userName: "Empresa B", shiftDate: "2026-10-05", branchName: "Sur B" })]);
  expect(errores).toEqual([]);
});

async function elegirDestinoEmpresaB(page: Page) {
  await page.getByRole("combobox", { name: "Plantilla" }).selectOption({ label: "Turno Mañana (07:00–15:00)" });
  await page.getByRole("combobox", { name: "Rol del turno" }).selectOption("CAJERO");
  await page.getByLabel("Desde").fill("2026-10-05");
  await page.getByLabel("Hasta").fill("2026-10-05");
  await page.getByRole("checkbox", { name: "Empresa B" }).check();
}
