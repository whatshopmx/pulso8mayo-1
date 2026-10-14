import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

// C19: pantalla real y API controlada, sin escrituras en la base compartida.
const RUN = "abababab-0000-4000-8000-000000000019";
const DUPLICATE = "Esta referencia ya está programada en otra corrida activa.";
type Reference = { id: string; folio?: string; description?: string; branchName?: string };
const sources = [
  { tab: "Facturas", path: "invoices", type: "INVOICE", unit: "facturas", rows: [
    { id: "invoice-ok", folio: "F-019-A", nombreEmisor: "Proveedor A", total: 12000, matchStatus: "MATCHED" },
    { id: "invoice-rejected", folio: "F-019-B", nombreEmisor: "Proveedor B", total: 18000, matchStatus: "MATCHED" },
  ], label: (row: Reference) => `Seleccionar factura ${row.folio}` },
  { tab: "Gastos", path: "expenses", type: "OPERATING_EXPENSE", unit: "gastos", rows: [
    { id: "expense-ok", description: "Gas octubre A", category: "GAS", payeeName: "Proveedor A", amount: 12000 },
    { id: "expense-rejected", description: "Gas octubre B", category: "GAS", payeeName: "Proveedor B", amount: 18000 },
  ], label: (row: Reference) => `Seleccionar gasto ${row.description}` },
  { tab: "Nómina", path: "payroll", type: "PAYROLL", unit: "nóminas", rows: [
    { id: "payroll-ok", branchName: "Sucursal A", periodStart: "2026-10-01", periodEnd: "2026-10-15", totalAmountCents: 12000, status: "COMPLETED" },
    { id: "payroll-rejected", branchName: "Sucursal B", periodStart: "2026-10-01", periodEnd: "2026-10-15", totalAmountCents: 18000, status: "COMPLETED" },
  ], label: (row: Reference) => `Seleccionar nómina ${row.branchName}` },
];

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

async function mount(page: Page) {
  const available = new Map(sources.map((source) => [source.path, [...source.rows]]));
  const rejected = new Set(sources.map((source) => source.rows[1].id));
  const posts: Array<{ itemType: string; referenceId: string }> = [];
  const reads = new Map<string, number>();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  await page.addInitScript((runId) => {
    Object.assign(window, { __corridaPrueba: runId, __actorPrueba: { id: "admin-c19", role: "ADMIN" } });
  }, RUN);
  await page.route("**/api/finance/treasury/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const source = sources.find((candidate) => pathname === `/api/finance/treasury/${candidate.path}/unpaid`);
    if (source) {
      reads.set(source.path, (reads.get(source.path) ?? 0) + 1);
      return route.fulfill({ json: { success: true, data: available.get(source.path) } });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      posts.push(body);
      if (rejected.has(body.referenceId)) return route.fulfill({ status: 400, json: { error: DUPLICATE } });
      const addedSource = sources.find((candidate) => candidate.type === body.itemType)!;
      available.set(addedSource.path, available.get(addedSource.path)!.filter((row) => row.id !== body.referenceId));
      return route.fulfill({ json: { success: true, data: { id: `item-${body.referenceId}` } } });
    }
    return route.fulfill({ json: { success: true, data: { run: {
      id: RUN, companyId: "company-c19", branchId: null, branchName: "Consolidado", title: "Corrida C19",
      status: "DRAFT", preparedBy: "admin-c19", totalAmountCents: 0, currency: "MXN", runDate: "2026-10-20T00:00:00.000Z",
    }, items: [] } } });
  });
  await page.goto(`${harness.url}/tesoreria`);
  await expect(page.getByText("Corrida C19")).toBeVisible();
  await page.getByRole("button", { name: /Agregar.*Corrida/ }).click();
  await expect(page.getByRole("checkbox", { name: sources[0].label(sources[0].rows[0]), exact: true })).toBeVisible();
  return { available, rejected, posts, reads, errors };
}

