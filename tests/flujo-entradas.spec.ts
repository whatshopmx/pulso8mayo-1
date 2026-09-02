import { test, expect } from "@playwright/test";
import { COMPANY_ID } from "./support/constants";
import {
  deleteTestBranch,
  deleteTestSalesCuts,
  seedSalesCutHistory,
  seedTestBranch,
} from "./support/db";
import { getCashFlowProjection } from "../lib/services/cash-flow-service";

/**
 * A1 / F1 — el flujo de efectivo aprende a proyectar entradas.
 *
 * La pantalla de flujo existe para contestar una pregunta: ¿me alcanza? Antes
 * de A1 contestaba "Sin estimar" a **todo** inquilino, tuviera seis meses de
 * cortes o ninguno, por dos motivos encadenados:
 *
 * 1. `inflowBasis` estaba fijado al literal `"NONE"`.
 * 2. Y aunque no lo estuviera, la consulta de ventas usaba la ventana
 *    *proyectada* (hoy → hoy+29), así que buscaba cortes en días que todavía no
 *    ocurren y devolvía cero por construcción. Ésa era la causa raíz.
 *
 * Este spec llama al servicio directo: no necesita servidor ni Inngest y corre
 * en segundos.
 *   pnpm exec playwright test --no-deps --project=chromium tests/flujo-entradas.spec.ts
 */

const VENTANA_DIAS = 30;

/**
 * Sucursal desechable, y no una de las sembradas.
 *
 * `pnpm seed` llena julio y agosto de 2026 de cortes para Condesa, Polanco y
 * Roma. Un spec que siembra hacia atrás desde hoy cae dentro de esa ventana y
 * choca contra el índice único `(company, branch, business_date, shift,
 * channel)` — y peor: el caso `NONE` no se puede probar en una sucursal que ya
 * tiene historial. Una sucursal propia hace de las tres bases algo medible en
 * vez de algo que depende del calendario.
 */
let sucursal: string;

/** Día de la semana (0=domingo) de un `YYYY-MM-DD`, sin husos de por medio. */
function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

/** La proyección de la sucursal desechable donde se siembra el historial. */
function proyectar() {
  return getCashFlowProjection(COMPANY_ID, VENTANA_DIAS, sucursal);
}

