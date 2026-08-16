import { test, expect, type APIRequestContext } from "@playwright/test";
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
  deleteCashFlowAssumptions,
  deleteTestExpenses,
  deleteTestSalesCuts,
  seedCashFlowAssumption,
  seedOperatingExpense,
  seedSalesCutHistory,
} from "./support/db";
import { addCalendarDays, localDateString } from "../lib/workflows/today";

/**
 * Fase 0 — invariantes aritméticos del Panel de Flujo de Efectivo.
 *
 * La pantalla `/dashboard/finance/cash-flow` le dice a una dueña si le alcanza
 * para la nómina. Antes de mejorar cómo se ve, los números tienen que cuadrar
 * consigo mismos: la barra "Salidas" de un día, el total de su semana y el
 * "Total egresos" del período salen los tres del mismo payload y hoy se
 * contradicen (`tasks/plan.md`, Fase 0).
 *
 * Este spec no valida que las cifras sean *correctas* contra la realidad del
 * negocio — no hay fuente de verdad para eso — sino que sean *consistentes*
 * entre sí. Es lo que hace falta para que las Tasks 1-5 no se rompan entre ellas.
 */

const VENTANA_DIAS = 30;

interface DiaProyectado {
  date: string;
  /** `null` cuando no hay cortes de venta de los que estimar (Task 2). */
  projectedInflowCents: number | null;
  projectedOutflowCents: number;
  netFlowCents: number | null;
  cumulativeBalanceCents: number | null;
  outflowItemsCount: number;
}

interface Partida {
  id: string;
  date: string;
  amountCents: number;
  category: string;
  source: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE";
}

interface Comprometido {
  purchaseOrdersCount: number;
  purchaseOrdersTotalCents: number;
  invoicesCount: number;
  invoicesTotalCents: number;
}

interface Semana {
  key: string;
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalOutflowCents: number;
  itemCount: number;
  isHeavy: boolean;
  dayCount: number;
  isPartial: boolean;
}

interface Proyeccion {
  days: DiaProyectado[];
  outflowItems: Partida[];
  weeklyAggregation: Semana[];
  overdueItems: Partida[];
  upcomingItems: Partida[];
  inflow: {
    basis: "SEASONAL" | "AVERAGE" | "NONE";
    historyDays: number;
    lookbackDays: number;
    avgDailyInflowCents: number | null;
  };
  procurementCommitments: Comprometido & { outsideWindow: Comprometido };
  scope: { branchId: string | null; branchName: string | null };
  unassignedInvoicesCount: number;
  initialBalanceCents: number | null;
  openingBalance: {
    source: "BRANCH" | "COMPANY" | "NONE";
    asOfDate: string | null;
    ageInDays: number | null;
    isStale: boolean;
  };
}

/** Día de la semana (0=domingo) de un `YYYY-MM-DD`, sin arrastrar zona horaria. */
function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

async function obtenerProyeccion(
  request: APIRequestContext,
  dias = VENTANA_DIAS,
  branchId?: string
): Promise<Proyeccion> {
  const url = `/api/finance/cash-flow?days=${dias}${branchId ? `&branchId=${branchId}` : ""}`;
  const res = await request.get(url);
  expect(res.ok(), `La API respondió ${res.status()}`).toBe(true);
  const json = await res.json();
  expect(json.success).toBe(true);
  return json.data as Proyeccion;
}

/**
 * Fechas de la ventana en las que el servicio agrega nómina quincenal (día 15 o
 * 30 del mes). Se devuelven en las dos lecturas posibles —fecha local y corte
 * UTC del mismo instante— porque el servicio hoy mezcla ambas: elige el día con
 * `getDate()` (local) pero rotula con `toISOString()` (UTC). Sembrar en las dos
 * garantiza la colisión que destapa el doble conteo, y deja el spec en pie
 * cuando la Task 4 unifique las dos lecturas en la zona de la sucursal.
 */
