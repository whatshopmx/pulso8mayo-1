import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Pantallas reales; solo sustituye límites Next, contexto de sucursal y pestañas ajenas a IMSS. */
export async function startImssBrowserServer() {
    const fromVitest = createRequire(require.resolve('vitest/package.json'));
    const { createServer } = await import(pathToFileURL(fromVitest.resolve('vite')).href);
    const root = path.resolve(__dirname, '../..').replace(/\\/g, '/');
    const chunks = path.join(root, '.next/static/chunks');
    const css = existsSync(chunks) ? readdirSync(chunks).filter(file => file.endsWith('.css')) : [];
    const styles = css.length ? css.map(file => readFileSync(path.join(chunks, file), 'utf8')).join('\n') : execFileSync(process.execPath, ['-e', `
        const fs = require('node:fs'); const {createRequire}=require('node:module');
        const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
        postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})
          .then(result=>process.stdout.write(result.css)).catch(error=>{console.error(error);process.exitCode=1});
    `], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const fixtures: Record<string, string> = {
        '\0imss-link': `import React from 'react'; export default ({children,...props})=>React.createElement('a',props,children);`,
        '\0imss-navigation': `export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search); export const useRouter=()=>({push:()=>{}});`,
        '\0imss-branch': `import React from 'react'; const ctx=React.createContext(null);
          export const useBranch=()=>React.useContext(ctx);
          export function Provider({children}) {const [selectedBranchId,setSelectedBranchId]=React.useState(null);
            return React.createElement(ctx.Provider,{value:{selectedBranchId,setSelectedBranchId}},children);}`,
        '\0imss-unrelated': `export const NOM251Report=()=>null; export const NOM035Report=()=>null;
          export const ComplianceDashboard=()=>null; export const PayrollExport=()=>null; export const ComplianceServicesList=()=>null;`,
        '\0imss-style.css': styles,
        '\0imss-entry': `
          import '/imss-style.css'; import React from 'react'; import {createRoot} from 'react-dom/client'; import {Toaster} from 'sonner';
          import {Provider} from '@/lib/branch-context';
          import Altas from '/app/dashboard/compliance/imss/altas/page.tsx'; import Bajas from '/app/dashboard/compliance/imss/bajas/page.tsx';
          import Sua from '/app/dashboard/compliance/imss/sua/page.tsx'; import Reports from '/app/dashboard/compliance/imss/reports/page.tsx';
          import Overview from '/app/dashboard/compliance/imss/page.tsx'; import {CompliancePageClient} from '/app/dashboard/compliance/compliance-page-client.tsx';
          const Page=({ '/altas':Altas,'/bajas':Bajas,'/sua':Sua,'/reports':Reports,'/overview':Overview })[location.pathname];
          const content=Page?React.createElement(Page):React.createElement(CompliancePageClient,{companyId:'test-company',branches:[{id:'20000000-0000-4000-8000-000000000001',name:'Centro'}]});
          createRoot(document.getElementById('root')).render(React.createElement(Provider,null,
            React.createElement('main',{className:'mx-auto max-w-7xl p-4 md:p-6'},content),React.createElement(Toaster)));
        `,
    };
    const server = await createServer({ configFile: false, root, cacheDir: path.join(root, '.tmp', `imss-ui-vite-${process.pid}`),
        esbuild: { jsx: 'automatic' }, css: { postcss: { plugins: [] } },
        server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.next/**', '**/.tmp/**', '**/test-results/**'] } },
        optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'sonner', 'lucide-react', 'radix-ui',
            '@radix-ui/react-checkbox', '@radix-ui/react-dialog', '@radix-ui/react-label', '@radix-ui/react-select', '@radix-ui/react-slot', '@radix-ui/react-tabs',
            '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', '@radix-ui/react-tooltip', 'date-fns', 'date-fns/locale',
            'class-variance-authority', 'clsx', 'tailwind-merge'] },
        resolve: { alias: [
            { find: /^next\/link$/, replacement: '\0imss-link' }, { find: /^next\/navigation$/, replacement: '\0imss-navigation' },
            { find: /^@\/lib\/branch-context$/, replacement: '\0imss-branch' },
            { find: /^@\/components\/(?:compliance\/(?:nom251-report|nom035-report|compliance-dashboard|payroll-export)|equipment\/compliance-services-list)$/, replacement: '\0imss-unrelated' },
            { find: '@', replacement: root },
        ] },
        plugins: [{ name: 'imss-browser-fixtures', enforce: 'pre',
            resolveId(id: string) { if (Object.hasOwn(fixtures, id)) return id; if (id === '/imss-entry.tsx') return '\0imss-entry'; if (id === '/imss-style.css') return '\0imss-style.css'; },
            load: (id: string) => fixtures[id],
            configureServer(devServer: { middlewares: { use: (handler: unknown) => void } }) {
                devServer.middlewares.use((req: { url: string }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
                    const pathname = new URL(req.url, 'http://localhost').pathname;
                    if (!['/altas', '/bajas', '/sua', '/reports', '/overview', '/compliance'].includes(pathname)) return next();
                    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>IMSS — prueba aislada</title></head><body><div id="root"></div><script type="module" src="/imss-entry.tsx"></script></body></html>');
                });
            },
        }],
    });
    await server.listen();
    return { server, url: `http://127.0.0.1:${server.httpServer.address().port}` };
}