test.describe("A1 · las tres bases de procedencia de las entradas", () => {
  test.beforeEach(async () => {
    sucursal = await seedTestBranch(COMPANY_ID, "flujo entradas");
  });

  test.afterEach(async () => {
    // Borra también los cortes de la sucursal: una sucursal `[E2E]` huérfana
    // secuestra el alcance por omisión del selector y tiñe de rojo specs ajenos.
    await deleteTestBranch(sucursal);
    await deleteTestSalesCuts();
  });

  test("sin cortes: NONE, sin trayectoria y sin ceros disfrazados", async () => {
    const proyeccion = await proyectar();

    expect(proyeccion.inflow.historyDays).toBe(0);
    expect(proyeccion.inflow.basis).toBe("NONE");
    expect(proyeccion.inflow.avgDailyInflowCents).toBeNull();

    // `null`, no `0`. Un cero afirma que no va a entrar dinero, y contra los
    // egresos del mes pinta de rojo la pantalla entera de quien apenas empieza
    // a capturar. Ésta es la conducta correcta, no una carencia.
    expect(proyeccion.days.every((d) => d.projectedInflowCents === null)).toBe(true);
    expect(proyeccion.days.every((d) => d.netFlowCents === null)).toBe(true);
    expect(proyeccion.days.every((d) => d.cumulativeBalanceCents === null)).toBe(true);
  });

  test("con 5 días de corte: AVERAGE y una línea plana declarada", async () => {
    await seedSalesCutHistory({ companyId: COMPANY_ID, branchId: sucursal, days: 5 });

    const proyeccion = await proyectar();

    expect(proyeccion.inflow.basis).toBe("AVERAGE");
    expect(proyeccion.inflow.avgDailyInflowCents).not.toBeNull();

    // Cinco días no alcanzan para partir la muestra en siete: quedarían uno o
    // cero sábados, y un promedio de esa muestra es ruido presentado como
    // estacionalidad. Se proyecta plano, pero rotulado como plano.
    const estimados = proyeccion.days.filter((d) => d.projectedInflowCents !== null);
    expect(estimados.length).toBe(VENTANA_DIAS);

    // Se salta el día 0: si el corte de hoy ya está capturado —y lo está cuando
    // el spec corre después de las 18:00 local, porque la siembra calcula en
    // UTC— ese día lleva **venta real**, que sustituye a la estimación a
    // propósito. Es la conducta correcta, no una excepción a la línea plana.
    const proyectados = proyeccion.days.slice(1);
    const distintos = new Set(proyectados.map((d) => d.projectedInflowCents));
    expect([...distintos]).toEqual([proyeccion.inflow.avgDailyInflowCents]);
  });

  test("con 20 días de corte: SEASONAL, y el sábado se proyecta con los sábados", async () => {
    // `seedSalesCutHistory` siembra un monto distinto por día de la semana, con
    // los sábados deliberadamente altos: es el patrón de un restaurante y es lo
    // que el promedio plano borraba.
    const montos = await seedSalesCutHistory({
      companyId: COMPANY_ID,
      branchId: sucursal,
      days: 20,
    });

    const proyeccion = await proyectar();

    expect(proyeccion.inflow.basis).toBe("SEASONAL");
    // Uno de los días sembrados puede caer en "hoy" local según la hora a la que
    // corra el spec: ése cuenta como venta real y no como historial.
    expect(proyeccion.inflow.historyDays).toBeGreaterThanOrEqual(19);
    expect(proyeccion.inflow.lookbackDays).toBe(56);

    const sabados = proyeccion.days.filter((d) => diaDeLaSemana(d.date) === 6);
    const martes = proyeccion.days.filter((d) => diaDeLaSemana(d.date) === 2);
    expect(sabados.length, "una ventana de 30 días tiene que traer sábados").toBeGreaterThan(0);
    expect(martes.length).toBeGreaterThan(0);

    // La afirmación que justifica toda la tarea: un sábado proyectado supera a
    // un martes proyectado. Con el promedio plano los dos eran el mismo número.
    for (const sabado of sabados) {
      for (const martes_ of martes) {
        expect(
          sabado.projectedInflowCents!,
          `${sabado.date} (sábado) no supera a ${martes_.date} (martes)`
        ).toBeGreaterThan(martes_.projectedInflowCents!);
      }
    }

    // Y cada día proyectado es el promedio de su propio día de la semana, que
    // con la siembra es exactamente el monto sembrado para ese día. Coincide
    // también en el día 0 aunque lleve venta real: la siembra usa el mismo
    // monto por día de la semana.
    for (const dia of proyeccion.days) {
      expect(dia.projectedInflowCents, `Entradas del ${dia.date}`).toBe(
        montos[diaDeLaSemana(dia.date)]
      );
    }
  });

  test("el historial se lee hacia atrás, no dentro de la ventana proyectada", async () => {
    // La regresión de la causa raíz: si la consulta volviera a usar
    // `startDateStr`/`endDateStr`, un historial íntegramente pasado daría cero
    // días y la base caería a `NONE` con todo capturado.
    await seedSalesCutHistory({ companyId: COMPANY_ID, branchId: sucursal, days: 30 });

    const proyeccion = await proyectar();

    expect(
      proyeccion.inflow.historyDays,
      "la consulta de ventas volvió a mirar hacia adelante"
    ).toBeGreaterThan(0);
    expect(proyeccion.inflow.avgDailyInflowCents).not.toBeNull();
    expect(proyeccion.inflow.basis).not.toBe("NONE");
  });
});
