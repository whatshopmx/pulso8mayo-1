import { test, expect, type Page } from "@playwright/test";
import { startAccountingBrowserServer } from "../support/accounting-browser-server";

let harness: Awaited<ReturnType<typeof startAccountingBrowserServer>>;
test.beforeAll(async () => { harness = await startAccountingBrowserServer("settings"); });
test.afterAll(async () => { await harness?.server.close(); });
const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const account = (n: number, code: string, name: string, kind: string) => ({ id: id(n), code, name, kind,
  active: true, postable: true, validFrom: "2026-01-01", validTo: null });
const accounts = [account(1, "5100", "Mantenimiento", "EXPENSE"), account(2, "2100", "Obligaciones por pagar", "LIABILITY"),
  account(3, "1100", "Banco operativo", "ASSET"), account(4, "1200", "Impuesto documentado", "ASSET")];

async function prepare(page: Page, options: { empty?: boolean; denied?: boolean; noRules?: boolean } = {}) {
  const errors: string[] = [], writes: { url: string; body: Record<string, unknown> }[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const data = { accounts: options.empty ? [] : [...accounts],
    centers: [{ id: id(10), code: "4110", name: "Mantenimiento correctivo", accountingLine: "OPEX-MANT" }],
    banks: [{ id: id(11), label: "Banco de operación", lastFour: "1234", purpose: "MIXTO", currency: "MXN" }],
    links: [] as { accountId: string; costCenterId?: string; bankAccountId?: string }[],
    expenses: [{ id: id(12), description: "Reparación de horno", amountCents: 500000, status: "APPROVED", businessDate: "2026-10-20" }],
    truncated: false, postingEnabled: false, canPublishOpening: true };
  await page.route("**/api/finance/accounting/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (options.denied) return route.fulfill({ status: 403, json: { success: false, error: { message: "No tienes permiso para preparar la contabilidad." } } });
    if (request.method() === "POST") {
      const body = request.postDataJSON(); writes.push({ url: url.pathname, body });
      if (body.action === "link") data.links.push(body.input);
      if (body.action === "account") data.accounts.push({ ...body.input, id: id(50), validTo: null });
      return route.fulfill({ json: { success: true, data: { id: id(99) } } });
    }
    if (url.pathname.endsWith("preparation")) {
      return route.fulfill({ json: { success: true, data: url.searchParams.has("expenseId")
        ? { description: "Reparación de horno", date: "2026-10-20", published: false, reason: null,
          lines: [{ accountId: id(1), accountCode: "5100", accountName: "Mantenimiento", debitCents: 500000, creditCents: 0 },
            { accountId: id(2), accountCode: "2100", accountName: "Obligaciones por pagar", debitCents: 0, creditCents: 500000 }] } : data } });
    }
    if (url.pathname.endsWith("openings")) return route.fulfill({ json: { success: true, data: null } });
    if (url.pathname.endsWith("settings")) {
      const event = url.searchParams.get("eventType") ?? "EXPENSE_RECOGNIZED";
      const rule = { id: id(event === "EXPENSE_PAYMENT" ? 21 : 20), code: event, name: event, version: 1, effectiveFrom: "2026-01-01", active: true };
      const entries = [{ role: "PAYABLE", accountId: id(2), accountName: "Obligaciones por pagar" }];
      const view = url.searchParams.get("view");
      return route.fulfill({ json: { success: true, data: view === "preview" || view === "rule"
        ? { rule: options.noRules ? null : rule, entries: options.noRules ? [] : entries,
          blockers: options.noRules ? [{ reason: "Sin configuración vigente." }] : [] }
        : { items: options.noRules ? [] : [rule], hasMore: false } } });
    }
    return route.fulfill({ status: 404, json: { success: false, error: { message: "Ruta sintética inesperada" } } });
  });
  await page.goto(harness.url);
  await expect(page.getByRole("heading", { name: "Preparar contabilidad", exact: true })).toBeVisible();
  return { data, errors, writes };
}

