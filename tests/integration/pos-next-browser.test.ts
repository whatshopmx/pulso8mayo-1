import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { config, parse } from "dotenv";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page, type APIRequestContext } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { account, users, sessions, companies, branches, dailySalesCuts, dataAccessLogs } from "@/lib/db/schema";

// Opt-in: Next de producción, Better Auth, Neon aislado y R2 reales. Sin mocks.
config({ path: ".env" });
const enabled = process.env.RUN_POS_NEXT_BROWSER === "1";
const companyId = randomUUID(), branchId = randomUUID(), actorId = randomUUID(), cutId = randomUUID();
const otherCutId = randomUUID(), cutIds = [cutId, otherCutId];
const foreignCompanyId = randomUUID(), foreignBranchId = randomUUID(), otherBranchId = randomUUID();
const peers = [
  { id: randomUUID(), role: "ADMIN" as const, companyId: foreignCompanyId, branchId: foreignBranchId, status: 404 },
  { id: randomUUID(), role: "GERENTE" as const, companyId, branchId: otherBranchId, status: 404 },
  { id: randomUUID(), role: "EMPLEADO" as const, companyId, branchId, status: 403 },
];
const actorIds = [actorId, ...peers.map(peer => peer.id)];
const companyIds = [companyId, foreignCompanyId], branchIds = [branchId, otherBranchId, foreignBranchId];
const day = "2026-11-17", password = `Synthetic-${randomUUID()}`;
const contents = Buffer.from("Evidencia POS sintetica de integracion\n");

/**
 * Mismo CSV de resumen de formas de pago que usa `pos-storage-r2-db.test.ts`:
 * no declara fecha (la aporta el formulario), separa Rappi como DELIVERY y deja
 * el resto en SALON. Se sube desde la pantalla, no por HTTP directo.
 */
const DIRECT_CUT_CSV = [
  "Forma de Pago,Importe,Tickets",
  'Efectivo,"$6,000.00",45',
  'Tarjeta,"$2,500.00",25',
  'Rappi,"$1,500.00",10',
  'Total,"$10,000.00",80',
].join("\r\n");

/** Día propio del recorrido de pantalla: no comparte fecha con los otros casos. */
const directDay = "2026-11-16";
let child: ChildProcess | undefined, browser: Browser | undefined, baseURL: string;
let seeded = false, fileKey: string | undefined, directKey: string | undefined, log: number | undefined;
let r2: typeof import("@/lib/storage/r2-client");

/**
 * Better Auth limita `/sign-in/email` por IP. El recorrido abre varias sesiones
 * seguidas y la ventana se agota a mitad del archivo, así que el 429 se espera a
 * que expire en vez de convertirlo en un fallo del producto bajo prueba.
 */
async function signIn(request: APIRequestContext, data: { email: string; password: string }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await request.post("/api/auth/sign-in/email", { headers: { origin: baseURL }, data });
    if (response.status() !== 429) return response;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return request.post("/api/auth/sign-in/email", { headers: { origin: baseURL }, data });
}