function fechasDeNominaEnLaVentana(dias = VENTANA_DIAS): string[] {
  const hoy = new Date();
  const fechas = new Set<string>();

  for (let i = 0; i < dias; i++) {
    const dia = new Date(hoy.getTime() + i * 24 * 60 * 60 * 1000);
    const delMes = dia.getDate();
    if (delMes !== 15 && delMes !== 30 && !(delMes === 28 && dia.getMonth() === 1)) {
      continue;
    }
    fechas.add(dia.toISOString().slice(0, 10));
    const local = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(delMes).padStart(2, "0")}`;
    fechas.add(local);
  }

  return [...fechas];
}

/** Suma de las partidas cuya fecha cae dentro del rango (inclusive). */
function sumaEnRango(partidas: Partida[], desde: string, hasta: string): number {
  return partidas
    .filter((p) => p.date >= desde && p.date <= hasta)
    .reduce((total, p) => total + p.amountCents, 0);
}

test.describe("Fase 0 · aritmética del flujo de efectivo", () => {
  test.beforeAll(async () => {
    // Un gasto en cada día de nómina de la ventana. Sin esta colisión el doble
    // conteo no se manifiesta: cuando la nómina cae en una fecha sin ningún otro
    // egreso, el mapa por fecha todavía no existe y el monto se suma una vez.
    await deleteTestExpenses();
    for (const fecha of fechasDeNominaEnLaVentana()) {
      await seedOperatingExpense({
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
        requestedBy: USER_SUPER_ADMIN,
        dueDate: fecha,
        amountCents: 123_400,
        description: `${E2E_TAG} Gasto en día de nómina ${fecha}`,
      });
    }
  });

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("los días proyectados suman exactamente las partidas de la ventana", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);
    expect(proyeccion.days.length).toBe(VENTANA_DIAS);

    const primerDia = proyeccion.days[0].date;
    const ultimoDia = proyeccion.days[proyeccion.days.length - 1].date;

    const sumaDeDias = proyeccion.days.reduce((t, d) => t + d.projectedOutflowCents, 0);
    const sumaDePartidas = sumaEnRango(proyeccion.outflowItems, primerDia, ultimoDia);

    // El día que comparte fecha con la nómina la cuenta dos veces: el mapa por
    // fecha ya la incluye y el cálculo vuelve a sumarle `payrollExtra`.
    expect(sumaDeDias).toBe(sumaDePartidas);
  });

  test("el conteo de partidas del día coincide con las partidas de esa fecha", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);

    const partidasPorFecha = new Map<string, number>();
    for (const partida of proyeccion.outflowItems) {
      partidasPorFecha.set(partida.date, (partidasPorFecha.get(partida.date) ?? 0) + 1);
    }

    for (const dia of proyeccion.days) {
      expect(dia.outflowItemsCount, `Conteo del ${dia.date}`).toBe(
        partidasPorFecha.get(dia.date) ?? 0
      );
    }
  });

  test("ninguna partida cae fuera del rango de días proyectados", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);
    const primerDia = proyeccion.days[0].date;
    const ultimoDia = proyeccion.days[proyeccion.days.length - 1].date;

    // La ventana de consulta llega a `hoy + días` pero el timeline solo emite
    // `días` filas, así que una partida en el último día se cobra en el total
    // del período y en ningún día de la gráfica.
    const huerfanas = proyeccion.outflowItems.filter(
      (p) => p.date < primerDia || p.date > ultimoDia
    );
    expect(huerfanas.map((p) => `${p.date} · ${p.id}`)).toEqual([]);
  });

  test("cada semana suma exactamente los días que la componen", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);
    expect(proyeccion.weeklyAggregation.length).toBeGreaterThan(0);

    for (const semana of proyeccion.weeklyAggregation) {
      const diasDeLaSemana = proyeccion.days.filter(
        (d) => d.date >= semana.startDate && d.date <= semana.endDate
      );
      const sumaDeSusDias = diasDeLaSemana.reduce(
        (t, d) => t + d.projectedOutflowCents,
        0
      );
      expect(sumaDeSusDias, `Total de ${semana.weekLabel}`).toBe(semana.totalOutflowCents);
    }
  });

  test("las semanas cubren la ventana completa sin traslaparse", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);

    const cubiertos = new Set<string>();
    for (const semana of proyeccion.weeklyAggregation) {
      for (const dia of proyeccion.days) {
        if (dia.date < semana.startDate || dia.date > semana.endDate) continue;
        expect(cubiertos.has(dia.date), `${dia.date} contado en dos semanas`).toBe(false);
        cubiertos.add(dia.date);
      }
    }

    expect(cubiertos.size).toBe(proyeccion.days.length);
  });

  test("sin entradas estimadas ningún día afirma un saldo", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);

    // Invariante que no depende de si la base tiene cortes o no: restar egresos
    // contra un cero inventado es exactamente lo que pintaba de rojo la pantalla
    // de estreno de un inquilino nuevo.
    for (const dia of proyeccion.days) {
      if (dia.projectedInflowCents !== null) continue;
      expect(dia.netFlowCents, `Flujo neto del ${dia.date}`).toBeNull();
      expect(dia.cumulativeBalanceCents, `Saldo del ${dia.date}`).toBeNull();
    }
  });
});

/**
 * Task 8 — el saldo inicial se captura, no se adivina.
 *
 * Era `INITIAL_BALANCE = 2000000`: los mismos $20,000 para un café de tres
 * sucursales y para un grupo hotelero de quince, renderizados en negritas como
 * "Saldo inicial proyectado". "Saldo mínimo", las bandas de color y "Te alcanza
 * para N días" heredaban todos esa invención.
 */
test.describe("Task 8 · saldo inicial capturado", () => {
  test.beforeAll(async () => {
    await deleteCashFlowAssumptions(COMPANY_ID);
  });

  test.afterAll(async () => {
    await deleteCashFlowAssumptions(COMPANY_ID);
  });

  test("sin captura no se inventa un saldo ni se proyecta sobre cero", async ({ request }) => {
    await deleteCashFlowAssumptions(COMPANY_ID);
    const proyeccion = await obtenerProyeccion(request);

    expect(proyeccion.initialBalanceCents).toBeNull();
    expect(proyeccion.openingBalance.source).toBe("NONE");
    // Y no hay constante de respaldo escondida.
    expect(proyeccion.initialBalanceCents).not.toBe(2_000_000);

    // Sin punto de partida no hay trayectoria: restar egresos contra cero
    // pintaría de rojo el mes entero por un dato que nadie dio.
    expect(proyeccion.days.every((d) => d.cumulativeBalanceCents === null)).toBe(true);
  });

  test("el supuesto de la sucursal gana sobre el del grupo", async ({ request }) => {
    await deleteCashFlowAssumptions(COMPANY_ID);
    await seedCashFlowAssumption({
      companyId: COMPANY_ID,
      branchId: null,
      openingBalanceCents: 5_000_000,
    });
    await seedCashFlowAssumption({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      openingBalanceCents: 7_777_700,
    });

    const grupo = await obtenerProyeccion(request, 30);
    expect(grupo.initialBalanceCents).toBe(5_000_000);
    expect(grupo.openingBalance.source).toBe("COMPANY");

    const condesa = await obtenerProyeccion(request, 30, BRANCH_CONDESA);
    expect(condesa.initialBalanceCents).toBe(7_777_700);
    expect(condesa.openingBalance.source).toBe("BRANCH");

    // Una sucursal sin supuesto propio hereda el del grupo, no el de su vecina.
    const polanco = await obtenerProyeccion(request, 30, BRANCH_POLANCO);
    expect(polanco.initialBalanceCents).toBe(5_000_000);
    expect(polanco.openingBalance.source).toBe("COMPANY");
  });

  test("el saldo capturado es de verdad el punto de partida", async ({ request }) => {
    await deleteCashFlowAssumptions(COMPANY_ID);
    await seedCashFlowAssumption({
      companyId: COMPANY_ID,
      branchId: null,
      openingBalanceCents: 5_000_000,
    });
    const conCinco = await obtenerProyeccion(request, 30);

    await deleteCashFlowAssumptions(COMPANY_ID);
    await seedCashFlowAssumption({
      companyId: COMPANY_ID,
      branchId: null,
      openingBalanceCents: 9_000_000,
    });
    const conNueve = await obtenerProyeccion(request, 30);

    // Los egresos no cambiaron, así que toda la trayectoria se desplaza
    // exactamente la diferencia del saldo capturado.
    const saldoDe = (p: Proyeccion) =>
      p.days.map((d) => d.cumulativeBalanceCents).filter((s) => s !== null);
    const a = saldoDe(conCinco);
    const b = saldoDe(conNueve);
    if (a.length > 0 && b.length > 0) {
      expect(b[0]! - a[0]!).toBe(4_000_000);
    }
  });

  test("un saldo viejo se usa, pero se marca para actualizarlo", async ({ request }) => {
    await deleteCashFlowAssumptions(COMPANY_ID);
    await seedCashFlowAssumption({
      companyId: COMPANY_ID,
      branchId: null,
      openingBalanceCents: 5_000_000,
      asOfDaysAgo: 9,
    });

    const viejo = await obtenerProyeccion(request, 30);
    // Se usa —nueve días es mejor que nada— con la antigüedad a la vista.
    expect(viejo.initialBalanceCents).toBe(5_000_000);
    expect(viejo.openingBalance.ageInDays).toBe(9);
    expect(viejo.openingBalance.isStale).toBe(true);

    await deleteCashFlowAssumptions(COMPANY_ID);
    await seedCashFlowAssumption({
      companyId: COMPANY_ID,
      branchId: null,
      openingBalanceCents: 5_000_000,
      asOfDaysAgo: 3,
    });
    const fresco = await obtenerProyeccion(request, 30);
    expect(fresco.openingBalance.ageInDays).toBe(3);
    expect(fresco.openingBalance.isStale).toBe(false);
  });
});

/**
 * Task 7 — horizonte y estado de pantalla en la URL.
 *
 * `days=30` estaba fijo en la página y editar la URL no hacía nada, porque la
 * página armaba la suya. No había control de horizonte ni forma de mandarle a
 * alguien la vista exacta, y los dos colapsos eran `useState` local que se
 * reiniciaba en cada cambio de sucursal.
 *
 * Estos casos manejan la pantalla de verdad, no la API: es lo único que prueba
 * que el estado sobrevive al remonte.
 */
test.describe("Task 7 · estado de pantalla en la URL", () => {
  // La página se compila en el primer golpe del dev server.
  test.setTimeout(180_000);

  const PANTALLA = "/dashboard/finance/cash-flow";
  // `CardTitle` de shadcn renderiza un `div`, no un heading: se busca por texto.
  const horizonteVisible = (page: import("@playwright/test").Page) =>
    page.getByText(/Proyección de Entradas vs Salidas \(Próximos \d+ días\)/);

  test("el horizonte por defecto queda escrito en la URL", async ({ page }) => {
    await page.goto(PANTALLA);
    await expect(horizonteVisible(page)).toBeVisible();

    // La página espeja su estado: la URL deja de estar vacía y se puede copiar.
    await expect(page).toHaveURL(/days=30/);
    await expect(horizonteVisible(page)).toContainText("30 días");
  });

  test("cambiar el horizonte reproyecta y lo declara en toda la pantalla", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30`);
    await expect(horizonteVisible(page)).toContainText("30 días");

    await page
      .getByRole("group", { name: "Horizonte de proyección" })
      .getByRole("button", { name: "7 días" })
      .click();

    await expect(page).toHaveURL(/days=7/);
    // La gráfica ya no se queda en 14 mientras el resto dice otra cosa: las
    // tres ventanas de la pantalla describen la misma.
    await expect(horizonteVisible(page)).toContainText("7 días");
    await expect(page.getByRole("heading", { name: /^Resumen 7 días$/ })).toBeVisible();
  });

  test("pegar la URL reproduce la misma vista", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=60`);
    await expect(horizonteVisible(page)).toContainText("60 días");
    await expect(
      page
        .getByRole("group", { name: "Horizonte de proyección" })
        .getByRole("button", { name: "60 días" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("un horizonte inválido cae al default en vez de romperse", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=999`);
    await expect(horizonteVisible(page)).toContainText("30 días");
    await expect(page).toHaveURL(/days=30/);
  });

  test("los colapsos viven en la URL y sobreviven al remonte", async ({ page }) => {
    // La tarjeta de categorías sólo colapsa a partir de 4, y la base sembrada
    // sólo produce dos (Nómina y Compras). Sin estos gastos no habría colapso
    // que probar.
    const enTresDias = addCalendarDays(
      localDateString(new Date(), "America/Mexico_City"),
      3
    );
    const categorias = [
      "RENTA",
      "SERVICIOS",
      "MANTENIMIENTO",
      "PUBLICIDAD",
      "SERVICIOS_PROFESIONALES",
    ];
    for (const [i, categoria] of categorias.entries()) {
      await seedOperatingExpense({
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
        requestedBy: USER_SUPER_ADMIN,
        dueDate: enTresDias,
        amountCents: 100_000 * (i + 1),
        description: `${E2E_TAG} Gasto ${categoria}`,
        category: categoria,
      });
    }

    try {
      await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
      await expect(horizonteVisible(page)).toBeVisible();

      // Colapsado: el botón invita a ver todas.
      const verTodas = page.getByRole("button", { name: /Ver todas/ });
      await expect(verTodas).toBeVisible();
      await verTodas.click();

      // Al expandir, el estado se escribe en la URL en vez de quedarse en
      // `useState`, donde se perdía en cada cambio de sucursal.
      await expect(page).toHaveURL(/categorias=todas/);
      const verMenos = page.getByRole("button", { name: /Colapsar/ });
      await expect(verMenos).toBeVisible();

      // Y sobrevive al remonte: es lo que hace que el enlace sea compartible.
      await page.reload();
      await expect(page.getByRole("button", { name: /Colapsar/ })).toBeVisible();
      await expect(page).toHaveURL(/categorias=todas/);
    } finally {
      await deleteTestExpenses();
    }
  });
});