test("reuses existing centers and banks and saves their links with a single capture", async ({ page }) => {
  const { errors, writes } = await prepare(page);
  await expect(page.getByText("La contabilización automática está deshabilitada en este entorno.")).toBeVisible();
  const center = page.getByRole("form", { name: "Vincular 4110 · Mantenimiento correctivo" });
  await center.getByRole("combobox").selectOption(id(1));
  await center.getByRole("button", { name: "Guardar vínculo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cuenta vinculada a Mantenimiento correctivo" })).toBeVisible();
  const bank = page.getByRole("form", { name: "Vincular Banco de operación · 1234" });
  await bank.getByRole("combobox").selectOption(id(3)); await bank.getByRole("button", { name: "Guardar vínculo" }).click();
  await expect(bank.getByText("Cuenta vinculada y utilizable hoy")).toBeVisible();
  expect(writes.map(write => write.body)).toEqual([
    { action: "link", input: { accountId: id(1), costCenterId: id(10) } },
    { action: "link", input: { accountId: id(3), bankAccountId: id(11) } },
  ]);
  expect(errors).toEqual([]);
});

test("configures a named operation without asking for event codes, roles or version IDs", async ({ page }) => {
  const { writes, errors } = await prepare(page, { noRules: true });
  await page.getByRole("button", { name: "Configurar esta operación", exact: true }).click();
  const form = page.getByRole("form", { name: "Configurar operación" });
  await expect(form).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.tmp/accounting-preparation-editor-${width}.png`, fullPage: true });
  }
  await form.getByLabel("Obligaciones por pagar", { exact: true }).selectOption(id(2));
  await form.getByLabel("Aplicar desde").fill(today());
  await form.getByRole("button", { name: "Guardar configuración de la operación" }).click();
  await expect(page.getByText(`Configuración guardada desde ${today()}. Las pólizas publicadas conservan sus cuentas.`)).toBeVisible();
  expect(writes[0].body).toMatchObject({ code: "EXPENSE_RECOGNIZED", eventType: "EXPENSE_RECOGNIZED", supersedesId: null,
    entries: [{ role: "PAYABLE", accountId: id(2), required: true }] });
  await expect(page.getByPlaceholder("ID de la versión que reemplaza")).toHaveCount(0);
  await expect(page.getByPlaceholder("EXPENSE_RECOGNIZED")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("previews a real expense read-only and keeps opening behind an explained action", async ({ page }) => {
  const { writes, errors } = await prepare(page);
  await page.getByLabel("Gasto existente (hasta 30 disponibles)").selectOption(id(12));
  await page.getByRole("button", { name: "Ver efecto contable" }).click();
  await expect(page.getByRole("cell", { name: "5100 · Mantenimiento" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2100 · Obligaciones por pagar" })).toBeVisible();
  expect(writes).toEqual([]);
  await expect(page.getByRole("form", { name: "Capturar apertura" })).toHaveCount(0);
  const open = page.getByRole("button", { name: "Preparar saldos con el responsable contable" });
  await open.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("form", { name: "Capturar apertura" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("empty catalogs explain account creation and denied reads never look complete", async ({ page }) => {
  await prepare(page, { empty: true });
  await page.getByRole("link", { name: "Añadir las cuentas del catálogo contable." }).click();
  const form = page.getByRole("form", { name: "Añadir cuenta contable" });
  await expect(form).toBeVisible();
  await form.getByLabel("Código de cuenta").fill("5101"); await form.getByLabel("Nombre de cuenta").fill("Renta");
  await form.getByRole("button", { name: "Añadir cuenta contable", exact: true }).click();
  await expect(page.getByText("Cuenta contable añadida. Ya puedes vincularla con su partida o banco.")).toBeVisible();
  await page.unrouteAll(); await prepare(page, { denied: true });
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
  await expect(page.getByRole("heading", { name: "Configuración de gastos y pagos preparada" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar vínculo" })).toHaveCount(0);
});

test("desktop and mobile keep controls inside the viewport", async ({ page }) => {
  await prepare(page);
  await expect(page.getByRole("heading", { name: "Partidas y bancos que ya utilizas" })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of await page.locator("button:visible, select:visible, input:visible").all()) {
      const rect = await control.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    }
    if (width !== 768) await page.screenshot({ path: `.tmp/accounting-preparation-${width}.png`, fullPage: true });
  }
});