async function visit(page: Page, source: typeof sources[number]) {
  await page.getByRole("tab", { name: new RegExp(source.tab) }).click();
  await expect(page.getByRole("checkbox", { name: source.label(source.rows[0]), exact: true })).toBeVisible();
}

test("factura agregada desaparece y el rechazo individual conserva la fila y muestra el motivo", async ({ page }) => {
  const state = await mount(page);
  const source = sources[0];
  const ok = page.getByRole("checkbox", { name: source.label(source.rows[0]), exact: true });
  const failed = page.getByRole("checkbox", { name: source.label(source.rows[1]), exact: true });
  await ok.locator("xpath=ancestor::tr").getByRole("button", { name: "Adjuntar", exact: true }).click();
  await expect(ok).toHaveCount(0);
  await failed.locator("xpath=ancestor::tr").getByRole("button", { name: "Adjuntar", exact: true }).click();
  await expect(page.getByText(DUPLICATE, { exact: true })).toBeVisible();
  await expect(failed).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: /Agregar.*Corrida/ }).click();
  await expect(failed).toBeVisible();
  await expect(ok).toHaveCount(0);
  expect(state.reads.get("invoices")).toBe(2);
  expect(state.errors).toEqual([]);
});

for (const source of sources) {
  test(`${source.tab}: lote parcial retira sólo éxitos, informa el motivo y conserva selección para reintentar`, async ({ page }) => {
    const state = await mount(page);
    await visit(page, source);
    const ok = page.getByRole("checkbox", { name: source.label(source.rows[0]), exact: true });
    const failed = page.getByRole("checkbox", { name: source.label(source.rows[1]), exact: true });
    await ok.check();
    await failed.check();
    await page.getByRole("button", { name: /^Adjuntar 2 seleccionados/ }).click();
    await expect(page.getByText(`Se agregaron 1 ${source.unit}; 1 no se pudieron agregar.`, { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(DUPLICATE))).toBeVisible();
    await expect(ok).toHaveCount(0);
    await expect(failed).toBeChecked();
    if (source.path === "invoices") {
      await page.screenshot({ path: test.info().outputPath("partial-result.png"), fullPage: true });
    }
    state.rejected.delete(source.rows[1].id);
    await page.getByRole("button", { name: /^Adjuntar 1 seleccionado/ }).click();
    await expect(failed).toHaveCount(0);
    expect(state.posts.map((post) => post.referenceId)).toEqual([source.rows[0].id, source.rows[1].id, source.rows[1].id]);
    expect(state.errors).toEqual([]);
  });

  test(`${source.tab}: cero éxitos conserva selección y no informa éxito`, async ({ page }) => {
    const state = await mount(page);
    await visit(page, source);
    const failed = page.getByRole("checkbox", { name: source.label(source.rows[1]), exact: true });
    await failed.check();
    await page.getByRole("button", { name: /^Adjuntar 1 seleccionado/ }).click();
    await expect(page.getByText(new RegExp(DUPLICATE))).toBeVisible();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await expect(failed).toBeChecked();
    expect(state.errors).toEqual([]);
  });
}

test("cada visita a las pestañas refresca disponibles y elimina selecciones que otra corrida programó", async ({ page }) => {
  const state = await mount(page);
  for (const source of sources) {
    await visit(page, source);
    await page.getByRole("checkbox", { name: source.label(source.rows[0]), exact: true }).check();
    await page.getByRole("tab", { name: new RegExp(source.path === "expenses" ? "Facturas" : "Gastos") }).click();
    state.available.set(source.path, [source.rows[1]]);
    await page.getByRole("tab", { name: new RegExp(source.tab) }).click();
    await expect(page.getByRole("checkbox", { name: source.label(source.rows[1]), exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: source.label(source.rows[0]), exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Adjuntar 1 seleccionado/ })).toHaveCount(0);
    expect(state.reads.get(source.path)).toBeGreaterThan(1);
  }
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
});
