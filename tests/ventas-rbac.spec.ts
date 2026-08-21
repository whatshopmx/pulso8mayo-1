import { test, expect, type Browser } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  EMPLEADO_EMAIL,
  GERENTE_EMAIL,
  READONLY_EMAIL,
} from "./support/constants";

/**
 * Auditoría A2 — quién entra al módulo de Ventas.
 *
 * `ROUTE_PERMISSIONS` no tenía entrada para `/dashboard/sales`, así que
 * `hasAccess` caía al comodín `/dashboard`, que admite los seis roles: un
 * EMPLEADO podía leer el corte del día y el arqueo de caja de todas las
 * sucursales, y abrir la pantalla de mapeo POS —la que decide cómo se ingesta
 * la venta— con solo escribir la URL. Las tres rutas de `/api/sales` usaban
 * `requireTenant`/`requireAuth`, que autentican pero no miran el rol.
 *
 * Cerrar la ruta del dashboard sin cerrar la API deja la fuga abierta: un
 * `fetch` desde la consola no pasa por `proxy.ts` con la misma ruta que el
 * navegador. Por eso cada caso tiene su gemelo de API.
 *
 * Necesita el servidor levantado (usa sesiones reales):
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e ventas-rbac
 */

/**
 * Abre un contexto con la sesión de otro rol. El `storageState: undefined`
 * descarta las cookies de admin que `auth.setup.ts` dejó para todos los specs —
 * sin eso la petición se haría como SUPER_ADMIN y el test pasaría por la razón
 * equivocada. Mismo patrón que `gastos-autorizaciones.spec.ts:47`.
 */
async function sesionDe(browser: Browser, email: string) {
  const contexto = await browser.newContext({ storageState: undefined });
  const login = await contexto.request.post("/api/auth/sign-in/email", {
    data: { email, password: ADMIN_PASSWORD },
  });
  expect(login.ok(), `no se pudo iniciar sesión como ${email}`).toBe(true);
  return contexto;
}

/** Las tres rutas que este módulo expone en lectura. */
const RUTAS_DE_LECTURA = [
  "/api/sales/cuts",
  "/api/sales/analytics",
  "/api/sales/mapping-templates",
];

test.describe("A2 · RBAC del módulo de Ventas", () => {
  // ── Pantallas ──────────────────────────────────────────────────────────────

  for (const ruta of ["/dashboard/sales", "/dashboard/sales/mapping"]) {
    test(`un EMPLEADO no entra a ${ruta} ni escribiendo la URL`, async ({ browser }) => {
      const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
      try {
        const page = await contexto.newPage();
        // `proxy.ts` redirige del lado del servidor, así que `goto` ya aterriza
        // en el destino final. `networkidle` no sirve: el dashboard mantiene
        // sondeos abiertos y la red nunca se queda quieta.
        await page.goto(ruta, { waitUntil: "domcontentloaded" });

        expect(
          page.url(),
          `un EMPLEADO llegó a ${ruta}, donde se ve el arqueo de caja`
        ).not.toContain("/dashboard/sales");
      } finally {
        await contexto.close();
      }
    });
  }

  // ── API ────────────────────────────────────────────────────────────────────

  for (const ruta of RUTAS_DE_LECTURA) {
    test(`un EMPLEADO recibe 403 en ${ruta}`, async ({ browser }) => {
      const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
      try {
        const res = await contexto.request.get(ruta);
        expect(res.status(), `${ruta} le respondió a un EMPLEADO`).toBe(403);
      } finally {
        await contexto.close();
      }
    });

    test(`un READONLY recibe 403 en ${ruta}`, async ({ browser }) => {
      // READONLY consulta operación. El corte de caja es tesorería: el mismo
      // criterio con el que quedó fuera de Finanzas.
      const contexto = await sesionDe(browser, READONLY_EMAIL);
      try {
        const res = await contexto.request.get(ruta);
        expect(res.status(), `${ruta} le respondió a un READONLY`).toBe(403);
      } finally {
        await contexto.close();
      }
    });
  }

  test("un EMPLEADO tampoco captura un corte por la API", async ({ browser }) => {
    const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await contexto.request.post("/api/sales/cuts", {
        data: {
          branchId: "b1000001-0000-4000-8000-000000000001",
          businessDate: "2026-01-01",
          shift: "COMPLETO",
          totalSales: 100000,
        },
      });
      // 403 antes de mirar el cuerpo: el rol se revisa primero, así que el
      // gasto ni siquiera llega a validarse.
      expect(res.status(), "un EMPLEADO escribió un corte de ventas").toBe(403);
    } finally {
      await contexto.close();
    }
  });

  test("un EMPLEADO tampoco crea una plantilla de mapeo POS", async ({ browser }) => {
    const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await contexto.request.post("/api/sales/mapping-templates", {
        data: { name: "[E2E] plantilla no autorizada", mapping: {} },
      });
      expect(res.status(), "un EMPLEADO alteró cómo se ingesta la venta").toBe(403);
    } finally {
      await contexto.close();
    }
  });

  // ── Los roles que sí ────────────────────────────────────────────────────────

  test("un GERENTE conserva acceso a las cuatro superficies", async ({ browser }) => {
    // El otro lado del cambio: cerrar de más deja sin trabajar a quien captura
    // el corte todos los días.
    const contexto = await sesionDe(browser, GERENTE_EMAIL);
    try {
      for (const ruta of RUTAS_DE_LECTURA) {
        const res = await contexto.request.get(ruta);
        expect(res.status(), `${ruta} le cerró la puerta a un GERENTE`).toBe(200);
      }

      const page = await contexto.newPage();
      await page.goto("/dashboard/sales", { waitUntil: "domcontentloaded" });
      expect(page.url(), "un GERENTE no pudo abrir Ventas").toContain("/dashboard/sales");
    } finally {
      await contexto.close();
    }
  });
});
