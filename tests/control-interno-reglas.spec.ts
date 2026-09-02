import { test, expect } from "@playwright/test";
import { COMPANY_ID, USER_ADMIN, USER_SUPER_ADMIN } from "./support/constants";
import {
  deleteAuthorizationRulesForBranch,
  deleteTestBranch,
  deleteTestCostCenters,
  deleteTestExpenses,
  deleteTestPettyCash,
  deleteTestSalesCuts,
  seedAuthorizationRule,
  seedExpenseDetallado,
  seedPettyCashFund,
  seedPettyCashOutflow,
  seedSalesCutConIva,
  seedTestBranch,
  seedTestCostCenter,
  seedTestPayee,
} from "./support/db";
import { detectViolations } from "../lib/services/control-interno-service";
import { getPnLByBranch } from "../lib/services/pnl-service";

/**
 * Fases 4 y 5 — que la excepción valga lo que cuesta.
 *
 * Lo que estaba roto:
 *  - `SELF_APPROVAL` conservaba `matchingRule.minAmount > 0`, justo el carve-out
 *    que A16 había eliminado de `expense-service` por vaciar la segregación de
 *    funciones: el detector no veía los autoaprobados del tramo más bajo, que es
 *    donde vive la mayoría de los gastos (A5.2).
 *  - No había regla de **fraccionamiento**, que es la forma número uno de evadir
 *    una escalera de aprobación en operación multisucursal (A5.3).
 *  - No había regla de **pago duplicado** (A5.4).
 *  - No se distinguía la forma de pago, así que el gasto en efectivo no deducible
 *    del artículo 27-III de la LISR no se podía señalar (A4.3).
 *  - Ningún archivo del repo fuera de su propio servicio leía
 *    `petty_cash_transactions`: la utilidad operativa del P&L venía
 *    sobreestimada exactamente en el monto de la caja chica (A4.2).
 *
 * No necesita servidor ni Inngest:
 *   pnpm exec playwright test --no-deps --project=chromium tests/control-interno-reglas.spec.ts
 */

let sucursal: string;

/** Ayer, para que los gastos caigan dentro de la ventana de 90 días. */
function hace(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
}

async function excepcionesDeMiSucursal() {
  const todas = await detectViolations(COMPANY_ID, sucursal);
  return todas;
}

