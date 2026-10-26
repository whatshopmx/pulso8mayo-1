import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Página real de lotes; sesión y HTTP se sustituyen por fixtures aisladas. */
export async function startFefoBrowserServer() {
    const fromVitest = createRequire(require.resolve('vitest/package.json'));
    const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href);
    const root = path.resolve(__dirname, '../..').replace(/\\/g, '/');
    const fromTailwind = createRequire(require.resolve('@tailwindcss/postcss'));
    const chunks = path.join(root, '.next/static/chunks');
    const css = existsSync(chunks) ? readdirSync(chunks).filter(file => file.endsWith('.css')) : [];
    const styles = css.length ? css.map(file => readFileSync(path.join(chunks, file), 'utf8')).join('\n')
        : (await fromTailwind('postcss')([fromTailwind('@tailwindcss/postcss')()])
            .process(readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
    const fixtures: Record<string, string> = {
        '\0fefo-session': `export const useSession=()=>({session:{user:{role:new URLSearchParams(location.search).get('role')||'GERENTE'}}});`,
        '\0fefo-link': `import React from 'react'; export default ({children,...props})=>React.createElement('a',props,children);`,
        '\0fefo-style.css': styles,
        '\0fefo-entry': `import '/fefo-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
          import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {Toaster} from 'sonner';
          import Page from '/app/dashboard/inventory/lotes/page.tsx';
          createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},
            React.createElement(React.Fragment,null,React.createElement(Page),React.createElement(Toaster))));`,
    };
    const server = await createServer({ configFile: false, root, cacheDir: path.join(root, '.tmp/fefo-browser-vite'),
        css: { postcss: { plugins: [] } }, esbuild: { jsx: 'automatic' },
        optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
            '@tanstack/react-query', 'sonner', 'lucide-react', 'radix-ui', '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-label', '@radix-ui/react-progress',
            '@radix-ui/react-select', '@radix-ui/react-slot', '@radix-ui/react-tabs', 'class-variance-authority', 'clsx', 'tailwind-merge'] },
        server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.next/**', '**/.tmp/**', '**/test-results/**'] } },
        resolve: { alias: [{ find: /^@\/hooks\/use-session$/, replacement: '\0fefo-session' },
            { find: /^next\/link$/, replacement: '\0fefo-link' }, { find: '@', replacement: root }] },
        plugins: [{ name: 'fefo-fixtures', enforce: 'pre',
            resolveId(id) { if (Object.hasOwn(fixtures, id)) return id;
                if (id === '/fefo-entry.js') return '\0fefo-entry'; if (id === '/fefo-style.css') return '\0fefo-style.css'; },
            load(id) { return fixtures[id]; },
            configureServer(dev) { dev.middlewares.use((req, res, next) => {
                if (new URL(req.url!, 'http://localhost').pathname !== '/') return next();
                res.setHeader('Content-Type', 'text/html');
                res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lotes — prueba aislada</title></head><body><div id="root"></div><script type="module" src="/fefo-entry.js"></script></body></html>');
            }); },
        }],
    });
    await server.listen();
    return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
