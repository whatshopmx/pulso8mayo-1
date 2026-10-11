import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Usa Vite, el servidor de módulos que ya depende de Vitest. Sin BD ni auth reales. */
export async function startShiftsBrowserServer() {
  const resolveFromVitest = createRequire(require.resolve("vitest/package.json"));
  const { createServer } = await import(pathToFileURL(resolveFromVitest.resolve("vite")).href);
  const root = path.resolve(__dirname, "../..").replace(/\\/g, "/");
  const server = await createServer({
    configFile: false,
    root,
    optimizeDeps: {
      entries: [],
      include: [
        "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
        "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-label",
        "@radix-ui/react-select", "@radix-ui/react-slot", "@radix-ui/react-tabs", "radix-ui",
        "class-variance-authority", "clsx", "date-fns", "date-fns/locale",
        "lucide-react", "tailwind-merge",
      ],
    },
    server: { host: "127.0.0.1", port: 0 },
    resolve: { alias: [
      { find: "@/hooks", replacement: "\0test-hooks" },
      { find: "@/app/actions/shifts", replacement: "\0test-actions" },
      { find: "@", replacement: root },
    ] },
    plugins: [{
      name: "shifts-browser-fixtures",
      enforce: "pre",
      resolveId(id: string) {
        if (id.startsWith("\0test-")) return id;
        if (id === "./ShiftEditorDialog") return "\0test-editor";
        if (id === "/shifts-test-entry.tsx") return "\0test-entry";
      },
      load(id: string) {
        if (id === "\0test-hooks") return `
          export { useShifts } from '/hooks/use-shifts.ts';
          export { useWeeklySchedule } from '/hooks/use-weekly-schedule.ts';
          export { useShiftExport } from '/hooks/use-shift-export.ts';
          export { useSchedulerCatalog } from '/hooks/use-scheduler-catalog.ts';
          export const useShiftValidation = () => ({ conflictSummary: { hasConflicts: false, errorCount: 0 } });
        `;
        if (id === "\0test-editor") return "export const ShiftEditorDialog = () => null;";
        if (id === "\0test-actions") return `
          async function read(url) {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Error de carga simulado');
            return response.json();
          }
          export const getShifts = (filters) => read('/fixture/shifts?filters=' + encodeURIComponent(JSON.stringify(filters)));
          export const getSchedulerCatalog = () => read('/fixture/catalog');
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
      },
      configureServer(devServer: { middlewares: { use: (handler: unknown) => void } }) {
        devServer.middlewares.use((req: { url: string }, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/shifts-test-entry.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}
