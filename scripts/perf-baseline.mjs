// Performance baseline via raw CDP (no npm deps). Drives installed Chrome headless.
// Usage: node scripts/perf-baseline.mjs [baseURL]
import { spawn } from 'node:child_process';
import http from 'node:http';

const BASE = process.argv[2] || 'http://localhost:3000';
const EMAIL = 'carlos@pulso.mx';
const PASSWORD = '123456';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', `--user-data-dir=${process.env.TEMP}\\perf-baseline-profile`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

const getJson = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
    let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

// wait for devtools endpoint
let version;
for (let i = 0; i < 40; i++) {
  try { version = await getJson('/json/version'); break; } catch { await new Promise(r => setTimeout(r, 500)); }
}
if (!version) { console.error('Chrome DevTools endpoint never came up'); process.exit(1); }

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, (msg) => msg.error ? rej(new Error(method + ': ' + msg.error.message)) : res(msg.result));
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function waitForLoad(timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (events.some(e => e.method === 'Page.loadEventFired')) { events.length = 0; return; }
    await sleep(150);
  }
  events.length = 0;
}

const COLLECT = `(() => {
  const [n] = performance.getEntriesByType('navigation');
  const res = performance.getEntriesByType('resource');
  const byType = {}; let total = 0, jsCount = 0;
  for (const r of res) {
    const s = r.transferSize || 0; total += s;
    byType[r.initiatorType] = (byType[r.initiatorType] || 0) + s;
    if (r.initiatorType === 'script') jsCount++;
  }
  return Promise.resolve({
    ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd),
    load: Math.round(n.loadEventEnd), transferKB: Math.round(total / 1024),
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])),
    resources: res.length, jsCount,
  });
})()`;

const VITALS = `new Promise((resolve) => {
  const out = { LCP: 0, CLS: 0, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) out.LCP = Math.round(e[e.length - 1].startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.CLS += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { out.longTasks++; out.longTaskMs += Math.round(e.duration); } })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  setTimeout(() => { out.CLS = +out.CLS.toFixed(3); resolve(out); }, 300);
})`;

async function measure(url, settleMs = 4000) {
  const t0 = Date.now();
  await send('Page.navigate', { url }, sid);
  await waitForLoad();
  await sleep(settleMs);
  const nav = await evalJs(COLLECT);
  const vitals = await evalJs(VITALS);
  const lcpStatus = vitals.LCP <= 2500 ? '✅' : vitals.LCP <= 4000 ? '⚠️' : '❌';
  console.log(`\n== ${url.replace(BASE, '') || '/'} (wall ${((Date.now() - t0) / 1000).toFixed(1)}s) ==`);
  console.log(`  TTFB ${nav.ttfb}ms | DCL ${nav.dcl}ms | Load ${nav.load}ms`);
  console.log(`  LCP ${vitals.LCP}ms ${lcpStatus} | CLS ${vitals.CLS} | long tasks ${vitals.longTasks} (${vitals.longTaskMs}ms)`);
  console.log(`  transfer ${nav.transferKB}KB (${nav.resources} req, ${nav.jsCount} JS) | byType KB:`, nav.byType);
  return { url, ...nav, ...vitals };
}

// public pages
await measure(`${BASE}/`);
await measure(`${BASE}/sign-in`);

// login
await send('Page.navigate', { url: `${BASE}/sign-in` }, sid);
await waitForLoad(); await sleep(1500);
const loginResult = await evalJs(`(() => {
  const email = document.querySelector('input[type="email"], input[name="email"]');
  const pass = document.querySelector('input[type="password"]');
  if (!email || !pass) return 'NO_INPUTS';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  for (const [el, v] of [[email, '${EMAIL}'], [pass, '${PASSWORD}']]) {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled);
  const primary = btns.find(b => b.className.includes('w-full')) || btns.find(b => b.type === 'submit') || btns[btns.length - 1];
  primary?.click();
  return primary ? 'CLICKED: ' + primary.textContent.trim().slice(0, 40) : 'NO_BUTTON';
})()`);
console.log('\nlogin:', loginResult);
let landed = '';
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  landed = await evalJs('location.pathname');
  if (landed.includes('dashboard') || landed.includes('onboarding')) break;
}
console.log('landed on:', landed);
if (!landed.includes('dashboard')) {
  const errText = await evalJs(`document.body.innerText.slice(0, 500)`).catch(() => '');
  console.log('page text:', errText.replace(/\n+/g, ' | ').slice(0, 300));
}

if (landed.includes('dashboard')) {
  for (const p of ['/dashboard', '/dashboard/workflows', '/dashboard/inventory', '/dashboard/labor/attendance', '/dashboard/my-tasks']) {
    await measure(`${BASE}${p}`, 5000);
  }
} else {
  console.log('⚠ login failed, skipping authenticated pages');
}

ws.close();
chrome.kill();
console.log('\nDone.');
