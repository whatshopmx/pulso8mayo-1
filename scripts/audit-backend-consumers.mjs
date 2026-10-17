#!/usr/bin/env node
/**
 * Auditoría de "backend sin consumidor".
 *
 * Responde: ¿qué servicios y rutas API no llegan a ningún consumidor
 * (frontend, ruta API, cron/Inngest) o sólo a tests?
 *
 * Uso:
 *   node scripts/audit-backend-consumers.mjs            # resumen
 *   node scripts/audit-backend-consumers.mjs --json     # detalle JSON
 *
 * Límites (ver informe):
 *   - Es análisis ESTÁTICO de rutas de import/referencia. No prueba ejecución.
 *   - Un servicio puede usarse por inyección/registro con clave string; poco
 *     probable en este repo, pero posible.
 *   - Rutas API externas (webhooks, Inngest, WebSocket) no aparecen referenciadas
 *     en el código a propósito: se marcan por patrón.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib", "hooks", "scripts", "tests"];
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", ".tmp", "drizzle"]);

const toPosix = (p) => p.split(path.sep).join("/");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) walk(path.join(dir, e.name), acc);
    } else acc.push(toPosix(path.join(dir, e.name)));
  }
  return acc;
}

const codeFiles = SCAN_DIRS.flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx)$/.test(f));
const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) cache.set(f, fs.readFileSync(f, "utf8"));
  return cache.get(f);
};

const categoryOf = (f) => {
  if (f.endsWith(".test.ts") || f.endsWith(".spec.ts") || f.includes("__tests__") || f.includes("/tests/"))
    return "test";
  if (f.startsWith("app/api/")) return "apiRoute";
  if (f.startsWith("app/") || f.startsWith("components/") || f.startsWith("hooks/")) return "front";
  if (f.startsWith("lib/inngest/") || f.startsWith("lib/cron/")) return "job";
  return "lib";
};

const norm = (s) => s.replace(/\[[^\]]+\]/g, "*").replace(/\/+$/, "");

// ── Servicios ────────────────────────────────────────────────────────────────
const QUOTES = ['"', "'", "`"];
const serviceFiles = walk("lib/services").filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/__tests__/"),
);

function serviceConsumers(svc) {
  const base = path.basename(svc, ".ts");
  const hits = [];
  for (const f of codeFiles) {
    if (f === svc) continue;
    const t = read(f);
    if (QUOTES.some((q) => t.includes("/" + base + q))) hits.push({ file: f, cat: categoryOf(f) });
  }
  return hits;
}

const services = serviceFiles.map((svc) => {
  const hits = serviceConsumers(svc);
  const by = { front: 0, api: 0, job: 0, lib: 0, test: 0, apiRoute: 0, other: 0 };
  for (const h of hits) by[h.cat] = (by[h.cat] || 0) + 1;
  return { svc, hits, ...by };
});

// ── Rutas API ────────────────────────────────────────────────────────────────
const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const esc = (s) => s.replace(ESCAPE, "\\$&");
const routeTest = (url) => {
  const parts = url.split("/").map((s) => (s === "*" ? "[^\"'`\\s)]*" : esc(s)));
  return new RegExp(parts.join("/") + "(?![A-Za-z0-9_/-])");
};

const routeFiles = walk("app/api").filter((f) => f.endsWith("route.ts"));
const routes = routeFiles.map((f) => ({
  file: f,
  url: "/api" + norm("/" + f.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "")),
}));

const EXTERNAL = /(inngest|socket|whatsapp|webhook|receive-photo|external-reports|smart-links|rate-limit-status)/;

for (const r of routes) {
  const re = routeTest(r.url);
  r.hits = [];
  for (const f of codeFiles) {
    if (f === r.file) continue;
    if (re.test(read(f))) r.hits.push({ file: f, cat: categoryOf(f) });
  }
  r.external = EXTERNAL.test(r.url);
  r.front = r.hits.some((h) => h.cat === "front");
  r.nothing = r.hits.length === 0;
}

const report = {
  generatedAt: new Date().toISOString(),
  services: {
    total: services.length,
    front: services.filter((s) => s.front > 0).length,
    orphan: services.filter((s) => s.front === 0 && s.api + s.apiRoute === 0).length,
    dead: services.filter((s) => !s.front && !s.api && !s.apiRoute && !s.job && !s.lib && !s.test).map((s) => s.svc),
    testOnly: services
      .filter((s) => !s.front && !s.api && !s.apiRoute && !s.job && !s.lib && s.test > 0)
      .map((s) => s.svc),
    cronOnly: services
      .filter((s) => !s.front && !s.api && !s.apiRoute && s.job > 0)
      .map((s) => s.svc),
    svcOnly: services
      .filter((s) => !s.front && !s.api && !s.apiRoute && !s.job && s.lib > 0)
      .map((s) => s.svc),
  },
  routes: {
    total: routes.length,
    front: routes.filter((r) => r.front).length,
    noFront: routes.filter((r) => !r.front).length,
    nothing: routes.filter((r) => r.nothing).map((r) => r.url).sort(),
    nothingInternal: routes.filter((r) => r.nothing && r.external).map((r) => r.url).sort(),
    nothingDead: routes.filter((r) => r.nothing && !r.external).map((r) => r.url).sort(),
    onlyTest: routes
      .filter((r) => !r.front && r.hits.length > 0 && r.hits.every((h) => h.cat === "test"))
      .map((r) => r.url)
      .sort(),
  },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const s = report.services;
  const rt = report.routes;
  console.log("=== SERVICIOS (lib/services) ===");
  console.log(`total ${s.total} | frontend ${s.front} | huérfanos(front=0 y api=0) ${s.orphan}`);
  console.log(`  muertos ${s.dead.length} | solo-tests ${s.testOnly.length} | solo-cron ${s.cronOnly.length} | solo-servicios ${s.svcOnly.length}`);
  console.log("=== RUTAS API ===");
  console.log(`total ${rt.total} | con frontend ${rt.front} | sin frontend ${rt.noFront}`);
  console.log(`  sin NINGUNA referencia ${rt.nothing.length}  (infra/externo ${rt.nothingInternal.length} | candidatos ${rt.nothingDead.length})`);
  console.log(`  solo tests ${rt.onlyTest.length}`);
  console.log("\n(muertos)"); s.dead.forEach((x) => console.log("  -", x));
  console.log("\n(candidatos a sin-consumidor, no externos)"); rt.nothingDead.forEach((x) => console.log("  -", x));
}
