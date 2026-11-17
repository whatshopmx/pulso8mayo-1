import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Detalle real y CSS compilado; los specs declaran sus respuestas HTTP. */
export async function startPosFileBrowserServer() {
  const loader = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(loader.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const cssPath = path.join(root, ".next/static");
  const styles = readdirSync(cssPath, { recursive: true }).filter(file => String(file).endsWith(".css"))
    .map(file => readFileSync(path.join(cssPath, String(file)), "utf8")).join("\n");
  const virtual: Record<string, string> = {
    "\0pos.css": styles,
    "\0pos.tsx": `import '/pos.css'; import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {SalesCutDetailSheet} from '@/components/sales/sales-cut-detail-sheet';
      const cut = {id:'d1000000-0000-4000-8000-000000000001', branchId:'b1000000-0000-4000-8000-000000000001',
        branchName:'Centro', businessDate:'2026-11-17', shift:'COMPLETO', channel:'TOTAL',totalSales:10000,
        cashSales:null,cardSales:null,otherPayments:null,cashCountedCents:null,depositedCents:null,
        aggregatorSales:null,commissionCents:null,tpvDepositCents:null,ticketCount:null,avgTicket:null,
        source:'UPLOAD',rawFileUrl:'private-key-never-a-link',status:'VALIDATED',validationNotes:null,
        receivedByName:null,receivedAt:'2026-11-17T12:00:00Z',createdAt:'2026-11-17T12:00:00Z'};
      function App(){ const [open,setOpen]=useState(false), [current,setCurrent]=useState(cut);
        return React.createElement('main',null,React.createElement('h1',null,'Cortes de ventas · escenario sintético'),
          React.createElement('button',{onClick:()=>{setCurrent(cut);setOpen(true)}},'Ver corte'),
          React.createElement('button',{onClick:()=>{setCurrent({...cut,id:'d2000000-0000-4000-8000-000000000002'});setOpen(true)}},'Ver otro corte'),
          React.createElement('button',{onClick:()=>{setCurrent({...cut,rawFileUrl:null});setOpen(true)}},'Ver corte sin archivo'),
          React.createElement(SalesCutDetailSheet,{cut:current,open,onOpenChange:setOpen,onOpenBatches:()=>{}})); }
      createRoot(document.getElementById('root')).render(React.createElement(App));`,
  };
  const server = await createServer({ configFile: false, root,
    cacheDir: path.join(root, ".tmp", "pos-file-vite"),
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    resolve: { dedupe: ["react", "react-dom"], alias: [{ find: "@", replacement: root }] },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "radix-ui", "@radix-ui/react-dialog", "@radix-ui/react-separator", "@radix-ui/react-slot", "class-variance-authority", "clsx", "tailwind-merge"] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    plugins: [{ name: "pos-file-browser", enforce: "pre",
      resolveId(id: string) { const key = id === "/pos.css" ? "\0pos.css" : id === "/pos.tsx" ? "\0pos.tsx" : id;
        if (Object.hasOwn(virtual, key)) return key; },
      load: (id: string) => virtual[id],
      configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
        dev.middlewares.use((req: { url: string }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Archivo POS</title></head><body><div id="root"></div><script type="module" src="/pos.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
