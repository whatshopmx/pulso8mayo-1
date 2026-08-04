// CLS attribution + cold-cache measurement via raw CDP.
import { spawn } from 'node:child_process';
import http from 'node:http';

const BASE = process.argv[2] || 'http://localhost:3000';
const EMAIL = 'carlos@pulso.mx';
const PASSWORD = '123456';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', `--user-data-dir=${process.env.TEMP}\\perf-cls-profile-${Date.now()}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

const getJson = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
    let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

let version;
for (let i = 0; i < 40; i++) {
  try { version = await getJson('/json/version'); break; } catch { await new Promise(r => setTimeout(r, 500)); }
}
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
await send('Network.enable', {}, sid);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
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

// login first (warm auth, still cold assets later after cache clear)
await send('Page.navigate', { url: `${BASE}/sign-in` }, sid);
await waitForLoad(); await sleep(1500);
await evalJs(`(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const email = document.querySelector('input[type="email"], input[name="email"]');
  const pass = document.querySelector('input[type="password"]');
  for (const [el, v] of [[email, '${EMAIL}'], [pass, '${PASSWORD}']]) {
    setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  [...document.querySelectorAll('button')].find(b => b.className.includes('w-full'))?.click();
  return true;
})()`);
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  if ((await evalJs('location.pathname')).includes('dashboard')) break;
}
console.log('logged in');

// instrument CLS with node attribution
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        const srcs = (e.sources || []).map(s => {
          const n = s.node;
          if (!n) return null;
          const r = n.getBoundingClientRect ? n.getBoundingClientRect() : {};
          return { el: n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0,3).join('.') : ''), y: Math.round(r.y||0), h: Math.round(r.height||0) };
        }).filter(Boolean);
        window.__shifts.push({ value: +e.value.toFixed(4), t: Math.round(e.startTime), srcs });
      }
    }).observe({ type: 'layout-shift', buffered: true });`,
}, sid);

// COLD load of /dashboard: clear cache then navigate
await send('Network.clearBrowserCache', {}, sid);
await send('Page.navigate', { url: `${BASE}/dashboard` }, sid);
await waitForLoad();
await sleep(5000);

const cold = await evalJs(`(() => {
  const res = performance.getEntriesByType('resource');
  let js = 0, css = 0, img = 0, font = 0, other = 0, total = 0;
  for (const r of res) {
    const s = r.transferSize || 0; total += s;
    if (r.initiatorType === 'script') js += s;
    else if (r.initiatorType === 'link' || r.initiatorType === 'css') css += s;
    else if (r.initiatorType === 'img') img += s;
    else if (/font/.test(r.name)) font += s;
    else other += s;
  }
  const [n] = performance.getEntriesByType('navigation');
  return { ttfb: Math.round(n.responseStart), totalKB: Math.round(total/1024), jsKB: Math.round(js/1024), cssKB: Math.round(css/1024), imgKB: Math.round(img/1024), otherKB: Math.round(other/1024), requests: res.length };
})()`);
console.log('\n== COLD /dashboard ==');
console.log(`  TTFB ${cold.ttfb}ms | ${cold.requests} requests | total ${cold.totalKB}KB transferred`);
console.log(`  JS ${cold.jsKB}KB | CSS ${cold.cssKB}KB | img ${cold.imgKB}KB | other ${cold.otherKB}KB`);

const shifts = await evalJs('window.__shifts');
console.log('\n== Layout shifts on /dashboard ==');
for (const s of shifts.sort((a, b) => b.value - a.value).slice(0, 8)) {
  console.log(`  shift ${s.value} @${s.t}ms`, JSON.stringify(s.srcs.slice(0, 3)));
}
const totalCls = shifts.reduce((a, s) => a + s.value, 0);
console.log(`  TOTAL CLS: ${totalCls.toFixed(3)}`);

ws.close();
chrome.kill();
console.log('\nDone.');
