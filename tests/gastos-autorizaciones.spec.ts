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
  findExpenseByDescription,
  findUserIdByEmail,
  seedExpenseAuthorizationRule,
  deleteExpenseAuthorizationRule,
} from "./support/db";
import {
  approveOperatingExpense,
  rejectOperatingExpense,
} from "../lib/services/expense-service";

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

  let login = await contexto.request.post("/api/auth/sign-in/email", {
    data: { email, password: ADMIN_PASSWORD },
  });

  // better-auth limita `/sign-in/email` a 3 intentos cada 10 segundos, y esos
  // valores por omisión sólo se activan con `NODE_ENV=production` — es decir,
  // al verificar contra `npm run start`, que es como se corre este spec. Con un
  // inicio de sesión por caso, los últimos volvían 429 y el spec se teñía de
  // rojo por el límite y no por los permisos, que es lo que dice estar probando.
  for (let intento = 0; intento < 3 && login.status() === 429; intento++) {
    await new Promise((r) => setTimeout(r, 11_000));
    login = await contexto.request.post("/api/auth/sign-in/email", {
      data: { email, password: ADMIN_PASSWORD },
    });
  }

  expect(
    login.ok(),
    `no se pudo iniciar sesión como ${email} (HTTP ${login.status()})`
  ).toBe(true);
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

/**
 * Auditoría A4 — resolver un gasto respeta la sucursal, y el `UPDATE` es la guarda.
 *
 * `approveOperatingExpense` y `rejectOperatingExpense` sólo acotaban por
 * `companyId`. Un GERENTE fijado a Condesa no *veía* los gastos de Polanco en la
 * lista —eso lo cerró el P0 de arriba— pero con el `expenseId` en la mano los
 * aprobaba igual por API: el filtro estaba en la lectura y no en la escritura,
 * que es donde se decide el dinero.
 *
 * Aparte, el chequeo de estado vivía sólo en el `SELECT` previo. Dos
 * aprobaciones simultáneas lo pasaban las dos y la segunda pisaba `approved_by`
 * y `approval_notes` de la primera: la bitácora terminaba nombrando a quien
 * llegó tarde. La condición `status = 'PENDING_APPROVAL'` en el `WHERE` del
 * `UPDATE` es la única guarda que no tiene ventana entre leer y escribir.
 *
 * Casi todo pega al servicio y corre sin servidor; el último caso usa una sesión
 * real de GERENTE porque el criterio es "ni por API".
 */
