import { test, expect } from "@playwright/test";
import {
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  BRANCH_ROMA,
  COMPANY_ID,
  USER_SUPER_ADMIN,
} from "./support/constants";
import {
  countPettyCashFunds,
  deactivatePettyCashFund,
  deleteTestBranch,
  findPettyCashFund,
  findPettyCashTransactions,
  seedTestBranch,
} from "./support/db";
import {
  getFund,
  openFund,
  registerOutflow,
  replenishFund,
} from "../lib/services/petty-cash-service";

/**
 * Auditoría A1 — leer el estado de caja chica no puede escribirlo.
 *
 * `GET /api/petty-cash?branchId=…` llamaba a `getOrCreateFund`, así que **abrir
 * la pantalla** con alcance "todas" insertaba un fondo por sucursal con
 * `fund_amount = current_balance = $5,000` que nadie entregó, y los sumaba como
 * saldo real de la cadena. Un usuario que solo miraba escribía datos.
 *
 * Casi todo el spec pega al servicio, no al servidor, y corre en segundos:
 *   pnpm exec playwright test --no-deps --project=chromium tests/petty-cash-lectura-pura.spec.ts
 * El último caso es la excepción: pega al `GET` real con sesión, porque el
 * criterio de A1 es sobre la ruta y una envoltura puede volver a escribir sin
 * que el servicio se entere.
 *
 * La sucursal se crea aquí a propósito. Las sembradas pueden traer fondo ya
 * escrito —justamente por este bug—, y entonces el caso no probaría nada.
 */

let branchId = "";

