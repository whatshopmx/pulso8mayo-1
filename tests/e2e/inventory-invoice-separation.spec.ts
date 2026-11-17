import { test, expect } from "@playwright/test";
import { startInventoryBrowserServer } from "../support/inventory-browser-server";
let harness: Awaited<ReturnType<typeof startInventoryBrowserServer>>;
test.beforeAll(async () => { harness = await startInventoryBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

const xml = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="123"
  Fecha="2026-11-10T10:00:00" SubTotal="1000.00" Total="1160.00" Moneda="MXN">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Harina del Centro"/><cfdi:Receptor Rfc="BBB010101BBB" Nombre="Empresa"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="24121021" NoIdentificacion="HAR-001" Cantidad="10"
    ClaveUnidad="H87" Descripcion="Harina" ValorUnitario="100.00" Importe="1000.00"/></cfdi:Conceptos>
</cfdi:Comprobante>`;

test("T11 el historial de Inventario distingue compras, pendientes y gastos operativos", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${harness.url}/inventory-invoices`);
  await page.getByRole("tab", { name: /historial/i }).click();
  await expect(page.getByText("F-123", { exact: true })).toBeVisible();
  await expect(page.getByText("F-124", { exact: true })).toBeVisible();
  await expect(page.getByText("F-125", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Compra de inventario", { exact: true })).toBeVisible();
  await expect(page.getByText("Por clasificar", { exact: true })).toBeVisible();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`inventario-${width}.png`), fullPage: true });
  }
  await page.getByLabel("Destino", { exact: true }).click();
  await page.getByRole("option", { name: /Gasto operativo/ }).click();
  await expect(page.getByText("F-125", { exact: true })).toBeVisible();
  await expect(page.getByText("F-123", { exact: true })).toHaveCount(0);
  await page.getByLabel("Destino", { exact: true }).click();
  await page.getByRole("option", { name: "Todos los destinos" }).click();
  await expect(page.getByText("F-123", { exact: true })).toBeVisible();
  await expect(page.getByText("F-125", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("T11 la captura de Inventario declara compra y no elige la OC por ambigüedad", async ({ page }) => {
  const bodies: string[] = [];
  let purchaseOrders = [{ id: "oc-1", poNumber: "OC-1", status: "APPROVED", total: 116000 },
    { id: "oc-2", poNumber: "OC-2", status: "SENT", total: 50000 }];
  let purchaseOrderMatch = "AMBIGUOUS";
  await page.route("**/api/inventory/invoices/upload", route => {
    bodies.push(route.request().postDataBuffer()?.toString() ?? "");
    return route.fulfill({ json: { success: true, destination: "INVENTORY_PURCHASE", purchaseOrderMatch, purchaseOrders,
      supplier: { id: "proveedor-1", name: "Harina del Centro", taxId: "AAA010101AAA" },
      invoice: { id: "inv-1", folio: "123", serie: "F", fecha: "2026-11-10", subTotal: 1000, total: 1160, moneda: "MXN",
        rfcEmisor: "AAA010101AAA", nombreEmisor: "Harina del Centro" },
      items: [{ concepto: { claveProdServ: "24121021", cantidad: 10, claveUnidad: "H87", descripcion: "Harina", valorUnitario: 100, importe: 1000 },
        matchedItemId: "insumo-1", matchedItemName: "Harina", matchedItemSku: "HAR-001", matchStatus: "MATCHED" }] } });
  });
  await page.goto(`${harness.url}/inventory-invoices`);
  await expect(page.getByText(/compras de inventario/i)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "cfdi.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: /Analizar Factura/i }).click();
  await expect(page.getByText(/No se vinculó ninguna automáticamente/i)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Orden de compra a cerrar" })).toContainText("Sin orden");
  expect(bodies.at(-1)).toContain("INVENTORY_PURCHASE");

  purchaseOrders = [{ id: "oc-1", poNumber: "OC-1", status: "APPROVED", total: 116000 }];
  purchaseOrderMatch = "UNIQUE";
  await page.getByRole("button", { name: /Cancelar/i }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "cfdi.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: /Analizar Factura/i }).click();
  await expect(page.getByRole("combobox", { name: "Orden de compra a cerrar" })).toContainText("OC-1");
  await expect(page.getByText(/No se vinculó ninguna automáticamente/i)).toHaveCount(0);
});