test.describe("Fase 5 · reglas nuevas de Control Interno", () => {
  test.beforeEach(async () => {
    sucursal = await seedTestBranch(COMPANY_ID, "control interno");
  });

  test.afterEach(async () => {
    await deleteTestExpenses();
    await deleteTestPettyCash();
    // Antes de borrar la sucursal: las reglas la referencian por llave foránea.
    await deleteAuthorizationRulesForBranch(sucursal);
    await deleteTestBranch(sucursal);
    await deleteTestCostCenters();
  });

  test("A5.2 · un autoaprobado del tramo bajo ya no se escapa", async () => {
    // $500: por debajo de cualquier escalón de autorización. Antes la regla
    // exigía `matchingRule.minAmount > 0` y este gasto no producía hallazgo.
    await seedExpenseDetallado({
      companyId: COMPANY_ID,
      branchId: sucursal,
      requestedBy: USER_ADMIN,
      approvedBy: USER_ADMIN,
      amountCents: 50_000,
      description: "[E2E] autoaprobado tramo bajo",
      status: "APPROVED",
    });

    const v = await excepcionesDeMiSucursal();
    const self = v.filter((x) => x.type === "SELF_APPROVAL");

    expect(self.length, "el autoaprobado del tramo bajo sigue invisible").toBe(1);
    expect(self[0].severity).toBe("HIGH");
    expect(self[0].detail).toMatch(/no depende del monto/i);
  });

  test("A5.3 · tres gastos de $4,000 el mismo día producen un hallazgo", async () => {
    // Escalón en $10,000: ninguno de los tres lo cruza por separado, la suma sí.
    // La empresa sembrada no trae ninguna regla capturada —que es el estado de
    // todo inquilino nuevo— y su umbral de doble autorización está en $50,000,
    // así que sin este escalón no habría barrera de $10,000 que evadir.
    await seedAuthorizationRule({
      companyId: COMPANY_ID,
      branchId: sucursal,
      minAmountCents: 1_000_000,
      approverRole: "ADMIN",
    });

    const payeeId = await seedTestPayee(COMPANY_ID, "Proveedor fraccionado");
    const costCenterId = await seedTestCostCenter(COMPANY_ID, "CC fraccionamiento");

    for (let i = 0; i < 3; i++) {
      await seedExpenseDetallado({
        companyId: COMPANY_ID,
        branchId: sucursal,
        requestedBy: USER_SUPER_ADMIN,
        approvedBy: USER_ADMIN,
        payeeId,
        costCenterId,
        amountCents: 400_000,
        description: `[E2E] fraccionado ${i}`,
        status: "APPROVED",
        createdAt: hace(2),
      });
    }

    const v = await excepcionesDeMiSucursal();
    const split = v.filter((x) => x.type === "SPLIT_PURCHASE");

    expect(split.length, "el fraccionamiento no se detectó").toBe(1);
    // MEDIA al inicio: el insumo perecedero comprado a diario produce falsos
    // positivos, y se sube a ALTA después de calibrar con datos reales.
    expect(split[0].severity).toBe("MEDIUM");
    expect(split[0].amountCents).toBe(1_200_000);
    // La excepción nombra los tres importes: quien investiga tiene que poder
    // reconocerlos sin abrir otra pantalla.
    expect(split[0].detail).toContain("$4000.00 + $4000.00 + $4000.00");
  });

  test("A5.3 · gastos de contrapartes distintas no son fraccionamiento", async () => {
    const costCenterId = await seedTestCostCenter(COMPANY_ID, "CC compartido");

    for (let i = 0; i < 3; i++) {
      await seedExpenseDetallado({
        companyId: COMPANY_ID,
        branchId: sucursal,
        requestedBy: USER_SUPER_ADMIN,
        approvedBy: USER_ADMIN,
        payeeId: await seedTestPayee(COMPANY_ID, `Proveedor distinto ${i}`),
        costCenterId,
        amountCents: 400_000,
        description: `[E2E] distinto proveedor ${i}`,
        status: "APPROVED",
        createdAt: hace(2),
      });
    }

    const v = await excepcionesDeMiSucursal();
    expect(
      v.filter((x) => x.type === "SPLIT_PURCHASE").length,
      "marcó como fraccionamiento tres compras a proveedores distintos"
    ).toBe(0);
  });

  test("A5.4 · dos pagos idénticos a la misma contraparte en la semana", async () => {
    const payeeId = await seedTestPayee(COMPANY_ID, "Proveedor duplicado");

    for (const dias of [4, 2]) {
      await seedExpenseDetallado({
        companyId: COMPANY_ID,
        branchId: sucursal,
        requestedBy: USER_SUPER_ADMIN,
        approvedBy: USER_ADMIN,
        paidBy: USER_ADMIN,
        payeeId,
        amountCents: 987_600,
        description: `[E2E] duplicado ${dias}`,
        status: "PAID",
        paidAt: hace(dias),
        createdAt: hace(dias),
      });
    }

    const v = await excepcionesDeMiSucursal();
    const dup = v.filter((x) => x.type === "DUPLICATE_PAYMENT");

    expect(dup.length, "el pago duplicado no se detectó").toBe(1);
    // ALTA: a diferencia del fraccionamiento, aquí el dinero ya salió dos veces.
    expect(dup[0].severity).toBe("HIGH");
    expect(dup[0].amountCents).toBe(987_600);
  });

  test("A5.4 · dos pagos idénticos con tres semanas de diferencia no lo son", async () => {
    const payeeId = await seedTestPayee(COMPANY_ID, "Arrendador mensual");

    for (const dias of [40, 10]) {
      await seedExpenseDetallado({
        companyId: COMPANY_ID,
        branchId: sucursal,
        requestedBy: USER_SUPER_ADMIN,
        approvedBy: USER_ADMIN,
        paidBy: USER_ADMIN,
        payeeId,
        amountCents: 1_500_000,
        description: `[E2E] renta ${dias}`,
        status: "PAID",
        paidAt: hace(dias),
        createdAt: hace(dias),
      });
    }

    const v = await excepcionesDeMiSucursal();
    expect(
      v.filter((x) => x.type === "DUPLICATE_PAYMENT").length,
      "marcó como duplicado el pago mensual de una renta"
    ).toBe(0);
  });

  test("A4.3 · un gasto de $3,000 en efectivo genera excepción", async () => {
    await seedExpenseDetallado({
      companyId: COMPANY_ID,
      branchId: sucursal,
      requestedBy: USER_SUPER_ADMIN,
      approvedBy: USER_ADMIN,
      paidBy: USER_ADMIN,
      amountCents: 300_000,
      description: "[E2E] efectivo no deducible",
      status: "PAID",
      paymentMethod: "EFECTIVO",
      paidAt: hace(1),
      createdAt: hace(1),
    });

    const v = await excepcionesDeMiSucursal();
    const cash = v.filter((x) => x.type === "NON_DEDUCTIBLE_CASH");

    expect(cash.length, "el efectivo arriba del límite no se señaló").toBe(1);
    // MEDIA: es dinero que se paga de más en impuestos, no dinero que se fue.
    expect(cash[0].severity).toBe("MEDIUM");
    expect(cash[0].detail).toMatch(/27-III/);
  });

  test("A4.3 · $1,500 en efectivo está por debajo del límite y no genera nada", async () => {
    await seedExpenseDetallado({
      companyId: COMPANY_ID,
      branchId: sucursal,
      requestedBy: USER_SUPER_ADMIN,
      approvedBy: USER_ADMIN,
      paidBy: USER_ADMIN,
      amountCents: 150_000,
      description: "[E2E] efectivo deducible",
      status: "PAID",
      paymentMethod: "EFECTIVO",
      paidAt: hace(1),
      createdAt: hace(1),
    });

    const v = await excepcionesDeMiSucursal();
    expect(v.filter((x) => x.type === "NON_DEDUCTIBLE_CASH").length).toBe(0);
  });

  test("A5.1 · un gasto fuera de la ventana no entra en la detección", async () => {
    await seedExpenseDetallado({
      companyId: COMPANY_ID,
      branchId: sucursal,
      requestedBy: USER_ADMIN,
      approvedBy: USER_ADMIN,
      amountCents: 900_000,
      description: "[E2E] autoaprobado viejo",
      status: "APPROVED",
      createdAt: hace(200),
    });

    // Con la ventana por omisión (90 días) no aparece: una excepción de hace
    // siete meses no es accionable, y traer el histórico entero a memoria en
    // cada carga de la pantalla es lo que A5.1 cerró.
    const conVentana = await detectViolations(COMPANY_ID, sucursal);
    expect(conVentana.filter((x) => x.type === "SELF_APPROVAL").length).toBe(0);

    // Y sí aparece si se pide explícitamente un período que lo cubre.
    const ampliada = await detectViolations(COMPANY_ID, sucursal, { sinceDays: 365 });
    expect(ampliada.filter((x) => x.type === "SELF_APPROVAL").length).toBe(1);
  });
});

