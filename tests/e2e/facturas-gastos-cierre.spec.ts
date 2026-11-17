import { test, expect, type Page } from "@playwright/test";
import { startPayeeBrowserServer } from "../support/payee-browser-server";
import { mixedExpenseIds, mixedInvoiceIds, mixedIssuerFixture, payeeId } from "../fixtures/payee-finance";

/**
 * T13 — cierre de facturas de compras y gastos operativos.
 *
 * El mismo emisor vende harina (compra de inventario), cobra la luz y el
 * mantenimiento (gastos operativos) y conserva una factura histórica sin
 * evidencia. La renta es un gasto sin comprobante que se documenta después.
 *
 * UI y CSS reales con límites de Next, sesión y API simulados: las
 * transacciones, la contabilidad y los pagos se verifican en las pruebas de
 * integración de T03–T12, no aquí.
 */

const evidence = "tasks/evidencia/2026-11-16/FACTURAS-GASTOS-T13";
let harness: Awaited<ReturnType<typeof startPayeeBrowserServer>>;
test.beforeAll(async () => { harness = await startPayeeBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

const candidate = { id: mixedInvoiceIds.renta, uuid: "CFDI-RENTA-1200", folio: "1200", date: "2026-11-08" };

type Options = { onAssociate?: () => void };

/** Sirve la ficha con el fixture de emisor mixto y filtra documentos como el API real. */
async function serveFinance(page: Page, options: Options = {}) {
  const requested: string[] = [];
  let rentaAsociada = false;
  await page.route("**/api/finance/payees/*/finance**", route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ expenseId: mixedExpenseIds.renta, invoiceId: mixedInvoiceIds.renta });
      rentaAsociada = true;
      options.onAssociate?.();
      return route.fulfill({ json: { success: true, data: { expenseId: mixedExpenseIds.renta, invoiceId: mixedInvoiceIds.renta } } });
    }
    requested.push(url.search);
    const data = mixedIssuerFixture(rentaAsociada);
    if (url.searchParams.has("expenseId")) return route.fulfill({ json: { success: true, data: { candidates: [candidate] } } });
    const destination = url.searchParams.get("destination");
    return route.fulfill({ json: { success: true, data: destination
      ? { ...data, documents: data.documents.filter(doc => doc.destination === destination), moreDocuments: false }
      : data } });
  });
  return () => requested.slice();
}

const row = (page: Page, uuid: string) => page.getByRole("row").filter({ hasText: uuid });
const documentsRows = (page: Page) => page.getByRole("row");

