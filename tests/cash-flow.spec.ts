import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  COMPANY_ID,
  E2E_TAG,
  EMPLEADO_EMAIL,
  GERENTE_BRANCH,
  GERENTE_EMAIL,
  USER_SUPER_ADMIN,
} from "./support/constants";
import {
  deleteCashFlowAssumptions,
  deleteTestExpenses,
  deleteTestPayees,
  deleteTestSalesCuts,
  seedCashFlowAssumption,
  seedOperatingExpense,
  seedSalesCutHistory,
} from "./support/db";
import { addCalendarDays, localDateString } from "../lib/workflows/today";
import { readFileSync } from "node:fs";
import { BLANCO, contrastRatio, leerToken, rgbDe } from "./support/contrast";

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
  description: string;
  source: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE";
  supplierName?: string;
  branchId?: string | null;
  branchName?: string | null;
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
 * Task 18 — accesibilidad.
 *
 * Los colapsos se anunciaban "Ver todos (12), botón", sin estado. El tooltip
 * de la gráfica pasaba `""` como nombre de serie, así que un valor no decía si
 * era lo que entra o lo que sale. Y al 200% de zoom la badge que distingue OC
 * de Factura quedaba cortada por el `overflow:hidden` del párrafo que la
 * contenía.
 */
test.describe("Task 18 · accesibilidad", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";

  test.beforeAll(async () => {
    await deleteTestExpenses();
    // Seis vencidos: el colapso sólo aparece a partir de cinco.
    for (let i = 0; i < 6; i++) {
      await seedOperatingExpense({
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
        requestedBy: USER_SUPER_ADMIN,
        dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), -3 - i),
        amountCents: 120_000 + i * 1_000,
        description: `${E2E_TAG} Vencido con nombre bastante largo para truncar ${i}`,
      });
    }
  });

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("los colapsos anuncian su estado", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);

    const verTodos = page.getByRole("button", { name: /Ver todos/ });
    await expect(verTodos).toBeVisible();
    await expect(verTodos).toHaveAttribute("aria-expanded", "false");
    // `aria-controls` apunta a la lista que abre, no a nada.
    await expect(verTodos).toHaveAttribute("aria-controls", "lista-vencidos");
    await expect(page.locator("#lista-vencidos")).toBeVisible();

    await verTodos.click();
    await expect(
      page.getByRole("button", { name: /Mostrar solo 5/ })
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("la gráfica nombra sus series", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Entradas vs\. salidas/)).toBeVisible();

    // La leyenda y la tabla alternativa nombran ambas series: un lector de
    // pantalla no puede interpretar el color de la barra.
    const tabla = page.locator("[data-sr-table]");
    await expect(tabla).toContainText("Entradas");
    await expect(tabla).toContainText("Salidas");
  });

  test("la badge de origen sobrevive al zoom y al truncado", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Presión semanal de egresos/)).toBeVisible();

    // Zoom 200% simulado reduciendo el viewport a la mitad.
    await page.setViewportSize({ width: 640, height: 720 });

    // La badge ya no vive dentro del párrafo con `truncate`, así que ningún
    // ancestro con overflow oculto puede cortarla.
    const anidadas = await page.evaluate(() =>
      Array.from(document.querySelectorAll("p.truncate")).filter((p) =>
        p.querySelector("[data-slot='badge'], .badge, span[class*='rounded']")
      ).length
    );
    expect(anidadas).toBe(0);
  });

  test("a 320px la pantalla no se desborda", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Presión semanal de egresos/)).toBeVisible();

    // Recharts se dimensiona de forma asíncrona: medir antes de que asiente da
    // el ancho inicial del gráfico, no el final.
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll("section")).reduce(
              (peor, s) => Math.max(peor, s.scrollWidth - s.clientWidth),
              0
            )
          ),
        { timeout: 15_000 }
      )
      .toBeLessThanOrEqual(1);

    // La tira "Fuentes de egresos" era `flex` sin `flex-wrap` con badges
    // `shrink-0`: en un teléfono se salía por la derecha y el contenido
    // simplemente quedaba fuera de la pantalla.
    //
    // Se mide el contenido de ESTA pantalla, no el documento completo: el
    // layout del dashboard (barra lateral e iconos) desborda por su cuenta a
    // 320px, y es un defecto de otra pantalla — queda anotado, no silenciado.
    // Se compara `scrollWidth` contra `clientWidth` de cada sección: es la
    // medida que de verdad significa "esto obliga a hacer scroll lateral".
    // Recorrer descendientes y comparar rectángulos daba falsos positivos —
    // la tabla alternativa del gráfico está clipada por `sr-only`, así que sus
    // celdas reportan su tamaño natural sin ocupar un solo píxel en pantalla.
    const desborde = await page.evaluate(() =>
      Array.from(document.querySelectorAll("section")).reduce(
        (peor, s) => Math.max(peor, s.scrollWidth - s.clientWidth),
        0
      )
    );

    // Se tolera 1px de redondeo del navegador.
    expect(desborde, `el contenido desborda su sección ${desborde}px`).toBeLessThanOrEqual(1);
  });
});

