const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 });
  await p.screenshot({ path: '.impeccable/critique/shots/after-typeset-hero.png' });
  await p.screenshot({ path: '.impeccable/critique/shots/after-typeset-full.png', fullPage: true });
  const p2 = await ctx.newPage();
  await p2.goto('http://localhost:3000/sign-in', { waitUntil: 'networkidle', timeout: 90000 });
  console.log('signin', await p2.evaluate(() => getComputedStyle(document.querySelector('h1, [class*=card] *') || document.body).fontFamily));
  await p2.screenshot({ path: '.impeccable/critique/shots/after-typeset-signin.png' });
  await b.close();
  console.log('ok');
})();
