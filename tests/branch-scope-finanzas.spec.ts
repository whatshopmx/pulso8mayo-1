import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  COMPANY_ID,
  E2E_TAG,
  GERENTE_BRANCH,
  GERENTE_EMAIL,
  USER_SUPER_ADMIN,
} from "./support/constants";
import {
  deleteTestExpenses,
  seedOperatingExpense,
  setUserBranchId,
} from "./support/db";

/**
 * Auditoría A5 — omitir `branchId` no puede significar "todo el grupo".
 *
 * Las cinco rutas ABAC de Finanzas pasan el `branchId` del query como
 * `targetBranchId`, así que ABAC 403 a un rol acotado que pida la sucursal de
 * otro. Pero cuando el parámetro **se omite**, el paso 2 del gate se salta y la
 * consulta agregada corre sin filtro: un GERENTE que abre la pantalla sin tocar
 * el selector veía las cifras de toda la cadena. El hueco no estaba en pedir de
 * más, sino en no pedir nada.
 *
 * `resolveBranchScope` ya distingue los tres casos; estas rutas no lo usaban.
 * `NONE` —un rol acotado a sucursal sin ninguna asignada— tiene que devolver
 * vacío, no el grupo: es exactamente el `null` ambiguo que ese helper existe
 * para no volver a producir.
 *
 * Necesita el servidor levantado (usa una sesión real de GERENTE):
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
 *     pnpm exec playwright test --project=chromium tests/branch-scope-finanzas.spec.ts
 */

const KPIS = "/api/finance/kpis";
const PNL = "/api/finance/pnl";
const PAYABLES = "/api/finance/payables";
const AUDIT_LOG = "/api/finance/control-interno/audit-log";
const EXCEPCIONES = "/api/finance/control-interno/excepciones";

/** Las cinco rutas ABAC que este plan reclama (AD-A3). */
const RUTAS = [KPIS, PNL, PAYABLES, AUDIT_LOG, EXCEPCIONES];

/** Sesión del GERENTE, capturada una vez: better-auth limita los inicios de sesión. */
let estadoGerente: Awaited<ReturnType<BrowserContext["storageState"]>>;

async function contextoGerente(browser: Browser) {
  return await browser.newContext({ storageState: estadoGerente });
}

/** El `data` de una respuesta que tiene que haber salido bien. */
async function leer(ctx: BrowserContext, url: string) {
  const res = await ctx.request.get(url);
  expect(res.status(), `${url} respondió ${res.status()}`).toBe(200);
  const json = await res.json();
  expect(json.success, `${url} devolvió success=false`).toBe(true);
  return json.data;
}