/**
 * Task 17 — copy factualmente correcto.
 *
 * No es registro: son errores de hecho. La pantalla decía "supera el promedio"
 * cuando el código usa mediana × 1.5, llamaba "facturas" a lo que sólo puede
 * ser un gasto operativo, y prometía "{días}+ días" sobre un horizonte que no
 * había proyectado.
 */
test.describe("Task 17 · copy", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";
  const componente = readFileSync("components/finance/cash-flow-calendar.tsx", "utf8");
  // Sin comentarios: los dos archivos citan las cadenas viejas para explicar por
  // qué se fueron, y contarlas daría el mismo falso positivo que en la Task 16.
  const sinComentarios = (s: string) =>
    s.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/\/\/.*$/gm, "");
  const pagina = sinComentarios(
    readFileSync("app/dashboard/finance/cash-flow/page.tsx", "utf8")
  );

  test("el umbral del colchón está en la unidad correcta", () => {
    // Estaba en `50000` — que son $500, no $50,000. La banda ámbar era
    // inalcanzable: un saldo mínimo de $3,000 se pintaba tan tranquilo como uno
    // de $300,000.
    const umbral = componente.match(/COLCHON_MINIMO_CENTS = ([\d_]+)/)?.[1];
    expect(umbral).toBeTruthy();
    expect(Number(umbral!.replace(/_/g, ""))).toBe(5_000_000);

    // Y ya no se compara contra el literal suelto.
    expect(componente).not.toContain("minBalance < 50000");
  });

  test("no quedan errores de hecho ni voseo en la pantalla", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Presión semanal de egresos/)).toBeVisible();
    const texto = (await page.locator("main, body").first().innerText()).toLowerCase();

    // Voseo rioplatense en un producto es-MX.
    expect(texto).not.toContain("prepará");
    // El código usa mediana × 1.5, no promedio.
    expect(texto).not.toContain("supera el promedio");
    // `overdueItems` se construye sólo de `operating_expenses`.
    expect(texto).not.toContain("facturas y gastos vencidos");
    // Abreviatura que no usa ningún hispanohablante.
    expect(texto).not.toMatch(/\d+ emp\b/);
    // Garantía absoluta sobre una base estimada.
    expect(texto).not.toContain("sin riesgo de saldo negativo");
  });

  test("el H1 no usa la anti-referencia que prohíbe PRODUCT.md", () => {
    expect(pagina).not.toContain("Panel de Alerta Temprana");
    expect(pagina).toContain("Flujo de efectivo");
  });

  test("los títulos usan sentence case", () => {
    // `Proyección de Entradas vs Salidas` era el único en Title Case, contra
    // "¿En qué gasto?", "Próximos 7 días" y "Presión semanal de egresos".
    expect(componente).not.toContain("Entradas vs Salidas");
    expect(componente).toContain("Entradas vs. salidas");
  });

  test("los conteos manejan el singular", () => {
    // "1 días" y "1 compromisos" salían de plantillas sin plural.
    for (const plural of ["días", "compromisos", "empleados", "facturas"]) {
      const singular = plural.replace(/e?s$/, "");
      expect(
        componente,
        `falta el caso singular de "${plural}"`
      ).toContain(`"${singular}" : "${plural}"`);
    }
  });
});

/**
 * Task 16 — jerarquía visual.
 *
 * Cuatro valores `text-2xl` con el mismo peso competían por ser la respuesta,
 * así que la pantalla no contestaba "¿me alcanza?": enumeraba datos y dejaba
 * el trabajo a la lectora. Y había once bloques de primer nivel.
 */
