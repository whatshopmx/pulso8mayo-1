import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  COMPANY_ID,
  EMPLEADO_EMAIL,
  GERENTE_EMAIL,
  READONLY_EMAIL,
} from "./support/constants";
import {
  countDefaultMappingTemplates,
  deleteTestMappingTemplates,
  seedMappingTemplate,
} from "./support/db";

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
 * Cookies de cada rol, capturadas una sola vez.
 *
 * Dos límites distintos vuelven inestable a un spec que inicia sesión por caso:
 *
 * 1. **better-auth** limita `/sign-in/email` a **3 intentos cada 10 segundos**.
 *    `lib/auth-config.ts` no define `rateLimit`, así que rigen los valores por
 *    omisión, y esos solo se activan con `NODE_ENV=production` — es decir, con
 *    `npm run start`, que es como se corre este spec. Bajo `next dev` no se
 *    notan, y por eso el rojo aparece solo al verificar contra el build.
 * 2. `proxy.ts` limita el resto de `/api/*`, aunque exceptúa `/api/auth`.
 *
 * Iniciando sesión en cada caso, este spec gastaba once inicios de sesión y los
 * últimos volvían 429: los tests fallaban por el límite y no por el RBAC, que es
 * justo el falso rojo que un spec de permisos no puede permitirse. Con la sesión
 * capturada una vez por rol son tres, y el reintento cubre el caso de que
 * `auth.setup.ts` acabe de gastar su parte de la ventana.
 */
const estadosPorRol = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

/** Ventana de better-auth para `/sign-in/email`, más un margen. */
const ESPERA_TRAS_429_MS = 11_000;

test.beforeAll(async ({ browser }) => {
  for (const email of [EMPLEADO_EMAIL, READONLY_EMAIL, GERENTE_EMAIL]) {
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      let login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email, password: ADMIN_PASSWORD },
      });

      // Un 429 no dice nada sobre los permisos: se espera a que la ventana
      // corra y se vuelve a intentar, en vez de teñir de rojo el spec entero.
      for (let intento = 0; intento < 3 && login.status() === 429; intento++) {
        await new Promise((r) => setTimeout(r, ESPERA_TRAS_429_MS));
        login = await contexto.request.post("/api/auth/sign-in/email", {
          data: { email, password: ADMIN_PASSWORD },
        });
      }

      expect(
        login.ok(),
        `no se pudo iniciar sesión como ${email} (HTTP ${login.status()})`
      ).toBe(true);
      estadosPorRol.set(email, await contexto.storageState());
    } finally {
      await contexto.close();
    }
  }
});

/**
 * Abre un contexto con la sesión de otro rol.
 *
 * Parte del estado capturado arriba y **nunca** del que `auth.setup.ts` dejó
 * para todos los specs: sin eso la petición se haría como SUPER_ADMIN y el test
 * pasaría por la razón equivocada. Mismo patrón que
 * `gastos-autorizaciones.spec.ts:47`, con la sesión reutilizada.
 */
async function sesionDe(browser: Browser, email: string) {
  const estado = estadosPorRol.get(email);
  if (!estado) throw new Error(`no hay sesión preparada para ${email}`);
  return await browser.newContext({ storageState: estado });
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

/**
 * Auditoría A13 + A14 — la plantilla que decide cómo se cuenta la venta.
 *
 * A2 cerró `/dashboard/sales/mapping` y la ruta de colección, pero
 * `PUT`/`DELETE /api/sales/mapping-templates/[id]` **se quedó abierta**: un
 * EMPLEADO no podía crear una plantilla y sí podía editar o borrar la que ya
 * existía. Es la superficie más apalancada del módulo — no lees el dinero,
 * defines cómo se cuenta.
 *
 * A14 es el otro defecto del mismo `PUT`: marcar como default hacía dos
 * escrituras sueltas —limpiar el `isDefault` de todas, luego poner el de la
 * objetivo— así que un id inexistente dejaba a la empresa **sin ninguna
 * plantilla default**, y con eso muere la autodetección de archivos POS.
 */
test.describe("A13/A14 · plantillas POS: rol y transacción", () => {
  let plantillaId = "";

  test.beforeEach(async () => {
    await deleteTestMappingTemplates();
    plantillaId = await seedMappingTemplate({
      companyId: COMPANY_ID,
      nombre: `plantilla default ${Date.now()}`,
      isDefault: true,
    });
  });

  test.afterEach(async () => {
    await deleteTestMappingTemplates();
  });

  test("un EMPLEADO no edita una plantilla existente", async ({ browser }) => {
    const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await contexto.request.put(`/api/sales/mapping-templates/${plantillaId}`, {
        data: { name: "[E2E] secuestrada" },
      });
      expect(res.status(), "un EMPLEADO alteró cómo se ingesta la venta").toBe(403);
    } finally {
      await contexto.close();
    }
  });

  test("un EMPLEADO tampoco borra una plantilla", async ({ browser }) => {
    const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await contexto.request.delete(
        `/api/sales/mapping-templates/${plantillaId}`
      );
      expect(res.status()).toBe(403);
    } finally {
      await contexto.close();
    }
  });

  test("un GERENTE sí edita la plantilla", async ({ browser }) => {
    const contexto = await sesionDe(browser, GERENTE_EMAIL);
    try {
      const res = await contexto.request.put(`/api/sales/mapping-templates/${plantillaId}`, {
        data: { posSystem: "Soft Restaurant" },
      });
      expect(res.ok(), await res.text()).toBe(true);
    } finally {
      await contexto.close();
    }
  });

  test("un PUT con id inexistente no deja a la empresa sin plantilla default", async ({
    request,
  }) => {
    expect(await countDefaultMappingTemplates(COMPANY_ID)).toBeGreaterThan(0);

    const res = await request.put(
      "/api/sales/mapping-templates/b9999999-0000-4000-8000-999999999999",
      { data: { isDefault: true } }
    );
    expect(res.status(), "esperaba 404 por la plantilla inexistente").toBe(404);

    // Lo que A14 protege: el primer UPDATE limpiaba el default de TODAS y el
    // `throw` salía con ese borrado ya comprometido.
    expect(
      await countDefaultMappingTemplates(COMPANY_ID),
      "la empresa quedó sin plantilla default: la autodetección de POS deja de funcionar"
    ).toBeGreaterThan(0);
  });

  test("marcar una plantilla como default sigue desmarcando a las demás", async ({
    request,
  }) => {
    const segunda = await seedMappingTemplate({
      companyId: COMPANY_ID,
      nombre: `segunda plantilla ${Date.now()}`,
    });

    const res = await request.put(`/api/sales/mapping-templates/${segunda}`, {
      data: { isDefault: true },
    });
    expect(res.ok(), await res.text()).toBe(true);

    expect(
      await countDefaultMappingTemplates(COMPANY_ID),
      "quedó más de una plantilla default"
    ).toBe(1);
  });
});
