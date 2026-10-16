import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Usa Vite, el servidor de módulos que ya depende de Vitest. Sin BD ni auth reales. */
export async function startShiftsBrowserServer() {
  const resolveFromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(resolveFromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  let configStyles: string | undefined;
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(root, ".tmp", `browser-vite-${process.pid}`),
    // Los estilos se compilan en un proceso sin los hooks ESM de Playwright.
    css: { postcss: { plugins: [] } },
    optimizeDeps: {
      entries: [],
      include: [
        "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
        "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-label",
        "@radix-ui/react-select", "@radix-ui/react-slot", "@radix-ui/react-tabs", "@radix-ui/react-switch",
        "@radix-ui/react-checkbox", "@radix-ui/react-progress", "@radix-ui/react-separator",
        // C17 — la pantalla de transferencias usa popover. Se declara aquí
        // porque Vite optimiza lo que descubre durante la ejecución y avisa de
        // recarga: una dependencia nueva a mitad de suite rompe los tests que
        // ya estaban en curso.
        "@radix-ui/react-popover", "radix-ui",
        "class-variance-authority", "clsx", "date-fns", "date-fns/locale",
        "lucide-react", "tailwind-merge", "@tanstack/react-query", "sonner",
      ],
    },
    server: {
      host: "127.0.0.1", port: 0,
      watch: { ignored: ["**/.next/**", "**/.tmp/**", "**/test-results/**"] },
    },
    resolve: { alias: [
      { find: /^@\/hooks$/, replacement: "\0test-hooks" },
      { find: /^@\/hooks\/use-toast$/, replacement: "\0test-toast" },
      { find: "@/app/actions/shifts", replacement: "\0test-actions" },
      { find: "@/app/actions/workflow-completion-recovery", replacement: "\0test-completion-recovery" },
      // C17 — la pantalla de transferencias (el abastecimiento entre
      // sucursales) se monta con un contexto de sucursal fijo: la página real,
      // los componentes reales y `fetch` a la API, que la prueba intercepta.
      // `next/link` y `next/navigation` no corren fuera de Next: se sustituyen
      // por lo mínimo que la página usa de ellos.
      { find: /^@\/lib\/branch-context$/, replacement: "\0test-branch-context" },
      // C18 — la pantalla de la corrida pregunta el rol de la sesión para no
      // ofrecer lo que el servidor va a rechazar; en la prueba el rol lo
      // inyecta la página, sin llamada a la API de auth.
      { find: /^@\/hooks\/use-session$/, replacement: "\0test-use-session" },
      { find: /^@\/components\/shared\/camera-capture$/, replacement: "\0test-camera-capture" },
      { find: /^next\/link$/, replacement: "\0test-next-link" },
      { find: /^next\/navigation$/, replacement: "\0test-next-navigation" },
      { find: "@", replacement: root },
    ] },
    plugins: [{
      name: "shifts-browser-fixtures",
      enforce: "pre",
      resolveId(id: string) {
        if (id.startsWith("\0test-")) return id;
        if (id === "./ShiftEditorDialog") return "\0test-editor";
        if (id === "/transfers-test-entry.tsx") return "\0test-transfers-entry";
        if (id === "/treasury-test-entry.tsx") return "\0test-treasury-entry";
        if (id === "/shifts-test-entry.tsx") return "\0test-entry";
        if (id === "/config-test-entry.tsx") return "\0test-config-entry";
        if (id === "/liga-test-entry.tsx") return "\0test-liga-entry";
        if (id === "/workflow-test-entry.tsx") return "\0test-workflow-entry";
        if (id === "/workflow-completion-test-entry.tsx") return "\0test-workflow-completion-entry";
        if (id === "/workflow-settings-test-entry.tsx") return "\0test-workflow-settings-entry";
        if (id === "/config-test-page.tsx") return "\0test-config-page";
        if (id === "/config-test.css") return "\0test-config.css";
      },
      load(id: string) {
        if (id === "\0test-config.css") {
          configStyles ??= execFileSync(process.execPath, ["-e", `
            const { readFileSync } = require('node:fs');
            const { createRequire } = require('node:module');
            const plugin = require('@tailwindcss/postcss');
            const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
            postcss([plugin()]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' })
              .then(result => process.stdout.write(result.css))
              .catch(error => { console.error(error); process.exitCode = 1; });
          `], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
          return configStyles;
        }
        if (id === "\0test-hooks") return `
          export { useShifts } from '/hooks/use-shifts.ts';
          export { useWeeklySchedule } from '/hooks/use-weekly-schedule.ts';
          export { useShiftExport } from '/hooks/use-shift-export.ts';
          export { useSchedulerCatalog } from '/hooks/use-scheduler-catalog.ts';
          export const useShiftValidation = () => ({ conflictSummary: { hasConflicts: false, errorCount: 0 } });
        `;
        if (id === "\0test-toast") return `
          export const useToast = () => {
            const avisos = [];
            return {
              toast: (aviso) => {
                const nodo = document.createElement('div');
                nodo.setAttribute('role', 'alert');
                nodo.dataset.tone = aviso.variant === 'destructive' ? 'error' : 'ok';
                nodo.textContent = aviso.title + '. ' + (aviso.description ?? '');
                document.body.appendChild(nodo);
              },
            };
          };
        `;
        if (id === "\0test-editor") return "export const ShiftEditorDialog = () => null;";
        if (id === "\0test-camera-capture") return "export const CameraCapture = () => null;";
        // C17 — la sucursal activa la fija la prueba, no el contexto real: lo
        // que se comprueba es la pantalla contra las respuestas de la API.
        if (id === "\0test-branch-context") return `
          import React from 'react';
          import { createContext, useContext } from 'react';
          const Contexto = createContext(undefined);
          const porDefecto = () => ({
            selectedBranchId: window.__sucursalPrueba ?? null,
            selectedBranch: null,
            branches: window.__ramasPrueba ?? [],
            setBranches: () => {},
            isLoading: false,
          });
          export function useBranch() {
            // Sin proveedor se devuelve la sucursal que la prueba inyectó, en
            // lugar de fallar: hay pantallas que piden el contexto en un árbol
            // que la prueba no monta, y reventar ahí culpa sería del stub.
            return useContext(Contexto) ?? porDefecto();
          }
          export function BranchProvider({ value, children }) {
            return React.createElement(Contexto.Provider, { value }, children);
          }
          export function getBranchCookieHeader() { return 'p_branch_id'; }
          export const BRANCH_COOKIE_NAME = 'p_branch_id';
        `;
        if (id === "\0test-use-session") return `
          export function useSession() {
            const actor = window.__actorPrueba ?? {};
            return {
              session: { user: { id: actor.id ?? 'user-1', role: actor.role ?? null } },
              loading: false,
              error: null,
              refresh: () => {},
            };
          }
          export function useRequireAuth() {
            return { session: null, loading: false, isAuthenticated: false };
          }
          export function useRequireRole() {
            return { session: null, loading: false, hasAccess: false };
          }
        `;
        if (id === "\0test-next-link") return `
          import React from 'react';
          export default function Link({ href, children, ...resto }) {
            return React.createElement('a', { href: href ?? '#', ...resto }, children);
          }
        `;
        if (id === "\0test-next-navigation") return `
          export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {} });
          export const usePathname = () => '/';
          export const useSearchParams = () => new URLSearchParams();
          export const redirect = () => {};
          export const useParams = () => window.__paramsPrueba ?? {};
        `;
        if (id === "\0test-completion-recovery") return `
          export async function retryWorkflowCompletionEffects(input) {
            const response = await fetch('/api/workflow-test/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            return data;
          }
        `;
        if (id === "\0test-workflow-completion-entry") return `
          import '/config-test.css';
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import Page from '/app/dashboard/workflows/execute/[id]/page.tsx';
          import { Toaster } from 'sonner';
          createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null, React.createElement(Page), React.createElement(Toaster)));
        `;
        if (id === "\0test-transfers-entry") return `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
          import TransfersPage from '/app/dashboard/inventory/transfers/page.tsx';
          import { BranchProvider } from '@/lib/branch-context';
          import { Toaster } from 'sonner';
          const ramas = window.__ramasPrueba ?? [];
          const seleccionada = window.__sucursalPrueba ?? ramas[0]?.id ?? null;
          const valor = {
            selectedBranchId: seleccionada,
            selectedBranch: ramas.find((r) => r.id === seleccionada) ?? null,
            branches: ramas,
            setBranches: () => {},
            isLoading: false,
          };
          // El Toaster lo monta el layout real; sin él, ningún aviso de la
          // pantalla se ve y la prueba de «el motivo llega al operador» no
          // probaría nada.
          // El QueryClientProvider lo monta el layout real; la pantalla usa el
          // hook de sucursales, así que sin él no hay árbol.
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          createRoot(document.getElementById('root')).render(
            React.createElement(
              QueryClientProvider,
              { client },
              React.createElement(
                BranchProvider,
                { value: valor },
                React.createElement(TransfersPage),
                React.createElement(Toaster, { position: 'top-right' })
              )
            )
          );
        `;
        if (id === "\0test-treasury-entry") return `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { PaymentRunDetail } from '/components/finance/payment-run-detail.tsx';
          import { Toaster } from 'sonner';
          createRoot(document.getElementById('root')).render(
            React.createElement(
              React.Fragment,
              null,
              React.createElement(PaymentRunDetail, { runId: window.__corridaPrueba }),
              React.createElement(Toaster, { position: 'top-right' })
            )
          );
        `;
        if (id === "\0test-actions") return `
          async function read(url, init) {
            const response = await fetch(url, init);
            if (!response.ok) throw new Error('Error de carga simulado');
            return response.json();
          }
          const operationUrl = (path, operation) =>
            path + '?operation=' + encodeURIComponent(JSON.stringify(operation));
          export const getShifts = (filters) => read('/fixture/shifts?filters=' + encodeURIComponent(JSON.stringify(filters)));
          export const getSchedulerCatalog = () => read('/fixture/catalog');
          export const getDefaultTemplates = () => read('/fixture/templates');
          export const previewBulkOperation = (operation) =>
            read(operationUrl('/fixture/template-preview', operation));
          export const applyBulkOperation = (operation) =>
            read(operationUrl('/fixture/template-apply', operation), { method: 'POST' });
          const noWrites = () => { throw new Error('Esta prueba no permite escrituras'); };
          export const createShift = noWrites, updateShift = noWrites, deleteShift = noWrites,
            publishShifts = noWrites, duplicateShifts = noWrites;
        `;
        if (id === "\0test-entry") return `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { ShiftSchedulerContainer } from '/components/labor/shifts/ShiftSchedulerContainer.tsx';
          createRoot(document.getElementById('root')).render(React.createElement(ShiftSchedulerContainer));
        `;
        if (id === "\0test-config-page") return `
          export { default } from '/app/dashboard/company/operating-config/page.tsx';
        `;
        if (id === "\0test-config-entry") return `
          import '/config-test.css';
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
          import OperatingConfigPage from '/config-test-page.tsx';
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          createRoot(document.getElementById('root')).render(
            React.createElement(QueryClientProvider, { client }, React.createElement(OperatingConfigPage))
          );
        `;
        // C22 — la Liga de Sucursales es una pantalla que sólo habla con
        // `/api/group/branches-qsr`, que la prueba intercepta: no necesita
        // proveedores, sólo los estilos del layout real.
        if (id === "\0test-liga-entry") return `
          import '/config-test.css';
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import LigaPage from '/app/dashboard/branches/page.tsx';
          createRoot(document.getElementById('root')).render(React.createElement(LigaPage));
        `;
        // C24 — Workflow executor para validar contrato de paso y omisión en cliente
        if (id === "\0test-workflow-entry") return `
          import '/config-test.css';
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { WorkflowExecutor } from '/components/workflow/workflow-executor.tsx';
          import { Toaster } from 'sonner';

          const execution = window.__executionPrueba;
          createRoot(document.getElementById('root')).render(
            React.createElement(
              React.Fragment,
              null,
              execution ? React.createElement(WorkflowExecutor, { execution }) : null,
              React.createElement(Toaster, { position: 'top-right' })
            )
          );
        `;
        // C25 — Modal de configuración de workflows para validar transmisión de IA y fallback
        if (id === "\0test-workflow-settings-entry") return `
          import '/config-test.css';
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { WorkflowSettingsModal } from '/components/builder/workflow-settings-modal.tsx';
          import { Toaster } from 'sonner';

          const initialSettings = window.__settingsPrueba || {
            aiConfig: {
              provider: 'moondream',
              fallbackProvider: 'cloudflare',
              maxRetries: 2,
            },
          };
          const canEditPrivileged = window.__canEditPrivileged ?? true;

          createRoot(document.getElementById('root')).render(
            React.createElement(
              React.Fragment,
              null,
              React.createElement(WorkflowSettingsModal, {
                open: true,
                onClose: () => {},
                templateId: 'tpl-c25-test',
                initialSettings,
                canEditPrivileged,
              }),
              React.createElement(Toaster, { position: 'top-right' })
            )
          );
        `;
      },
      configureServer(devServer: { middlewares: { use: (handler: unknown) => void } }) {
        devServer.middlewares.use((req: { url: string }, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (req.url === "/" || req.url === "/config" || req.url === "/transfers" || req.url === "/tesoreria" || req.url === "/liga" || req.url === "/workflow" || req.url === "/workflow-settings" || req.url === "/workflow-completion") {
            res.setHeader("Content-Type", "text/html");
            const entrada =
              req.url === "/config" ? "/config-test-entry.tsx"
              : req.url === "/transfers" ? "/transfers-test-entry.tsx"
              : req.url === "/tesoreria" ? "/treasury-test-entry.tsx"
              : req.url === "/liga" ? "/liga-test-entry.tsx"
              : req.url === "/workflow" ? "/workflow-test-entry.tsx"
              : req.url === "/workflow-completion" ? "/workflow-completion-test-entry.tsx"
              : req.url === "/workflow-settings" ? "/workflow-settings-test-entry.tsx"
              : "/shifts-test-entry.tsx";
            res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="${entrada}"></script></body></html>`);
            return;
          }
          next();
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}