test.describe("Task 16 · jerarquía visual", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";
  // Se miden las clases, no los comentarios: el archivo explica en prosa por
  // qué se abandonó `text-2xl`, y contar esas menciones daría falsos positivos.
  const componente = readFileSync("components/finance/cash-flow-calendar.tsx", "utf8");
  const soloCodigo = componente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  test.beforeAll(async () => {
    // Un gasto vencido: sin él la sección de vencidos no se renderiza y el caso
    // que prueba la agrupación no existiría.
    await deleteTestExpenses();
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), -4),
      amountCents: 640_000,
      description: `${E2E_TAG} Vencido para jerarquía`,
    });
  });

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("hay una sola respuesta primaria dominante", () => {
    // `text-4xl` es el peso reservado a la respuesta: aparece sólo en la
    // tarjeta "Te alcanza para", en sus tres estados (sin estimar, con fecha
    // negativa, y sin riesgo).
    expect((soloCodigo.match(/text-4xl/g) ?? []).length).toBe(3);

    // Y nadie más compite: ya no quedan `text-2xl` en la pantalla.
    expect(soloCodigo.match(/text-2xl/g) ?? []).toEqual([]);
  });

  test("la pantalla se agrupa en cuatro bloques de primer nivel", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Presión semanal de egresos/)).toBeVisible();

    // `<section>` con nombre: agrupa visualmente y le da al lector de pantalla
    // una tabla de contenido navegable.
    const secciones = page.locator("main section, section");
    const nombres = await secciones.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")).filter(Boolean)
    );

    for (const esperado of [
      "¿Me alcanza?",
      "Gastos vencidos",
      "¿En qué gasto?",
      "¿Cómo se ve el mes?",
    ]) {
      expect(nombres, `falta la sección "${esperado}"`).toContain(esperado);
    }
    expect(nombres.length).toBeLessThanOrEqual(4);
  });

  test("toda cifra monetaria alinea por dígito", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Presión semanal de egresos/)).toBeVisible();

    // Sin `tabular-nums` los montos que la dueña quiere comparar de un renglón
    // a otro no alinean verticalmente. Se excluye la tabla alternativa del
    // gráfico (`sr-only`): la lee un lector de pantalla, donde la alineación
    // visual no significa nada.
    const sinAlinear = await page.evaluate(() => {
      const esMonto = (t: string | null) => !!t && /^\$[\d,]+\.\d{2}$/.test(t.trim());
      const malos: string[] = [];

      for (const el of Array.from(document.querySelectorAll("section *"))) {
        if (el.children.length > 0) continue; // sólo hojas: el texto vive ahí
        if (!esMonto(el.textContent)) continue;
        if (el.closest("[data-sr-table]")) continue;
        if (!getComputedStyle(el).fontVariantNumeric.includes("tabular-nums")) {
          malos.push(el.textContent!.trim());
        }
      }
      return malos;
    });

    expect(sinAlinear).toEqual([]);
  });

  test("el componente deja de pisar los primitivos de tarjeta", () => {
    // `CardDescription` trae `text-sm` de fábrica y se pisaba a `text-xs` cuatro
    // veces; `CardContent` mezclaba `p-4` y `p-6`.
    expect(componente).not.toContain("CardDescription className");
    expect(componente).not.toContain('CardContent className="p-4"');
  });
});

/**
 * Task 15 — presupuesto de rojo.
 *
 * En un mes malo estaban rojos a la vez: dos tarjetas hero completas, la
 * tarjeta de vencidos entera, la badge de nómina, la barra NOMINA, la de RENTA
 * (h=25, prácticamente Rojo Operativo), hasta cinco tarjetas semanales, las
 * cifras del resumen y las catorce barras de "Salidas". DESIGN.md lo topa en
 * 10–15%. Un tablero donde todo es rojo no prioriza nada.
 */
test.describe("Task 15 · presupuesto de rojo", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";
  const css = readFileSync("app/globals.css", "utf8");
  const componente = readFileSync("components/finance/cash-flow-calendar.tsx", "utf8");

  /** Hue del rojo de alarma; ±30° se considera la misma familia. */
  const HUE_DESTRUCTIVE = leerToken(css, "destructive", ":root").h;

  test("ninguna categoría de egresos se pinta en la familia del rojo", () => {
    const mapa = componente.match(/const CATEGORY_COLORS[\s\S]*?\n\};/)?.[0] ?? "";
    expect(mapa).not.toContain("--destructive");

    const tokens = [...mapa.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(0);

    for (const token of tokens) {
      // `muted-foreground` e `info` no son de gráfica; sólo se miden los que
      // tienen hue propio en el bloque de tokens.
      let color;
      try {
        color = leerToken(css, token, ":root");
      } catch {
        continue;
      }
      const distancia = Math.min(
        Math.abs(color.h - HUE_DESTRUCTIVE),
        360 - Math.abs(color.h - HUE_DESTRUCTIVE)
      );
      expect(
        distancia,
        `--${token} (h=${color.h}) está a ${distancia}° del rojo de alarma`
      ).toBeGreaterThan(30);
    }
  });

  test("las barras de Salidas dejaron el carmesí", () => {
    // Eran `--chart-5` (h=0): la mitad de la tinta de la gráfica en rojo por
    // dibujar egresos normales.
    const barra = componente.match(/dataKey="Salidas"[\s\S]{0,120}?fill="var\(--([\w-]+)\)"/);
    expect(barra?.[1]).toBe("chart-4");
  });

  test("una semana pesada se marca con palabra, no sólo con color", async ({ request }) => {
    // El `AlertTriangle` era el único marcador no cromático y no tenía nombre
    // accesible: "qué semanas son malas" viajaba sólo por color.
    expect(componente).toContain("Semana pesada");

    // Y el tinte de la semana pesada es ámbar, no rojo.
    const tarjetaSemanal =
      componente.match(/week\.isHeavy\s*\n?\s*\?\s*"([^"]+)"/)?.[1] ?? "";
    expect(tarjetaSemanal).toContain("warning");
    expect(tarjetaSemanal).not.toContain("destructive");

    // La proyección sigue emitiendo el dato que la tarjeta usa.
    const proyeccion = await obtenerProyeccion(request, 30);
    expect(proyeccion.weeklyAggregation.every((s) => typeof s.isHeavy === "boolean")).toBe(
      true
    );
  });

  test("el rojo se concentra en la tarjeta de vencidos", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(/Presión semanal de egresos/)).toBeVisible();

    // Se cuentan los elementos con tinte o texto de alarma en la pantalla
    // completa. La tarjeta de vencidos aporta los suyos; el resto no debería
    // sumar casi nada cuando no hay una urgencia real.
    const rojos = await page
      .locator(
        '[class*="text-destructive"], [class*="bg-destructive"], [class*="border-destructive"]'
      )
      .count();

    // Umbral generoso a propósito: el test protege contra una regresión
    // (volver a teñir semanas, barras o categorías), no fija un número exacto
    // de píxeles.
    expect(rojos, `${rojos} elementos en rojo`).toBeLessThanOrEqual(20);
  });
});

