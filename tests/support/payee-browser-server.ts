import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { payeeFixture, payeeId, branchId, invoiceId } from "../fixtures/payee-finance";

/** UI y CSS reales con datos sintéticos. No usa sesión ni base de producción. */
export async function startPayeeBrowserServer() {
  const fromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(fromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const fromTailwind = createRequire(require.resolve("@tailwindcss/postcss"));
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8").replace('@import "tailwindcss";',
    '@import "tailwindcss" source(none);\n@source "../components/finance";\n@source "../components/ui";\n@source "./dashboard/finance/payees";');
  const styles = (await fromTailwind("postcss")([fromTailwind("@tailwindcss/postcss")()])
    .process(css, { from: path.join(root, "app/globals.css") })).css;
  const virtual: Record<string, string> = {
    "\0payee-style.css": styles,
    "\0payee-navigation": `export const useParams=()=>({id:'${payeeId}'});`,
    "\0payee-link": `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`,
    "\0payee-branch": `export const useBranch=()=>({selectedBranchId:'${branchId}'});`,
    "\0payee-entry.tsx": `import '/payee-style.css'; import React from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import Page from '@/app/dashboard/finance/payees/[id]/page'; import {BranchProvider} from '@/lib/branch-context';
      createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,{client:new QueryClient()},React.createElement('main',{className:'mx-auto max-w-6xl px-4'},React.createElement(BranchProvider,{initialBranchId:'${branchId}',initialBranches:[{id:'${branchId}',name:'Centro'}],userRole:'ADMIN'},React.createElement(Page)))));`,
  };
  let associated = false;
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, ".tmp", "payee-vite"),
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    resolve: { dedupe: ["react", "react-dom"], alias: [{ find: "@", replacement: root }] },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "@tanstack/react-query", "lucide-react", "radix-ui", "react/jsx-dev-runtime", "sonner",
      "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs", "@radix-ui/react-label", "@radix-ui/react-slot", "class-variance-authority", "clsx", "tailwind-merge"] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    plugins: [{ name: "payee-browser", enforce: "pre", resolveId(id: string) {
      if (Object.hasOwn(virtual, id)) return id;
      if (id === "next/navigation") return "\0payee-navigation";
      if (id === "next/link") return "\0payee-link";
      if (id === "@/lib/branch-context") return "\0payee-branch";
      if (id === "/payee-entry.tsx") return "\0payee-entry.tsx";
      if (id === "/payee-style.css") return "\0payee-style.css";
    }, load: (id: string) => virtual[id], configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
      dev.middlewares.use((req: { url: string; method: string; resume: () => void }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/api/")) {
          res.setHeader("Content-Type", "application/json");
          if (req.method === "POST") { associated = true; req.resume(); return res.end(JSON.stringify({ success: true, data: {} })); }
          const data = url.pathname.endsWith("/finance")
            ? url.searchParams.has("expenseId") ? { candidates: [{ id: invoiceId, uuid: "CFDI-DE-PRUEBA-123", folio: "123", date: "2026-11-01" }] } : payeeFixture(associated)
            : url.pathname === "/api/branches" ? [{ id: branchId, name: "Centro" }]
            : url.pathname === "/api/finance/payees" ? [payeeFixture().payee] : [];
          return res.end(JSON.stringify({ success: true, data }));
        }
        if (url.pathname !== "/") return next();
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Contraparte · escenario sintético</title></head><body><div id="root"></div><script type="module" src="/payee-entry.tsx"></script></body></html>');
      });
    } }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
