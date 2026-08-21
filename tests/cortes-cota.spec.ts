import { test, expect } from "@playwright/test";
import { COMPANY_ID } from "./support/constants";
import {
  deleteTestBranch,
  deleteTestSalesCuts,
  seedCutsEnDiasConsecutivos,
  seedTestBranch,
} from "./support/db";

/**
 * Auditoría A8 — la lista de cortes deja de barrer la historia entera.
 *
 * `GET /api/sales/cuts` no tenía cota de ningún tipo: sin `startDate` devolvía
 * **todos** los cortes de la empresa desde el principio, y la página los pintaba
 * todos. Una cadena de tres sucursales con un año de operación son miles de
 * filas por petición para mostrar las de esta semana.
 *
 * El rango por defecto pasa a ser el **mes en curso** (AD-A6): es el filtro que
 * la operación usa de todos modos, y convierte una consulta sin cota en una
 * acotada sin quitarle nada al usuario, que puede ampliarla desde el control del
 * encabezado. Lo importante es que el rango aplicado **se declara** en `scope`:
 * acotar en silencio cambiaría lo que la pantalla afirma sin decirlo.
 *
 * `total` cuenta las filas que existen en el rango, no las devueltas, que es lo
 * que permite decir "muestro 100 de 342" en vez de presentar una lista truncada
 * como si fuera completa.
 *
 * Necesita el servidor (pega a la ruta con sesión):
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
 *     pnpm exec playwright test --project=chromium tests/cortes-cota.spec.ts
 */

/** Primer y último día del mes en curso, en hora local de México. */
function mesEnCurso() {
  const hoy = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return {
    startDate: `${anio}-${mm}-01`,
    endDate: `${anio}-${mm}-${String(ultimo).padStart(2, "0")}`,
    anio,
    mes,
  };
}

const MES = mesEnCurso();
/** Un día del mes pasado, fuera del rango por defecto. */
const DIA_MES_PASADO = (() => {
  // Día 1 del mes anterior: siete días consecutivos desde ahí siguen fuera del
  // mes en curso en cualquier mes del año.
  const d = new Date(Date.UTC(MES.anio, MES.mes - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
})();
/** Un día dentro del mes en curso que existe en cualquier mes. */
const DIA_ESTE_MES = MES.startDate;

/** Último de los días sembrados en el mes pasado. */
function masDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DENTRO = 12;
const FUERA = 7;

test.describe("A8 · la lista de cortes acota, pagina y declara el total", () => {
  /**
   * Sucursal propia del spec. Las sembradas ya traen cortes y otros specs
   * escriben sobre ellas, y `total` cuenta **todas** las filas del rango: con
   * una sucursal compartida los conteos exactos serían una lotería.
   */
  let branchId = "";

  test.beforeAll(async () => {
    branchId = await seedTestBranch(COMPANY_ID, "cota de cortes");
    // Un corte por día: el índice único no deja apilar varios el mismo día con
    // el mismo turno y canal.
    await seedCutsEnDiasConsecutivos({
      companyId: COMPANY_ID,
      branchId,
      desdeDia: DIA_ESTE_MES,
      cantidad: DENTRO,
    });
    await seedCutsEnDiasConsecutivos({
      companyId: COMPANY_ID,
      branchId,
      desdeDia: DIA_MES_PASADO,
      cantidad: FUERA,
    });
  });

  test.afterAll(async () => {
    await deleteTestSalesCuts();
    if (branchId) await deleteTestBranch(branchId);
  });

  test("sin fechas se devuelve el mes en curso, y el alcance lo dice", async ({ request }) => {
    const res = await request.get(`/api/sales/cuts?branchId=${branchId}`);
    expect(res.status()).toBe(200);
    const { data } = await res.json();

    expect(data.scope.rangoPorDefecto, "el rango por defecto no se declaró").toBe(true);
    expect(data.scope.startDate).toBe(MES.startDate);
    expect(data.scope.endDate).toBe(MES.endDate);

    // Ni un solo corte del mes pasado se coló.
    const fechas = (data.items as Array<{ businessDate: string }>).map((c) => c.businessDate);
    expect(fechas.length).toBeGreaterThan(0);
    expect(
      fechas.filter((f) => f < MES.startDate),
      "el rango por defecto dejó pasar cortes de meses anteriores"
    ).toHaveLength(0);
  });

  test("pedir un rango explícito manda sobre el mes en curso", async ({ request }) => {
    const res = await request.get(
      `/api/sales/cuts?branchId=${branchId}&startDate=${DIA_MES_PASADO}&endDate=${masDias(DIA_MES_PASADO, FUERA - 1)}`
    );
    const { data } = await res.json();

    expect(data.scope.rangoPorDefecto, "un rango pedido se marcó como por defecto").toBe(false);
    expect(data.total).toBe(FUERA);
    expect(data.items).toHaveLength(FUERA);
  });

  test("`total` cuenta lo que existe en el rango, no lo que se devolvió", async ({
    request,
  }) => {
    const res = await request.get(
      `/api/sales/cuts?branchId=${branchId}&startDate=${MES.startDate}&endDate=${MES.endDate}&limit=5`
    );
    const { data } = await res.json();

    expect(data.items).toHaveLength(5);
    expect(data.total, "`total` devolvió las filas de la página, no las del rango").toBe(
      DENTRO
    );
    expect(data.scope.truncated, "una lista acotada se presentó como completa").toBe(true);
  });

  test("la última página no se declara truncada", async ({ request }) => {
    const res = await request.get(
      `/api/sales/cuts?branchId=${branchId}&startDate=${MES.startDate}&endDate=${MES.endDate}&limit=5&offset=10`
    );
    const { data } = await res.json();

    expect(data.items).toHaveLength(DENTRO - 10);
    expect(data.total).toBe(DENTRO);
    expect(data.scope.truncated).toBe(false);
  });

  test("un `limit` desmedido se recorta al tope, no tumba la consulta", async ({ request }) => {
    const res = await request.get(`/api/sales/cuts?branchId=${branchId}&limit=100000`);
    const { data } = await res.json();

    expect(res.status()).toBe(200);
    expect(data.scope.limit).toBe(500);
  });

  test("un `limit` basura cae al valor por defecto en vez de romper", async ({ request }) => {
    const res = await request.get(`/api/sales/cuts?branchId=${branchId}&limit=abc`);
    const { data } = await res.json();

    expect(res.status()).toBe(200);
    expect(data.scope.limit).toBe(100);
    expect(data.scope.offset).toBe(0);
  });
});