/**
 * Task 6 — alcance por sucursal.
 *
 * La página mandaba `branchId` y la ruta lo tiraba: una dueña que cambiaba a
 * "Polanco" en el selector del encabezado veía las cifras del grupo entero
 * etiquetadas como esa sucursal, y actuaba sobre ellas. Es peor que una función
 * faltante — es un número equivocado presentado con confianza en la única
 * pantalla cuyo nombre promete alertar.
 */
test.describe("Task 6 · alcance por sucursal", () => {
  test.beforeAll(async () => {
    await deleteTestExpenses();
    // Un gasto distinto en cada sucursal: sin esto las dos podrían coincidir
    // por casualidad y el test pasaría sin probar nada.
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 3),
      amountCents: 1_111_100,
      description: `${E2E_TAG} Gasto solo de Condesa`,
    });
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 3),
      amountCents: 2_222_200,
      description: `${E2E_TAG} Gasto solo de Polanco`,
    });
  });

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("cambiar de sucursal cambia las cifras", async ({ request }) => {
    const condesa = await obtenerProyeccion(request, 30, BRANCH_CONDESA);
    const polanco = await obtenerProyeccion(request, 30, BRANCH_POLANCO);
    const grupo = await obtenerProyeccion(request, 30);

    const total = (p: Proyeccion) =>
      p.days.reduce((t, d) => t + d.projectedOutflowCents, 0);

    expect(total(condesa)).not.toBe(total(polanco));
    expect(total(grupo)).not.toBe(total(condesa));

    // Y cada una ve lo suyo, no lo de la otra.
    const descripciones = (p: Proyeccion) => p.outflowItems.map((i) => i.description);
    expect(descripciones(condesa)).toContain(`${E2E_TAG} Gasto solo de Condesa`);
    expect(descripciones(condesa)).not.toContain(`${E2E_TAG} Gasto solo de Polanco`);
    expect(descripciones(polanco)).toContain(`${E2E_TAG} Gasto solo de Polanco`);
    expect(descripciones(polanco)).not.toContain(`${E2E_TAG} Gasto solo de Condesa`);
  });

  test("el payload declara siempre para qué alcance son los números", async ({ request }) => {
    const grupo = await obtenerProyeccion(request, 30);
    expect(grupo.scope.branchId).toBeNull();
    expect(grupo.scope.branchName).toBeNull();

    const condesa = await obtenerProyeccion(request, 30, BRANCH_CONDESA);
    expect(condesa.scope.branchId).toBe(BRANCH_CONDESA);
    // Con nombre: la píldora dice "Condesa", no un UUID.
    expect(condesa.scope.branchName).toBeTruthy();
  });

  test("un GERENTE queda fijado a su sucursal aunque pida otra", async ({ browser }) => {
    // Contexto limpio: el storageState compartido es de SUPER_ADMIN, que sí
    // puede pedir cualquier sucursal.
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(login.ok(), `Login de GERENTE respondió ${login.status()}`).toBe(true);

      // Juan es GERENTE de Condesa y pide Polanco.
      const res = await contexto.request.get(
        `/api/finance/cash-flow?days=30&branchId=${BRANCH_POLANCO}`
      );
      expect(res.ok(), `La API respondió ${res.status()}`).toBe(true);
      const proyeccion = (await res.json()).data as Proyeccion;

      // `enforceBranchScope` le devuelve la suya, y el payload lo declara: la
      // pantalla rotula el alcance aplicado, no el solicitado.
      expect(proyeccion.scope.branchId).toBe(GERENTE_BRANCH);
      expect(proyeccion.scope.branchId).not.toBe(BRANCH_POLANCO);
      expect(proyeccion.outflowItems.map((i) => i.description)).not.toContain(
        `${E2E_TAG} Gasto solo de Polanco`
      );
    } finally {
      await contexto.close();
    }
  });

  test("las facturas sin sucursal se excluyen y se declaran", async ({ request }) => {
    const grupo = await obtenerProyeccion(request, 30);
    const condesa = await obtenerProyeccion(request, 30, BRANCH_CONDESA);

    // En alcance de grupo no se excluye nada, así que el conteo es cero.
    expect(grupo.unassignedInvoicesCount).toBe(0);
    // Con sucursal, el conteo existe (aunque sea 0 con la semilla actual) y
    // nunca es negativo: es la cifra que la pantalla declara.
    expect(condesa.unassignedInvoicesCount).toBeGreaterThanOrEqual(0);
  });

  test("los invariantes de la Fase 0 se sostienen con alcance de sucursal", async ({
    request,
  }) => {
    const condesa = await obtenerProyeccion(request, 30, BRANCH_CONDESA);

    const primerDia = condesa.days[0].date;
    const ultimoDia = condesa.days[condesa.days.length - 1].date;
    expect(condesa.days.reduce((t, d) => t + d.projectedOutflowCents, 0)).toBe(
      sumaEnRango(condesa.outflowItems, primerDia, ultimoDia)
    );

    for (const semana of condesa.weeklyAggregation) {
      const suma = condesa.days
        .filter((d) => d.date >= semana.startDate && d.date <= semana.endDate)
        .reduce((t, d) => t + d.projectedOutflowCents, 0);
      expect(suma, semana.weekLabel).toBe(semana.totalOutflowCents);
    }
  });
});