/**
 * Task 14 — contraste.
 *
 * `text-warning` es 2.52:1 sobre blanco: falla incluso el piso de 3:1 de texto
 * grande, y estaba en un `text-2xl font-bold`. `text-success` es 3.68:1: pasa
 * en texto grande pero falla el 4.5:1 de `text-xs`, que es donde más se usa.
 *
 * Los tokens se leen del `globals.css` real: así el test no puede quedar
 * describiendo unos valores mientras la app usa otros.
 */
test.describe("Task 14 · contraste de tokens", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const fondoOscuro = () => rgbDe(leerToken(css, "card", ".dark"));

  test("los tokens de texto cumplen AA sobre fondo claro", () => {
    // Piso 4.5:1 — son tokens para texto chico.
    const warning = contrastRatio(rgbDe(leerToken(css, "warning-text", ":root")), BLANCO);
    expect(warning, `--warning-text da ${warning.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

    const success = contrastRatio(rgbDe(leerToken(css, "success-text", ":root")), BLANCO);
    expect(success, `--success-text da ${success.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  test("los tokens que motivaron el arreglo siguen sin cumplir", () => {
    // Se afirma el hecho, no el deseo: `--warning` y `--success` son tokens de
    // relleno y no deben usarse como texto chico. Si algún día se oscurecen,
    // este test falla y hay que revisar si el token de texto sigue haciendo
    // falta.
    const warning = contrastRatio(rgbDe(leerToken(css, "warning", ":root")), BLANCO);
    expect(warning).toBeLessThan(4.5);

    const success = contrastRatio(rgbDe(leerToken(css, "success", ":root")), BLANCO);
    expect(success).toBeLessThan(4.5);
  });

  test("las badges de origen se distinguen y son legibles en oscuro", () => {
    const info = leerToken(css, "info", ".dark");
    const chart4 = leerToken(css, "chart-4", ".dark");

    // Eran idénticos byte a byte: "OC" y "Factura" se pintaban del mismo color
    // y sólo las distinguía la etiqueta.
    expect(Math.abs(info.h - chart4.h)).toBeGreaterThanOrEqual(20);

    // Y ambos son texto chico sobre la tarjeta oscura.
    for (const [nombre, token] of [
      ["--info", info],
      ["--chart-4", chart4],
    ] as const) {
      const ratio = contrastRatio(rgbDe(token), fondoOscuro());
      expect(ratio, `${nombre} da ${ratio.toFixed(2)}:1 en oscuro`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("los tokens de texto también cumplen en modo oscuro", () => {
    for (const nombre of ["warning-text", "success-text"]) {
      const ratio = contrastRatio(rgbDe(leerToken(css, nombre, ".dark")), fondoOscuro());
      expect(ratio, `--${nombre} da ${ratio.toFixed(2)}:1 en oscuro`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("la pantalla no usa los tokens de relleno como texto chico", async () => {
    const componente = readFileSync("components/finance/cash-flow-calendar.tsx", "utf8");

    // `text-warning` como color de texto quedó erradicado del archivo; sólo
    // sobrevive `text-warning-text`.
    const warningSuelto = componente.match(/text-warning(?![-\w])/g) ?? [];
    expect(warningSuelto).toEqual([]);

    // `text-success` sólo sobrevive donde el piso es 3:1 (texto grande e
    // iconos); en `text-xs` se usa `text-success-text`.
    expect(componente).toContain("text-success-text");
  });
});

/**
 * Task 13 — las acciones, en la fila.
 *
 * Conecta los endpoints de la Task 12 a las filas, y dice en voz alta qué hace
 * y qué no: aquí el aviso cambia de sentido respecto a `payables` —esta
 * pantalla sí escribe, pero no concilia contra el banco.
 */
test.describe("Task 13 · acciones en línea", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("marcar pagado desde la fila recalcula la proyección sin recargar", async ({
    page,
  }) => {
    await deleteTestExpenses();
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 2),
      amountCents: 1_234_500,
      description: `${E2E_TAG} Gasto accionable`,
      status: "APPROVED",
    });

    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(`${E2E_TAG} Gasto accionable`)).toBeVisible();

    // La acción vive junto a su fila, no en una barra global: se busca desde el
    // enlace de la partida hacia su contenedor (`ItemRow`).
    const fila = page
      .getByRole("link", { name: /Gasto accionable/ })
      .locator("xpath=..");
    const botonPagar = fila.getByRole("button", { name: /Pagado/ });
    await expect(botonPagar).toBeVisible();
    await botonPagar.click();

    // Sin recargar: el botón desaparece porque el gasto ya no está APPROVED.
    await expect(botonPagar).toHaveCount(0, { timeout: 30_000 });

    await deleteTestExpenses();
  });

  test("la pantalla dice que registra el gasto, no el movimiento bancario", async ({
    page,
  }) => {
    await page.goto(`${PANTALLA}?days=30`);
    await expect(
      page.getByText(/Marcar pagado registra el gasto, no el movimiento bancario/)
    ).toBeVisible();
    await expect(page.getByText(/no se conecta a tu banco/i)).toBeVisible();
  });

  test("un EMPLEADO no ve los botones de acción", async ({ browser }) => {
    await deleteTestExpenses();
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 2),
      amountCents: 1_234_500,
      description: `${E2E_TAG} Gasto accionable`,
      status: "APPROVED",
    });

    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const pagina = await contexto.newPage();
      await pagina.goto("/sign-in");
      await pagina.locator("#email").fill(EMPLEADO_EMAIL);
      await pagina.locator("#password").fill(ADMIN_PASSWORD);
      await pagina.getByRole("button", { name: /iniciar|sign in|entrar/i }).click();
      await pagina.waitForURL(/\/dashboard/, { timeout: 120_000 });

      await pagina.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
      // Un EMPLEADO llega a la pantalla (es de lectura financiera) pero no
      // puede accionar: ni botones ni aviso de escritura.
      await expect(pagina.getByRole("button", { name: /Reprogramar/ })).toHaveCount(0);
      await expect(
        pagina.getByText(/Marcar pagado registra el gasto/)
      ).toHaveCount(0);
    } finally {
      await contexto.close();
      await deleteTestExpenses();
    }
  });

  test("las acciones no quedan anidadas dentro del enlace de la fila", async ({ page }) => {
    await deleteTestExpenses();
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 2),
      amountCents: 1_234_500,
      description: `${E2E_TAG} Gasto accionable`,
      status: "APPROVED",
    });

    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await expect(page.getByText(`${E2E_TAG} Gasto accionable`)).toBeVisible();

    // Un <button> dentro de un <a> es HTML inválido y rompe la navegación por
    // teclado: el lector anuncia un solo control donde hay tres.
    const botonesDentroDeEnlaces = await page.locator("a button").count();
    expect(botonesDentroDeEnlaces).toBe(0);

    await deleteTestExpenses();
  });
});

