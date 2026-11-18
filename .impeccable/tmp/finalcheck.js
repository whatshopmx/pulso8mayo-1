const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const out = {};

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 120000 });

  out.desktop = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const c2d = canvas.getContext('2d', { willReadFrequently: true });
    function px(color) { c2d.clearRect(0, 0, 1, 1); c2d.fillStyle = '#fff'; c2d.fillStyle = color; c2d.fillRect(0, 0, 1, 1); const d = c2d.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }
    function lum(rgb) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); }
    function bgOf(el) { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; n = n.parentElement; } return 'rgb(255,255,255)'; }
    // scan every text node's parent for contrast
    const nodes = [...document.querySelectorAll('p, span, li, a, h1, h2, h3, summary, button')].filter(el => (el.textContent || '').trim() && el.children.length === 0);
    let worst = { ratio: 99 };
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      const a = lum(px(cs.color)), b = lum(px(bgOf(el)));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const fs = parseFloat(cs.fontSize);
      const min = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < min && ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, text: el.textContent.trim().slice(0, 40), fs, bg: bgOf(el) };
    }
    const hashLinks = [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('#'));
    return {
      docHeight: document.documentElement.scrollHeight,
      words: (document.body.innerText || '').split(/\s+/).filter(Boolean).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      textNodesChecked: nodes.length,
      worstContrast: worst,
      below12px: [...document.querySelectorAll('main *, footer *')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 12 && (e.textContent || '').trim()).length,
      brokenAnchors: hashLinks.filter(h => !document.querySelector('[id="' + h.slice(1) + '"]')),
      h1Count: document.querySelectorAll('h1').length,
      headingLevels: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e => e.tagName).join(''),
      fontFamily: getComputedStyle(document.querySelector('h1')).fontFamily,
      fontsLoaded: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))],
      signupLabels: [...new Set([...document.querySelectorAll('a')].filter(a => a.getAttribute('href') === '/sign-up').map(a => a.textContent.trim()))],
      sections: document.querySelectorAll('main section').length,
    };
  });

  const trail = [];
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    trail.push(await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24), outline: cs.outlineStyle + ' ' + cs.outlineWidth };
    }));
  }
  out.keyboard = { stops: trail.length, allRings: trail.every(s => s.outline.includes('solid')), first: trail.slice(0, 4) };

  await page.screenshot({ path: '.impeccable/critique/shots/final-desktop-full.png', fullPage: true });
  await page.screenshot({ path: '.impeccable/critique/shots/final-desktop-hero.png' });
  await ctx.close();

  for (const [name, vp] of [['tablet', { width: 834, height: 1112 }], ['mobile', { width: 390, height: 844 }]]) {
    const c = await browser.newContext({ viewport: vp, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const p = await c.newPage();
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 120000 });
    out[name] = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      docHeight: document.documentElement.scrollHeight,
      offscreen: [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).length,
      h1: getComputedStyle(document.querySelector('h1')).fontSize,
    }));
    await p.screenshot({ path: '.impeccable/critique/shots/final-' + name + '-full.png', fullPage: true });
    await c.close();
  }

  out.errors = errs.slice(0, 8);
  await browser.close();
  fs.writeFileSync('.impeccable/tmp/final-out.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();