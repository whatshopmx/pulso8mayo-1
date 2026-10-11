import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";
import { EMPRESA_B, SUCURSAL_A_1, SUCURSAL_A_2, SUCURSAL_B_1, shiftCompleto } from "../fixtures/tenant-isolation";

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

const shifts = [
  shiftCompleto({ id: "a1", userName: 'María, "López"', branchName: "Café Centro", shiftDate: "2026-10-05", notes: "Línea 1\nLínea 2" }),
  shiftCompleto({ id: "a2", userName: "Pedro", branchId: SUCURSAL_A_2, branchName: "Norte", shiftDate: "2026-10-06", role: "MESERO", status: "PUBLISHED" }),
  shiftCompleto({ id: "cancelado", userName: "Cancelado", status: "CANCELLED", shiftDate: "2026-10-06" }),
  shiftCompleto({ id: "otra-semana", userName: "Otra semana", shiftDate: "2026-10-12", status: "PUBLISHED" }),
  shiftCompleto({ id: "b1", companyId: EMPRESA_B, branchId: SUCURSAL_B_1, userName: "Empresa B", branchName: "Sur B", shiftDate: "2026-10-05" }),
];

async function openPlanner(page: Page, companyB = false) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => pageErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.clock.install({ time: new Date("2026-10-07T12:00:00-06:00") });
  const authorized = shifts.filter((shift) => (shift.companyId === EMPRESA_B) === companyB);
  await page.route("**/fixture/catalog", (route) => route.fulfill({ json: {
    branches: companyB ? [{ id: SUCURSAL_B_1, name: "Sur B" }] : [{ id: SUCURSAL_A_1, name: "Café Centro" }, { id: SUCURSAL_A_2, name: "Norte" }],
    employees: authorized.map((shift) => ({ id: shift.userId, name: shift.userName })),
    roles: ["CAJERO", "MESERO"], sinAlcance: false,
  } }));
  await page.route("**/fixture/shifts?*", (route) => {
    const filters = JSON.parse(new URL(route.request().url()).searchParams.get("filters")!);
    const data = authorized.filter((shift) =>
      (!filters.search || shift.userName.toLowerCase().includes(filters.search.toLowerCase())) &&
      (!filters.branchId || shift.branchId === filters.branchId) &&
      (!filters.role || shift.role === filters.role) &&
      (!filters.status?.length || filters.status.includes(shift.status))
    );
    return route.fulfill({ json: data });
  });
  await page.goto(harness.url);
  try {
    await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  } catch (error) {
    throw new Error(`${String(error)}\nErrores del navegador: ${pageErrors.join("; ")}`);
  }
}

async function downloadCsv(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await downloaded;
  const csv = await readFile((await download.path())!, "utf8");
  return { filename: download.suggestedFilename(), csv };
}

test("descarga sólo la semana visible y mantiene texto y sucursales", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openPlanner(page);
  const { filename, csv } = await downloadCsv(page);
  expect(filename).toBe("turnos_2026-10-05_2026-10-11.csv");
  expect(csv).toContain('"María, ""López""","Café Centro"');
  expect(csv).toContain('"Línea 1\nLínea 2"');
  expect(csv).toContain('"Pedro","Norte"');
  for (const excluded of ["Otra semana", "Empresa B", "Cancelado"]) expect(csv).not.toContain(excluded);
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  const next = await downloadCsv(page);
  expect(next.filename).toBe("turnos_2026-10-12_2026-10-18.csv");
  expect(next.csv).toContain("Otra semana");
  expect(next.csv).not.toContain("Pedro");
  expect(errors).toEqual([]);
});

test("descarga los filtros de sucursal, rol, estado y búsqueda", async ({ page }) => {
  await openPlanner(page);
  for (const [index, option] of [[0, "Norte"], [1, "MESERO"], [2, "Publicado"]] as const) {
    await page.getByRole("combobox").nth(index).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
    const { csv } = await downloadCsv(page);
    expect(csv).toContain("Pedro");
    expect(csv).not.toContain("María");
  }
  await page.getByRole("button", { name: "Limpiar" }).click();
  await page.getByPlaceholder("Buscar empleado...").fill("María");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  const { csv } = await downloadCsv(page);
  expect(csv).toContain("María");
  expect(csv).not.toContain("Pedro");
});

test("una respuesta vacía o fallida bloquea descargar datos previos y permite reintentar", async ({ page }) => {
  await openPlanner(page);
  await page.getByPlaceholder("Buscar empleado...").fill("No existe");
  await expect(page.getByRole("status")).toContainText("No hay turnos para exportar");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  await page.route("**/fixture/shifts?*", (route) => route.fulfill({ status: 500 }));
  await page.getByRole("button", { name: "Limpiar" }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos cargar los turnos");
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  await page.route("**/fixture/shifts?*", (route) => route.fulfill({ json: [shifts[0]] }));
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
});

test("un fallo de descarga es visible y el botón permite reintento", async ({ page }) => {
  await openPlanner(page);
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => { URL.createObjectURL = original; throw new Error("Fallo de descarga simulado"); };
  });
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos exportar los turnos");
  expect((await downloadCsv(page)).csv).toContain("María");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("la segunda empresa exporta exclusivamente su respuesta autorizada", async ({ page }) => {
  await openPlanner(page, true);
  const { csv } = await downloadCsv(page);
  expect(csv).toContain('"Empresa B","Sur B"');
  expect(csv).not.toContain("María");
  expect(csv).not.toContain("Pedro");
});

for (const failed of [false, true]) {
test(`una respuesta anterior tardía (${failed ? "error" : "éxito"}) no cambia la exportación actual`, async ({ page }) => {
  await openPlanner(page);
  let releaseOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldStarted!: () => void;
  const oldRequest = new Promise<void>((resolve) => { oldStarted = resolve; });
  await page.route("**/fixture/shifts?*", async (route) => {
    const filters = JSON.parse(new URL(route.request().url()).searchParams.get("filters")!);
    if (filters.search === "María") {
      oldStarted();
      await oldResponse;
      await route.fulfill(failed ? { status: 500 } : { json: [shifts[0]] });
    } else {
      await route.fulfill({ json: [shifts[1]] });
    }
  });
  await page.getByPlaceholder("Buscar empleado...").fill("María");
  await oldRequest;
  await page.getByPlaceholder("Buscar empleado...").fill("Pedro");
  await expect(page.getByText("Pedro", { exact: true })).toBeVisible();
  // Un fetch que rechaza HTTP 500 puede cancelar el cuerpo sin emitir
  // requestfinished. Esperar la respuesta también cubre ese rechazo.
  const oldFinished = page.waitForResponse((response) =>
    response.url().includes("fixture/shifts") &&
    JSON.parse(new URL(response.url()).searchParams.get("filters")!).search === "María"
  );
  releaseOld();
  await oldFinished;
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const { csv } = await downloadCsv(page);
  expect(csv).toContain("Pedro");
  expect(csv).not.toContain("María");
});
}
