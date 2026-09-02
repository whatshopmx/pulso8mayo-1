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
  getExpenseStatus,
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

/** Las cinco rutas ABAC originales (AD-A3). */
const RUTAS = [KPIS, PNL, PAYABLES, AUDIT_LOG, EXCEPCIONES];

/**
 * A5.5 — las superficies que la red **no** cubría.
 *
 * `RUTAS` sólo listaba las cinco que ya habían pasado por la corrección de
 * alcance. Fuera quedaban tesorería, cuentas bancarias de proveedores, flujo de
 * efectivo, comisiones, costo laboral, caja chica y las mutaciones de gasto —
 * **exactamente donde vivían F4 y F10**. Una suite que sólo prueba lo que ya se
 * arregló no es una red de regresión: es un acta.
 *
 * Se separan de `RUTAS` porque no todas contestan lo mismo: unas devuelven la
 * sucursal del GERENTE, otras 403. Lo que se afirma aquí es lo único común y lo
 * que importa: **omitir `branchId` nunca puede significar "todo el grupo"**.
 */
const CAJA_CHICA = "/api/petty-cash/consolidado";
const FLUJO = "/api/finance/cash-flow";
const COMISIONES = "/api/finance/commissions";
const COSTO_LABORAL = "/api/finance/labor-cost";

const RUTAS_NUEVAS = [CAJA_CHICA, FLUJO, COMISIONES, COSTO_LABORAL];

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

  // ── A0.1 · las mutaciones también, no sólo las lecturas ────────────────────

  /**
   * Hasta A0.1 esta red sólo probaba lecturas, y por eso F4 vivió aquí sin que
   * nadie lo viera: `pay` y `reschedule` se acotaban por `companyId` y nada
   * más. Un GERENTE de Condesa no *veía* el gasto de Polanco en la lista, pero
   * con el id en la mano lo pagaba por API —el filtro de sucursal estaba en la
   * lectura y no en la escritura, que es donde se decide el dinero.
   */
  test("un GERENTE no puede pagar ni reprogramar un gasto de otra sucursal", async ({
    browser,
  }) => {
    const ajeno = await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: new Date().toISOString().slice(0, 10),
      amountCents: 3_100_00,
      // APPROVED a propósito: si el gasto estuviera pendiente, un 400 por
      // estado se confundiría con el 403 por alcance y el caso no probaría nada.
      status: "APPROVED",
      description: `${E2E_TAG} ajeno Polanco ${Date.now()}`,
    });

    const ctx = await contextoGerente(browser);
    try {
      const pago = await ctx.request.post(`/api/expenses/${ajeno}/pay`, { data: {} });
      expect(pago.status(), "un GERENTE pagó un gasto de otra sucursal").toBe(403);

      const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const repro = await ctx.request.post(`/api/expenses/${ajeno}/reschedule`, {
        data: { dueDate: manana },
      });
      expect(repro.status(), "un GERENTE reprogramó un gasto de otra sucursal").toBe(403);

      // Y no lo tocó: el 403 tiene que ser un rechazo, no un error después de
      // escribir.
      expect(await getExpenseStatus(ajeno)).toBe("APPROVED");
    } finally {
      await ctx.close();
    }
  });

  test("un GERENTE sí puede pagar un gasto de su propia sucursal", async ({ browser }) => {
    // El contraejemplo importa tanto como el 403: sin él, A0.1 pasaría también
    // si hubiera cerrado la ruta para todos los GERENTE.
    const propio = await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: GERENTE_BRANCH,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: new Date().toISOString().slice(0, 10),
      amountCents: 1_200_00,
      status: "APPROVED",
      description: `${E2E_TAG} propio Condesa ${Date.now()}`,
    });

    const ctx = await contextoGerente(browser);
    try {
      const pago = await ctx.request.post(`/api/expenses/${propio}/pay`, { data: {} });
      expect(
        pago.status(),
        "A0.1 cerró de más: el GERENTE ya no puede pagar lo suyo"
      ).toBe(200);
      expect(await getExpenseStatus(propio)).toBe("PAID");
    } finally {
      await ctx.close();
    }
  });

  // ── A5.5 · las superficies que la red no cubría ────────────────────────────

  for (const ruta of RUTAS_NUEVAS) {
    test(`omitir branchId no entrega el grupo — ${ruta}`, async ({ browser }) => {
      const ctx = await contextoGerente(browser);
      try {
        const sinParametro = await ctx.request.get(ruta);
        const conSuSucursal = await ctx.request.get(`${ruta}?branchId=${GERENTE_BRANCH}`);

        // Una ruta puede negarle el acceso a un GERENTE por completo, y eso es
        // una respuesta válida; lo que no puede es contestar el grupo cuando no
        // se le pide sucursal. Si las dos respuestas son 200, tienen que decir
        // lo mismo.
        expect(
          sinParametro.status(),
          `${ruta} respondió ${sinParametro.status()} sin branchId`
        ).toBe(conSuSucursal.status());

        if (sinParametro.status() !== 200) return;

        expect(
          JSON.stringify(await sinParametro.json()),
          `${ruta} le dio el grupo a un GERENTE por no pasar branchId`
        ).toBe(JSON.stringify(await conSuSucursal.json()));
      } finally {
        await ctx.close();
      }
    });
  }

  test("un GERENTE no puede generar el layout de dispersión (F10)", async ({ browser }) => {
    // El archivo lleva las CLABEs en claro de todos los proveedores del grupo.
    // La ruta se autorizaba con `reports:read`, que un GERENTE tiene.
    const ctx = await contextoGerente(browser);
    try {
      const res = await ctx.request.get(
        "/api/finance/treasury/runs/00000000-0000-4000-8000-000000000000/layout"
      );
      expect(
        res.status(),
        "la ruta del layout sigue abierta a un rol de sucursal"
      ).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test("un GERENTE no lee las cuentas bancarias de proveedores de otra sucursal", async ({
    browser,
  }) => {
    const ctx = await contextoGerente(browser);
    try {
      const res = await ctx.request.get(
        `/api/finance/supplier-bank-accounts?branchId=${BRANCH_POLANCO}`
      );
      // 403 o su propia sucursal; lo que no puede es contestar Polanco.
      expect([200, 403, 404]).toContain(res.status());
      if (res.status() !== 200) return;

      const propio = await ctx.request.get(
        `/api/finance/supplier-bank-accounts?branchId=${GERENTE_BRANCH}`
      );
      expect(JSON.stringify(await res.json())).toBe(JSON.stringify(await propio.json()));
    } finally {
      await ctx.close();
    }
  });

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