/**
 * Task 5 — la tira "Fuentes de egresos" contra la proyección.
 *
 * Sumaba TODAS las OC comprometidas y TODAS las facturas pendientes, incluidas
 * las que vencen fuera de la ventana, mientras la proyección sólo admite las de
 * adentro: dos cifras en la misma pantalla afirmando describir la misma
 * proyección y sin coincidir nunca.
 */
test.describe("Task 5 · comprometido dentro y fuera de la ventana", () => {
  test("la tira de fuentes describe exactamente lo que la proyección admitió", async ({
    request,
  }) => {
    const proyeccion = await obtenerProyeccion(request);
    const comprometido = proyeccion.procurementCommitments;

    const primerDia = proyeccion.days[0].date;
    const ultimoDia = proyeccion.days[proyeccion.days.length - 1].date;
    const admitidas = (fuente: Partida["source"]) =>
      proyeccion.outflowItems.filter(
        (p) => p.source === fuente && p.date >= primerDia && p.date <= ultimoDia
      );

    const ocs = admitidas("PURCHASE_ORDER");
    expect(comprometido.purchaseOrdersCount).toBe(ocs.length);
    expect(comprometido.purchaseOrdersTotalCents).toBe(
      ocs.reduce((t, p) => t + p.amountCents, 0)
    );

    const facturas = admitidas("PROCUREMENT_INVOICE");
    expect(comprometido.invoicesCount).toBe(facturas.length);
    expect(comprometido.invoicesTotalCents).toBe(
      facturas.reduce((t, p) => t + p.amountCents, 0)
    );
  });

  test("lo que vence fuera de la ventana se declara, no se mezcla", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);
    const { outsideWindow } = proyeccion.procurementCommitments;

    // El bloque existe siempre, aunque esté en ceros: la pantalla necesita poder
    // decir "no hay nada más allá" con la misma confianza que "hay $X".
    expect(outsideWindow).toBeDefined();
    expect(outsideWindow.purchaseOrdersCount).toBeGreaterThanOrEqual(0);
    expect(outsideWindow.invoicesCount).toBeGreaterThanOrEqual(0);

    // Y no se cuela en la proyección: ninguna partida admitida cae fuera.
    const primerDia = proyeccion.days[0].date;
    const ultimoDia = proyeccion.days[proyeccion.days.length - 1].date;
    const fugadas = proyeccion.outflowItems.filter(
      (p) => p.date < primerDia || p.date > ultimoDia
    );
    expect(fugadas.map((p) => `${p.date} · ${p.source}`)).toEqual([]);
  });
});

