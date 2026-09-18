import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: 'tests/.auth/admin.json', viewport: { width: 1440, height: 900 }, locale: 'es-MX' });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}\t${m.text()}`));
await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
await page.waitForTimeout(2000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.addScriptTag({ url: 'http://localhost:8400/detect.js' });
await page.waitForTimeout(4000);
await browser.close();
console.log(logs.filter((l) => /impeccable/i.test(l)).join('\n'));