test.describe("A4 · aprobar y rechazar respetan la sucursal", () => {
  /** Alcance de un rol fijado a Condesa, tal como lo devuelve `resolveBranchScope`. */
  const SOLO_CONDESA = { kind: "BRANCH", branchId: BRANCH_CONDESA } as const;
  const TODAS = { kind: "ALL" } as const;
  /** Un rol acotado a sucursal que no tiene ninguna asignada. */
  const NINGUNA = { kind: "NONE" } as const;

  /** Aprobador distinto de quien pidió el gasto, para no chocar con la segregación. */
  let aprobadorId = "";
  let reglaId = "";

  test.beforeAll(async () => {
    aprobadorId = await findUserIdByEmail(GERENTE_EMAIL);
    // La base de dev no tiene reglas de autorización sembradas, y sin ninguna el
    // aprobador exigido cae a `OWNER`: un GERENTE se quedaría fuera por el rol y
    // el caso probaría eso en vez de la sucursal. Con la regla, el rol alcanza y
    // lo único que puede negar la aprobación es el alcance.
    reglaId = await seedExpenseAuthorizationRule({
      companyId: COMPANY_ID,
      approverRole: "GERENTE",
      minAmountCents: 0,
      maxAmountCents: 5_000_00,
    });
  });

  test.afterAll(async () => {
    if (reglaId) await deleteExpenseAuthorizationRule(reglaId);
  });

  test.afterEach(async () => {
    await deleteTestExpenses();
  });

  async function gastoPendienteEn(branchId: string, etiqueta: string) {
    const description = `${E2E_TAG} ${etiqueta} ${Date.now()}`;
    const id = await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enDias(5),
      amountCents: 1_200_00,
      description,
      status: "PENDING_APPROVAL",
    });
    return { id, description };
  }

  test("un GERENTE de Condesa no aprueba un gasto de Polanco", async () => {
    const gasto = await gastoPendienteEn(BRANCH_POLANCO, "renta Polanco");

    await expect(
      approveOperatingExpense(gasto.id, COMPANY_ID, SOLO_CONDESA, aprobadorId, "GERENTE")
    ).rejects.toThrow(/otra sucursal/i);

    // Y el gasto sigue esperando a quien sí le toca.
    const fila = await findExpenseByDescription(gasto.description);
    expect(fila.status).toBe("PENDING_APPROVAL");
    expect(fila.approved_by).toBeNull();
  });

  test("un GERENTE de Condesa tampoco rechaza un gasto de Polanco", async () => {
    // Rechazar es tan definitivo como aprobar: deja el gasto sin pagar y con un
    // motivo firmado por alguien que no responde por esa sucursal.
    const gasto = await gastoPendienteEn(BRANCH_POLANCO, "luz Polanco");

    await expect(
      rejectOperatingExpense(
        gasto.id,
        COMPANY_ID,
        SOLO_CONDESA,
        aprobadorId,
        "GERENTE",
        "no me consta"
      )
    ).rejects.toThrow(/otra sucursal/i);

    const fila = await findExpenseByDescription(gasto.description);
    expect(fila.status).toBe("PENDING_APPROVAL");
    expect(fila.approval_notes).toBeNull();
  });

  test("un GERENTE sí resuelve lo de su propia sucursal", async () => {
    // El otro lado del cambio: cerrar de más deja sin trabajar a quien autoriza
    // el gasto de su sucursal todos los días.
    const gasto = await gastoPendienteEn(BRANCH_CONDESA, "mantenimiento Condesa");

    const resuelto = await approveOperatingExpense(
      gasto.id,
      COMPANY_ID,
      SOLO_CONDESA,
      aprobadorId,
      "GERENTE"
    );

    expect(resuelto.status).toBe("APPROVED");
    expect(resuelto.approvedBy).toBe(aprobadorId);
  });

  test("un ADMIN sin sucursal fijada conserva las dos sucursales", async () => {
    const polanco = await gastoPendienteEn(BRANCH_POLANCO, "ADMIN sobre Polanco");
    const condesa = await gastoPendienteEn(BRANCH_CONDESA, "ADMIN sobre Condesa");

    expect(
      (await approveOperatingExpense(polanco.id, COMPANY_ID, TODAS, aprobadorId, "ADMIN")).status
    ).toBe("APPROVED");
    expect(
      (
        await rejectOperatingExpense(
          condesa.id,
          COMPANY_ID,
          TODAS,
          aprobadorId,
          "ADMIN",
          "duplicado"
        )
      ).status
    ).toBe("REJECTED");
  });

  test("un rol de sucursal sin sucursal asignada no resuelve nada", async () => {
    // `kind: "NONE"` es el caso que `resolveBranchScope` existe para no
    // confundir con "todas": fallar abierto aquí es firmar cualquier gasto.
    const gasto = await gastoPendienteEn(BRANCH_CONDESA, "sin alcance");

    await expect(
      approveOperatingExpense(gasto.id, COMPANY_ID, NINGUNA, aprobadorId, "GERENTE")
    ).rejects.toThrow(/sucursal/i);

    expect((await findExpenseByDescription(gasto.description)).status).toBe(
      "PENDING_APPROVAL"
    );
  });

  test("aprobar dos veces: la segunda falla por el estado y no pisa la bitácora", async () => {
    const gasto = await gastoPendienteEn(BRANCH_CONDESA, "doble aprobación");

    await approveOperatingExpense(
      gasto.id,
      COMPANY_ID,
      TODAS,
      aprobadorId,
      "ADMIN",
      "autorizado por dirección"
    );

    await expect(
      approveOperatingExpense(
        gasto.id,
        COMPANY_ID,
        TODAS,
        USER_SUPER_ADMIN,
        "SUPER_ADMIN",
        "segunda firma"
      )
    ).rejects.toThrow(/APPROVED/);

    const fila = await findExpenseByDescription(gasto.description);
    expect(fila.approved_by, "la segunda aprobación se quedó con la bitácora").toBe(
      aprobadorId
    );
    expect(fila.approval_notes).toBe("autorizado por dirección");
  });

  test("dos aprobaciones simultáneas: una gana y la bitácora nombra a una sola", async () => {
    // El `SELECT` previo no es guarda: las dos lo pasan. La condición de estado
    // dentro del `UPDATE` es la que no tiene ventana entre leer y escribir.
    const gasto = await gastoPendienteEn(BRANCH_CONDESA, "carrera de aprobación");

    const resultados = await Promise.allSettled([
      approveOperatingExpense(gasto.id, COMPANY_ID, TODAS, aprobadorId, "ADMIN", "primera"),
      approveOperatingExpense(
        gasto.id,
        COMPANY_ID,
        TODAS,
        USER_SUPER_ADMIN,
        "SUPER_ADMIN",
        "segunda"
      ),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);

    const fila = await findExpenseByDescription(gasto.description);
    expect(["primera", "segunda"]).toContain(fila.approval_notes);
  });

  test("un GERENTE de Condesa recibe 403 sobre Polanco por API, no sólo en la UI", async ({
    browser,
  }) => {
    const aprobar = await gastoPendienteEn(BRANCH_POLANCO, "API aprobar Polanco");
    const rechazar = await gastoPendienteEn(BRANCH_POLANCO, "API rechazar Polanco");

    const contexto = await sesionDe(browser, GERENTE_EMAIL);
    try {
      const resAprobar = await contexto.request.post("/api/expenses/approvals", {
        data: { expenseId: aprobar.id },
      });
      expect(resAprobar.status(), "un GERENTE aprobó un gasto de otra sucursal").toBe(403);

      const resRechazar = await contexto.request.post("/api/expenses/reject", {
        data: { expenseId: rechazar.id, reason: "no me consta" },
      });
      expect(resRechazar.status(), "un GERENTE rechazó un gasto de otra sucursal").toBe(403);

      // Los dos siguen pendientes para quien sí responde por Polanco.
      expect((await findExpenseByDescription(aprobar.description)).status).toBe(
        "PENDING_APPROVAL"
      );
      expect((await findExpenseByDescription(rechazar.description)).status).toBe(
        "PENDING_APPROVAL"
      );
    } finally {
      await contexto.close();
    }
  });
});
