const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 150)));
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 });

  const geo = await p.evaluate(() => {
    const s = document.querySelector('#workflows');
    const items = [...s.querySelectorAll('ol > li')];
    const dots = items.map(li => {
      const dot = [...li.children].find(el => el.tagName === 'SPAN' && el.getAttribute('style'));
      const r = dot.getBoundingClientRect();
      return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    });
    const line = [...items[0].children].find(el => el.className.includes('h-px'));
    const lr = line ? line.getBoundingClientRect() : null;
    return {
      dots,
      line: lr ? { x: Math.round(lr.x), right: Math.round(lr.right), y: Math.round(lr.y) } : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(JSON.stringify(geo), 'errors', errs);

  const top = await p.evaluate(() => document.querySelector('#workflows').getBoundingClientRect().top + window.scrollY);
  await p.evaluate(y => window.scrollTo(0, y - 30), top);
  await p.waitForTimeout(400);
  await p.screenshot({ path: '.impeccable/critique/shots/after-bolder-workflows.png' });

  const mc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mc.newPage();
  await mp.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 90000 });
  const mt = await mp.evaluate(() => document.querySelector('#workflows').getBoundingClientRect().top + window.scrollY);
  await mp.evaluate(y => window.scrollTo(0, y - 20), mt);
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: '.impeccable/critique/shots/after-bolder-workflows-mobile.png' });
  console.log('mobile overflow', await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await b.close();
})();