/**
 * Task 12 — endpoints de pago y reprogramación.
 *
 * `expense-service` tenía `create`, `approve`, `reject` y `get`, pero no
 * `markPaid` ni `reschedule`, así que la pantalla sólo podía informar. Los
 * endpoints viven en el dominio de gastos: el panel de flujo es un consumidor.
 */
test.describe("Task 12 · pagar y reprogramar gastos", () => {
  test.setTimeout(180_000);

  /** Siembra un gasto aprobado y devuelve su id. */
  async function gastoAprobado(dias: number): Promise<string> {
    return seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), dias),
      amountCents: 456_700,
      description: `${E2E_TAG} Gasto para accionar`,
      status: "APPROVED",
    });
  }

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("marcar pagado cambia el estado y queda en la bitácora", async ({ request }) => {
    const id = await gastoAprobado(3);

    const res = await request.post(`/api/expenses/${id}/pay`, { data: {} });
    expect(res.ok(), `La API respondió ${res.status()}`).toBe(true);

    const { data } = await res.json();
    expect(data.status).toBe("PAID");
    expect(data.paidAt).toBeTruthy();
    // Quién lo pagó queda escrito: `operating_expenses` no tiene columna
    // `paid_by`, así que la bitácora va en el mismo campo que usan
    // approve/reject.
    expect(data.approvalNotes).toMatch(/Pagado por /);

    await deleteTestExpenses();
  });

  test("pagar dos veces es idempotente y no reescribe la fecha", async ({ request }) => {
    const id = await gastoAprobado(3);

    const primera = await request.post(`/api/expenses/${id}/pay`, { data: {} });
    const pagoOriginal = (await primera.json()).data.paidAt;

    // Dos clics, o dos personas a la vez: no es un error del usuario, pero
    // tampoco debe mover la fecha de pago original.
    const segunda = await request.post(`/api/expenses/${id}/pay`, { data: {} });
    expect(segunda.ok()).toBe(true);
    expect((await segunda.json()).data.paidAt).toBe(pagoOriginal);

    await deleteTestExpenses();
  });

  test("un gasto sin aprobar no se puede pagar", async ({ request }) => {
    const id = await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 3),
      amountCents: 100_000,
      description: `${E2E_TAG} Gasto sin aprobar`,
      status: "PENDING_APPROVAL",
    });

    // Pagarlo saltaría la cadena de autorización por la puerta de atrás.
    const res = await request.post(`/api/expenses/${id}/pay`, { data: {} });
    expect(res.ok()).toBe(false);
    expect((await res.json()).success).toBe(false);

    await deleteTestExpenses();
  });

  test("reprogramar mueve el vencimiento y lo deja anotado", async ({ request }) => {
    const id = await gastoAprobado(3);
    const nueva = addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 20);

    const res = await request.post(`/api/expenses/${id}/reschedule`, {
      data: { dueDate: nueva },
    });
    expect(res.ok(), `La API respondió ${res.status()}`).toBe(true);

    const { data } = await res.json();
    expect(data.dueDate).toBe(nueva);
    expect(data.approvalNotes).toMatch(/Reprogramado de .* a .* por /);

    await deleteTestExpenses();
  });

  test("no se puede reprogramar al pasado", async ({ request }) => {
    const id = await gastoAprobado(3);
    const ayer = addCalendarDays(localDateString(new Date(), "America/Mexico_City"), -1);

    // Mover un vencimiento al pasado no reprograma nada: sólo maquilla un
    // vencido para que deje de aparecer como tal.
    const res = await request.post(`/api/expenses/${id}/reschedule`, {
      data: { dueDate: ayer },
    });
    expect(res.ok()).toBe(false);
    expect((await res.json()).success).toBe(false);

    await deleteTestExpenses();
  });

  test("un gasto pagado ya no se reprograma", async ({ request }) => {
    const id = await gastoAprobado(3);
    await request.post(`/api/expenses/${id}/pay`, { data: {} });

    const res = await request.post(`/api/expenses/${id}/reschedule`, {
      data: { dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 20) },
    });
    expect(res.ok()).toBe(false);

    await deleteTestExpenses();
  });

  test("un EMPLEADO no puede pagar ni reprogramar", async ({ browser }) => {
    const id = await gastoAprobado(3);
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: EMPLEADO_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(login.ok()).toBe(true);

      const pago = await contexto.request.post(`/api/expenses/${id}/pay`, { data: {} });
      expect(pago.status()).toBe(403);
      expect((await pago.json()).success).toBe(false);

      const repro = await contexto.request.post(`/api/expenses/${id}/reschedule`, {
        data: { dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 20) },
      });
      expect(repro.status()).toBe(403);
    } finally {
      await contexto.close();
      await deleteTestExpenses();
    }
  });

  test("pagar no altera el total proyectado: la proyección no filtra por estado", async ({
    request,
  }) => {
    const id = await gastoAprobado(3);

    const antes = await obtenerProyeccion(request, 30, BRANCH_CONDESA);
    const totalAntes = antes.days.reduce((t, d) => t + d.projectedOutflowCents, 0);
    expect(antes.outflowItems.some((p) => p.id === id)).toBe(true);

    await request.post(`/api/expenses/${id}/pay`, { data: {} });

    // Hallazgo, y el test lo fija: la consulta de gastos proyectados NO filtra
    // por estado (a diferencia de la de vencidos, que excluye PAID). Un gasto
    // pagado sigue contando en "Total egresos" del período.
    //
    // Se afirma lo que de verdad pasa, no lo que sería bonito que pasara. Si el
    // comportamiento correcto es excluirlos, cambia el servicio y este test
    // falla — que es exactamente lo que debe hacer.
    const despues = await obtenerProyeccion(request, 30, BRANCH_CONDESA);
    const totalDespues = despues.days.reduce((t, d) => t + d.projectedOutflowCents, 0);
    expect(totalDespues).toBe(totalAntes);
    expect(despues.outflowItems.some((p) => p.id === id)).toBe(true);

    await deleteTestExpenses();
  });
});

