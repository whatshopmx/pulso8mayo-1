import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  BRANCH_CONDESA,
  COMPANY_ID,
  E2E_TAG,
  USER_SUPER_ADMIN,
} from "./support/constants";
import {
  deleteTestExpenses,
  deleteTestSalesCuts,
  seedOperatingExpense,
  seedSalesCutHistory,
} from "./support/db";

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
}

/** Día de la semana (0=domingo) de un `YYYY-MM-DD`, sin arrastrar zona horaria. */
function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

async function obtenerProyeccion(
  request: APIRequestContext,
  dias = VENTANA_DIAS
): Promise<Proyeccion> {
  const res = await request.get(`/api/finance/cash-flow?days=${dias}`);
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
