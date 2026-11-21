import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Componente y CSS reales; servidor local sin sesión, base de datos ni escrituras operativas. */
export async function startSalesEntryBrowserServer(fixtureResponse?: Record<string, unknown>, view: 'bulk' | 'manual' | 'pos' = 'bulk') {
  const fromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(fromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const chunks = path.join(root, ".next/static/chunks");
  const css = existsSync(chunks) ? readdirSync(chunks).filter(file => file.endsWith(".css")) : [];
  const fromTailwind = createRequire(require.resolve("@tailwindcss/postcss"));
  const styles = css.length ? css.map(file => readFileSync(path.join(chunks, file), "utf8")).join("\n")
    : (await fromTailwind("postcss")([fromTailwind("@tailwindcss/postcss")()])
      .process(readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const virtual: Record<string, string> = {
    '\0manual-link.tsx': `import React from 'react'; export default function Link({href, children, ...props}) {return React.createElement('a',{href,...props},children)}`,
    "\0sales-style.css": styles,
    "\0sales-entry.tsx": `import '/sales-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
      import {SalesEntryClient} from '@/app/dashboard/inventory/sales-entry/sales-entry-client';
      createRoot(document.getElementById('root')).render(React.createElement('main',{className:'mx-auto max-w-5xl p-4'},
        React.createElement('h1',{className:'mb-6 text-2xl font-semibold'},'Importación de ventas · escenario sintético'),
        React.createElement(SalesEntryClient,{branches:[{id:'b1000000-0000-4000-8000-000000000001',name:'Centro'},{id:'b2000000-0000-4000-8000-000000000002',name:'Norte'}],scopedBranchId:null})));`,
  };
  if (view === 'manual') virtual['\0sales-entry.tsx'] = `import '/sales-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
    import Page from '@/app/dashboard/inventory/reports/page'; import {BranchProvider,useBranch} from '@/lib/branch-context';
    function Scope(){const {setSelectedBranchId}=useBranch(); return React.createElement('nav',{'aria-label':'Alcance sintético'},React.createElement('button',{onClick:()=>setSelectedBranchId('b2000000-0000-4000-8000-000000000002')},'Seleccionar Norte'),React.createElement('button',{onClick:()=>setSelectedBranchId(null)},'Todas las sucursales'))}
    createRoot(document.getElementById('root')).render(React.createElement(BranchProvider,{userRole:'ADMIN',initialBranchId:'b1000000-0000-4000-8000-000000000001',initialBranches:[{id:'b1000000-0000-4000-8000-000000000001',name:'Centro'},{id:'b2000000-0000-4000-8000-000000000002',name:'Norte'}]},React.createElement(Scope),React.createElement(Page)));`;
  if (view === 'pos') virtual['\0sales-entry.tsx'] = `import '/sales-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
    import {WorkflowStepper} from '@/components/execution/workflow-stepper';
    import {WorkflowExecutor} from '@/components/workflow/workflow-executor';
    const query=new URLSearchParams(location.search), legacy=query.has('legacy');
    const steps=[{id:'pos',title:'Subir archivo del POS',description:'Escenario sintético de cierre',type:legacy?'smart_link':'TEXT',required:true,
        ...(legacy?{smartLinkTarget:'/api/workflows/smart-links/upload-pos'}:{config:{posUpload:true}})},
        {id:'review',title:'Revisión final',type:'INFO',required:false}];
    createRoot(document.getElementById('root')).render(query.has('executor') ? React.createElement(WorkflowExecutor,{execution:{
      id:'e1000000-0000-4000-8000-000000000001',branchId:query.has('noBranch')?undefined:'b1000000-0000-4000-8000-000000000001',
      status:'IN_PROGRESS',steps:query.has('saved')?[{stepId:'pos',status:'IN_PROGRESS',evidenceUrl:'saved-pos-key',value:{businessDate:'2026-11-19',fileName:'previo.csv'}}]:[],
      template:{name:'Cierre sintético',steps}}}) : React.createElement(WorkflowStepper,{
      instance:{id:'e1000000-0000-4000-8000-000000000001',branchId:query.has('noBranch')?undefined:'b1000000-0000-4000-8000-000000000001',status:'IN_PROGRESS'},
      executionId:'e1000000-0000-4000-8000-000000000001',mode:query.has('preview')?'preview':'execution',existingSteps:[],
      steps}));`;
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, ".tmp", `sales-entry-vite-${process.pid}-${view}`),
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    resolve: { dedupe: ["react", "react-dom"], alias: [{ find: "@", replacement: root }] },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "radix-ui", "@radix-ui/react-dialog", "@radix-ui/react-label", "@radix-ui/react-slot", "class-variance-authority", "clsx", "tailwind-merge", "zod", ...(view === 'manual' ? ['@radix-ui/react-select', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', 'date-fns', 'recharts', 'sonner', 'next/navigation'] : []), ...(view === 'pos' ? ['@stepperize/react','@shivantra/react-web-camera','sonner','@radix-ui/react-select','@radix-ui/react-progress','@radix-ui/react-checkbox','@radix-ui/react-radio-group','@radix-ui/react-separator'] : [])] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    plugins: [{ name: "sales-entry-browser", enforce: "pre",
      resolveId(id: string) { if (Object.hasOwn(virtual, id)) return id;
        if (view === 'manual' && id === 'next/link') return '\0manual-link.tsx';
        if (id === "/sales-entry.tsx") return "\0sales-entry.tsx";
        if (id === "/sales-style.css") return "\0sales-style.css"; },
      load: (id: string) => virtual[id],
      configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
        dev.middlewares.use((req: { url: string }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (req.url === "/api/inventory/sales-entry/bulk" && fixtureResponse) {
            res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fixtureResponse)); return;
          }
          if (req.url.split('?')[0] !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Importación sintética</title></head><body><div id="root"></div><script type="module" src="/sales-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