/**
 * Task 11 — cada hallazgo navega a su registro origen.
 *
 * Inventario del crítico: **4 elementos interactivos, 0 que naveguen**. Las
 * filas eran `<div>` planos, así que la dueña se enteraba de que tenía seis
 * gastos vencidos y después tenía que salir, abrir la lista y buscarlos a mano
 * por una descripción truncada.
 */
test.describe("Task 11 · navegación al registro origen", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";
  let gastoId: string;

  test.beforeAll(async () => {
    await deleteTestExpenses();
    gastoId = await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 3),
      amountCents: 777_700,
      description: `${E2E_TAG} Gasto navegable`,
    });
  });

  test.afterAll(async () => {
    await deleteTestExpenses();
  });

  test("la fila de un gasto enlaza a su registro con foco", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);

    const fila = page.getByRole("link", { name: /Gasto navegable/ });
    await expect(fila).toBeVisible();
    // El destino lleva el id del registro, no sólo la lista.
    await expect(fila).toHaveAttribute(
      "href",
      `/dashboard/finance/expenses?focus=${gastoId}`
    );
  });

  test("hacer clic aterriza en el gasto correcto y resaltado", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    await page
      .getByRole("link", { name: /Gasto navegable/ })
      .click();

    await expect(page).toHaveURL(new RegExp(`/dashboard/finance/expenses\\?focus=${gastoId}`));

    // La lista tarda en aparecer: `next dev` compila la ruta destino en el
    // primer golpe y eso excede de sobra los timeouts por defecto (lo advierte
    // CLAUDE.md). Se espera al contenido antes de mirar el resaltado.
    await expect(page.getByText(/Gasto navegable/).first()).toBeVisible({
      timeout: 120_000,
    });

    // La fila destino queda marcada con `aria-current`, no sólo con color: el
    // resaltado cromático no se anuncia en un lector de pantalla.
    const filaDestino = page.locator('tr[aria-current="true"]');
    await expect(filaDestino).toBeVisible({ timeout: 30_000 });
    await expect(filaDestino).toContainText(`${E2E_TAG} Gasto navegable`);
  });

  test("la fila es alcanzable por teclado", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
    const fila = page.getByRole("link", { name: /Gasto navegable/ });
    await fila.focus();
    await expect(fila).toBeFocused();
  });

  test("la nómina no enlaza a ningún lado", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=60&branchId=${BRANCH_CONDESA}`);
    // Se sintetiza en el servicio (`payroll-<fecha>`): no hay registro que abrir,
    // así que ofrecer un enlace roto sería peor que no ofrecerlo.
    const nomina = page.getByRole("link", { name: /Nómina quincenal/ });
    await expect(nomina).toHaveCount(0);
  });

  test("hay salida al detalle de Cuentas por Pagar", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30`);
    const enlace = page.getByRole("link", { name: /Ver Cuentas por Pagar/ });
    await expect(enlace).toBeVisible();
    await expect(enlace).toHaveAttribute("href", "/dashboard/finance/payables");
  });
});