beforeAll(async () => {
  if (!enabled) return;
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync(".env")).DATABASE_URL));
  expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
  // El build del recorrido puede vivir aparte para no competir con `next dev`
  // por `.next`; el flag lo comparten build y `next start`.
  const distDir = process.env.PULSO_POS_BROWSER_TEST === "1" ? ".tmp/next-pos-browser" : ".next";
  expect(existsSync(`${distDir}/BUILD_ID`), `Se requiere el build verificado (${distDir})`).toBe(true);
  r2 = await import("@/lib/storage/r2-client");
  expect(r2.isR2Configured(), "Esta integración requiere R2 real").toBe(true);
  const runtime = await db.execute(sql`select rolbypassrls as bypass from pg_roles where rolname = current_user`);
  console.log("POS runtime:", JSON.stringify({ bypassRls: runtime.rows[0]?.bypass }));
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No se obtuvo un puerto de prueba");
  const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  baseURL = `http://127.0.0.1:${port}`;
  const now = new Date(), hash = await hashPassword(password);
  await db.transaction(async tx => {
    await tx.insert(companies).values({ id: companyId, name: "Synthetic POS Next company" });
    await tx.insert(companies).values({ id: foreignCompanyId, name: "Synthetic POS foreign company" });
    await tx.insert(branches).values({ id: branchId, companyId, name: "Synthetic POS Next branch" });
    await tx.insert(branches).values([{ id: otherBranchId, companyId, name: "Synthetic POS other branch" },
      { id: foreignBranchId, companyId: foreignCompanyId, name: "Synthetic POS foreign branch" }]);
    await tx.insert(users).values({ id: actorId, companyId, branchId, role: "ADMIN", email: `${actorId}@example.invalid`,
      name: "Synthetic POS actor", emailVerified: true, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: randomUUID(), userId: actorId, accountId: actorId,
      providerId: "credential", password: hash, createdAt: now, updatedAt: now });
    await tx.insert(users).values(peers.map(peer => ({ id: peer.id, companyId: peer.companyId, branchId: peer.branchId,
      role: peer.role, email: `${peer.id}@example.invalid`, name: "Synthetic POS peer", emailVerified: true, createdAt: now, updatedAt: now })));
    await tx.insert(account).values(peers.map(peer => ({ id: randomUUID(), userId: peer.id, accountId: peer.id,
      providerId: "credential", password: hash, createdAt: now, updatedAt: now })));
    await tx.insert(dailySalesCuts).values({ id: cutId, companyId, branchId, businessDate: day,
      shift: "COMPLETO", channel: "TOTAL", totalSales: 10000, source: "MANUAL_FORM", status: "VALIDATED" });
    await tx.insert(dailySalesCuts).values({ id: otherCutId, companyId, branchId: otherBranchId, businessDate: day,
      shift: "COMPLETO", channel: "TOTAL", totalSales: 20000, source: "MANUAL_FORM", status: "VALIDATED" });
  });
  seeded = true;
  log = openSync(".tmp/pos-next-browser-server.log", "w");
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: randomUUID(), NEXT_PUBLIC_APP_URL: baseURL,
      UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", RESEND_API_KEY: "", WASENDER_API_KEY: "",
      INNGEST_DEV: "1", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", log, log], windowsHide: true,
  });
  child.on("error", () => {});
  let ready = false;
  for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
    if (child.exitCode !== null) throw new Error(`Next terminó con código ${child.exitCode}`);
    try { ready = (await fetch(`${baseURL}/api/auth/get-session`, { signal: AbortSignal.timeout(3000) })).status === 401; }
    catch { /* El servidor aún está iniciando. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  expect(ready, "Next no inició; consulta .tmp/pos-next-browser-server.log").toBe(true);
  browser = await chromium.launch({ headless: true });
}, 120000);

afterAll(async () => {
  if (!enabled) return;
  try { await browser?.close(); }
  finally {
    if (child?.pid && child.exitCode === null) {
      if (process.platform === "win32") {
        const stop = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        await once(stop, "exit");
      } else { child.kill("SIGTERM"); await once(child, "exit"); }
    }
    if (log !== undefined) closeSync(log);
    try {
      if (fileKey) { await r2.deleteFromR2(fileKey); expect(await r2.getFromR2(fileKey)).toBeNull(); }
      if (directKey) { await r2.deleteFromR2(directKey); expect(await r2.getFromR2(directKey)).toBeNull(); }
    } finally { if (seeded) {
      await db.transaction(async tx => {
        await tx.delete(dataAccessLogs).where(inArray(dataAccessLogs.companyId, companyIds));
        await tx.delete(sessions).where(inArray(sessions.userId, actorIds));
        await tx.delete(account).where(inArray(account.userId, actorIds));
        // Por empresa, no por IDs sembrados: la ingesta desde la pantalla crea
        // cortes con IDs que genera el servidor. Las empresas son sintéticas.
        await tx.delete(dailySalesCuts).where(inArray(dailySalesCuts.companyId, companyIds));
        await tx.delete(users).where(inArray(users.id, actorIds));
        await tx.delete(branches).where(inArray(branches.id, branchIds));
        await tx.delete(companies).where(inArray(companies.id, companyIds));
      });
      expect(await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, companyIds))).toEqual([]);
      expect(await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.userId, actorIds))).toEqual([]);
      expect(await db.select({ id: dataAccessLogs.id }).from(dataAccessLogs).where(inArray(dataAccessLogs.companyId, companyIds))).toEqual([]);
      expect(await db.select({ id: dailySalesCuts.id }).from(dailySalesCuts).where(inArray(dailySalesCuts.companyId, companyIds))).toEqual([]);
    } }
  }
}, 60000);

it.skipIf(!enabled)("Next + sesión + R2: sube POS, descarga desde el detalle y rechaza acceso tras logout", async () => {
  const context = await browser!.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  let page: Page | undefined;
  try {
    expect((await context.request.get(`/api/sales/cuts/${cutId}/pos-file`)).status()).toBe(401);
    const login = await signIn(context.request, { email: `${actorId}@example.invalid`, password });
    expect(login.status()).toBe(200);
    const upload = await context.request.post("/api/workflows/smart-links/upload-pos", { multipart: {
      branchId, businessDate: day, file: { name: "evidence.csv", mimeType: "text/csv", buffer: contents },
    } });
    expect(upload.status()).toBe(200);
    const body = await upload.json();
    expect(typeof body.data.fileUrl).toBe("string");
    expect(body.data.fileUrl.startsWith(`companies/${companyId}/branches/${branchId}/pos/${day}/`)).toBe(true);
    fileKey = body.data.fileUrl;
    expect(body.data).toMatchObject({ durable: true, matchedCount: 1 });
    expect((await r2.getFromR2(fileKey!))?.equals(contents)).toBe(true);

    await context.addCookies([{ name: "pulso_selected_branch", value: branchId, url: baseURL }]);
    page = await context.newPage();
    const errors: string[] = [], failures: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === baseURL && url.pathname.startsWith("/api/") && response.status() >= 400)
        failures.push(`${response.status()} ${url.pathname}`);
    });
    const listed = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/sales/cuts" && url.searchParams.get("branchId") === branchId;
    });
    await page.goto(`/dashboard/sales?startDate=${day}&endDate=${day}`, { timeout: 60000 });
    const listing = await (await listed).json();
    expect(listing.data.scope).toMatchObject({ branchId, startDate: day, endDate: day });
    expect(listing.data.items.map((cut: { id: string }) => cut.id)).toContain(cutId);
    await browserExpect(page.getByRole("heading", { name: /Ventas y Cortes de Caja/ })).toBeVisible();
    await page.getByRole("tab", { name: "Registro de Cortes" }).click();
    const row = page.getByRole("row").filter({ hasText: "Synthetic POS Next branch" });
    await browserExpect(row).toHaveCount(1, { timeout: 30000 });
    await row.click();
    const access = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sales/cuts/${cutId}/pos-file`);
    await page.getByRole("button", { name: "Consultar archivo POS" }).click();
    expect((await access).status()).toBe(200);
    const link = page.getByRole("link", { name: /Abrir archivo POS/ });
    await browserExpect(link).toHaveAttribute("rel", "noopener noreferrer");
    await page.screenshot({ path: ".tmp/pos-next-browser-desktop.png", fullPage: true, animations: "disabled" });
    const downloaded = page.waitForEvent("download", { timeout: 30000 });
    await link.click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    expect(readFileSync((await download.path())!).equals(contents)).toBe(true);
    expect(errors).toEqual([]); expect(failures).toEqual([]);

    for (const reference of [fileKey!.replace(companyId, foreignCompanyId), fileKey!.replace(branchId, otherBranchId),
      fileKey!.replace("/pos/", "/evidence/")]) {
      const rejected = await context.request.post("/api/workflows/smart-links/upload-pos", {
        data: { branchId, businessDate: day, fileUrl: reference },
      });
      expect(rejected.status()).toBe(400);
      await db.update(dailySalesCuts).set({ rawFileUrl: reference }).where(eq(dailySalesCuts.id, cutId));
      try {
        // También protege registros legacy/corruptos que ya existen en DB.
        expect((await context.request.get(`/api/sales/cuts/${cutId}/pos-file`)).status()).toBe(404);
      } finally {
        await db.update(dailySalesCuts).set({ rawFileUrl: fileKey }).where(eq(dailySalesCuts.id, cutId));
      }
    }
    const [stored] = await db.select({ key: dailySalesCuts.rawFileUrl }).from(dailySalesCuts).where(eq(dailySalesCuts.id, cutId));
    expect(stored.key).toBe(fileKey);

    expect((await context.request.post("/api/auth/sign-out", { headers: { origin: baseURL }, data: {} })).status()).toBe(200);
    expect((await context.request.get(`/api/sales/cuts/${cutId}/pos-file`)).status()).toBe(401);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await row.click();
    await page.getByRole("button", { name: "Consultar archivo POS" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Tu sesión terminó");
    await browserExpect(page.getByRole("link", { name: /Abrir archivo POS/ })).toHaveCount(0);
    for (const peer of peers) {
      const session = await browser!.newContext({ baseURL });
      try {
        const login = await signIn(session.request, { email: `${peer.id}@example.invalid`, password });
        expect(login.status()).toBe(200);
        expect((await session.request.get(`/api/sales/cuts/${cutId}/pos-file`)).status()).toBe(peer.status);
      } finally { await session.close(); }
    }
  } catch (error) {
    if (page) await page.screenshot({ path: ".tmp/pos-next-browser-failure.png", fullPage: true, animations: "disabled" }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}, 120000);

it.skipIf(!enabled)("listado de cortes respeta empresa y sucursal con sesiones reales", async () => {
  const range = `startDate=${day}&endDate=${day}`;
  for (const peer of [{ id: actorId, role: "ADMIN" as const }, ...peers]) {
    const session = await browser!.newContext({ baseURL });
    try {
      const login = await signIn(session.request, { email: `${peer.id}@example.invalid`, password });
      expect(login.status()).toBe(200);
      const list = await session.request.get(`/api/sales/cuts?${range}`);
      if (peer.role === "EMPLEADO") {
        expect(list.status()).toBe(403);
      } else {
        expect(list.status()).toBe(200);
        const listed = (await list.json()).data;
        const expected = peer.id === actorId ? cutIds : peer.role === "GERENTE" ? [otherCutId] : [];
        expect(listed.items.map((cut: { id: string }) => cut.id).sort()).toEqual([...expected].sort());
        expect(listed.total).toBe(expected.length);
        expect(listed.scope.branchId).toBe(peer.role === "GERENTE" ? otherBranchId : null);
        if (peer.role === "GERENTE") {
          expect((await session.request.get(`/api/sales/cuts?${range}&branchId=${branchId}`)).status()).toBe(403);
          const own = await session.request.get(`/api/sales/cuts?${range}&branchId=${otherBranchId}`);
          expect(own.status()).toBe(200);
          const ownList = (await own.json()).data;
          expect(ownList).toMatchObject({ total: 1, scope: { branchId: otherBranchId } });
          expect(ownList.items.map((cut: { id: string }) => cut.id)).toEqual([otherCutId]);
        }
      }
    } finally { await session.close(); }
  }
}, 60000);

/**
 * V3 navegador del productor directo (`/dashboard/sales/upload`).
 *
 * Los otros dos casos recorren el cierre por smart link y la lectura. Éste
 * ejerce la pantalla real contra el mismo Next de producción, con Better Auth,
 * Neon aislado y R2 reales, y comprueba el contrato completo de la key: lo que
 * el formulario escribe es lo que la ruta autorizada puede volver a abrir.
 */
it.skipIf(!enabled)("pantalla de ingesta POS: sube el archivo, persiste la key canónica y la lectura autorizada lo devuelve", async () => {
  const context = await browser!.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  let page: Page | undefined;
  try {
    const login = await signIn(context.request, { email: `${actorId}@example.invalid`, password });
    expect(login.status()).toBe(200);
    await context.addCookies([{ name: "pulso_selected_branch", value: branchId, url: baseURL }]);
    page = await context.newPage();
    const errors: string[] = [], failures: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === baseURL && url.pathname.startsWith("/api/") && response.status() >= 400)
        failures.push(`${response.status()} ${url.pathname}`);
    });

    await page.goto("/dashboard/sales/upload", { timeout: 60000 });
    await browserExpect(page.getByRole("heading", { name: /Ingesta POS Manual/ })).toBeVisible();
    // La empresa sintética tiene una sola sucursal: es la que viene elegida.
    await browserExpect(page.locator("#branch")).toContainText("Synthetic POS Next branch");
    await page.locator("#date").fill(directDay);
    await page.locator("#file-input").setInputFiles({
      name: "reporte caja.csv", mimeType: "text/csv", buffer: Buffer.from(DIRECT_CUT_CSV),
    });
    await browserExpect(page.getByText("reporte caja.csv")).toBeVisible();

    const upload = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/sales/cuts/upload" && response.request().method() === "POST";
    });
    await page.getByRole("button", { name: "Subir Reporte y Procesar" }).click();
    const response = await upload;
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { success: boolean; data: { rows: unknown[] } };
    expect(payload.success).toBe(true);
    expect(payload.data.rows).toHaveLength(2);

    // El destino del `router.push` tiene que existir: antes apuntaba a
    // `/dashboard/sales/cuts`, una ruta sin página que terminaba en 404.
    await page.waitForURL(url => new URL(url).pathname === "/dashboard/sales", { timeout: 60000 });
    await browserExpect(page.getByRole("heading", { name: /Ventas y Cortes de Caja/ })).toBeVisible();
    await page.screenshot({ path: ".tmp/pos-direct-upload-browser.png", fullPage: true, animations: "disabled" });

    // Lo que la pantalla escribió es exactamente lo que el contrato POS exige.
    const cutRows = await db
      .select({
        id: dailySalesCuts.id,
        channel: dailySalesCuts.channel,
        totalSales: dailySalesCuts.totalSales,
        rawFileUrl: dailySalesCuts.rawFileUrl,
        source: dailySalesCuts.source,
        shift: dailySalesCuts.shift,
      })
      .from(dailySalesCuts)
      .where(and(
        eq(dailySalesCuts.companyId, companyId),
        eq(dailySalesCuts.branchId, branchId),
        eq(dailySalesCuts.businessDate, directDay),
        eq(dailySalesCuts.shift, "MATUTINO"),
      ));
    expect(cutRows).toHaveLength(2);
    expect(cutRows.map(row => row.channel).sort()).toEqual(["DELIVERY", "SALON"]);
    expect(cutRows.every(row => row.source === "UPLOAD")).toBe(true);
    expect(cutRows.reduce((sum, row) => sum + row.totalSales, 0)).toBe(1_000_000);

    const key = cutRows[0].rawFileUrl!;
    expect(key).toBeTruthy();
    expect(cutRows[1].rawFileUrl).toBe(key);
    directKey = key;
    expect(key).toMatch(new RegExp(`^companies/${companyId}/branches/${branchId}/pos/${directDay}/\\d+_reporte_caja\\.csv$`));
    expect(key.startsWith("http")).toBe(false);

    const stored = await r2.getFromR2(key);
    expect(stored).not.toBeNull();
    expect(stored!.equals(Buffer.from(DIRECT_CUT_CSV))).toBe(true);

    // La ruta autorizada abre el corte recién creado por la pantalla.
    const read = await context.request.get(`/api/sales/cuts/${cutRows[0].id}/pos-file`);
    expect(read.status()).toBe(200);
    const signed = ((await read.json()) as { data: { url: string; fileKey: string } }).data;
    expect(signed.fileKey).toBe(key);
    const download = await fetch(signed.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(Buffer.from(DIRECT_CUT_CSV))).toBe(true);

    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
  } catch (error) {
    if (page) await page.screenshot({ path: ".tmp/pos-direct-upload-failure.png", fullPage: true, animations: "disabled" }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}, 120000);
