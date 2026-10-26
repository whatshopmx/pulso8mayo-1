import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

let server: { close: () => Promise<void> };
let url: string;
test.beforeAll(async () => {
  const fromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(fromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const chunks = path.join(root, ".next/static/chunks");
  const styles = readdirSync(chunks).filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(path.join(chunks, file), "utf8")).join("\n");
  const fixtures: Record<string, string> = {
    "\0aguinaldo-style.css": styles,
    "\0aguinaldo-entry": `
      import '/aguinaldo-style.css'; import React from 'react';
      import { createRoot } from 'react-dom/client'; import { Toaster } from 'sonner';
      import { AguinaldoCard } from '/components/labor/aguinaldo-card.tsx';
      createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
        React.createElement(AguinaldoCard), React.createElement(Toaster)));
    `,
  };
  const vite = await createServer({
    configFile: false, root, cacheDir: path.join(root, ".tmp", `aguinaldo-vite-${process.pid}`),
    css: { postcss: { plugins: [] } }, resolve: { alias: { "@": root }, dedupe: ["react", "react-dom"] },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
      "@radix-ui/react-label", "@radix-ui/react-select", "@radix-ui/react-slot", "@radix-ui/react-separator",
      "radix-ui", "date-fns", "date-fns/locale", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge", "sonner"] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    plugins: [{
      name: "aguinaldo-fixtures", enforce: "pre",
      resolveId(id: string) {
        if (Object.hasOwn(fixtures, id)) return id;
        if (id === "/aguinaldo-entry.tsx") return "\0aguinaldo-entry";
        if (id === "/aguinaldo-style.css") return "\0aguinaldo-style.css";
      },
      load: (id: string) => fixtures[id],
      configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
        dev.middlewares.use((req: { url: string }, res: { setHeader: (k: string, v: string) => void; end: (body: string) => void }, next: () => void) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>Aguinaldo — prueba aislada</title></head><body><div id="root"></div><script type="module" src="/aguinaldo-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await vite.listen(); server = vite; url = `http://127.0.0.1:${vite.httpServer.address().port}`;
});
test.afterAll(async () => { await server?.close(); });

const employeeId = "11111111-1111-4111-8111-111111111111";
const basePreview = (fechaPago: string, dailyCents = 60_000) => ({
  anioFiscal: 2026, fechaPago, base: "REGISTERED", practiceMode: "FORMAL",
  estatusLegal: { fuente: "LEY_VIGENTE", diasLegalesVigente: 15 }, aguinaldoDaysMxn: 15,
  umaDailyCents: fechaPago.startsWith("2026-01") ? 11_314 : 11_731,
  totalBrutoCents: 900_000, totalExentoCents: 351_930, totalGravadoCents: 548_070,
  totalDeduccionesCents: 117_065, totalNetoCents: 782_935, totalDiferenciaCents: 0,
  empleadosATimbrar: 1, empleadosSinRFC: 0,
  rows: [{ userId: employeeId, name: "Empleado Prueba", rfc: "TEST010101AAA", salarioDiarioCents: dailyCents,
    salarioEfectivoCents: dailyCents, gapSalarioCents: 0, esFormal: true,
    diasCalendario: 365, diasLaborados: 365, diasAutomaticos: null, fuenteDias: "CALENDARIO",
    calculo: { brutoCents: 900_000, exentoCents: 351_930, gravadoCents: 548_070, diasAguinaldo: 15 }, diferenciaCents: 0 }],
});

test("fecha de pago, ISR, neto y cero editado llegan al POST", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const posts: unknown[] = [];
  await page.clock.install({ time: new Date("2026-12-15T18:00:00Z") });
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const requestUrl = new URL(req.url());
    let data: unknown = [];
    if (req.method() === "POST") {
      posts.push(req.postDataJSON()); data = { results: [{ success: true }], runId: "run-test" };
    } else if (requestUrl.pathname === "/api/payroll/aguinaldo" && !requestUrl.searchParams.has("dispersiones")) {
      data = basePreview(requestUrl.searchParams.get("fechaPago") ?? "2026-12-15");
    } else if (requestUrl.searchParams.has("dispersiones")) data = { dispersiones: [] };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(url);
  await expect(page.getByLabel("Fecha de pago")).toHaveValue("2026-12-15");
  await expect(page.getByText("Neto a pagar (registro)", { exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Empleado Prueba" });
  await expect(row).toContainText("1,170.65");
  await expect(row).toContainText("7,829.35");
  await page.getByLabel("Fecha de pago").fill("2026-01-31");
  await expect(row).toContainText("1,197.31");
  await expect(row).toContainText("7,802.69");
  await page.getByRole("button", { name: "Ejecutar Dispersión 2026" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ fechaPago: "2026-01-31", anioFiscal: 2026 });
  await page.getByLabel("Días a considerar para Empleado Prueba").fill("0");
  await expect(row).toContainText("= 0.00 días agui.");
  await expect(row.getByRole("cell").nth(2)).toContainText("0.00");
  await page.getByRole("button", { name: "Ejecutar Dispersión 2026" }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ fechaPago: "2026-01-31", diasLaboradosPorUsuario: { [employeeId]: 0 } });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByLabel("Fecha de pago")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ejecutar Dispersión 2026" })).toBeInViewport();
  }
  await page.getByLabel("Fecha de pago").focus();
  await expect(page.getByLabel("Fecha de pago")).toBeFocused();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "tasks/evidencia/consolidado-2026-10-22/AGU-03B-4/browser-desktop.png", fullPage: true });
});

test("recupera por ID y fecha original; bloquea doble clic y muestra conciliación pendiente sin depender de la preview", async ({ page }) => {
  const runId = "22222222-2222-4222-8222-222222222222";
  const posts: unknown[] = [];
  let liberar!: () => void;
  const pendiente = new Promise<void>((resolve) => { liberar = resolve; });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const requestUrl = new URL(req.url());
    if (req.method() === "POST") {
      posts.push(req.postDataJSON()); await pendiente;
      return route.fulfill({ json: { success: true, data: { runId, fechaPago: "2026-01-31", anioFiscal: 2025,
        status: "COMPLETED_WITH_ERRORS", results: [{ success: false, employeeName: "Empleado Prueba", error: "Envío incierto: concilia con el proveedor antes de emitir otro." }] } } });
    }
    if (requestUrl.pathname === "/api/payroll") return route.fulfill({ json: { success: true, data: [{
      id: runId, aguinaldoFiscalYear: 2025, status: "COMPLETED_WITH_ERRORS", createdAt: "2026-01-31T18:00:00Z",
      periodStart: "2025-01-01", periodEnd: "2025-12-31", aguinaldoSnapshot: { version: 1, fechaPago: "2026-01-31" },
    }] } });
    if (requestUrl.pathname === "/api/payroll/aguinaldo" && !requestUrl.searchParams.has("dispersiones")) {
      return route.fulfill({ status: 400, json: { success: false, error: { message: "Fuente fiscal no disponible hoy" } } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto(url);
  const recover = page.getByRole("button", { name: "Recuperar corrida 2025" });
  await expect(recover).toBeVisible();
  await expect(page.getByText("Pago autorizado: 2026-01-31")).toBeVisible();
  await recover.focus(); await page.keyboard.press("Enter");
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.getByRole("button", { name: "Recuperando corrida 2025" })).toBeDisabled();
  expect(posts[0]).toEqual({ action: "RECOVER", runId });
  liberar();
  await expect(page.getByText(/Envío incierto: concilia con el proveedor/)).toBeVisible();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(recover).toBeVisible();
    const bounds = await recover.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(page.getByText(/Envío incierto: concilia con el proveedor/)).toBeVisible();
    if (width === 320) await page.screenshot({ path: "tasks/evidencia/consolidado-2026-10-22/AGU-03B-4/browser-recovery-mobile.png", fullPage: true });
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: "tasks/evidencia/consolidado-2026-10-22/AGU-03B-4/browser-recovery.png", fullPage: true });
});

test("bloqueo de subsidio visible y corregible al editar días; error de fuente invalida la preview", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-12-15T18:00:00Z") });
  let rejectPreview = false; let posts = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const requestUrl = new URL(req.url());
    if (req.method() === "POST") { posts++; return route.abort(); }
    if (requestUrl.pathname === "/api/payroll/aguinaldo" && !requestUrl.searchParams.has("dispersiones")) {
      if (rejectPreview) return route.fulfill({ status: 400, json: { success: false, error: { message: "UMA no disponible" } } });
      const preview = basePreview("2026-12-15", 35_000);
      return route.fulfill({ json: { success: true, data: preview } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto(url);
  await expect(page.getByText(/acumulados mensuales conciliados/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ejecutar Dispersión 2026" })).toBeDisabled();
  await page.getByLabel("Días a considerar para Empleado Prueba").fill("0");
  await expect(page.getByRole("button", { name: "Ejecutar Dispersión 2026" })).toBeEnabled();
  rejectPreview = true;
  await page.getByLabel("Fecha de pago").fill("2026-12-16");
  await expect(page.getByText("No hay preview disponible.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ejecutar Dispersión 2026" })).toBeDisabled();
  expect(posts).toBe(0);
});
