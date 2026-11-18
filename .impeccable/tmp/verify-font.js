const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 });
  const r = await p.evaluate(() => {
    const h1 = document.querySelector('h1');
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    const r1 = h1.getBoundingClientRect();
    return {
      html: getComputedStyle(document.documentElement).fontFamily,
      h1: getComputedStyle(h1).fontFamily,
      fonts: [...document.fonts].map(f => f.family + ':' + f.status),
      h1Lines: Math.round(r1.height / lh),
      h1Height: Math.round(r1.height),
      h1Width: Math.round(r1.width),
      docHeight: document.documentElement.scrollHeight,
      leadWidth: Math.round(document.querySelector('.l-lead').getBoundingClientRect().width),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