test.describe("A1 · caja chica: la lectura no crea fondos", () => {
  test.beforeEach(async () => {
    branchId = await seedTestBranch(COMPANY_ID, "caja chica");
  });

  test.afterEach(async () => {
    if (branchId) await deleteTestBranch(branchId);
    branchId = "";
  });

  test("leer una sucursal sin fondo devuelve null y no inserta ninguna fila", async () => {
    const antes = await countPettyCashFunds(COMPANY_ID);

    const fund = await getFund(COMPANY_ID, branchId);
    expect(fund).toBeNull();

    // Leer diez veces tampoco: el abanico de la vista consolidada pega una vez
    // por sucursal, y era ahí donde se multiplicaban los fondos fantasma.
    for (let i = 0; i < 10; i++) {
      expect(await getFund(COMPANY_ID, branchId)).toBeNull();
    }

    expect(await countPettyCashFunds(COMPANY_ID)).toBe(antes);
    expect(await findPettyCashFund(COMPANY_ID, branchId)).toBeNull();
  });

  test("un retiro sin fondo abierto falla y no lo crea al paso", async () => {
    const antes = await countPettyCashFunds(COMPANY_ID);

    await expect(
      registerOutflow({
        companyId: COMPANY_ID,
        branchId,
        amountCents: 15000,
        concept: "[E2E] retiro sin fondo",
        registeredBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/no tiene un fondo de caja chica/i);

    expect(await countPettyCashFunds(COMPANY_ID)).toBe(antes);
    expect(await findPettyCashFund(COMPANY_ID, branchId)).toBeNull();
  });

  test("una reposición sin fondo abierto falla y no lo crea al paso", async () => {
    const antes = await countPettyCashFunds(COMPANY_ID);

    await expect(
      replenishFund({
        companyId: COMPANY_ID,
        branchId,
        amountCents: 50000,
        registeredBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/no tiene un fondo de caja chica/i);

    expect(await countPettyCashFunds(COMPANY_ID)).toBe(antes);
    expect(await findPettyCashFund(COMPANY_ID, branchId)).toBeNull();
  });

  test("abrir el fondo usa el monto capturado, nunca los $5,000 inventados", async () => {
    // Un monto que ningún default podría producir por casualidad.
    const entregado = 123_456;

    await openFund({
      companyId: COMPANY_ID,
      branchId,
      fundAmountCents: entregado,
      openedBy: USER_SUPER_ADMIN,
    });

    const fondo = await findPettyCashFund(COMPANY_ID, branchId);
    expect(fondo).not.toBeNull();
    expect(fondo!.fundAmount).toBe(entregado);
    expect(fondo!.currentBalance).toBe(entregado);
    // 20% del fondo entregado, no el $1,000 fijo de antes.
    expect(fondo!.lowThreshold).toBe(Math.round(entregado * 0.2));

    // La apertura deja movimiento: un fondo con saldo y bitácora vacía es
    // exactamente la huella que dejaban los fondos fantasma.
    const movs = await findPettyCashTransactions(fondo!.id);
    expect(movs).toHaveLength(1);
    expect(movs[0].type).toBe("REPLENISHMENT");
    expect(movs[0].amount).toBe(entregado);
  });

  test("abrir dos veces la misma sucursal no duplica el fondo", async () => {
    await openFund({
      companyId: COMPANY_ID,
      branchId,
      fundAmountCents: 200_000,
      openedBy: USER_SUPER_ADMIN,
    });
    const despuesDeLaPrimera = await countPettyCashFunds(COMPANY_ID);

    await expect(
      openFund({
        companyId: COMPANY_ID,
        branchId,
        fundAmountCents: 900_000,
        openedBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/ya tiene un fondo/i);

    expect(await countPettyCashFunds(COMPANY_ID)).toBe(despuesDeLaPrimera);
    // El segundo intento tampoco pisó el monto del primero.
    expect((await findPettyCashFund(COMPANY_ID, branchId))!.fundAmount).toBe(200_000);
  });

  test("dos aperturas simultáneas: una gana, la otra falla, y queda un solo fondo", async () => {
    // La guarda real es el índice único `petty_cash_fund_branch_unique`; sin él
    // dos peticiones concurrentes pasarían las dos el pre-SELECT.
    const resultados = await Promise.allSettled([
      openFund({
        companyId: COMPANY_ID,
        branchId,
        fundAmountCents: 300_000,
        openedBy: USER_SUPER_ADMIN,
      }),
      openFund({
        companyId: COMPANY_ID,
        branchId,
        fundAmountCents: 400_000,
        openedBy: USER_SUPER_ADMIN,
      }),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);

    const fondo = await findPettyCashFund(COMPANY_ID, branchId);
    expect(fondo).not.toBeNull();
    // Y un solo movimiento de apertura: la transacción de la que perdió se
    // deshace entera.
    expect(await findPettyCashTransactions(fondo!.id)).toHaveLength(1);
  });

  test("el GET real de todas las sucursales no inserta ni una fila", async ({ request }) => {
    // El criterio de A1 tal cual: la vista consolidada pega una vez por
    // sucursal, y era ahí donde nacían los fondos. Usa la sesión de admin que
    // dejó `auth.setup.ts`, así que necesita el servidor levantado.
    const antes = await countPettyCashFunds(COMPANY_ID);

    for (const b of [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA, branchId]) {
      const res = await request.get(`/api/petty-cash?branchId=${b}`);
      expect(res.status(), `GET de la sucursal ${b}`).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    }

    expect(
      await countPettyCashFunds(COMPANY_ID),
      "abrir la pantalla escribió fondos que nadie entregó"
    ).toBe(antes);
    // La sucursal recién creada sigue sin fondo: el GET la dejó como estaba.
    expect(await findPettyCashFund(COMPANY_ID, branchId)).toBeNull();
  });

  // ── Baja y reapertura (saneo de los fondos fantasma) ──────────────────────

  test("un fondo dado de baja se lee como si no hubiera fondo", async () => {
    await openFund({
      companyId: COMPANY_ID,
      branchId,
      fundAmountCents: 500_000,
      openedBy: USER_SUPER_ADMIN,
    });
    await deactivatePettyCashFund(COMPANY_ID, branchId);

    // La fila sigue ahí —es la evidencia de que el sistema la escribió— pero
    // deja de sumar al saldo de la cadena.
    expect(await getFund(COMPANY_ID, branchId)).toBeNull();
    expect(await findPettyCashFund(COMPANY_ID, branchId)).not.toBeNull();

    // Y no se puede mover efectivo contra un fondo que ya no está abierto.
    await expect(
      registerOutflow({
        companyId: COMPANY_ID,
        branchId,
        amountCents: 1_000,
        concept: "[E2E] retiro sobre fondo dado de baja",
        registeredBy: USER_SUPER_ADMIN,
      })
    ).rejects.toThrow(/no tiene un fondo de caja chica/i);
  });

  test("un fondo dado de baja se reabre con el monto real, no con el inventado", async () => {
    // El caso del saneo: la sucursal quedó sin fondo visible y la gerente
    // captura el efectivo que de verdad tiene en la caja.
    await openFund({
      companyId: COMPANY_ID,
      branchId,
      fundAmountCents: 500_000,
      openedBy: USER_SUPER_ADMIN,
    });
    await deactivatePettyCashFund(COMPANY_ID, branchId);
    const antes = await countPettyCashFunds(COMPANY_ID);

    await openFund({
      companyId: COMPANY_ID,
      branchId,
      fundAmountCents: 37_500,
      openedBy: USER_SUPER_ADMIN,
    });

    const fondo = await getFund(COMPANY_ID, branchId);
    expect(fondo).not.toBeNull();
    expect(fondo!.fundAmount).toBe(37_500);
    expect(fondo!.currentBalance).toBe(37_500);
    // Se reabrió la misma fila: el índice único no mira `active`, así que un
    // INSERT nuevo habría chocado.
    expect(await countPettyCashFunds(COMPANY_ID)).toBe(antes);

    const movs = await findPettyCashTransactions(fondo!.id);
    expect(movs.at(-1)!.concept).toMatch(/Reapertura/i);
    expect(movs.at(-1)!.amount).toBe(37_500);
  });

  test("con el fondo abierto, retiro y reposición vuelven a funcionar", async () => {
    await openFund({
      companyId: COMPANY_ID,
      branchId,
      fundAmountCents: 100_000,
      openedBy: USER_SUPER_ADMIN,
    });

    const retiro = await registerOutflow({
      companyId: COMPANY_ID,
      branchId,
      amountCents: 30_000,
      concept: "[E2E] gas",
      registeredBy: USER_SUPER_ADMIN,
    });
    expect(retiro.newBalanceCents).toBe(70_000);

    const reposicion = await replenishFund({
      companyId: COMPANY_ID,
      branchId,
      amountCents: 20_000,
      registeredBy: USER_SUPER_ADMIN,
    });
    expect(reposicion.newBalanceCents).toBe(90_000);

    expect((await findPettyCashFund(COMPANY_ID, branchId))!.currentBalance).toBe(90_000);
  });
});
