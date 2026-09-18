import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: 'tests/.auth/admin.json', viewport: { width: 1440, height: 900 }, locale: 'es-MX' });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
await page.waitForTimeout(2000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.addScriptTag({ url: 'http://localhost:8400/detect.js' });
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const globals = Object.keys(window).filter((k) => /imp|detect/i.test(k));
  const nodes = Array.from(document.querySelectorAll('[id*="imp" i],[class*="imp" i],[data-impeccable]'));
  return {
    globals,
    globalDump: globals.slice(0, 6).map((g) => {
      try { return { g, v: JSON.stringify(window[g]).slice(0, 3000) }; } catch { return { g, v: 'unserializable' }; }
    }),
    nodeCount: nodes.length,
    nodes: nodes.map((n) => ({ tag: n.tagName, id: n.id, cls: (n.className || '').toString().slice(0, 90), text: (n.innerText || '').slice(0, 4000) })),
  };
});
await browser.close();
console.log(JSON.stringify(out, null, 2));
