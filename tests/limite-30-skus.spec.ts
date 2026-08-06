import { test, expect } from "@playwright/test";
import { COMPANY_ID, E2E_TAG } from "./support/constants";
import {
  countHighValueSkus,
  createTestSkus,
  deleteTestSkus,
  restoreHighValue,
  snapshotHighValueIds,
  unsetHighValue,
} from "./support/db";

/**
 * Fase 4 — Límite de 30 SKUs de alto valor.
 *
 * Escenario del plan: con 30 SKUs ya marcados, el intento de marcar el 31 debe
 * rechazarse. Con 29, debe aceptarse.
 */

const MAX = 30;

/** Estado original de la empresa, para restaurarlo al terminar. */
let snapshot: string[] = [];

/** Deja exactamente `n` SKUs de alto valor usando artículos de prueba. */
async function dejarExactamente(n: number) {
  await restoreHighValue(COMPANY_ID, []); // ninguno marcado
  await deleteTestSkus();
  await createTestSkus(COMPANY_ID, n, { isHighValue: true, category: "Otro" });
  expect(await countHighValueSkus(COMPANY_ID)).toBe(n);
}

test.describe.configure({ mode: "serial" });

test.describe("Fase 4 · límite de 30 SKUs de alto valor", () => {
  test.beforeAll(async () => {
    snapshot = await snapshotHighValueIds(COMPANY_ID);
  });

  test.afterAll(async () => {
    await deleteTestSkus();
    await restoreHighValue(COMPANY_ID, snapshot);
  });

  test("acepta el SKU 30 de alto valor", async ({ page }) => {
    await dejarExactamente(MAX - 1);

    const res = await page.request.post("/api/inventory/products", {
      data: {
        name: `${E2E_TAG} SKU numero 30`,
        sku: `E2E-30-${Date.now()}`,
        unit: "UNIT",
        category: "Otro",
        isHighValue: true,
      },
    });

    expect(res.status(), await res.text()).toBe(200);
    const creado = await res.json();
    expect(creado.isHighValue).toBe(true);
    expect(await countHighValueSkus(COMPANY_ID)).toBe(MAX);
  });

  test("rechaza el SKU 31 con el mensaje del límite", async ({ page }) => {
    await dejarExactamente(MAX);

    const res = await page.request.post("/api/inventory/products", {
      data: {
        name: `${E2E_TAG} SKU numero 31`,
        sku: `E2E-31-${Date.now()}`,
        unit: "UNIT",
        category: "Otro",
        isHighValue: true,
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Límite de SKUs de alto valor alcanzado");
    expect(body.error).toContain(`${MAX} de ${MAX}`);

    // No se creó nada de más.
    expect(await countHighValueSkus(COMPANY_ID)).toBe(MAX);
  });

  test("permite crear el SKU 31 si NO se marca como alto valor", async ({ page }) => {
    await dejarExactamente(MAX);

    const res = await page.request.post("/api/inventory/products", {
      data: {
        name: `${E2E_TAG} SKU normal`,
        sku: `E2E-normal-${Date.now()}`,
        unit: "UNIT",
        category: "Otro",
        isHighValue: false,
      },
    });

    expect(res.status(), await res.text()).toBe(200);
    expect(await countHighValueSkus(COMPANY_ID)).toBe(MAX);
  });

  test("al liberar un espacio, el siguiente SKU de alto valor entra", async ({ page }) => {
    await dejarExactamente(MAX);

    // Liberar un lugar desmarcando uno de los SKUs de prueba.
    const marcados = await snapshotHighValueIds(COMPANY_ID);
    await unsetHighValue([marcados[0]]);
    expect(await countHighValueSkus(COMPANY_ID)).toBe(MAX - 1);

    const res = await page.request.post("/api/inventory/products", {
      data: {
        name: `${E2E_TAG} SKU reemplazo`,
        sku: `E2E-reemplazo-${Date.now()}`,
        unit: "UNIT",
        category: "Otro",
        isHighValue: true,
      },
    });

    expect(res.status(), await res.text()).toBe(200);
    expect(await countHighValueSkus(COMPANY_ID)).toBe(MAX);
  });
});
