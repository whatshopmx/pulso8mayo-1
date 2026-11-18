const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 120000 });
  const res = [];
  for (const id of ['problema', 'producto', 'operaciones', 'finanzas', 'workflows', 'compras', 'inteligencia', 'whatsapp', 'industrias', 'implementacion', 'precios', 'faq']) {
    await p.evaluate(i => { window.location.hash = ''; window.location.hash = i; }, id);
    await p.waitForTimeout(250);
    const r = await p.evaluate(i => {
      const sec = document.getElementById(i);
      const head = document.querySelector('header').getBoundingClientRect();
      const first = sec.querySelector('h1, h2, .l-display, .l-h2').getBoundingClientRect();
      return { id: i, headerBottom: Math.round(head.bottom), headingTop: Math.round(first.top), clear: first.top >= head.bottom };
    }, id);
    res.push(r);
  }
  console.log(JSON.stringify(res, null, 1));
  await p.evaluate(() => { window.location.hash = 'precios'; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: '.impeccable/critique/shots/final-anchor-precios.png' });
  await b.close();
})();