/**
 * Task 10 — higiene de datos del render.
 *
 * `supplierName` venía en el payload y no se pintaba en ningún lado, así que
 * identificar cuál de seis "Renta" truncadas es cuál exigía recordar. Y el
 * guard de "sin proyección" iba ANTES de la tarjeta de vencidos, de modo que un
 * inquilino con facturas vencidas y sin días proyectados no veía ninguna.
 */
test.describe("Task 10 · higiene de datos del render", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";

  test.afterAll(async () => {
    await deleteTestExpenses();
    await deleteTestPayees();
  });

  test("la contraparte y la sucursal viajan en cada partida", async ({ request }) => {
    await deleteTestExpenses();
    const enTresDias = addCalendarDays(
      localDateString(new Date(), "America/Mexico_City"),
      3
    );
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enTresDias,
      amountCents: 500_000,
      description: `${E2E_TAG} Renta del local`,
    });

    const proyeccion = await obtenerProyeccion(request, 30);
    const partida = proyeccion.outflowItems.find(
      (p) => p.description === `${E2E_TAG} Renta del local`
    );
    expect(partida).toBeDefined();

    // La sucursal viaja siempre: es lo que permite distinguir la renta de
    // Condesa de la de Polanco cuando las cifras son del grupo.
    expect(partida!.branchId).toBe(BRANCH_CONDESA);
    expect(partida!.branchName).toBeTruthy();

    await deleteTestExpenses();
  });

  test("los vencidos llevan sucursal para poder distinguirlos", async ({ request }) => {
    const proyeccion = await obtenerProyeccion(request, 30);
    for (const vencido of proyeccion.overdueItems) {
      // Sin esto, la fila dice "Renta · Venció 3 ago" y nada más.
      expect(vencido).toHaveProperty("branchName");
    }
  });

  test("la pantalla muestra proveedor y sucursal en las filas", async ({ page }) => {
    await deleteTestExpenses();
    const enTresDias = addCalendarDays(
      localDateString(new Date(), "America/Mexico_City"),
      3
    );
    await seedOperatingExpense({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_SUPER_ADMIN,
      dueDate: enTresDias,
      amountCents: 500_000,
      description: `${E2E_TAG} Renta del local`,
    });

    try {
      await page.goto(`${PANTALLA}?days=30&branchId=${BRANCH_CONDESA}`);
      await expect(page.getByText(`${E2E_TAG} Renta del local`)).toBeVisible();

      // La línea de detalle se arma con `ItemMeta`: categoría, contraparte,
      // sucursal (sólo en alcance de grupo) y fecha con su verbo correcto.
      await expect(page.getByText(/Otros · Vence/i).first()).toBeVisible();

      // En alcance de una sucursal la sucursal NO se repite en cada fila: ya
      // está en la píldora del encabezado, y repetirla en filas que se truncan
      // es ruido.
      await expect(page.getByText(/Otros · Condesa · Vence/i)).toHaveCount(0);
    } finally {
      await deleteTestExpenses();
    }
  });
});

/**
 * Task 9 — capturar el saldo desde la pantalla, con RBAC.
 *
 * La Task 8 dejó de inventar el saldo, pero sin superficie para capturarlo la
 * pantalla sólo sabía decir "sin capturar". Aquí se cierra el círculo.
 */