test.describe("Fase 4 · la caja chica llega al P&L (A4.2)", () => {
  const INICIO = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const FIN = new Date(Date.now() + 1 * 86_400_000).toISOString().slice(0, 10);

  test.beforeEach(async () => {
    sucursal = await seedTestBranch(COMPANY_ID, "caja chica pnl");
  });

  test.afterEach(async () => {
    await deleteTestPettyCash();
    await deleteTestSalesCuts();
    await deleteTestBranch(sucursal);
  });

  test("una salida de $800 aparece en el P&L de su sucursal", async () => {
    // Con venta capturada: sin ella el renglón de utilidad es `NO_DATA` y vale
    // cero, así que no se podría comprobar que la caja chica entró en la resta.
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: INICIO,
      totalCents: 1_160_000,
      taxCents: 160_000,
    });

    const fundId = await seedPettyCashFund({
      companyId: COMPANY_ID,
      branchId: sucursal,
      fundAmountCents: 500_000,
    });
    await seedPettyCashOutflow({
      fundId,
      amountCents: 80_000,
      concept: "hielo y gas de emergencia",
      registeredBy: USER_SUPER_ADMIN,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal)!;

    expect(mia.pettyCash, "el P&L no trae el renglón de caja chica").toBeTruthy();
    expect(mia.pettyCash!.cents).toBe(80_000);
    expect(mia.pettyCash!.source).toBe("MEASURED");

    // Y está dentro de la resta: antes la tabla existía, nadie la sumaba, y la
    // utilidad operativa venía sobreestimada exactamente en ese monto.
    const otrosCostos =
      mia.foodCost.cents +
      mia.waste.cents +
      mia.labor.cents +
      mia.operatingExpenses.cents +
      (mia.commissions?.cents ?? 0);
    expect(mia.operatingProfit.cents).toBe(1_000_000 - otrosCostos - 80_000);
  });

  test("sin movimientos capturados el renglón es NO_DATA, no cero medido", async () => {
    await seedPettyCashFund({
      companyId: COMPANY_ID,
      branchId: sucursal,
      fundAmountCents: 500_000,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal)!;

    // Un cero medido afirmaría que la sucursal no usó el fondo. "Nadie registró
    // nada" es otra cosa, y en caja chica suele significar que sí se usó.
    expect(mia.pettyCash!.source).toBe("NO_DATA");
    expect(mia.pettyCash!.note).toMatch(/sobreestimada/i);
  });
});
