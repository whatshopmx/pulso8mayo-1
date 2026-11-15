import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Real UI components with synthetic session/navigation; no production auth or DB. */
export async function startUiRolloutBrowserServer() {
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
    "\0rollout-style.css": styles,
    "\0rollout-navigation": `export const usePathname=()=>new URLSearchParams(location.search).get('path')||'/dashboard/inventory/purchase-orders'; export const useSearchParams=()=>new URLSearchParams(location.search); export const useRouter=()=>({push:(url)=>location.assign(url)});`,
    "\0rollout-link": `import React from 'react'; export default React.forwardRef(({href,children,...props},ref)=>React.createElement('a',{...props,href,ref},children));`,
    "\0rollout-intl": `export const useTranslations=()=>key=>({platform:'Plataforma'}[key]||key);`,
    "\0rollout-auth": `export const authClient={useSession:()=>({data:{user:{id:'synthetic-user',companyId:'synthetic-company'}}})};`,
    "\0rollout-entry.tsx": `import '/rollout-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {NavMain} from '@/components/nav-main'; import {SidebarProvider} from '@/components/ui/sidebar';
      import {ScheduledTab} from '@/components/dashboard/operations/scheduled-tab';
      import {TemperatureMonitor} from '@/components/dashboard/operations/temperature-monitor';
      import NotificationsPage from '@/app/dashboard/notifications/page';
      const surface=new URLSearchParams(location.search).get('surface');
      const items=[{title:'Inventario',url:'/dashboard/inventory',collapseGroups:true,items:[{title:'Panel',url:'/dashboard/inventory'},{groupLabel:'Operar'},{title:'Conteo',url:'/dashboard/inventory/stock-count'},{groupLabel:'Comprar'},{title:'Órdenes',url:'/dashboard/inventory/purchase-orders'},{title:'Proveedores',url:'/dashboard/inventory/suppliers'},{groupLabel:'Analizar'},{title:'Reportes',url:'/dashboard/inventory/reports'}]}];
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      const h=React.createElement;
      const content=surface==='nav'?h(SidebarProvider,null,h('div',{className:'w-72'},h(NavMain,{items}))):surface==='scheduled'?h(ScheduledTab,{branchId:'synthetic-branch'}):surface==='temperature'?h(TemperatureMonitor,{branchId:'synthetic-branch',period:'7d'}):h(NotificationsPage);
      createRoot(document.getElementById('root')).render(h(QueryClientProvider,{client},h('main',{className:'mx-auto max-w-5xl p-4'},h('h1',{className:'mb-6 text-xl font-semibold'},'Escenario sintético de mejoras'),content)));`,
  };
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, ".tmp", "ui-rollout-vite"),
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    resolve: { dedupe: ["react", "react-dom"], alias: [{ find: "@", replacement: root }] },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "radix-ui", "@tanstack/react-query", "class-variance-authority", "clsx", "tailwind-merge", "@radix-ui/react-collapsible", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-label", "@radix-ui/react-popover", "@radix-ui/react-separator", "@radix-ui/react-slot", "@radix-ui/react-tooltip", "date-fns", "date-fns/locale", "recharts", "sonner"] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    plugins: [{ name: "ui-rollout-browser", enforce: "pre",
      resolveId(id: string) {
        if (Object.hasOwn(virtual, id)) return id;
        if (id === "/rollout-entry.tsx") return "\0rollout-entry.tsx";
        if (id === "/rollout-style.css") return "\0rollout-style.css";
        if (id === "next/navigation") return "\0rollout-navigation";
        if (id === "next/link") return "\0rollout-link";
        if (id === "next-intl") return "\0rollout-intl";
        if (id.endsWith("/lib/auth-client")) return "\0rollout-auth";
      },
      load: (id: string) => virtual[id],
      configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
        dev.middlewares.use((req: { url: string }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (new URL(req.url, "http://localhost").pathname !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Revisión sintética Pulso</title></head><body><div id="root"></div><script type="module" src="/rollout-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
