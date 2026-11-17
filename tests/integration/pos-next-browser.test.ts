import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { config, parse } from "dotenv";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { account, users, sessions, companies, branches, dailySalesCuts } from "@/lib/db/schema";

// Opt-in: Next de producción, Better Auth, Neon aislado y R2 reales. Sin mocks.
config({ path: ".env" });
const enabled = process.env.RUN_POS_NEXT_BROWSER === "1";
const companyId = randomUUID(), branchId = randomUUID(), actorId = randomUUID(), cutId = randomUUID();
const day = "2026-11-17", password = `Synthetic-${randomUUID()}`;
const contents = Buffer.from("Evidencia POS sintetica de integracion\n");
let child: ChildProcess | undefined, browser: Browser | undefined, baseURL: string;
let seeded = false, fileKey: string | undefined, log: number | undefined;
let r2: typeof import("@/lib/storage/r2-client");

beforeAll(async () => {
  if (!enabled) return;
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync(".env")).DATABASE_URL));
  expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
  expect(existsSync(".next/BUILD_ID"), "Se requiere el build verificado de la aplicación").toBe(true);
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
    await tx.insert(branches).values({ id: branchId, companyId, name: "Synthetic POS Next branch" });
    await tx.insert(users).values({ id: actorId, companyId, branchId, role: "ADMIN", email: `${actorId}@example.invalid`,
      name: "Synthetic POS actor", emailVerified: true, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: randomUUID(), userId: actorId, accountId: actorId,
      providerId: "credential", password: hash, createdAt: now, updatedAt: now });
    await tx.insert(dailySalesCuts).values({ id: cutId, companyId, branchId, businessDate: day,
      shift: "COMPLETO", channel: "TOTAL", totalSales: 10000, source: "MANUAL_FORM", status: "VALIDATED" });
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
    } finally { if (seeded) {
      await db.transaction(async tx => {
        await tx.delete(sessions).where(eq(sessions.userId, actorId));
        await tx.delete(account).where(eq(account.userId, actorId));
        await tx.delete(dailySalesCuts).where(eq(dailySalesCuts.id, cutId));
        await tx.delete(users).where(eq(users.id, actorId));
        await tx.delete(branches).where(eq(branches.id, branchId));
        await tx.delete(companies).where(eq(companies.id, companyId));
      });
      expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId))).toEqual([]);
      expect(await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, actorId))).toEqual([]);
    } }
  }
}, 60000);

it.skipIf(!enabled)("sesión real: upload-pos persiste el objeto y vincula el corte aislado", async () => {
  const context = await browser!.newContext({ baseURL });
  try {
    expect((await context.request.get(`/api/sales/cuts/${cutId}/pos-file`)).status()).toBe(401);
    const login = await context.request.post("/api/auth/sign-in/email", { headers: { origin: baseURL },
      data: { email: `${actorId}@example.invalid`, password } });
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
  } finally { await context.close(); }
}, 60000);
