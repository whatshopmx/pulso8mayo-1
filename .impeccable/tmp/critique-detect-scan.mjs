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

const out = await page.evaluate(async () => {
  let findings;
  try { findings = await window.impeccableScanAsync(); } catch (e) { try { findings = window.impeccableScan(); } catch (e2) { return { err: String(e) + ' | ' + String(e2) }; } }
  const arr = Array.isArray(findings) ? findings : (findings && (findings.findings || findings.results)) || [];
  const overlay = Array.from(document.querySelectorAll('.impeccable-label')).map((n) => n.innerText.trim());
  const counts = {};
  for (const l of overlay) counts[l] = (counts[l] || 0) + 1;
  return {
    total: arr.length,
    counts,
    sample: arr.slice(0, 60).map((f) => ({
      id: f.id || f.antipattern || f.rule,
      severity: f.severity,
      category: f.category,
      msg: (f.message || f.description || '').slice(0, 120),
      sel: f.selector || f.path,
      snip: (f.snippet || f.value || f.evidence || '').toString().slice(0, 100),
    })),
  };
});
await browser.close();
console.log(JSON.stringify(out, null, 2));
