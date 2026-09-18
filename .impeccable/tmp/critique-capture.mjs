import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';
const STATE = 'tests/.auth/admin.json';
const OUT = '.impeccable/tmp';

const browser = await chromium.launch();

async function run(label, viewport) {
  const ctx = await browser.newContext({
    storageState: STATE,
    viewport,
    deviceScaleFactor: 1,
    locale: 'es-MX',
  });
  const page = await ctx.newPage();
  const logs = [];
  const errors = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(String(e)));

  const resp = await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(2500);

  const url = page.url();
  const title = await page.title();

  // --- preflight mutation check ---
  let mutation = false;
  try {
    const probe = await page.evaluate(() => {
      document.title = 'impeccable-probe';
      const s = document.createElement('script');
      s.textContent = 'window.__imp_probe = 1;';
      document.head.appendChild(s);
      return { title: document.title, probe: !!window.__imp_probe, node: s.tagName };
    });
    mutation = probe.title === 'impeccable-probe' && probe.probe === true;
  } catch (e) {
    mutation = false;
  }

  // --- metrics ---
  const metrics = await page.evaluate(() => {
    const q = (s) => Array.from(document.querySelectorAll(s));
    const out = {};
    out.docHeight = document.documentElement.scrollHeight;
    out.docWidth = document.documentElement.scrollWidth;
    out.viewportH = window.innerHeight;
    out.horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    out.scrollWidth = document.documentElement.scrollWidth;
    out.innerWidth = window.innerWidth;

    // h1/h2/h3 outline
    out.headings = q('h1,h2,h3,h4').map((h) => ({
      tag: h.tagName,
      text: (h.textContent || '').trim().slice(0, 90),
      size: getComputedStyle(h).fontSize,
      weight: getComputedStyle(h).fontWeight,
    }));

    // buttons / links without accessible name
    const nameless = [];
    for (const el of q('button, a[href], [role="button"]')) {
      const t = (el.innerText || '').trim();
      const al = el.getAttribute('aria-label');
      const tl = el.getAttribute('title');
      if (!t && !al && !tl) {
        const icon = el.querySelector('svg');
        nameless.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70), icon: !!icon });
      }
    }
    out.namelessControls = nameless;

    // focusable count
    out.focusable = q('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length;

    // sub-12px text nodes with actual visible text
    const tiny = [];
    for (const el of q('body *')) {
      if (!el.children.length && (el.textContent || '').trim()) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) tiny.push({ text: (el.textContent || '').trim().slice(0, 50), fs });
      }
    }
    out.tinyText = tiny.slice(0, 25);
    out.tinyTextCount = tiny.length;

    // contrast: approximate sample of text colors on backgrounds
    function lum(rgb) {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function parse(c) {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    }
    function bgOf(el) {
      let n = el;
      while (n && n !== document.documentElement) {
        const b = parse(getComputedStyle(n).backgroundColor);
        if (b && b.a > 0.5) return b.rgb;
        n = n.parentElement;
      }
      return [255, 255, 255];
    }
    const lowContrast = [];
    const textEls = q('p, span, a, li, td, th, label, h1,h2,h3,h4,h5, div').filter(
      (el) => !el.children.length && (el.textContent || '').trim().length > 2
    );
    for (const el of textEls) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const L1 = lum(fg.rgb), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const fs = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight) >= 700;
      const large = fs >= 24 || (fs >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        lowContrast.push({
          text: (el.textContent || '').trim().slice(0, 45),
          color: cs.color,
          bg: `rgb(${bg.join(',')})`,
          fs,
          ratio: Math.round(ratio * 100) / 100,
          need,
        });
      }
    }
    // dedupe by text+color
    const seen = new Set();
    out.lowContrast = lowContrast.filter((f) => {
      const k = f.text + f.color + f.ratio;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 30);
    out.lowContrastCount = lowContrast.length;

    // shadows on containers
    const shadowed = [];
    for (const el of q('div, section, article, aside, header, li')) {
      const cs = getComputedStyle(el);
      if (cs.boxShadow && cs.boxShadow !== 'none') {
        shadowed.push({ cls: (el.className || '').toString().slice(0, 80), shadow: cs.boxShadow.slice(0, 60) });
      }
    }
    out.shadowedCount = shadowed.length;
    out.shadowed = shadowed.slice(0, 15);

    // animations running
    out.animations = q('body *')
      .filter((el) => getComputedStyle(el).animationName !== 'none')
      .map((el) => ({ cls: (el.className || '').toString().slice(0, 70), name: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration }))
      .slice(0, 20);

    // interactive rollup
    out.linkCount = q('a[href]').length;
    out.buttonCount = q('button').length;
    out.inputCount = q('input, select, textarea').length;

    return out;
  });

  if (mutation) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addScriptTag({ url: 'http://localhost:8400/detect.js' });
    await page.waitForTimeout(3000);
  }

  const impLogs = logs.filter((l) => /impeccable/i.test(l));

  await page.screenshot({ path: `${OUT}/dash-${label}-top.png` });
  try {
    await page.screenshot({ path: `${OUT}/dash-${label}-full.png`, fullPage: true });
  } catch (e) {
    errors.push('fullpage screenshot failed: ' + e.message);
  }

  await ctx.close();
  return { label, viewport, httpStatus: resp && resp.status(), url, title, mutation, metrics, impLogs, consoleErrors: errors, consoleCount: logs.length, consoleWarn: logs.filter(l => l.startsWith('[warning]')).slice(0, 10), consoleErr: logs.filter(l => l.startsWith('[error]')).slice(0, 10) };
}

const desktop = await run('desktop', { width: 1440, height: 900 });
const mobile = await run('mobile', { width: 390, height: 844 });
const wide = await run('wide', { width: 1920, height: 1080 });

await browser.close();
console.log(JSON.stringify({ desktop, mobile, wide }, null, 2));