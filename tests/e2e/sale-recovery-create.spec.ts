import { test, expect, type Page } from "@playwright/test";
import { startSalesEntryBrowserServer } from "../support/sales-entry-browser-server";

let fixture: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;
const branchId = "b1000000-0000-4000-8000-000000000001";
const proposalId = "30000000-0000-4000-8000-000000000003";
const values = {
  "Venta por recuperar": "40000000-0000-4000-8000-000000000004",
  "Atestación de venta": "60000000-0000-4000-8000-000000000006",
  "Atestación de receta histórica": "70000000-0000-4000-8000-000000000007",
  "Atestación de ausencia de consumo": "80000000-0000-4000-8000-000000000008",
  "Motivo de recuperación": "Conciliación documental del cierre histórico",
};

test.beforeAll(async () => { fixture = await startSalesEntryBrowserServer(); });
test.afterAll(async () => { await fixture?.server.close(); });

async function openCreate(page: Page) {
  await page.goto(fixture.url);
  await page.getByLabel("Sucursal destino").selectOption(branchId);
  await page.getByRole("button", { name: "Recuperación Histórica", exact: true }).click();
  await page.getByRole("button", { name: "Crear expediente", exact: true }).click();
  for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value);
}

test("crea desde captura, conserva la clave al reintentar y abre la revisión independiente", async ({ page }) => {
  const requests: Record<string, string>[] = [];
  await page.route("**/api/inventory/sales-entry/recovery-proposals**", async route => {
    if (route.request().method() === "POST") {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: requests.length === 1 ? 503 : 201, json: requests.length === 1
        ? { error: "Almacenamiento privado no disponible" } : { data: { id: proposalId, created: true } } });
    }
    await route.fulfill({ json: { data: { proposal: { id: proposalId, branchId,
      requestedBy: "Solicitante de prueba", reason: values["Motivo de recuperación"],
      createdAt: "2026-11-18T12:00:00Z", proposalHash: "hash-propuesta", stateHash: "hash-estado" },
      decision: null, canDecide: false } } });
  });
  await openCreate(page);
  await page.screenshot({ path: ".tmp/recovery-create-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Almacenamiento privado no disponible");
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByText(proposalId, { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toEqual({ branchId, legacySaleId: values["Venta por recuperar"],
    saleAttestationId: values["Atestación de venta"], recipeAttestationId: values["Atestación de receta histórica"],
    absenceAttestationId: values["Atestación de ausencia de consumo"], reason: values["Motivo de recuperación"],
    idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await expect(page.getByRole("button", { name: "Registrar Decisión" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aplicar Consumo e Inventario" })).toHaveCount(0);
});

test("rechaza atestaciones repetidas antes de enviar y renueva la clave al cambiar la solicitud", async ({ page }) => {
  const requests: Record<string, string>[] = [];
  await page.route("**/api/inventory/sales-entry/recovery-proposals**", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { error: "Fuentes incompatibles" } });
  });
  await openCreate(page);
  await page.getByLabel("Atestación de receta histórica", { exact: true }).fill(values["Atestación de venta"]);
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("tres atestaciones distintas");
  expect(requests).toHaveLength(0);
  await page.getByLabel("Atestación de receta histórica", { exact: true }).fill(values["Atestación de receta histórica"]);
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Fuentes incompatibles");
  await page.getByLabel("Motivo de recuperación", { exact: true }).fill("Otra conciliación documental");
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
});

test("mantiene el formulario durante la solicitud y limpia la venta al cambiar de sucursal en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  let finish!: () => void;
  const responseReady = new Promise<void>(resolve => { finish = resolve; });
  let requests = 0;
  await page.route("**/api/inventory/sales-entry/recovery-proposals**", async route => {
    requests++;
    await responseReady;
    await route.fulfill({ status: 503, json: { error: "Reintenta la operación" } });
  });
  await openCreate(page);
  await page.screenshot({ path: ".tmp/recovery-create-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Verificando fuentes");
  await expect(page.getByRole("button", { name: "Consultar expediente existente" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  finish();
  await expect(page.getByRole("alert")).toContainText("Reintenta la operación");
  expect(requests).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Sucursal destino").selectOption("b2000000-0000-4000-8000-000000000002");
  await page.getByRole("button", { name: "Recuperación Histórica", exact: true }).click();
  await page.getByRole("button", { name: "Crear expediente", exact: true }).click();
  await expect(page.getByLabel("Venta por recuperar", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Motivo de recuperación", { exact: true })).toHaveValue("");
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("valida los UUID y conserva el reintento tras perder la respuesta", async ({ page }) => {
  const requests: Record<string, string>[] = [];
  await page.route("**/api/inventory/sales-entry/recovery-proposals**", async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort("connectionreset");
    await route.fulfill({ status: 409, json: { error: "El estado cambió durante la preparación" } });
  });
  await openCreate(page);
  await page.getByLabel("Venta por recuperar", { exact: true }).fill("venta-inválida");
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("UUID válidos");
  expect(requests).toHaveLength(0);
  await page.getByLabel("Venta por recuperar", { exact: true }).fill(values["Venta por recuperar"]);
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Registrar expediente", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("El estado cambió");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});
