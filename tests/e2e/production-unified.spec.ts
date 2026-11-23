import { test, expect } from "@playwright/test";
import { startSalesEntryBrowserServer } from "../support/sales-entry-browser-server";

let harness: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;

test.beforeAll(async () => {
  harness = await startSalesEntryBrowserServer(undefined, "production");
});

test.afterAll(async () => {
  await harness?.server.close();
});

test.describe("PROD-02 (V3 navegador): cierre de orden con orderId y lote terminado visible", () => {
  test("Completar Lote propaga orderId al POST y muestra saldo, caducidad y procedencia en Órdenes y En línea", async ({ page }) => {
    const orderId = "o1000000-0000-4000-8000-000000000001";
    const recipeId = "r1000000-0000-4000-8000-000000000001";
    const finishedBatchId = "f1000000-0000-4000-8000-000000000001";
    let completed = false;
    const postPayloads: Record<string, unknown>[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.route("**/api/inventory/production/prep-list**", route =>
      route.fulfill({
        json: {
          success: true,
          data: {
            date: "2026-11-22",
            timezone: "America/Mexico_City",
            totals: { total: 0, done: 0, pending: 0, overdue: 0 },
            groups: [],
          },
        },
      })
    );
    await page.route("**/api/inventory/production/suggestions**", route =>
      route.fulfill({ json: { suggestions: [] } })
    );
    await page.route("**/api/inventory/recipes**", route =>
      route.fulfill({ json: [{ id: recipeId, name: "Salsa Poblana", unit: "KG" }] })
    );
    await page.route("**/api/inventory/production?*", route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("preview") === "true") {
        return route.fulfill({
          json: {
            success: true,
            preview: [
              {
                itemId: "i1000000-0000-4000-8000-000000000001",
                itemName: "Chile Poblano",
                requiredQuantity: 4,
                unit: "KG",
                allocations: [
                  {
                    batchId: "b1000000-0000-4000-8000-000000000009",
                    lotNumber: "L-POBLANO-01",
                    expirationDate: "2027-06-01T00:00:00.000Z",
                    quantity: 4,
                  },
                ],
                allocatedQuantity: 4,
                shortfall: 0,
              },
            ],
          },
        });
      }
      return route.fulfill({
        json: {
          success: true,
          orders: [
            {
              order: {
                id: orderId,
                plannedQuantity: 2,
                unit: "KG",
                plannedDate: "2026-11-22T00:00:00.000Z",
                status: completed ? "COMPLETED" : "IN_PROGRESS",
                notes: "Lote turno matutino",
              },
              recipe: { id: recipeId, name: "Salsa Poblana" },
              finishedBatch: completed
                ? {
                    id: finishedBatchId,
                    itemName: "Salsa Poblana (Elaborado)",
                    lotNumber: null,
                    currentQuantity: "2.0000",
                    initialQuantity: "2.0000",
                    unit: "KG",
                    expirationDate: "2027-06-01T00:00:00.000Z",
                    origin: "PRODUCTION",
                    parentBatchCount: 1,
                  }
                : null,
            },
          ],
        },
      });
    });

    await page.route("**/api/inventory/production", route => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        postPayloads.push(body);
        completed = true;
        return route.fulfill({
          json: {
            success: true,
            result: {
              id: "res-1",
              finishedBatchId,
              producedQuantity: 2,
              ingredientCost: 10000,
              shortfalls: [],
            },
          },
        });
      }
      return route.continue();
    });

    await page.route("**/api/inventory/production/hold-time**", route =>
      route.fulfill({
        json: {
          success: true,
          data: {
            graceMinutes: 30,
            expired: [],
            expiringSoon: [
              {
                id: "res-1",
                recipeId,
                recipeName: "Salsa Poblana",
                producedQuantity: 2,
                unit: "KG",
                holdTimeMinutes: 30,
                status: "EXPIRING",
                minutesOverdue: 0,
                minutesRemaining: 12,
                notified: false,
                estimatedLossCents: 10000,
                finishedBatch: {
                  id: finishedBatchId,
                  lotNumber: null,
                  currentQuantity: "2.0000",
                  unit: "KG",
                  expirationDate: "2027-06-01T00:00:00.000Z",
                  origin: "PRODUCTION",
                  parentBatchCount: 1,
                },
              },
            ],
          },
        },
      })
    );

    await page.goto(harness.url);
    await page.getByRole("tab", { name: /Órdenes/i }).click();
    await expect(page.getByText("Salsa Poblana")).toBeVisible();
    await page.getByRole("button", { name: /Completar Lote/i }).click();

    await expect(page.getByRole("heading", { name: "Completar Orden de Producción" })).toBeVisible();
    await expect(page.getByText("Lote: L-POBLANO-01")).toBeVisible();
    await page.getByRole("button", { name: /Confirmar y Descontar Lotes/i }).click();

    await expect.poll(() => postPayloads.length).toBe(1);
    expect(postPayloads[0]).toMatchObject({
      action: "record",
      orderId,
      recipeId,
      producedQuantity: 2,
    });

    await expect(page.getByText("Saldo: 2.00/2.00 KG")).toBeVisible();
    await expect(page.getByText(/Procedencia: Producción · 1 lote\(s\) de insumo/)).toBeVisible();
    await expect(page.getByText(/Caducidad:/)).toBeVisible();

    await page.getByRole("tab", { name: /En línea/i }).click();
    await expect(page.getByText(/Saldo 2\.00 KG · Procedencia: Producción \(1 insumos\)/)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
