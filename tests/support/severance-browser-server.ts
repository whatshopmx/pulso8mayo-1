import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Sigue el harness Vite existente; solo sustituye límites de Next/DB/sesión. */
export async function startSeveranceBrowserServer() {
  const fromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(fromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  // La calculadora importa directamente el módulo salarial puro de producción;
  // no se sustituye por una extracción AST que oculte dependencias de servidor.
  // Reutiliza los estilos del build local cuando existen; la prueba no cambia tokens.
  // En un checkout sin build se compilan desde la misma hoja global del producto.
  const chunks = path.join(root, ".next/static/chunks");
  const builtCss = existsSync(chunks) ? readdirSync(chunks).filter((file) => file.endsWith(".css")) : [];
  const styles = builtCss.length ? builtCss.map((file) => readFileSync(path.join(chunks, file), "utf8")).join("\n") : execFileSync(process.execPath, ["-e", `
    const fs = require('node:fs');
    const { createRequire } = require('node:module');
    const plugin = require('@tailwindcss/postcss');
    const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
    postcss([plugin()]).process(fs.readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' })
      .then(result => process.stdout.write(result.css))
      .catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const fixtures: Record<string, string> = {
    "\0severance-session": `export const useSession = () => ({ session: { user: { id: 'actor-test', companyId: 'company-test', role: 'ADMIN' } } });`,
    "\0severance-link": `import React from 'react'; export default ({children, ...props}) => React.createElement('a', props, children);`,
    "\0severance-navigation": `export const useRouter = () => ({ push: () => {} });`,
    "\0severance-style.css": styles,
    "\0severance-entry": `
      import '/severance-style.css';
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Toaster } from 'sonner';
      import Page from '/app/dashboard/employees/offboarding/new/page.tsx';
      createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
        React.createElement(Page), React.createElement(Toaster)));
    `,
  };
  const server = await createServer({
    configFile: false, root, cacheDir: path.join(root, ".tmp", `severance-vite-${process.pid}`),
    css: { postcss: { plugins: [] } },
    optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
      "@radix-ui/react-label", "@radix-ui/react-select", "@radix-ui/react-slot", "@radix-ui/react-separator",
      "@radix-ui/react-checkbox", "@radix-ui/react-radio-group", "date-fns", "date-fns/locale", "lucide-react",
      "class-variance-authority", "clsx", "tailwind-merge", "sonner", "radix-ui"] },
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] } },
    resolve: { alias: [
      { find: /^@\/hooks\/use-session$/, replacement: "\0severance-session" },
      { find: /^next\/link$/, replacement: "\0severance-link" },
      { find: /^next\/navigation$/, replacement: "\0severance-navigation" },
      { find: "@", replacement: root },
    ] },
    plugins: [{
      name: "severance-fixtures", enforce: "pre",
      resolveId(id: string) {
        if (Object.hasOwn(fixtures, id)) return id;
        if (id === "/severance-entry.tsx") return "\0severance-entry";
        if (id === "/severance-style.css") return "\0severance-style.css";
      },
      load: (id: string) => fixtures[id],
      configureServer(devServer: { middlewares: { use: (handler: unknown) => void } }) {
        devServer.middlewares.use((req: { url: string }, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>Finiquito — prueba aislada</title></head><body><div id="root"></div><script type="module" src="/severance-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
