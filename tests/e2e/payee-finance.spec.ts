import { test, expect } from "@playwright/test";
import { startPayeeBrowserServer } from "../support/payee-browser-server";
import { payeeFixture, payeeId, branchId, invoiceId } from "../fixtures/payee-finance";
let harness: Awaited<ReturnType<typeof startPayeeBrowserServer>>;
test.beforeAll(async () => { harness = await startPayeeBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test("consulta historial, asocia factura y conserva una sola obligación", async ({ page }, info) => {
  let associated = false;
  const writes: unknown[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/finance/payees/*/finance**", async route => {
    if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); associated = true; return route.fulfill({ json: { success: true } }); }
    const candidates = [{ id: invoiceId, uuid: "CFDI-DE-PRUEBA-123", folio: "123", date: "2026-11-01" }];
    return route.fulfill({ json: { success: true, data: new URL(route.request().url()).searchParams.has("expenseId") ? { candidates } : payeeFixture(associated) } });
  });
  await page.goto(harness.url);
  await expect(page.getByRole("heading", { name: "Servicios del Centro" })).toBeVisible();
  await page.getByRole("tab", { name: "Movimientos" }).click();
  await page.getByRole("button", { name: "Asociar factura", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar asociación" })).toBeDisabled();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: /123/ }).click();
  await page.getByRole("button", { name: "Confirmar asociación" }).click();
  await expect(page.getByText("Factura asociada · pago único")).toBeVisible();
  expect(writes).toEqual([{ expenseId: "00000000-0000-4000-8000-000000000006", invoiceId }]);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  await expect(page.getByText("Respalda un gasto · pago único")).toBeVisible();
  await page.getByRole("tab", { name: "Datos y cuentas" }).click();
  await expect(page.getByText(/termina en 1234/)).toBeVisible();
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("payee-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("heading", { name: "Servicios del Centro" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("payee-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("recupera un error de carga y preselecciona la contraparte al registrar", async ({ page }) => {
  let fail = true;
  await page.route("**/api/finance/payees/*/finance**", route => fail
    ? route.fulfill({ status: 503, json: { success: false, error: { message: "Servicio no disponible" } } })
    : route.fulfill({ json: { success: true, data: payeeFixture() } }));
  await page.goto(harness.url);
  await expect(page.getByRole("alert")).toContainText("Servicio no disponible");
  fail = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByRole("button", { name: "Nuevo Gasto Operativo" }).click();
  await expect(page.locator("#expense-payee")).toContainText("Servicios del Centro");
  await expect(page.locator("#expense-payee")).toBeDisabled();
  await page.locator("#expense-amount").fill("100");
  await page.locator("#expense-desc").fill("Servicio de prueba");
  let body: Record<string, unknown> = {};
  await page.route("**/api/expenses", route => { body = route.request().postDataJSON(); return route.fulfill({ json: { success: true } }); });
  await page.getByRole("button", { name: "Guardar Gasto" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(body).toMatchObject({ payeeId, branchId, amountCents: 10000 });
});

test("T10 filtra destino con fechas/páginas y navega al origen correcto", async ({ page }, info) => {
  const base = payeeFixture(true);
  const common = { ...base.documents[0], expenseId: null, expenseAmountCents: null, expenseCount: 0,
    satStatus: null, identityConflict: false, hasPurchaseOrder: false, hasReceivingReport: false, hasRecurringContract: false, hasServiceOrder: false };
  const documents = [
    { ...common, id: "purchase", uuid: "UUID-COMPRA", destination: "INVENTORY_PURCHASE", hasReceivingReport: true, requiresReview: false, date: "2026-11-01" },
    { ...common, id: "operating", uuid: "UUID-GASTO", destination: "OPERATING_EXPENSE", expenseId: base.expenses[0].id, expenseCount: 1, expenseAmountCents: 450000, requiresReview: false, date: "2026-11-02" },
    { ...common, id: "orphan", uuid: "UUID-GASTO-SIN-VINCULO", destination: "OPERATING_EXPENSE", requiresReview: true, date: "2026-11-03" },
    { ...common, id: "legacy", uuid: "UUID-PENDIENTE", destination: "UNCLASSIFIED", requiresReview: true, date: "2026-11-04" },
  ];
  const queries: URLSearchParams[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/finance/payees/*/finance**", route => {
    const query = new URL(route.request().url()).searchParams; queries.push(query);
    const filtered = documents.filter(doc => (!query.get("destination") || doc.destination === query.get("destination"))
      && (!query.get("from") || doc.date >= query.get("from")!) && (!query.get("to") || doc.date <= query.get("to")!));
    const offset = Number(query.get("page")) * 2;
    return route.fulfill({ json: { success: true, data: { ...base, documents: filtered.slice(offset, offset + 2), moreDocuments: filtered.length > offset + 2 } } });
  });
  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  const destination = page.getByLabel("Destino de documentos");
  await expect(destination).toHaveValue("ALL");
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`documents-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(page.getByText("UUID-PENDIENTE", { exact: true })).toBeVisible();
  await destination.selectOption("OPERATING_EXPENSE");
  await expect(page.getByText("UUID-GASTO", { exact: true })).toBeVisible();
  await expect(page.getByText("UUID-GASTO-SIN-VINCULO", { exact: true })).toBeVisible();
  expect(queries.at(-1)?.get("page")).toBe("0");
  await expect(page.getByRole("link", { name: "Ver gasto", exact: true })).toHaveAttribute("href", new RegExp(`focus=${base.expenses[0].id}`));
  await expect(page.getByRole("link", { name: "Revisar gastos", exact: true })).toHaveAttribute("href", `/dashboard/finance/expenses?payeeId=${payeeId}`);
  await expect(page.locator('a[href*="/dashboard/inventory/"]')).toHaveCount(0);
  await page.getByLabel("Desde", { exact: true }).fill("2026-11-03");
  await expect(page.getByText("UUID-GASTO", { exact: true })).toHaveCount(0);
  await expect(page.getByText("UUID-GASTO-SIN-VINCULO", { exact: true })).toBeVisible();
  expect(queries.at(-1)?.get("branchId")).toBe(branchId);
  await page.getByLabel("Hasta", { exact: true }).fill("2026-11-03");
  await destination.selectOption("INVENTORY_PURCHASE");
  await expect(page.getByText("No hay documentos que coincidan con estos filtros.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Limpiar fechas" }).click();
  await expect(page.getByText("UUID-COMPRA", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver compra", exact: true })).toHaveAttribute("href", "/dashboard/inventory/invoices?focus=purchase");
  await destination.selectOption("UNCLASSIFIED");
  await expect(page.getByText("UUID-PENDIENTE", { exact: true })).toBeVisible();
  await expect(page.getByText("Requiere revisión", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("T10 no etiqueta una factura histórica pendiente como compra y permite filtrar por teclado", async ({ page }) => {
  await page.goto(harness.url);
  await expect(page.getByText("Factura por clasificar", { exact: true })).toBeVisible();
  await expect(page.getByText("Factura de compra", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  const destination = page.getByLabel("Destino de documentos");
  await destination.focus(); await page.keyboard.press("End"); await page.keyboard.press("Tab");
  await expect(destination).toHaveValue("UNCLASSIFIED");
});

test("T10 mantiene los filtros durante carga y permite corregir fechas inválidas", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let invalidRequests = 0;
  await page.route("**/api/finance/payees/*/finance**", async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("from") && query.get("to") && query.get("from")! > query.get("to")!) invalidRequests++;
    if (query.get("destination") === "OPERATING_EXPENSE") await pending;
    return route.fulfill({ json: { success: true, data: { ...payeeFixture(),
      documents: query.get("destination") === "OPERATING_EXPENSE" ? [] : payeeFixture().documents } } });
  });
  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  const destination = page.getByLabel("Destino de documentos");
  await destination.selectOption("OPERATING_EXPENSE");
  await expect(page.getByRole("status")).toContainText("Actualizando documentos");
  await expect(destination).toBeVisible();
  await expect(page.getByText("CFDI-DE-PRUEBA-123", { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText("No hay documentos que coincidan con estos filtros.", { exact: true })).toBeVisible();
  await page.getByLabel("Desde", { exact: true }).fill("2026-11-10");
  await page.getByLabel("Hasta", { exact: true }).fill("2026-11-01");
  await expect(page.getByRole("alert")).toContainText("La fecha inicial");
  await expect(destination).toBeVisible();
  await page.getByLabel("Hasta", { exact: true }).fill("2026-11-30");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("No hay documentos que coincidan con estos filtros.", { exact: true })).toBeVisible();
  expect(invalidRequests).toBe(0);
});
