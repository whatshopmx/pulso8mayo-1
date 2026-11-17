import { test, expect } from "@playwright/test";
import { startPosFileBrowserServer } from "../support/pos-file-browser-server";
let harness: Awaited<ReturnType<typeof startPosFileBrowserServer>>;
test.beforeAll(async () => { harness = await startPosFileBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test("consulta la ruta autorizada y nunca enlaza la referencia almacenada", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests: string[] = [];
  await page.route("**/api/sales/cuts/*/pos-file", route => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { success: true, data: { url: "https://signed.example/report.csv", expiresInSeconds: 600 } } });
  });
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Ver corte", exact: true }).click();
  await expect(page.getByRole("button", { name: "Consultar archivo POS" })).toBeVisible();
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  const link = page.getByRole("link", { name: "Abrir archivo POS" });
  await expect(link).toHaveAttribute("href", "https://signed.example/report.csv");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(requests).toEqual(["/api/sales/cuts/d1000000-0000-4000-8000-000000000001/pos-file"]);
  await expect(page.locator('a[href="private-key-never-a-link"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const [status, message] of [[401, "Tu sesión terminó"], [403, "No tienes permiso"],
  [404, "Vuelve a subirlo"], [500, "Intenta de nuevo"]] as const) {
  test(`HTTP ${status}: muestra recuperación y permite reintentar`, async ({ page }) => {
    let calls = 0;
    await page.route("**/api/sales/cuts/*/pos-file", route => route.fulfill(++calls === 1
      ? { status, json: { success: false } }
      : { json: { success: true, data: { url: "https://signed.example/retry.csv", expiresInSeconds: 600 } } }));
    await page.goto(harness.url);
    await page.getByRole("button", { name: "Ver corte", exact: true }).click();
    await page.getByRole("button", { name: "Consultar archivo POS" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Consultar archivo POS" }).click();
    await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveAttribute("href", "https://signed.example/retry.csv");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(calls).toBe(2);
  });
}

test("sin archivo no consulta ni ofrece enlaces", async ({ page }) => {
  let calls = 0;
  page.on("request", req => { if (req.url().endsWith("/pos-file")) calls++; });
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Ver corte sin archivo" }).click();
  await expect(page.getByText("Este corte no tiene archivo POS adjunto.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Consultar archivo POS" })).toHaveCount(0);
  expect(calls).toBe(0);
});

test("el enlace caduca y una nueva consulta pide una firma nueva", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/sales/cuts/*/pos-file", route => route.fulfill({ json: {
    success: true, data: { url: `https://signed.example/${++calls}.csv`, expiresInSeconds: 1 },
  } }));
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Ver corte", exact: true }).click();
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveAttribute("href", "https://signed.example/1.csv");
  await expect(page.getByRole("button", { name: "Consultar archivo POS" })).toBeVisible();
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveAttribute("href", "https://signed.example/2.csv");
});

test("red caída y respuesta inválida muestran un error operativo sin exponer detalles", async ({ page }) => {
  await page.route("**/api/sales/cuts/*/pos-file", route => route.abort("failed"));
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Ver corte", exact: true }).click();
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  await expect(page.getByRole("alert")).toHaveText("No se pudo consultar el archivo POS. Intenta de nuevo.");
  await page.unroute("**/api/sales/cuts/*/pos-file");
  await page.route("**/api/sales/cuts/*/pos-file", route => route.fulfill({ json: {
    success: true, data: { url: "javascript:alert(1)", expiresInSeconds: 600 },
  } }));
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  await expect(page.getByRole("alert")).toHaveText("No se pudo consultar el archivo POS. Intenta de nuevo.");
  await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveCount(0);
});

test("bloquea doble consulta y descarta la respuesta de un corte cerrado", async ({ page }) => {
  let calls = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/sales/cuts/*/pos-file", async route => {
    calls++;
    const first = route.request().url().includes("d1000000");
    if (first) await waiting;
    await route.fulfill({ json: { success: true, data: {
      url: `https://signed.example/${first ? "old" : "new"}.csv`, expiresInSeconds: 600,
    } } }).catch(() => {}); // La petición del primer corte puede estar abortada.
  });
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Ver corte", exact: true }).click();
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  await expect(page.getByRole("button", { name: "Consultando archivo…" })).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Ver otro corte" }).click();
  await page.getByRole("button", { name: "Consultar archivo POS" }).click();
  await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveAttribute("href", "https://signed.example/new.csv");
  release();
  await expect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveAttribute("href", "https://signed.example/new.csv");
  expect(calls).toBe(2);
});

test("teclado y composición sin desbordamiento en móvil, tablet y escritorio", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/sales/cuts/*/pos-file", route => route.fulfill({ status: 404, json: { success: false } }));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(harness.url);
    await page.getByRole("button", { name: "Ver corte", exact: true }).click();
    const button = page.getByRole("button", { name: "Consultar archivo POS" });
    await button.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Vuelve a subirlo");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(async () => {
      const box = await page.getByRole("dialog").boundingBox();
      return !!box && box.x >= -1 && box.x + box.width <= width + 1;
    }).toBe(true);
    if (width === 320 || width === 1440) await page.screenshot({ path: `.tmp/pos-ui-${width}.png`, fullPage: true, animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
