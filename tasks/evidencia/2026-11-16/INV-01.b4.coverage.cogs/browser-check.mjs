import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const fromVitest = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href);
const { chromium } = require('@playwright/test');
const root = process.cwd().replaceAll('\\', '/');
const output = path.join(root, 'tasks/evidencia/2026-11-16/INV-01.b4.coverage.cogs');
mkdirSync(output, { recursive: true });
const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
const { css: styles } = await postcss([require('@tailwindcss/postcss')()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
const fixtures = {
  '\0cogs-entry': `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Toaster} from 'sonner';
    import {OperationalReportsClient} from '/app/dashboard/inventory/reports/operational/operational-reports-client.tsx';
    import '/cogs-style.css';
    createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
      React.createElement(OperationalReportsClient,{branchId:'synthetic'}),React.createElement(Toaster)));`,
  '\0cogs-style.css': styles,
};
const server = await createServer({ configFile: false, root, cacheDir: path.join(root, '.tmp/cogs-vite'),
  css: { postcss: { plugins: [] } }, esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': root } },
  optimizeDeps: { entries: [], include: ['react','react-dom/client','react/jsx-runtime','radix-ui','recharts','lucide-react','sonner'] },
  server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.next/**','**/.tmp/**','**/test-results/**'] } },
  plugins: [{ name: 'cogs-test-entry', enforce: 'pre',
    resolveId(id) { if (id === '/cogs-entry.tsx') return '\0cogs-entry'; if (id === '/cogs-style.css') return '\0cogs-style.css'; },
    load(id) { return fixtures[id]; },
    configureServer(s) { s.middlewares.use((req,res,next) => {
      if (req.url !== '/') return next();
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/cogs-entry.tsx"></script></body></html>');
    }); },
  }],
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.setDefaultTimeout(120000);
  page.on('pageerror', e=>{errors.push(e.message); console.error(e.message);});
  let report={ cogsCents:300, reportedRevenueCents:900, revenueCents:null, foodCostPercent:null,
    revenueCoverage:{status:'PARTIAL',totalEntries:2,completeEntries:1},byRecipe:[] };
  await page.route('**/api/inventory/reports/**', route => route.fulfill({json:{success:true, report:route.request().url().includes('/cogs?')? report : {rows:[],totalUsageCostCents:0}}}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('tab',{name:'COGS',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Ingresos incompletos'}).waitFor();
  assert.match(await page.getByRole('status').filter({hasText:'Ingresos incompletos'}).innerText(), /\$9.00/);
  assert.equal(await page.getByText('null%').count(),0);
  assert.equal(await page.getByText('0%',{exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'partial-desktop.png'),fullPage:true});
  await page.setViewportSize({width:320,height:900});
  await page.screenshot({path:path.join(output,'partial-mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  report={...report,reportedRevenueCents:0,revenueCoverage:{status:'NO_DATA',totalEntries:0,completeEntries:0}};
  await page.getByRole('button',{name:'Actualizar'}).click();
  await page.getByText('Sin ventas registradas en el periodo.').waitFor();
  report={...report,revenueCents:0,revenueCoverage:{status:'COMPLETE',totalEntries:1,completeEntries:1}};
  await page.getByRole('button',{name:'Actualizar'}).click();
  await page.getByText('$0.00',{exact:true}).waitFor();
  assert.equal(await page.getByText('0%',{exact:true}).count(),0);
  report={...report,revenueCents:900,reportedRevenueCents:900,cogsCents:300,foodCostPercent:33.33};
  await page.getByRole('button',{name:'Actualizar'}).click();
  await page.getByText('33.33%',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:4,scenarios:['partial','empty','explicit zero','complete positive'],pageErrors:errors,viewports:[1440,320]}));
} finally { await browser.close(); await server.close(); }
