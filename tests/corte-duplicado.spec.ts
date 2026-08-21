import { test, expect } from "@playwright/test";
import { COMPANY_ID } from "./support/constants";
import { deleteTestBranch, seedTestBranch } from "./support/db";

/**
 * Auditoría A15 — el corte duplicado por carrera devuelve 409, no un 500.
 *
 * El `POST` comprueba duplicados con un `SELECT` previo y responde un 409 con
 * mensaje en español. Pero entre ese `SELECT` y el `INSERT` hay una ventana:
 * dos envíos simultáneos —un doble clic en el formulario basta— la pasan los
 * dos, y el segundo choca contra `daily_sales_cut_unique` como un **500 crudo
 * de Postgres**. Quien captura ve "error del servidor" sobre algo que el
 * sistema sabe explicar perfectamente.
 *
 * El índice único es la guarda real; el pre-`SELECT` sólo da el mensaje más
 * temprano. `onConflictDoNothing` traduce el choque al mismo 409.
 *
 * Necesita el servidor:
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
 *     pnpm exec playwright test --project=chromium tests/corte-duplicado.spec.ts
 */

const FECHA = "2019-07-11";

test.describe("A15 · dos cortes simultáneos: uno entra, el otro recibe 409", () => {
  /** Sucursal propia: la carrera necesita que nadie más escriba este par. */
  let branchId = "";

  test.beforeEach(async () => {
    branchId = await seedTestBranch(COMPANY_ID, "corte duplicado");
  });

  test.afterEach(async () => {
    // `deleteTestBranch` se lleva los cortes de la sucursal: estos se crean por
    // la API, así que no llevan la etiqueta que busca `deleteTestSalesCuts`.
    if (branchId) await deleteTestBranch(branchId);
    branchId = "";
  });

  const cuerpo = () => ({
    branchId,
    businessDate: FECHA,
    shift: "COMPLETO" as const,
    channel: "TOTAL" as const,
    totalSales: 90_000,
    cardSales: 90_000,
  });

  test("el segundo envío simultáneo recibe 409 con mensaje legible, no un 500", async ({
    request,
  }) => {
    const [a, b] = await Promise.all([
      request.post("/api/sales/cuts", { data: cuerpo() }),
      request.post("/api/sales/cuts", { data: cuerpo() }),
    ]);

    const estados = [a.status(), b.status()].sort();

    expect(
      estados.filter((s) => s === 500),
      "la carrera se filtró como un 500 de Postgres"
    ).toHaveLength(0);
    expect(estados, "esperaba exactamente un éxito y un 409").toEqual([200, 409]);

    // Y el 409 explica qué pasó, en el idioma del producto.
    const perdedor = a.status() === 409 ? a : b;
    const json = await perdedor.json();
    expect(JSON.stringify(json)).toMatch(/Ya existe un corte/i);
  });

  test("el envío secuencial repetido sigue dando el mismo 409", async ({ request }) => {
    // El pre-SELECT sigue haciendo su trabajo cuando no hay carrera: el cambio
    // no debía sustituirlo, sólo cubrir la ventana que dejaba abierta.
    const primero = await request.post("/api/sales/cuts", { data: cuerpo() });
    expect(primero.ok()).toBe(true);

    const segundo = await request.post("/api/sales/cuts", { data: cuerpo() });
    expect(segundo.status()).toBe(409);
    expect(JSON.stringify(await segundo.json())).toMatch(/Ya existe un corte/i);
  });
});