test("T13 el emisor mixto separa harina, luz y mantenimiento sin duplicar obligaciones", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await serveFinance(page);
  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();

  // Encabezado + cuatro documentos, cada uno una sola vez.
  await expect(documentsRows(page)).toHaveCount(5);
  await expect(page.getByText("CFDI-HARINA-1042")).toHaveCount(1);
  await expect(page.getByText("CFDI-LUZ-1101")).toHaveCount(1);
  await expect(page.getByText("CFDI-MANT-1102")).toHaveCount(1);
  await expect(page.getByText("CFDI-HIST-0998")).toHaveCount(1);

  // Harina: compra de inventario con su orden de compra y sin comprobante de gasto.
  const harina = row(page, "CFDI-HARINA-1042");
  await expect(harina).toContainText("Compra de inventario");
  await expect(harina).toContainText("Con orden de compra");
  await expect(harina.getByRole("link", { name: "Ver compra" }))
    .toHaveAttribute("href", `/dashboard/inventory/invoices?focus=${mixedInvoiceIds.harina}`);
  await expect(harina.getByRole("link", { name: "Descargar XML" })).toHaveCount(0);

  // Luz: gasto operativo documentado, con su gasto y su XML, sin acceso a inventario.
  const luz = row(page, "CFDI-LUZ-1101");
  await expect(luz).toContainText("Gasto operativo");
  await expect(luz).toContainText("Respalda un gasto · pago único");
  await expect(luz.getByRole("link", { name: "Ver gasto" })).toHaveAttribute("href",
    `/dashboard/finance/expenses?payeeId=${payeeId}&focus=${mixedExpenseIds.luz}`);
  await expect(luz.getByRole("link", { name: "Descargar XML" })).toHaveAttribute("href",
    `/api/finance/expense-invoices/${mixedInvoiceIds.luz}/xml`);
  await expect(luz.getByRole("link", { name: /inventory/i })).toHaveCount(0);

  // Mantenimiento: mismo tratamiento, otro gasto.
  const mantenimiento = row(page, "CFDI-MANT-1102");
  await expect(mantenimiento).toContainText("Gasto operativo");
  await expect(mantenimiento.getByRole("link", { name: "Ver gasto" })).toHaveAttribute("href",
    `/dashboard/finance/expenses?payeeId=${payeeId}&focus=${mixedExpenseIds.mantenimiento}`);

  // Histórica: visible como pendiente de clasificar, con revisión explícita.
  const historica = row(page, "CFDI-HIST-0998");
  await expect(historica).toContainText("Por clasificar");
  await expect(historica).toContainText("Requiere revisión");
  await expect(historica.getByRole("link", { name: "Revisar factura" })).toHaveAttribute("href",
    `/dashboard/inventory/invoices?focus=${mixedInvoiceIds.historica}`);

  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/documentos-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("T13 filtrar por destino no mueve saldos ni esconde la deuda real", async ({ page }) => {
  const requested = await serveFinance(page);
  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();

  await page.getByLabel("Destino de documentos").selectOption("INVENTORY_PURCHASE");
  await expect(documentsRows(page)).toHaveCount(2);
  await expect(page.getByText("CFDI-LUZ-1101")).toHaveCount(0);
  expect(requested().at(-1)).toContain("destination=INVENTORY_PURCHASE");

  // Los saldos no dependen del filtro: la deuda de la contraparte sigue igual.
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await expect(documentsRows(page)).toHaveCount(6);
  await expect(page.getByText("Factura de compra de inventario")).toBeVisible();
  await expect(page.getByText("Factura por clasificar")).toBeVisible();

  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  await page.getByLabel("Destino de documentos").selectOption("OPERATING_EXPENSE");
  await expect(documentsRows(page)).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Descargar XML" })).toHaveCount(2);
  await expect(page.getByText("CFDI-HARINA-1042")).toHaveCount(0);

  await page.getByLabel("Destino de documentos").selectOption("ALL");
  await expect(documentsRows(page)).toHaveCount(5);
  expect(requested().some(query => query.includes("destination=ALL"))).toBe(false);
});

test("T13 un gasto sin factura se documenta después y sigue siendo una sola obligación", async ({ page }) => {
  let confirmations = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await serveFinance(page, { onAssociate: () => { confirmations += 1; } });
  const xml = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Total="2320.00" />`;
  await page.route(`**/api/finance/expense-invoices/${mixedInvoiceIds.renta}/xml`, route => route.fulfill({
    body: xml, headers: { "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="cfdi-${mixedInvoiceIds.renta}.xml"` } }));

  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Movimientos", exact: true }).click();
  const renta = row(page, "Renta de noviembre");
  await expect(renta).toContainText("Autorizado");
  await renta.getByRole("button", { name: "Asociar factura" }).click();

  await expect(page.getByRole("dialog")).toContainText("Asociar factura al gasto");
  await page.getByRole("combobox", { name: "Factura" }).click();
  await page.getByRole("option", { name: /1200/ }).click();
  await page.getByRole("button", { name: "Confirmar asociación" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const documentada = row(page, "Renta de noviembre");
  await expect(documentada).toContainText("Factura asociada · pago único");
  await expect(documentada.getByRole("link", { name: "Descargar XML" })).toHaveAttribute("href",
    `/api/finance/expense-invoices/${mixedInvoiceIds.renta}/xml`);
  expect(confirmations).toBe(1);

  const download = page.waitForEvent("download");
  await documentada.getByRole("link", { name: "Descargar XML" }).click();
  expect((await download).suggestedFilename()).toBe(`cfdi-${mixedInvoiceIds.renta}.xml`);

  // Documentar el gasto no crea otra deuda: siguen las mismas cinco obligaciones.
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await expect(documentsRows(page)).toHaveCount(6);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/asociacion-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
