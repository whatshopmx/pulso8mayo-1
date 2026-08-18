import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import {
  COMPANY_ID,
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  USER_SUPER_ADMIN,
  ADMIN_PASSWORD,
  GERENTE_EMAIL,
  GERENTE_BRANCH,
  EMPLEADO_EMAIL,
  E2E_TAG,
} from "./support/constants";
import {
  seedOperatingExpense,
  seedManyOperatingExpenses,
  deleteTestExpenses,
} from "./support/db";

/**
 * Invariantes de la pantalla de Gastos Operativos y Autorizaciones.
 *
 * Plan: `tasks/plan-gastos-autorizaciones.md` · Crítica:
 * `.impeccable/critique/2026-08-18T03-46-00Z__app-dashboard-finance-expenses-page-tsx.md`
 *
 * Los tres primeros casos **arrancan en rojo**: fijan el P0 antes de arreglarlo.
 * Hoy `ROUTE_PERMISSIONS` no tiene entrada para `/dashboard/finance`, así que
 * `hasAccess` cae al comodín `/dashboard` que admite los seis roles; y
 * `GET /api/expenses` toma `branchId` del query string sin pasar por
 * `enforceBranchScope`. Las Tasks 1 y 2 los ponen en verde.
 *
 * Los casos marcados `test.fixme` esperan a tareas posteriores del plan. No se
 * borran: describen el destino.
 */

/** Fecha fija dentro de la ventana, sin depender de la hora a la que corra. */
function enDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Abre un contexto con la sesión de otro rol. El `storageState: undefined` es
 * lo que descarta las cookies de admin que `auth.setup.ts` dejó para todos los
 * specs — sin eso la petición se haría como SUPER_ADMIN y el test pasaría por
 * la razón equivocada. Mismo patrón que `cash-flow.spec.ts:963`.
 */
async function sesionDe(browser: Browser, email: string) {
  const contexto = await browser.newContext({ storageState: undefined });
  const login = await contexto.request.post("/api/auth/sign-in/email", {
    data: { email, password: ADMIN_PASSWORD },
  });
  expect(login.ok(), `no se pudo iniciar sesión como ${email}`).toBe(true);
  return contexto;
}

/**
 * Lee la lista de gastos y exige la forma **nueva** de la respuesta
 * (`{ items, scope, truncated }`, Task 2). Hoy la ruta devuelve un arreglo
 * pelado, así que esto falla a propósito hasta que la Task 2 aterrice.
 */