test.describe("Task 9 · captura del saldo inicial", () => {
  test.setTimeout(180_000);
  const PANTALLA = "/dashboard/finance/cash-flow";

  test.beforeAll(async () => {
    await deleteCashFlowAssumptions(COMPANY_ID);
  });

  test.afterAll(async () => {
    await deleteCashFlowAssumptions(COMPANY_ID);
  });

  test("capturar el saldo persiste y cambia las cifras derivadas", async ({ request }) => {
    await deleteCashFlowAssumptions(COMPANY_ID);

    const antes = await obtenerProyeccion(request, 30);
    expect(antes.initialBalanceCents).toBeNull();

    const guardado = await request.put("/api/finance/cash-flow/assumptions", {
      data: { openingBalanceCents: 4_500_000, branchId: null },
    });
    expect(guardado.ok(), `La API respondió ${guardado.status()}`).toBe(true);

    const despues = await obtenerProyeccion(request, 30);
    expect(despues.initialBalanceCents).toBe(4_500_000);
    expect(despues.openingBalance.source).toBe("COMPANY");
    expect(despues.openingBalance.ageInDays).toBe(0);

    // Capturar dos veces actualiza, no duplica: si se insertara una segunda
    // fila de grupo, la lectura sería ambigua.
    const otraVez = await request.put("/api/finance/cash-flow/assumptions", {
      data: { openingBalanceCents: 6_000_000, branchId: null },
    });
    expect(otraVez.ok()).toBe(true);

    const final = await obtenerProyeccion(request, 30);
    expect(final.initialBalanceCents).toBe(6_000_000);
  });

  test("un saldo con fecha futura se rechaza", async ({ request }) => {
    const manana = addCalendarDays(localDateString(new Date(), "America/Mexico_City"), 1);
    const res = await request.put("/api/finance/cash-flow/assumptions", {
      data: { openingBalanceCents: 1_000_000, branchId: null, asOfDate: manana },
    });
    expect(res.ok()).toBe(false);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test("un saldo negativo se acepta: una cuenta sobregirada es un saldo real", async ({
    request,
  }) => {
    const res = await request.put("/api/finance/cash-flow/assumptions", {
      data: { openingBalanceCents: -250_000, branchId: null },
    });
    expect(res.ok()).toBe(true);

    const proyeccion = await obtenerProyeccion(request, 30);
    expect(proyeccion.initialBalanceCents).toBe(-250_000);
  });

  test("un EMPLEADO no puede capturar el saldo de la empresa", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: EMPLEADO_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(login.ok(), `Login de EMPLEADO respondió ${login.status()}`).toBe(true);

      const res = await contexto.request.put("/api/finance/cash-flow/assumptions", {
        data: { openingBalanceCents: 99_999_900, branchId: null },
      });
      expect(res.ok()).toBe(false);
      expect(res.status()).toBe(403);

      // Y el envelope es el del repo, no un 500 genérico.
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBeTruthy();
    } finally {
      await contexto.close();
    }
  });

  test("un GERENTE captura para su sucursal, no para otra", async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(login.ok()).toBe(true);

      // Juan es GERENTE de Condesa y pide capturar para Polanco.
      const res = await contexto.request.put("/api/finance/cash-flow/assumptions", {
        data: { openingBalanceCents: 3_333_300, branchId: BRANCH_POLANCO },
      });
      expect(res.ok()).toBe(true);

      // `enforceBranchScope` lo redirige a la suya: el saldo quedó en Condesa.
      const json = await res.json();
      expect(json.data.branchId).toBe(GERENTE_BRANCH);
      expect(json.data.branchId).not.toBe(BRANCH_POLANCO);
    } finally {
      await contexto.close();
      await deleteCashFlowAssumptions(COMPANY_ID);
    }
  });

  test("la pantalla ofrece capturar el saldo y lo guarda", async ({ page }) => {
    await deleteCashFlowAssumptions(COMPANY_ID);
    await page.goto(`${PANTALLA}?days=30`);

    // Sin captura, la pantalla lo pide en vez de proyectar sobre cero.
    await expect(page.getByText("Sin capturar")).toBeVisible();

    await page.getByRole("button", { name: /Capturar/ }).click();
    await page.getByRole("textbox").first().fill("38500");
    await page.getByRole("button", { name: "Guardar" }).click();

    // La proyección se revalida sola: la cifra aparece sin recargar.
    await expect(page.getByText("$38,500.00")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Sin capturar")).toHaveCount(0);

    await deleteCashFlowAssumptions(COMPANY_ID);
  });

  test("la línea de supuestos nombra las cuatro estimaciones", async ({ page }) => {
    await page.goto(`${PANTALLA}?days=30`);

    const supuestos = page.getByText("Supuestos:");
    await expect(supuestos).toBeVisible();

    // Las cuatro que cargan la pantalla, cada una con su "cómo se calcula".
    for (const nombre of [
      "Saldo inicial",
      "Entradas por ventas",
      "Fecha de pago de las OC",
      "Quincena",
    ]) {
      await expect(page.getByRole("button", { name: new RegExp(nombre) })).toBeVisible();
    }

    // El popover explica de dónde sale la cifra, no sólo que es un supuesto.
    await page.getByRole("button", { name: /Quincena/ }).click();
    await expect(page.getByText(/15 y el 30 de cada mes/)).toBeVisible();
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
      // Fecha calculada en la zona de la operación, la misma con la que el
      // servicio mide la antigüedad. Con `CURRENT_DATE - 9` de Postgres el
      // test dependía de la hora del día.
      asOfDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), -9),
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
      asOfDate: addCalendarDays(localDateString(new Date(), "America/Mexico_City"), -3),
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
    page.getByText(/Entradas vs\. salidas de los próximos \d+ días/);

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