/**
 * Task 4 — la frontera del día en la zona de la sucursal.
 *
 * `toISOString().slice(0, 10)` calcula en UTC. En UTC-6, después de las 6pm
 * local —la hora a la que una dueña revisa el dinero— "hoy" se volvía mañana:
 * la ventana se recorría un día completo y las partidas saltaban entre
 * "vencido" y "próximo" según la hora a la que se abriera la pantalla.
 *
 * Son funciones puras: se prueban directo, sin servidor ni base de datos.
 */
test.describe("Task 4 · frontera de fecha", () => {
  // 2026-08-16T01:00:00Z son las 19:00 del 15 de agosto en Ciudad de México.
  const CAIDA_DE_LA_TARDE = new Date("2026-08-16T01:00:00Z");

  test("a las 19:00 en Ciudad de México, hoy sigue siendo hoy", () => {
    expect(localDateString(CAIDA_DE_LA_TARDE, "America/Mexico_City")).toBe("2026-08-15");

    // La lectura que hacía el servicio, para dejar el contraste asentado.
    expect(CAIDA_DE_LA_TARDE.toISOString().slice(0, 10)).toBe("2026-08-16");
  });

  test("cada sucursal lee su propio día", () => {
    // Tijuana (UTC-7) va una hora atrás de Ciudad de México; Cancún (UTC-5),
    // una adelante. A las 19:00 CDMX las tres siguen en el mismo día, pero a
    // las 23:30 CDMX Cancún ya cambió de fecha.
    const casiMedianoche = new Date("2026-08-16T05:30:00Z"); // 23:30 CDMX
    expect(localDateString(casiMedianoche, "America/Tijuana")).toBe("2026-08-15");
    expect(localDateString(casiMedianoche, "America/Mexico_City")).toBe("2026-08-15");
    expect(localDateString(casiMedianoche, "America/Cancun")).toBe("2026-08-16");
  });

  test("una zona inválida cae al default en vez de reventar", () => {
    expect(localDateString(CAIDA_DE_LA_TARDE, "No/Existe")).toBe("2026-08-15");
    expect(localDateString(CAIDA_DE_LA_TARDE, null)).toBe("2026-08-15");
  });

  test("sumar días es aritmética de calendario, no de milisegundos", () => {
    expect(addCalendarDays("2026-08-15", 1)).toBe("2026-08-16");
    expect(addCalendarDays("2026-08-15", -90)).toBe("2026-05-17");
    // Fin de mes, fin de año y año bisiesto: los tres saltos que rompen la
    // aritmética ingenua.
    expect(addCalendarDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  test("la ventana proyectada empieza hoy en la zona de la operación", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request);
    const hoyLocal = localDateString(new Date(), "America/Mexico_City");
    expect(proyeccion.days[0].date).toBe(hoyLocal);
  });
});

/**
 * Task 3 — la semana parcial del final de la ventana.
 *
 * `floor(i/7)+1` sobre 30 días emite cinco semanas: la última cubre dos días.
 * Antes se le imprimía igual un rango de siete y entraba a la mediana, jalándola
 * hacia abajo y marcando como "pesada" cualquier semana normal.
 */
test.describe("Task 3 · semanas parciales", () => {
  test("la semana final declara los días que de verdad cubre", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request, 30);

    expect(proyeccion.weeklyAggregation.length).toBe(5);

    const ultima = proyeccion.weeklyAggregation[4];
    expect(ultima.dayCount).toBe(2);
    expect(ultima.isPartial).toBe(true);
    // La etiqueta ya no promete un rango de siete días: termina donde termina la
    // ventana proyectada.
    expect(ultima.endDate).toBe(proyeccion.days[proyeccion.days.length - 1].date);

    // Las cuatro primeras son completas.
    for (const semana of proyeccion.weeklyAggregation.slice(0, 4)) {
      expect(semana.dayCount, semana.weekLabel).toBe(7);
      expect(semana.isPartial, semana.weekLabel).toBe(false);
    }
  });

  test("una semana parcial nunca se marca pesada", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request, 30);
    const parcialesPesadas = proyeccion.weeklyAggregation.filter(
      (s) => s.isPartial && s.isHeavy
    );
    expect(parcialesPesadas.map((s) => s.weekLabel)).toEqual([]);
  });

  for (const dias of [7, 30, 60]) {
    test(`con ${dias} días las semanas cubren la ventana exactamente`, async ({ request }) => {
      const proyeccion = await obtenerProyeccion(request, dias);

      // Ni una tarjeta de más ni una de menos: el número de semanas es el que la
      // rejilla tiene que acomodar.
      expect(proyeccion.weeklyAggregation.length).toBe(Math.ceil(dias / 7));

      const diasCubiertos = proyeccion.weeklyAggregation.reduce(
        (t, s) => t + s.dayCount,
        0
      );
      expect(diasCubiertos).toBe(dias);
      expect(proyeccion.weeklyAggregation.every((s) => s.dayCount >= 1 && s.dayCount <= 7)).toBe(
        true
      );

      // El rango declarado tiene que corresponder al número de días declarado.
      for (const semana of proyeccion.weeklyAggregation) {
        const enElRango = proyeccion.days.filter(
          (d) => d.date >= semana.startDate && d.date <= semana.endDate
        );
        expect(enElRango.length, semana.weekLabel).toBe(semana.dayCount);
      }
    });
  }
});

