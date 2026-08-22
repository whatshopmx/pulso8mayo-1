import { test, expect } from "@playwright/test";
import { COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import { deleteTestBranch, seedTestBranch, sql } from "./support/db";
import {
  getPettyCashConsolidado,
  openFund,
  registerOutflow,
} from "../lib/services/petty-cash-service";

/**
 * A17 — El estado de caja chica de la cadena, en una sola lectura.
 *
 * La pantalla pedía **dos endpoints por sucursal**: con 15 sucursales, 30
 * peticiones, cada una atravesando el limitador de tasa y una verificación de
 * sesión que es a su vez un `fetch` interno. Peor que el costo era la
 * consecuencia: como cada petición podía fallar sola, el saldo de la cadena era
 * la suma de las que alcanzaron a contestar, y la página tenía que avisar de
 * cuáles no sabía nada. Con una sola petición ese estado desaparece — falla
 * entera o no falla.
 *
 * Todos los casos menos el último pegan al servicio y corren sin servidor:
 *   pnpm exec playwright test --no-deps --project=chromium tests/caja-chica-consolidado.spec.ts
 * El último necesita el build, porque el criterio es sobre cuántas peticiones
 * hace la pantalla y eso no se puede comprobar desde el servicio.
 */

const TODAS = { kind: "ALL" } as const;

/** Suma de los fondos **activos** de la empresa, leída de la base. */
async function saldoRealDeLaCadena(): Promise<{ saldo: number; fondo: number; n: number }> {
  const rows = await sql`
    SELECT
      COALESCE(SUM(current_balance), 0)::int AS saldo,
      COALESCE(SUM(fund_amount), 0)::int     AS fondo,
      COUNT(*)::int                          AS n
    FROM petty_cash_funds
    WHERE company_id = ${COMPANY_ID} AND active = true
  `;
  return {
    saldo: Number(rows[0].saldo),
    fondo: Number(rows[0].fondo),
    n: Number(rows[0].n),
  };
}

test.describe("A17 · consolidado de caja chica", () => {
  let sucursalA = "";
  let sucursalB = "";

  test.beforeAll(async () => {
    // Sucursales propias: las sembradas pueden traer fondo o no, y el caso
    // compara contra SQL directo — necesita saber exactamente qué añadió.
    sucursalA = await seedTestBranch(COMPANY_ID, "consolidado A");
    sucursalB = await seedTestBranch(COMPANY_ID, "consolidado B");

    await openFund({
      companyId: COMPANY_ID,
      branchId: sucursalA,
      fundAmountCents: 10_000_00,
      lowThresholdCents: 2_000_00,
      openedBy: USER_SUPER_ADMIN,
    });

    // La B queda deliberadamente **bajo umbral**: es la que debe salir primero.
    await openFund({
      companyId: COMPANY_ID,
      branchId: sucursalB,
      fundAmountCents: 5_000_00,
      lowThresholdCents: 4_000_00,
      openedBy: USER_SUPER_ADMIN,
    });
    await registerOutflow({
      companyId: COMPANY_ID,
      branchId: sucursalB,
      amountCents: 2_000_00,
      concept: "[E2E] gasto que deja el fondo bajo umbral",
      registeredBy: USER_SUPER_ADMIN,
    });
  });

  test.afterAll(async () => {
    if (sucursalA) await deleteTestBranch(sucursalA);
    if (sucursalB) await deleteTestBranch(sucursalB);
  });

  test("el agregado coincide con la suma de la base", async () => {
    const real = await saldoRealDeLaCadena();
    const consolidado = await getPettyCashConsolidado(COMPANY_ID, TODAS);

    expect(consolidado.totals.currentBalanceCents).toBe(real.saldo);
    expect(consolidado.totals.fundAmountCents).toBe(real.fondo);
    expect(consolidado.totals.branchesWithFund).toBe(real.n);
    expect(consolidado.rows).toHaveLength(real.n);

    // Y las dos sucursales del caso están, con lo que se les abrió menos lo que
    // se les sacó.
    const a = consolidado.rows.find((r) => r.branchId === sucursalA);
    const b = consolidado.rows.find((r) => r.branchId === sucursalB);
    expect(a?.currentBalanceCents).toBe(10_000_00);
    expect(b?.currentBalanceCents).toBe(3_000_00);
  });

  test("el orden por urgencia y el conteo bajo umbral los decide el servidor", async () => {
    const consolidado = await getPettyCashConsolidado(COMPANY_ID, TODAS);

    // B tiene $3,000 contra un umbral de $4,000: está bajo el suyo.
    const b = consolidado.rows.find((r) => r.branchId === sucursalB);
    expect(b?.belowThreshold, "la sucursal bajo umbral no se marcó").toBe(true);
    expect(consolidado.totals.branchesBelowThreshold).toBeGreaterThanOrEqual(1);

    // Las que necesitan efectivo van primero: la pregunta de la pantalla es
    // "¿a dónde mando dinero?", no "¿cómo se llaman mis sucursales?".
    const bajoUmbral = consolidado.rows.filter((r) => r.belowThreshold);
    const primeras = consolidado.rows.slice(0, bajoUmbral.length);
    expect(
      primeras.every((r) => r.belowThreshold),
      "una sucursal con saldo suficiente se coló antes de una bajo umbral"
    ).toBe(true);

    // Dentro de cada grupo, de menos saldo a más.
    for (let i = 1; i < bajoUmbral.length; i++) {
      expect(bajoUmbral[i].currentBalanceCents).toBeGreaterThanOrEqual(
        bajoUmbral[i - 1].currentBalanceCents
      );
    }
  });

  test("una sucursal sin fondo se reporta como tal, no como un cero en la suma", async () => {
    // La distinción que A1 introdujo en la pantalla y A17 mueve al servidor: no
    // tener fondo abierto es efectivo que nadie entregó, no un saldo de cero.
    const sinFondo = await seedTestBranch(COMPANY_ID, "consolidado sin fondo");
    try {
      const consolidado = await getPettyCashConsolidado(COMPANY_ID, TODAS);

      expect(consolidado.branchesWithoutFund.map((b) => b.branchId)).toContain(sinFondo);
      expect(
        consolidado.rows.map((r) => r.branchId),
        "una sucursal sin fondo entró al agregado con saldo cero"
      ).not.toContain(sinFondo);
    } finally {
      await deleteTestBranch(sinFondo);
    }
  });

  test("un alcance NONE no devuelve la cadena entera", async () => {
    // Un rol acotado a sucursal sin sucursal asignada. Fallar abierto aquí es
    // enseñarle el efectivo de todo el grupo.
    const consolidado = await getPettyCashConsolidado(COMPANY_ID, { kind: "NONE" });

    expect(consolidado.rows).toHaveLength(0);
    expect(consolidado.totals.currentBalanceCents).toBe(0);
    expect(consolidado.movimientos.items).toHaveLength(0);
    expect(consolidado.movimientos.total).toBe(0);
  });

  test("la bitácora viene acotada y declara cuántos movimientos existen", async () => {
    // A19 — El `total` es el de la cadena; `items` es lo que cabe. Decir
    // "3 movimientos" cuando hay 4,000 sería afirmar de menos sobre el libro.
    const consolidado = await getPettyCashConsolidado(COMPANY_ID, TODAS, {
      movimientosLimit: 2,
    });

    expect(consolidado.movimientos.items.length).toBeLessThanOrEqual(2);
    expect(consolidado.movimientos.limit).toBe(2);
    expect(
      consolidado.movimientos.total,
      "el total no puede ser menor que lo que ya se trajo"
    ).toBeGreaterThanOrEqual(consolidado.movimientos.items.length);
  });

  test("la pantalla hace una sola petición con alcance «todas»", async ({ page }) => {
    // Se registra la ruta **y** si llevaba `branchId`: el alcance por omisión no
    // es "Todas" —`lib/branch-context.tsx:55` autoselecciona la primera sucursal
    // cuando no hay cookie— así que la pantalla carga una vez acotada antes de
    // que el caso pueda pedir la cadena entera. Separar por alcance mide lo que
    // importa sin depender de ese baile.
    const pedidas: Array<{ path: string; branchId: string | null }> = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith("/api/petty-cash")) {
        pedidas.push({ path: url.pathname, branchId: url.searchParams.get("branchId") });
      }
    });

    await page.goto("/dashboard/finance/petty-cash");
    await expect(page.getByRole("heading", { name: /Caja Chica/i })).toBeVisible();

    // Hay que dejar que el alcance **se asiente** antes de tocarlo. La pantalla
    // carga primero sin sucursal (el encabezado dice "Todas") y un instante
    // después el contexto autoselecciona la primera de la lista. Pulsar "Todas"
    // en esa ventana es un no-op —ya es `null`, no hay cambio de estado, no hay
    // recarga— y el anclaje llega justo después, dejando la pantalla acotada
    // con el botón diciendo "Todas". El caso fallaba por eso, no por la app.
    await expect(page.getByRole("button", { name: /Sucursal:/ })).not.toContainText(
      /Todas/,
      { timeout: 15_000 }
    );

    // El conteo arranca aquí: lo que se mide es lo que cuesta **pintar la cadena
    // entera**, no la suma de todo lo que pasó por la pantalla mientras se
    // llegaba al alcance correcto.
    pedidas.length = 0;

    await page.getByRole("button", { name: /Sucursal:/ }).click();
    await page.getByRole("menuitem", { name: "Todas" }).click();
    await expect(page.getByText(/Vista consolidada/i)).toBeVisible();
    // Margen por si alguna carga tardía dispara algo más.
    await page.waitForTimeout(1500);

    // El alcance elegido **aguanta**. `setBranches` de `lib/branch-context.tsx`
    // reponía la primera sucursal cuando la selección era `null`, y como
    // `components/nav-company.tsx:62` lo vuelve a llamar en cada cambio de
    // alcance, elegir "Todas" rebotaba a una sucursal sola sin decir nada.
    // Esta aserción es la que lo sostiene: sin la corrección, a esta altura la
    // pantalla ya volvió a estar acotada.
    await expect(
      page.getByText(/Vista consolidada/i),
      "el alcance rebotó a una sucursal después de elegir «Todas»"
    ).toBeVisible();

    // Ni `/api/petty-cash` ni `/api/petty-cash/transactions`: el abanico murió.
    expect(
      pedidas.filter((p) => p.path !== "/api/petty-cash/consolidado"),
      "la pantalla sigue pidiendo por las rutas viejas"
    ).toEqual([]);

    // Y la cadena entera costó exactamente una petición, no una por sucursal.
    expect(
      pedidas.filter((p) => p.branchId === null),
      `el alcance "todas" costó ${pedidas.filter((p) => p.branchId === null).length} peticiones`
    ).toHaveLength(1);
  });
});
