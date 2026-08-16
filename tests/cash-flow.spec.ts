import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  BRANCH_CONDESA,
  COMPANY_ID,
  E2E_TAG,
  USER_SUPER_ADMIN,
} from "./support/constants";
import { deleteTestExpenses, seedOperatingExpense } from "./support/db";

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
  projectedInflowCents: number;
  projectedOutflowCents: number;
  netFlowCents: number;
  cumulativeBalanceCents: number;
  outflowItemsCount: number;
}

interface Partida {
  id: string;
  date: string;
  amountCents: number;
  category: string;
}

interface Semana {
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalOutflowCents: number;
  itemCount: number;
}

interface Proyeccion {
  days: DiaProyectado[];
  outflowItems: Partida[];
  weeklyAggregation: Semana[];
  overdueItems: Partida[];
  upcomingItems: Partida[];
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

  // Task 2 del plan: sin `dailySalesCuts` el promedio de entradas cae a $0/día y
  // el inquilino nuevo estrena la pantalla en rojo. No se puede ejercitar con la
  // sesión sembrada —que sí tiene cortes— hasta que el payload declare
  // `inflowBasis: 'NONE'` y la proyección deje de dibujarse sobre cero.
  test.fixme("un inquilino sin cortes de venta no proyecta saldo negativo", async () => {});
});
