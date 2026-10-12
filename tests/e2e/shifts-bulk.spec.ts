import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";
import { SUCURSAL_A_1, SUCURSAL_B_1, shiftCompleto } from "../fixtures/tenant-isolation";

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

interface Operation {
  branchId: string; role: string; employeeIds: string[]; startDate: string; endDate: string;
  pattern: string; daysOfWeek: number[]; shiftType: string; customStartTime: string; customEndTime: string;
}

async function openBulk(page: Page, companyB = false) {
  const saved: ReturnType<typeof shiftCompleto>[] = [];
  const requests: Operation[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-07T12:00:00-06:00") });
  const branchId = companyB ? SUCURSAL_B_1 : SUCURSAL_A_1;
  const branchName = companyB ? "Sur B" : "Centro A";
  const employees = companyB ? [{ id: "emp-b", name: "Empresa B" }] : [{ id: "ana", name: "Ana" }, { id: "pedro", name: "Pedro" }];
  await page.route("**/fixture/catalog", (route) => route.fulfill({ json: {
    branches: [{ id: branchId, name: branchName }], employees, roles: ["CAJERO"], sinAlcance: false,
  } }));
  await page.route("**/fixture/shifts?*", (route) => route.fulfill({ json: saved }));
  // La asignación libre no depende de cargar plantillas.
  await page.route("**/fixture/templates", () => { throw new Error("No debe pedir plantillas en asignación masiva"); });
  const rows = (operation: Operation) => operation.employeeIds.map((employeeId) => ({
    date: operation.startDate, employeeId, branchId: operation.branchId, role: operation.role,
    startTime: operation.customStartTime, endTime: operation.customEndTime, employeeCount: 1,
    canApply: employeeId !== "ana" && !saved.some((shift) => shift.userId === employeeId && shift.shiftDate === operation.startDate),
    error: "El turno solapa con uno existente [SHIFT_OVERLAP]", warnings: [],
  }));
  await page.route("**/fixture/template-preview?*", (route) => {
    const operation = JSON.parse(new URL(route.request().url()).searchParams.get("operation")!) as Operation;
    requests.push(operation);
    return route.fulfill({ json: rows(operation) });
  });
  await page.route("**/fixture/template-apply?*", (route) => {
    const operation = JSON.parse(new URL(route.request().url()).searchParams.get("operation")!) as Operation;
    const preview = rows(operation);
    const created = preview.filter((row) => row.canApply).map((row) => shiftCompleto({
      id: `${row.employeeId}:${row.date}`, userId: row.employeeId,
      userName: employees.find((employee) => employee.id === row.employeeId)!.name,
      branchId: row.branchId, branchName, role: row.role, shiftDate: row.date,
      startTime: row.startTime, endTime: row.endTime, status: "DRAFT",
    }));
    saved.push(...created);
    return route.fulfill({ json: { created, failed: preview.filter((row) => !row.canApply).map((row) => ({ date: row.date, employeeId: row.employeeId, error: row.error })) } });
  });
  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Asignación Masiva" }).click();
  await page.getByRole("combobox", { name: "Sucursal" }).selectOption(branchId);
  await page.getByRole("combobox", { name: "Rol del turno" }).selectOption("CAJERO");
  await page.getByLabel("Desde").fill("2026-10-05");
  await page.getByLabel("Hasta").fill("2026-10-05");
  return { saved, requests, errors };
}

test("destinos y días son obligatorios; el horario explícito llega a la vista previa", async ({ page }) => {
  const fixture = await openBulk(page);
  await expect(page.getByRole("button", { name: "Vista previa" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Pedro" }).check();
  for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]) await page.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Vista previa" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Lunes", exact: true }).check();
  await page.getByLabel("Hora de inicio").fill("23:00");
  await page.getByLabel("Hora de fin").fill("07:00");
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByRole("table").getByText("23:00–07:00")).toBeVisible();
  expect(fixture.requests).toEqual([expect.objectContaining({ branchId: SUCURSAL_A_1, role: "CAJERO", employeeIds: ["pedro"], daysOfWeek: [1], shiftType: "CUSTOM", customStartTime: "23:00", customEndTime: "07:00" })]);
  expect(fixture.saved).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("muestra el resultado parcial y repetir el lote no duplica lo guardado", async ({ page }) => {
  const fixture = await openBulk(page);
  await page.getByRole("checkbox", { name: "Ana" }).check();
  await page.getByRole("checkbox", { name: "Pedro" }).check();
  await page.getByRole("button", { name: "Vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();
  const result = page.getByRole("region", { name: "Resultado de aplicación" });
  await expect(result.getByRole("status")).toHaveText("1 turnos creados; 1 rechazados.");
  await expect(result.getByText(/Ana: Rechazado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar aplicación" })).toHaveCount(0);
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByRole("region", { name: "Vista previa de turnos" })).toContainText("0 turnos disponibles; 2 rechazados");
  await expect(page.getByRole("button", { name: "Confirmar aplicación" })).toBeDisabled();
  expect(fixture.saved).toHaveLength(1);
  await expect(result).toHaveCount(0);
  await page.getByRole("tab", { name: "Vista Semanal" }).click();
  await expect(page.getByText("Pedro", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pedro", { exact: true })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test("un error de aplicación exige revisar el resultado antes de reintentar", async ({ page }) => {
  const fixture = await openBulk(page);
  await page.getByRole("checkbox", { name: "Pedro" }).check();
  await page.route("**/fixture/template-apply?*", (route) => route.fulfill({ status: 500 }));
  await page.getByRole("button", { name: "Vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos confirmar el resultado");
  await expect(page.getByRole("region", { name: "Resultado de aplicación" })).toHaveCount(0);
  expect(fixture.saved).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("el catálogo de la segunda empresa se usa al confirmar", async ({ page }) => {
  const fixture = await openBulk(page, true);
  await expect(page.getByRole("checkbox", { name: "Ana" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Empresa B" }).check();
  await page.getByRole("button", { name: "Vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar aplicación" }).click();
  await expect(page.getByRole("region", { name: "Resultado de aplicación" })).toContainText("1 turnos creados; 0 rechazados.");
  expect(fixture.saved).toEqual([expect.objectContaining({ branchId: SUCURSAL_B_1, userId: "emp-b", role: "CAJERO" })]);
  expect(fixture.errors).toEqual([]);
});