async function listarGastos(
  request: APIRequestContext,
  branchId?: string
): Promise<{
  items: any[];
  scope: { branchId: string | null; branchName: string | null };
  truncated: boolean;
}> {
  const url = branchId ? `/api/expenses?branchId=${branchId}` : "/api/expenses";
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} respondió ${res.status()}`).toBe(true);

  const json = await res.json();
  expect(json.success).toBe(true);

  expect(
    Array.isArray(json.data),
    "la respuesta sigue siendo un arreglo pelado: falta el alcance aplicado (Task 2)"
  ).toBe(false);
  expect(Array.isArray(json.data?.items)).toBe(true);
  expect(json.data).toHaveProperty("scope");

  return json.data;
}

test.describe("Gastos Operativos y Autorizaciones", () => {
  test.afterEach(async () => {
    await deleteTestExpenses();
  });

  // ── P0: quién puede abrir la pantalla ──────────────────────────────────────

  test("un EMPLEADO no entra al módulo de finanzas ni escribiendo la URL", async ({
    browser,
  }) => {
    // El sidebar ya oculta el enlace, pero eso es cosmético: una URL escrita, un
    // marcador o el `actionUrl` de una notificación aterrizan igual.
    const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const page = await contexto.newPage();
      // `proxy.ts` redirige del lado del servidor, así que `goto` ya aterriza en
      // el destino final. `networkidle` no sirve aquí: el dashboard mantiene
      // sondeos abiertos y la red nunca se queda quieta.
      await page.goto("/dashboard/finance/expenses", { waitUntil: "domcontentloaded" });

      expect(
        page.url(),
        "un EMPLEADO llegó a la pantalla donde se autoriza dinero"
      ).not.toContain("/finance/expenses");
    } finally {
      await contexto.close();
    }
  });

  test("un EMPLEADO tampoco lee el libro por la API", async ({ browser }) => {
    // Cerrar la ruta sin cerrar la API deja la fuga abierta: `fetch` desde la
    // consola no pasa por `proxy.ts` con la misma ruta que el navegador.
    const contexto = await sesionDe(browser, EMPLEADO_EMAIL);
    try {
      const res = await contexto.request.get("/api/expenses");
      expect(res.status(), "la API le entregó el libro a un EMPLEADO").toBe(403);
    } finally {
      await contexto.close();
    }
  });

  // ── P0: alcance de sucursal ────────────────────────────────────────────────

  test("un GERENTE fijado a Condesa no recibe Polanco aunque lo pida", async ({
    browser,
  }) => {
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enDias(5),
      amountCents: 5_000_00,
      description: `${E2E_TAG} renta Polanco fuera de alcance`,
      status: "PENDING_APPROVAL",
    });
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: GERENTE_BRANCH,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enDias(5),
      amountCents: 3_000_00,
      description: `${E2E_TAG} luz Condesa dentro de alcance`,
      status: "PENDING_APPROVAL",
    });

    const contexto = await sesionDe(browser, GERENTE_EMAIL);
    try {
      // Pide explícitamente la sucursal que no le toca.
      const data = await listarGastos(contexto.request, BRANCH_POLANCO);

      const ajenos = data.items.filter((g) => g.branchId !== GERENTE_BRANCH);
      expect(
        ajenos.length,
        `el GERENTE recibió ${ajenos.length} gastos de otras sucursales`
      ).toBe(0);

      // Y el alcance que se le devuelve es el suyo, no el que pidió: rotular
      // cifras del grupo como una sucursal es peor que no tener el filtro.
      expect(data.scope.branchId).toBe(GERENTE_BRANCH);
    } finally {
      await contexto.close();
    }
  });

  test("un ADMIN sin sucursal pedida recibe el grupo, y el alcance lo dice", async ({
    request,
  }) => {
    const data = await listarGastos(request);
    expect(data.scope.branchId).toBeNull();
  });

  // ── Cota asimétrica: la cola completa, el historial acotado ────────────────

  test("la cota del historial no recorta la cola de pendientes", async ({ request }) => {
    // Una aprobación que se quedó fuera del LIMIT es un gasto que nadie ve.
    const RESUELTOS = 240;
    const PENDIENTES = 6;

    await seedManyOperatingExpenses({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enDias(-30),
      cantidad: RESUELTOS,
      status: "PAID",
      etiqueta: "historial",
    });
    await seedManyOperatingExpenses({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enDias(4),
      cantidad: PENDIENTES,
      status: "PENDING_APPROVAL",
      etiqueta: "cola",
    });

    const data = await listarGastos(request, BRANCH_CONDESA);

    const pendientesSembrados = data.items.filter(
      (g) =>
        g.status === "PENDING_APPROVAL" &&
        typeof g.description === "string" &&
        g.description.includes("cola")
    );
    expect(
      pendientesSembrados.length,
      "la cota se comió pendientes: la cola tiene que volver completa"
    ).toBe(PENDIENTES);

    // El historial sí se acota, y la respuesta lo declara para que la pantalla
    // pueda decirlo en voz alta en vez de callarlo.
    const resueltos = data.items.filter((g) => g.status !== "PENDING_APPROVAL");
    expect(resueltos.length).toBeLessThan(RESUELTOS);
    expect(data.truncated).toBe(true);
  });

  // ── Fase 1: que la pantalla conteste una pregunta ──────────────────────────

  test.fixme(
    "la pantalla abre en la cola de pendientes, no en el libro completo",
    async () => {
      // Task 3: `statusFilter` arranca en PENDING_APPROVAL.
    }
  );

  test.fixme("la línea de encabezado suma lo mismo que las filas visibles", async () => {
    // Task 3: "N gastos por autorizar por $X · M vencen esta semana".
  });

  test.fixme("la columna de fecha es 'Vence' y marca los vencidos", async () => {
    // Task 4: hoy la columna rotulada "Fecha" muestra `createdAt`, y `dueDate`
    // —que es lo que decide— está seleccionada, tipada y sin renderizar.
  });

  test.fixme("el alcance aplicado se rotula en pantalla", async () => {
    // Task 5.
  });

  // ── Fase 2: ciclo de vida y bitácora ───────────────────────────────────────

  test.fixme("un gasto APPROVED ofrece pagar y reprogramar en su fila", async () => {
    // Task 6: `ExpenseRowActions` ya existe y la usa cash-flow; esta pantalla no.
  });

  test.fixme("una fila resuelta dice quién autorizó y por qué", async () => {
    // Task 7: el diálogo promete la bitácora dos veces y no se muestra nunca.
  });

  test.fixme("el enlace de la notificación aterriza en la fila correcta", async () => {
    // Task 8: el servicio escribe `?id=` y el hook lee `?focus=`.
  });

  test.fixme("un lote del mismo tramo se aprueba en una confirmación", async () => {
    // Task 9. Mezclar tramos de `requiredApproverRole` tiene que ser imposible.
  });
});