/**
 * Task 2 — de dónde salen las entradas proyectadas.
 *
 * La compañía sembrada no tiene un solo corte de venta, así que ejercita la
 * rama `NONE` tal cual está; la estacionalidad exige sembrar historial.
 */
test.describe("Task 2 · base de las entradas proyectadas", () => {
  test.beforeAll(async () => {
    await deleteTestSalesCuts();
  });

  test.afterAll(async () => {
    await deleteTestSalesCuts();
  });

  test("un inquilino sin cortes de venta no proyecta saldo negativo", async ({ request }) => {
    await deleteTestSalesCuts();
    const proyeccion = await obtenerProyeccion(request);

    // El caso solo existe si la base no trae cortes propios. Hoy `pnpm seed` no
    // siembra ninguno; si algún día lo hace, esto se salta con la razón a la
    // vista en vez de fallar por un cambio de datos que no es el sujeto.
    test.skip(
      proyeccion.inflow.historyDays > 0,
      "La base sembrada ya trae cortes de venta propios"
    );

    expect(proyeccion.inflow.basis).toBe("NONE");
    expect(proyeccion.inflow.historyDays).toBe(0);
    expect(proyeccion.inflow.avgDailyInflowCents).toBeNull();

    // Ni entradas inventadas, ni el saldo negativo que se derivaba de ellas.
    expect(proyeccion.days.every((d) => d.projectedInflowCents === null)).toBe(true);
    const negativos = proyeccion.days.filter((d) => (d.cumulativeBalanceCents ?? 0) < 0);
    expect(negativos.map((d) => d.date)).toEqual([]);
  });

  test("con historial suficiente las entradas siguen el día de la semana", async ({ request }) => {
    const montos = await seedSalesCutHistory({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      days: 60,
    });

    const proyeccion = await obtenerProyeccion(request);
    expect(proyeccion.inflow.basis).toBe("SEASONAL");

    // El promedio de cada día de la semana es el monto que se sembró para ese
    // día: si la serie fuera plana, todos darían la misma cifra.
    for (const dia of proyeccion.days) {
      expect(dia.projectedInflowCents, `Entradas del ${dia.date}`).toBe(
        montos[diaDeLaSemana(dia.date)]
      );
    }

    // La afirmación que importa: la serie dejó de ser una línea recta.
    const distintos = new Set(proyeccion.days.map((d) => d.projectedInflowCents));
    expect(distintos.size).toBeGreaterThan(1);
  });

  test("con poco historial cae al promedio simple y lo declara", async ({ request }) => {
    await deleteTestSalesCuts();
    await seedSalesCutHistory({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      days: 10,
    });

    const proyeccion = await obtenerProyeccion(request);
    expect(proyeccion.inflow.basis).toBe("AVERAGE");
    expect(proyeccion.inflow.historyDays).toBe(10);

    // Diez días no alcanzan para partir la muestra en siete: promedio plano,
    // pero marcado como tal en vez de disfrazado de estacionalidad.
    const distintos = new Set(proyeccion.days.map((d) => d.projectedInflowCents));
    expect([...distintos]).toEqual([proyeccion.inflow.avgDailyInflowCents]);
  });
});
