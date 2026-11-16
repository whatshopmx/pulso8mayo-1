import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Actual leave UI/CSS, synthetic identity and intercepted HTTP; no auth or database. */
export async function startLeaveBrowserServer() {
  const fromVitest = createRequire(require.resolve('vitest/package.json'));
  const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href);
  const root = path.resolve(__dirname, '../..').replace(/\\/g, '/');
  const fromTailwind = createRequire(require.resolve('@tailwindcss/postcss'));
  // Scope Tailwind discovery to the UI under test instead of the whole research workspace.
  const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace('@import "tailwindcss";',
    '@import "tailwindcss" source(none);\n@source "../components/labor";\n@source "../components/ui";');
  const styles = (await fromTailwind('postcss')([fromTailwind('@tailwindcss/postcss')()])
    .process(css, { from: path.join(root, 'app/globals.css') })).css;
  const virtual: Record<string, string> = {
    '\0leave-style.css': styles,
    '\0leave-intl': `import messages from '@/messages/es.json'; export const useTranslations=(namespace)=>key=>[...namespace.split('.'),...key.split('.')].reduce((value,part)=>value?.[part],messages)||key;`,
    '\0leave-entry.tsx': `import '/leave-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
      import {LeaveDashboard} from '@/components/labor/leave-dashboard'; import {Toaster} from 'sonner';
      const role=new URLSearchParams(location.search).get('role')||'GERENTE';
      const h=React.createElement;
      createRoot(document.getElementById('root')).render(h(React.Fragment,null,
        h('main',{className:'mx-auto max-w-6xl px-4'},h(LeaveDashboard,{companyId:'synthetic-company',userId:'synthetic-user',userRole:role})),h(Toaster)));`,
  };
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, '.tmp', 'leave-vite'),
    esbuild: { jsx: 'automatic' }, css: { postcss: { plugins: [] } },
    resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
    optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'sonner', 'date-fns', 'date-fns/locale', 'lucide-react', 'radix-ui', 'react-hook-form', '@hookform/resolvers/zod', 'zod', 'react-day-picker', '@radix-ui/react-label', '@radix-ui/react-slot', '@radix-ui/react-dialog', '@radix-ui/react-tabs', '@radix-ui/react-select', '@radix-ui/react-popover', '@radix-ui/react-progress', 'class-variance-authority', 'clsx', 'tailwind-merge'] },
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.next/**', '**/.tmp/**', '**/test-results/**'] } },
    plugins: [{ name: 'leave-browser', enforce: 'pre',
      resolveId(id: string) {
        if (Object.hasOwn(virtual, id)) return id;
        if (id === 'next-intl') return '\0leave-intl';
        if (id === '/leave-entry.tsx') return '\0leave-entry.tsx';
        if (id === '/leave-style.css') return '\0leave-style.css';
      },
      load: (id: string) => virtual[id],
      configureServer(dev: { middlewares: { use: (handler: unknown) => void } }) {
        dev.middlewares.use((req: { url: string }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (new URL(req.url, 'http://localhost').pathname !== '/') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Permisos · escenario sintético</title></head><body><div id="root"></div><script type="module" src="/leave-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
