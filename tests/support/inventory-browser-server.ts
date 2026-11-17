import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Documentos sintéticos con destinos mezclados del mismo emisor. */
export const inventoryDocuments = [
  { id: "compra", uuid: "UUID-COMPRA", folio: "123", serie: "F", fecha: "2026-11-01", total: 116000,
    subtotal: 100000, currency: "MXN", matchStatus: "MATCHED", destination: "INVENTORY_PURCHASE",
    supplierId: "proveedor-1", supplierName: "Harina del Centro", poNumber: "OC-1", receivingReportId: "recepcion-1" },
  { id: "por-clasificar", uuid: "UUID-POR-CLASIFICAR", folio: "124", serie: "F", fecha: "2026-11-02", total: 58000,
    subtotal: 50000, currency: "MXN", matchStatus: "PENDING", destination: "UNCLASSIFIED",
    supplierId: "proveedor-1", supplierName: "Harina del Centro", poNumber: null, receivingReportId: null },
  { id: "servicio", uuid: "UUID-SERVICIO", folio: "125", serie: "F", fecha: "2026-11-03", total: 23200,
    subtotal: 20000, currency: "MXN", matchStatus: "PENDING", destination: "OPERATING_EXPENSE",
    supplierId: "proveedor-1", supplierName: "Harina del Centro", poNumber: null, receivingReportId: null },
];

/**
 * UI y CSS reales de Inventario con datos sintéticos. No usa sesión ni base
 * operativa: la API se simula en el navegador.
 */
export async function startInventoryBrowserServer() {
  const fromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(fromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const fromTailwind = createRequire(require.resolve("@tailwindcss/postcss"));
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8").replace('@import "tailwindcss";',
    '@import "tailwindcss" source(none);\n@source "../components/ui";\n@source "../components/shared";\n@source "./dashboard/inventory/invoices";');
  const styles = (await fromTailwind("postcss")([fromTailwind("@tailwindcss/postcss")()])
    .process(css, { from: path.join(root, "app/globals.css") })).css;
  const virtual: Record<string, string> = {
    "\0inventory-style.css": styles,
    "\0inventory-navigation": `export const useParams=()=>({});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useRouter=()=>({push(){},replace(){},refresh(){}});`,
    "\0inventory-link": `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`,
    "\0inventory-branch": `export const useBranch=()=>({selectedBranchId:null,setSelectedBranchId(){}});`,
    "\0inventory-entry.tsx": `import '/inventory-style.css'; import React from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import Page from '@/app/dashboard/inventory/invoices/page';
      createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,{client:new QueryClient()},React.createElement('main',{className:'mx-auto max-w-6xl px-4'},React.createElement(Page))));`,
  };
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, ".tmp", "inventory-vite"),
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    resolve: { dedupe: ["react", "react-dom"], alias: [
      { find: /^@\/hooks\/use-session$/, replacement: "\0inventory-session" },
      { find: "@", replacement: root },
    ] },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "@tanstack/react-query", "lucide-react",
      "radix-ui", "react/jsx-dev-runtime", "sonner", "date-fns", "@radix-ui/react-dialog", "@radix-ui/react-select",
      "@radix-ui/react-tabs", "@radix-ui/react-label", "@radix-ui/react-slot", "@radix-ui/react-tooltip",
      "class-variance-authority", "clsx", "tailwind-merge"] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    plugins: [{ name: "inventory-browser", enforce: "pre", resolveId(id: string) {
      if (Object.hasOwn(virtual, id)) return id;
      if (id === "next/navigation") return "\0inventory-navigation";
      if (id === "next/link") return "\0inventory-link";
      if (id === "@/lib/branch-context") return "\0inventory-branch";
      if (id === "/inventory-entry.tsx") return "\0inventory-entry.tsx";
      if (id === "/inventory-style.css") return "\0inventory-style.css";
    }, load: (id: string) => virtual[id], configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
      dev.middlewares.use((req: { url: string; method: string; resume: () => void }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/api/")) {
          res.setHeader("Content-Type", "application/json");
          if (url.pathname === "/api/inventory/invoices") {
            const requested = url.searchParams.get("destination");
            const invoices = inventoryDocuments.filter(document => !requested
              ? document.destination !== "OPERATING_EXPENSE"
              : requested === "ALL" || document.destination === requested);
            return res.end(JSON.stringify({ success: true, invoices }));
          }
          if (url.pathname === "/api/inventory/products") return res.end(JSON.stringify([]));
          if (url.pathname === "/api/inventory/credit-notes") return res.end(JSON.stringify({ success: true, data: [] }));
          return res.end(JSON.stringify({ success: true, data: [] }));
        }
        if (url.pathname !== "/" && url.pathname !== "/inventory-invoices") return next();
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Inventario · escenario sintético</title></head><body><div id="root"></div><script type="module" src="/inventory-entry.tsx"></script></body></html>');
      });
    } }],  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
