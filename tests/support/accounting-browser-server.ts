import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Real P&L components/CSS; only Next Link and HTTP/session boundaries are substituted. */
export async function startAccountingBrowserServer(mode:"pnl"|"journals"|"settings"="pnl",fixture?:(url:string,res:{setHeader:(key:string,value:string)=>void;end:(body:string)=>void})=>boolean) {
  const requireVite = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(requireVite.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const styles = execFileSync(process.execPath, ["-e", `
    const fs=require('node:fs'); const {createRequire}=require('node:module');
    const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
    postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})
      .then(result=>process.stdout.write(result.css)).catch(error=>{console.error(error);process.exitCode=1});
  `], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const virtual: Record<string, string> = {
    "\0accounting-link": `import React from 'react'; export default ({children,...props})=>React.createElement('a',props,children);`,
    "\0accounting-style.css": styles,
    "\0accounting-entry.tsx": `import '/accounting-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
      import {PnlBranchTable} from '@/components/finance/pnl-branch-table'; import {TooltipProvider} from '@/components/ui/tooltip';
      function App(){const [month,setMonth]=React.useState(9); const range=React.useMemo(()=>({from:new Date(2026,month,1),to:new Date(2026,month+1,0)}),[month]);
        return React.createElement(TooltipProvider,null,React.createElement('main',{className:'mx-auto max-w-7xl p-4'},
          React.createElement('h1',{className:'mb-4 text-xl font-semibold'},'Resultados · escenario sintético'),
          React.createElement('button',{onClick:()=>setMonth(10)},'Periodo noviembre (prueba)'),React.createElement(PnlBranchTable,{dateRange:range})));}
      createRoot(document.getElementById('root')).render(React.createElement(App));`,
  };
  if(mode==="journals") virtual["\0accounting-entry.tsx"]=`import '/accounting-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AccountingJournals} from '@/components/finance/accounting-journals';
    const branches=[{id:'20000000-0000-4000-8000-000000000001',name:'Centro'},{id:'20000000-0000-4000-8000-000000000002',name:'Norte'}];
    function App(){const [branch,setBranch]=React.useState(branches[0].id);return React.createElement(React.Fragment,null,
      React.createElement('div',{className:'border-b px-4 py-2 text-sm'},'Escenario sintético · ',
        React.createElement('button',{onClick:()=>setBranch(branches[1].id)},'Norte (prueba)')),
      React.createElement('main',null,React.createElement(AccountingJournals,{key:branch,branchId:branch,branches})));}
    createRoot(document.getElementById('root')).render(React.createElement(App));`;
  if(mode==="settings") virtual["\0accounting-entry.tsx"]=`import '/accounting-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AccountingSettings} from '@/components/finance/accounting-settings';
    createRoot(document.getElementById('root')).render(React.createElement('main',null,React.createElement(AccountingSettings)));`;
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, ".tmp", `accounting-vite-${process.pid}`),
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "radix-ui",
      "@radix-ui/react-tooltip", "@radix-ui/react-slot", "class-variance-authority", "clsx", "tailwind-merge", "date-fns"] },
    resolve: { alias: [{ find: /^next\/link$/, replacement: "\0accounting-link" }, { find: "@", replacement: root }] },
    plugins: [{ name: "accounting-browser", enforce: "pre",
      resolveId(id: string) {
        if (Object.hasOwn(virtual, id)) return id;
        if (id === "/accounting-entry.tsx") return "\0accounting-entry.tsx";
        if (id === "/accounting-style.css") return "\0accounting-style.css";
      },
      load: (id: string) => virtual[id],
      configureServer(vite: { middlewares: { use: (handler: unknown) => void } }) {
        vite.middlewares.use((req: { url: string }, res: { setHeader: (k: string, v: string) => void; end: (s: string) => void }, next: () => void) => {
          if(fixture?.(req.url,res))return;
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resultados sintéticos</title></head><body><div id="root"></div><script type="module" src="/accounting-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
