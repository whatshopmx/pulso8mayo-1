import { test, expect, type Page } from "@playwright/test";
import { startAccountingBrowserServer } from "../support/accounting-browser-server";

let harness: Awaited<ReturnType<typeof startAccountingBrowserServer>>;
test.beforeAll(async () => { harness = await startAccountingBrowserServer("bank-accounts"); });
test.afterAll(async () => { await harness?.server.close(); });
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = (n: number, extra = {}) => ({ id: id(n), code: `110${n}`, name: `Banco contable ${n}`,
  kind: "ASSET", active: true, postable: true, validFrom: "2026-01-01", validTo: null, ...extra });

async function prepare(page: Page, options: { empty?: boolean; linked?: boolean; denied?: boolean;
  failSave?: boolean; truncated?: boolean; currency?: string; role?: string } = {}) {
  const errors: string[] = [], writes: { url: string; body: { action?: string; input?: Record<string, string> } }[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(role => { (window as Window & { __bankRole: string }).__bankRole = role; }, options.role ?? "ADMIN");
  const bank = { id: id(10), label: "BBVA · Operativa", accountLastFour: "1917", bankCode: "012",
    bankName: "BBVA", clabeLastFour: "1234", currency: options.currency ?? "MXN", active: true,
    purpose: "MIXTO", registeredByName: "Administración", notes: null, createdAt: "2026-01-01" };
  const data = { accounts: options.empty ? [] : [account(1), account(2), account(3, { kind: "INCOME" }),
    account(4, { active: false }), account(5, { postable: false }), account(6, { validFrom: "9999-01-01" }),
    account(7, { validTo: "2026-01-01" })], centers: [], banks: [{...bank,lastFour:bank.accountLastFour}],
    links: options.linked ? [{ accountId: id(1), bankAccountId: bank.id }] : [], expenses: [],
    truncated: options.truncated ?? false, postingEnabled: true, canPublishOpening: true };
  let failed = false;
  await page.route("**/api/finance/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== "GET") {
      const body = req.postDataJSON(); writes.push({ url: url.pathname, body });
      if (options.failSave && !failed) { failed = true; return route.fulfill({ status: 409,
        json: { success: false, error: { message: "La cuenta cambió; revisa el vínculo." } } }); }
      if (body.action === "account") {
        const created = account(20, body.input); data.accounts.push(created);
        return route.fulfill({ status: 201, json: { success: true, data: created } });
      }
      if (body.action === "link") data.links = [{ accountId: body.input.accountId, bankAccountId: body.input.bankAccountId }];
      return route.fulfill({ status: 201, json: { success: true, data: body.input } });
    }
    if (url.pathname === "/api/finance/bank-accounts") return route.fulfill({ json: { data: [bank] } });
    if (options.denied) return route.fulfill({ status: 503, json: { success: false,
      error: { message: "La revisión contable aún no está habilitada." } } });
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto(harness.url);
  await expect(page.getByRole("heading", { name: "Cuentas bancarias propias" })).toBeVisible();
  return { bank, data, writes, errors };
}

test("links the existing mixed bank and reopens the saved mapping without changing its purpose", async ({ page }) => {
  const { bank, writes, errors } = await prepare(page);
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Pagos e ingresos usan la misma cuenta contable.")).toBeVisible();
  const select = dialog.getByLabel("Cuenta contable", { exact: true });
  await expect(select.locator("option")).toHaveCount(3);
  await select.selectOption(id(2));
  await dialog.getByRole("button", { name: "Guardar vínculo" }).click();
  await expect(dialog.getByRole("status")).toContainText("Vínculo guardado");
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  await expect(page.getByLabel("Cuenta contable", { exact: true })).toHaveValue(id(2));
  expect(writes).toEqual([{ url: "/api/finance/accounting/preparation", body: { action: "link",
    input: { bankAccountId: bank.id, accountId: id(2) } } }]);
  expect(errors).toEqual([]);
});

test("creates an asset account in the bank dialog before explicitly saving its link", async ({ page }) => {
  const { writes, errors } = await prepare(page, { empty: true });
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Aún no hay cuentas contables de activo disponibles.")).toBeVisible();
  await dialog.getByRole("button", { name: "Añadir cuenta contable" }).click();
  await dialog.getByLabel("Código contable").fill("1101-BBVA");
  await dialog.getByLabel("Nombre contable").fill("BBVA operativo");
  await dialog.getByRole("button", { name: "Crear cuenta contable" }).click();
  await expect(dialog.getByLabel("Cuenta contable", { exact: true })).toHaveValue(id(20));
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ action: "account", input: { code: "1101-BBVA", name: "BBVA operativo",
    kind: "ASSET", normalBalance: "DEBIT", postable: true, active: true } });
  await dialog.getByRole("button", { name: "Guardar vínculo" }).click();
  await expect(dialog.getByRole("status")).toContainText("Vínculo guardado");
  expect(writes[1].body).toEqual({ action: "link", input: { bankAccountId: id(10), accountId: id(20) } });
  expect(errors).toEqual([]);
});

test("keeps the old mapping and selection visible on save failure, then permits retry", async ({ page }) => {
  const { writes, errors } = await prepare(page, { linked: true, failSave: true });
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Vinculada a 1101 · Banco contable 1")).toBeVisible();
  await dialog.getByLabel("Cuenta contable", { exact: true }).selectOption(id(2));
  await dialog.getByRole("button", { name: "Guardar vínculo" }).click();
  await expect(dialog.getByRole("alert")).toContainText("La cuenta cambió");
  await expect(dialog.getByText("Vinculada a 1101 · Banco contable 1")).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar vínculo" }).click();
  await expect(dialog.getByRole("status")).toContainText("Vínculo guardado");
  expect(writes).toHaveLength(2); expect(errors).toEqual([]);
});

test("denied accounting access leaves banking available and never allows a link", async ({ page }) => {
  const { writes } = await prepare(page, { denied: true });
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("no está habilitada");
  await expect(page.getByRole("button", { name: "Guardar vínculo" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Registrar cuenta" })).toBeEnabled();
  expect(writes).toEqual([]);
});

test("blocks non-MXN banks and incomplete catalogs", async ({ page }) => {
  await prepare(page, { currency: "USD" });
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  await expect(page.getByRole("dialog")).toContainText("El vínculo contable requiere una cuenta bancaria en MXN.");
  await expect(page.getByRole("button", { name: "Guardar vínculo" })).toBeDisabled();
  await page.unrouteAll(); await prepare(page, { truncated: true });
  await page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" }).click();
  await expect(page.getByRole("dialog")).toContainText("El catálogo está incompleto");
  await expect(page.getByRole("button", { name: "Guardar vínculo" })).toHaveCount(0);
});

test("keyboard and mobile dialog work, while non-admins have no mapping action", async ({ page }) => {
  const { errors } = await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const button = page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" });
  await button.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path: ".tmp/bank-account-accounting-mobile.png",fullPage:true});
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(errors).toEqual([]);
  await page.unrouteAll(); await prepare(page, { role: "GERENTE" });
  await expect(page.getByRole("button", { name: "Cuenta contable de BBVA · Operativa" })).toHaveCount(0);
});