test.describe("A5 · el alcance de sucursal sale de la sesión", () => {
  test.beforeAll(async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      let login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
      });
      for (let intento = 0; intento < 3 && login.status() === 429; intento++) {
        await new Promise((r) => setTimeout(r, 11_000));
        login = await contexto.request.post("/api/auth/sign-in/email", {
          data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
        });
      }
      expect(
        login.ok(),
        `no se pudo iniciar sesión como ${GERENTE_EMAIL} (HTTP ${login.status()})`
      ).toBe(true);
      estadoGerente = await contexto.storageState();
    } finally {
      await contexto.close();
    }
  });

  test.beforeEach(async () => {
    // Datos en dos sucursales, para que "el grupo" y "mi sucursal" no puedan
    // coincidir por casualidad: sin esto, una base vacía haría pasar el spec
    // aunque el filtro no existiera.
    for (const [branchId, etiqueta] of [
      [BRANCH_CONDESA, "alcance Condesa"],
      [BRANCH_POLANCO, "alcance Polanco"],
      [BRANCH_POLANCO, "alcance Polanco 2"],
    ] as const) {
      await seedOperatingExpense({
        companyId: COMPANY_ID,
        branchId,
        requestedBy: USER_SUPER_ADMIN,
        dueDate: new Date().toISOString().slice(0, 10),
        amountCents: 2_500_00,
        description: `${E2E_TAG} ${etiqueta} ${Date.now()}${Math.random()}`,
        status: "PENDING_APPROVAL",
      });
    }
  });

  test.afterEach(async () => {
    await deleteTestExpenses();
  });

  // ── El GERENTE recibe su sucursal, no el grupo ─────────────────────────────

  for (const ruta of RUTAS) {
    test(`un GERENTE sin branchId recibe lo mismo que pidiendo su sucursal — ${ruta}`, async ({
      browser,
    }) => {
      const ctx = await contextoGerente(browser);
      try {
        // Mismo rol en las dos peticiones, así que el enmascarado de ABAC es el
        // mismo y lo único que puede diferir es el alcance aplicado.
        const sinParametro = await leer(ctx, ruta);
        const conSuSucursal = await leer(ctx, `${ruta}?branchId=${GERENTE_BRANCH}`);

        expect(
          JSON.stringify(sinParametro),
          `${ruta} le dio el grupo a un GERENTE por no pasar branchId`
        ).toBe(JSON.stringify(conSuSucursal));
      } finally {
        await ctx.close();
      }
    });
  }

  test("la bitácora de un GERENTE sólo nombra su sucursal", async ({ browser }) => {
    const ctx = await contextoGerente(browser);
    try {
      const data = await leer(ctx, AUDIT_LOG);
      const sucursales = new Set(
        (data.entries as Array<{ branchName: string }>).map((e) => e.branchName)
      );

      expect(data.entries.length, "el fixture no sembró bitácora").toBeGreaterThan(0);
      expect(
        [...sucursales],
        "la bitácora del GERENTE nombra sucursales que no son la suya"
      ).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });

  test("el P&L de un GERENTE trae una sola sucursal: la suya", async ({ browser }) => {
    const ctx = await contextoGerente(browser);
    try {
      const data = await leer(ctx, PNL);
      const ids = (data.branches as Array<{ branchId?: string; id?: string }>).map(
        (b) => b.branchId ?? b.id
      );

      expect(ids, "el P&L le entregó el grupo a un GERENTE").toEqual([GERENTE_BRANCH]);
      expect(data.meta.branchCount, "el `meta` sigue contando el grupo").toBe(1);
    } finally {
      await ctx.close();
    }
  });

  // ── El ADMIN conserva el grupo ─────────────────────────────────────────────

  test("un ADMIN sin branchId sigue recibiendo el grupo", async ({ request }) => {
    // La sesión por omisión de los specs es la de admin (`auth.setup.ts`).
    const res = await request.get(PNL);
    expect(res.status()).toBe(200);
    const { data } = await res.json();

    expect(
      data.branches.length,
      "el ADMIN dejó de ver el grupo: A5 cerró de más"
    ).toBeGreaterThan(1);

    const bitacora = await request.get(AUDIT_LOG);
    const entries = (await bitacora.json()).data.entries as Array<{ branchName: string }>;
    const sucursales = new Set(entries.map((e) => e.branchName));
    expect(
      sucursales.size,
      "el fixture no tiene datos cruzados, así que la comparación del GERENTE no probaría nada"
    ).toBeGreaterThan(1);
  });

  // ── El caso que el helper existe para no perder ────────────────────────────

  test("un rol de sucursal sin sucursal asignada recibe vacío, no el grupo", async ({
    browser,
  }) => {
    // `kind: "NONE"`. No hay ningún usuario así en la base sembrada —
    // `assertBranchAssignment` impide crearlo desde la app— pero `branch_id` es
    // nullable y el estado es representable, así que se fabrica y se restaura.
    const anterior = await setUserBranchId(GERENTE_EMAIL, null);
    const ctx = await contextoGerente(browser);
    try {
      // Las listas devuelven vacío: "ninguna fila" se lee correctamente como
      // ninguna, y es la verdad para quien no alcanza ninguna sucursal.
      const bitacora = await leer(ctx, AUDIT_LOG);
      expect(bitacora.entries, "sin sucursal asignada, la bitácora entregó el grupo").toEqual(
        []
      );
      expect(bitacora.total).toBe(0);

      const excepciones = await leer(ctx, EXCEPCIONES);
      expect(excepciones.violations).toEqual([]);
      expect(excepciones.total).toBe(0);

      // Los agregados de dinero **no** devuelven ceros: un P&L en cero afirma un
      // margen operativo y un saldo en cero dice "no debes nada". Ninguna de las
      // dos es "no hay datos", y las dos serían falsas. Mismo criterio que
      // `/api/finance/cash-flow`, que ya resolvió esto en su plan.
      for (const ruta of [PNL, KPIS, PAYABLES]) {
        const res = await ctx.request.get(ruta);
        expect(res.status(), `${ruta} le respondió a un usuario sin sucursal`).toBe(403);
      }
    } finally {
      await ctx.close();
      await setUserBranchId(GERENTE_EMAIL, anterior);
    }
  });
});
