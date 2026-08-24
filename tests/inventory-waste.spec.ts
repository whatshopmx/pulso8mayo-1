import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, BRANCH_POLANCO, COMPANY_ID, E2E_TAG } from "./support/constants";
import {
  cleanupForeignTenant,
  createTestSkus,
  deleteBatch,
  deleteMovementsForItems,
  deleteTestSkus,
  deleteWasteForItems,
  findBatchExactQuantity,
  findItemLabel,
  findMovementsForItem,
  findUserBranchId,
  findWasteForItem,
  seedBatch,
  seedForeignTenant,
} from "./support/db";

/**
 * T5 (tasks/plan-inventory-waste.md) — `POST /api/inventory/waste` reescrito:
 * decimal-safe (numeric(12,4)) y multi-tenant.
 *
 * - Una merma fraccionaria (0.4 kg) se guarda como 0.4000, descuenta el lote
 *   exacto (2.5 → 2.1000) y escribe el movimiento -0.4000.
 * - Sobre-cantidad → 400 con el código ESTABLE `OVER_QUANTITY` (la UI se apoya
 *   en `error.details.code`, nunca en substrings del mensaje).
 * - Un lote de OTRO tenant → 404 (no 403), para no filtrar existencia.
 */

const TAG = "e2e-waste-api";
const UNIT = "KG";

let itemIds: string[] = [];
let batchId = "";
let foreign: { companyId: string; branchId: string; itemId: string; batchId: string } | null = null;

function postWaste(page: import("@playwright/test").Page, body: Record<string, unknown>) {
  return page.request.post("/api/inventory/waste", { data: body });
}

/**
 * Fija el alcance de sucursal (misma cookie que escribe el header) ANTES de
 * navegar. Sin cookie, un ADMIN cae en "Selecciona una Sucursal" — la página
 * exige contexto de sucursal por diseño — y ni el historial ni el botón de
 * registro llegan a renderizar. El valor debe ser la sucursal donde el test
 * siembra datos (`sessionBranchId`), no una constante.
 */
async function setBranchCookie(page: import("@playwright/test").Page, branchId: string) {
  await page.context().addCookies([
    { name: "pulso_selected_branch", value: branchId, url: "http://localhost:3000" },
  ]);
}

test.describe("T5 · API de mermas (ruta reescrita)", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: UNIT, tags: [TAG] });
  });

  test.afterEach(async () => {
    await deleteWasteForItems(itemIds);
    await deleteMovementsForItems(itemIds);
    if (batchId) await deleteBatch(batchId);
    await deleteTestSkus();
    if (foreign) {
      await cleanupForeignTenant(foreign);
      foreign = null;
    }
    batchId = "";
    itemIds = [];
  });

  test("una merma fraccionaria se guarda como 0.4000 y descuenta el lote exacto", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 2.5,
      unitCostCents: 1234,
      lotNumber: "E2E-T5-LOTE-01",
    });

    const res = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 0.4,
      unit: UNIT,
      reason: "EXPIRED",
      costPerUnit: 12.34,
    });

    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // La API devuelve la cantidad como número (T4), no "0.4000".
    expect(body.data.waste.quantity).toBe(0.4);
    // totalLoss derivado del costo redondeado a centavos: round(0.4 × 1234) = 494.
    expect(body.data.waste.totalLoss).toBe(494);
    expect(body.data.updatedStock).toBe(2.1);

    // En la DB: quantity = 0.4000, el lote bajó exacto y el movimiento es -0.4000.
    const wasteRows = await findWasteForItem(itemId);
    expect(wasteRows).toHaveLength(1);
    expect(wasteRows[0].quantityRaw).toBe("0.4000");
    expect(wasteRows[0].reason).toBe("EXPIRED");

    expect(await findBatchExactQuantity(batchId)).toBe("2.1000");

    const movements = await findMovementsForItem(itemId);
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe("WASTE");
    expect(movements[0].quantityChangeRaw).toBe("-0.4000");
  });

  test("sobre-cantidad es rechazada con el código estable OVER_QUANTITY", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 1,
      lotNumber: "E2E-T5-LOTE-02",
    });

    const res = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 1.5,
      unit: UNIT,
      reason: "EXPIRED",
    });

    expect(res.status(), await res.text()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    // El contrato para la UI (T6): el código vive en details, no en el mensaje.
    expect(body.error.details.code).toBe("OVER_QUANTITY");
    expect(body.error.details.maxQuantity).toBe("1");

    // Nada se escribió: ni merma, ni movimiento, ni decremento de lote.
    expect(await findWasteForItem(itemId)).toHaveLength(0);
    expect(await findMovementsForItem(itemId)).toHaveLength(0);
    expect(await findBatchExactQuantity(batchId)).toBe("1.0000");
  });

  test("un lote de otro tenant responde 404 (no 403) y no escribe nada", async ({ page }) => {
    const itemId = itemIds[0];
    foreign = await seedForeignTenant();

    const res = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId: foreign.batchId,
      itemId,
      quantity: 0.5,
      unit: UNIT,
      reason: "SPILLAGE",
    });

    expect(res.status(), await res.text()).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.details.code).toBe("BATCH_NOT_FOUND");

    // El tenant legítimo no sufrió efectos colaterales.
    expect(await findWasteForItem(itemId)).toHaveLength(0);
    expect(await findMovementsForItem(itemId)).toHaveLength(0);
    // Y el lote ajeno sigue intacto.
    const foreignQty = await findBatchExactQuantity(foreign.batchId);
    expect(foreignQty).toBe("5.0000");
  });

  test("el historial (GET) llega como envelope con cantidad numérica", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 3,
      lotNumber: "E2E-T5-LOTE-03",
    });

    const created = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 0.75,
      unit: UNIT,
      reason: "SPILLAGE",
    });
    expect(created.status(), await created.text()).toBe(200);

    // GET escopeado a la sucursal: envelope + quantity numérica, no "0.7500".
    const res = await page.request.get(
      `/api/inventory/waste?branchId=${BRANCH_POLANCO}`
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const row = body.data.waste.find((w: { waste: { itemId: string } }) => w.waste.itemId === itemId);
    expect(row).toBeTruthy();
    expect(row.waste.quantity).toBe(0.75);
    expect(row.item.unit).toBe(UNIT);
  });
});

/**
 * T6 (tasks/plan-inventory-waste.md) — el formulario acepta fracciones y valida
 * el máximo del lote ANTES de abrir el diálogo destructivo.
 *
 * El lote se siembra en la sucursal que la sesión trae asignada: la página toma
 * `branchId` de la sesión, no de la URL, y la sucursal del usuario semilla ha
 * cambiado entre seeds — leerla de la DB evita fijarla a mano.
 */
test.describe("T6 · Formulario de mermas (entrada fraccionaria)", () => {
  let sessionBranchId = "";

  test.beforeEach(async ({ page }) => {
    sessionBranchId = await findUserBranchId(ADMIN_EMAIL);
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: UNIT, tags: [TAG] });
    // El form vive en la página: sin alcance elegido, la página muestra el
    // empty-state "Selecciona una Sucursal" y no hay botón que clickear.
    await setBranchCookie(page, sessionBranchId);
  });

  test.afterEach(async () => {
    await deleteWasteForItems(itemIds);
    await deleteMovementsForItems(itemIds);
    if (batchId) await deleteBatch(batchId);
    await deleteTestSkus();
    batchId = "";
    itemIds = [];
  });

  /** Deja el formulario con producto y lote elegidos, listo para la cantidad.
   *  Task 3: el formulario vive ahora dentro de un dialog — se abre primero
   *  con el botón del header y el submit se busca DENTRO del dialog (hay dos
   *  botones "Registrar Merma" mientras está abierto). */
  async function selectProductAndBatch(
    page: import("@playwright/test").Page,
    itemLabel: string
  ) {
    // Los dos `<Select>` se habilitan cuando su fetch responde. Esperar la
    // respuesta —y no solo el estado del control— evita depender de si la
    // página está fría: con Neon en frío el catálogo tarda más que el timeout
    // por defecto de `expect`.
    await page.goto("/dashboard/inventory/waste");
    const productos = page.waitForResponse(
      (r) => r.url().includes("/api/inventory/products") && r.status() === 200,
      { timeout: 90_000 }
    );
    await page.getByRole("button", { name: "Registrar Merma" }).click();
    await productos;

    const producto = page.getByLabel("Producto");
    await expect(producto).toBeEnabled({ timeout: 30_000 });
    await producto.click();

    // El waiter se arma ANTES del click que dispara la petición.
    const lotes = page.waitForResponse(
      (r) => r.url().includes("/api/inventory/batches") && r.status() === 200,
      { timeout: 90_000 }
    );
    await page.getByRole("option", { name: itemLabel }).click();
    await lotes;

    const lote = page.getByLabel("Lote");
    await expect(lote).toBeEnabled({ timeout: 30_000 });
    await lote.click();
    await page.getByRole("option").first().click();
  }

  test("0.5 kg se registra desde el formulario y descuenta el lote exacto", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: sessionBranchId,
      itemId,
      quantity: 2.5,
      lotNumber: "E2E-T6-LOTE-01",
    });

    await selectProductAndBatch(page, await findItemLabel(itemId));

    // El campo acepta decimales: antes tenía `min="1"` y un Zod `.min(1)`.
    await page.getByLabel("Cantidad", { exact: true }).fill("0.5");
    await page.getByRole("dialog").getByRole("button", { name: "Registrar Merma" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("0.5");
    // El toast se desvanece solo, así que la evidencia estable del guardado es
    // la respuesta del POST y el diálogo cerrado — no el texto del toast, que
    // además T9 va a reescribir.
    const guardado = page.waitForResponse(
      (r) =>
        r.url().includes("/api/inventory/waste") &&
        r.request().method() === "POST",
      { timeout: 60_000 }
    );
    await dialog.getByRole("button", { name: "Sí, dar de baja" }).click();
    expect((await guardado).status()).toBe(200);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    const wasteRows = await findWasteForItem(itemId);
    expect(wasteRows).toHaveLength(1);
    expect(wasteRows[0].quantityRaw).toBe("0.5000");
    expect(await findBatchExactQuantity(batchId)).toBe("2.0000");
  });

  test("la sobre-cantidad se detiene en el campo, sin abrir el diálogo destructivo", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: sessionBranchId,
      itemId,
      quantity: 1,
      lotNumber: "E2E-T6-LOTE-02",
    });

    await selectProductAndBatch(page, await findItemLabel(itemId));

    await page.getByLabel("Cantidad", { exact: true }).fill("2");
    await page.getByRole("dialog").getByRole("button", { name: "Registrar Merma" }).click();

    // El error vive en el `FormMessage` (anunciable), no en una burbuja nativa,
    // y el diálogo de confirmación no llega a abrirse.
    await expect(page.getByText(`Solo quedan 1 ${UNIT} en este lote`)).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // Y nada se escribió.
    expect(await findWasteForItem(itemId)).toHaveLength(0);
    expect(await findBatchExactQuantity(batchId)).toBe("1.0000");
  });
});

/**
 * Task 2-3 (tasks/plan-mermas-historial.md) — el historial en UI: la fila con
 * motivo/origen legibles, el detalle desde la fila y el refresh del historial
 * al registrar desde el dialog sin recargar.
 */
test.describe("Task 2-3 · Historial de mermas en UI", () => {
  let sessionBranchId = "";

  test.beforeEach(async ({ page }) => {
    sessionBranchId = await findUserBranchId(ADMIN_EMAIL);
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: UNIT });
    // Historial y botón de registro sólo renderizan con sucursal activa.
    await setBranchCookie(page, sessionBranchId);
  });

  test.afterEach(async () => {
    await deleteWasteForItems(itemIds);
    await deleteMovementsForItems(itemIds);
    if (batchId) await deleteBatch(batchId);
    await deleteTestSkus();
    batchId = "";
    itemIds = [];
  });

  async function skuOf(itemId: string) {
    const label = await findItemLabel(itemId);
    return label.slice(label.lastIndexOf("(") + 1, -1);
  }

  test("la fila muestra motivo/origen y la fila abre el detalle", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: sessionBranchId,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H-UI-01",
    });
    const created = await postWaste(page, {
      branchId: sessionBranchId,
      batchId,
      itemId,
      quantity: 0.5,
      unit: UNIT,
      reason: "EXPIRED",
      costPerUnit: 12.34,
      notes: "[E2E-H] nota visible en detalle",
    });
    expect(created.status(), await created.text()).toBe(200);

    // Default del periodo: mes en curso — lo sembrado hoy entra.
    await page.goto("/dashboard/inventory/waste");

    const sku = await skuOf(itemId);
    const row = page.getByRole("row", { name: new RegExp(sku) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Caducidad")).toBeVisible();
    await expect(row.getByText("Captura manual")).toBeVisible();

    // Detalle desde la fila (Sheet). Captura manual → sin link a workflow.
    await row.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("[E2E-H] nota visible en detalle")).toBeVisible();
    await expect(sheet.getByText("$6.17")).toBeVisible(); // round(0.5 × 1234) = 617 centavos
    await expect(sheet.getByRole("link", { name: /flujo de origen/i })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(row).toBeVisible();
  });

  test("registrar desde el dialog refresca el historial sin recargar", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: sessionBranchId,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H-UI-DIALOG",
    });
    const sku = await skuOf(itemId);
    const itemLabel = await findItemLabel(itemId);

    // Deep-link ?registrar=1: el dialog abre solo, el form monta y pide productos.
    const productos = page.waitForResponse(
      (r) => r.url().includes("/api/inventory/products") && r.status() === 200,
      { timeout: 90_000 }
    );
    await page.goto("/dashboard/inventory/waste?registrar=1");
    await productos;

    const producto = page.getByLabel("Producto");
    await expect(producto).toBeEnabled({ timeout: 30_000 });
    await producto.click();
    const lotes = page.waitForResponse(
      (r) => r.url().includes("/api/inventory/batches") && r.status() === 200,
      { timeout: 90_000 }
    );
    await page.getByRole("option", { name: itemLabel }).click();
    await lotes;
    const lote = page.getByLabel("Lote");
    await expect(lote).toBeEnabled({ timeout: 30_000 });
    await lote.click();
    await page.getByRole("option").first().click();

    await page.getByLabel("Cantidad", { exact: true }).fill("1");
    await page.getByRole("dialog").getByRole("button", { name: "Registrar Merma" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const guardado = page.waitForResponse(
      (r) => r.url().includes("/api/inventory/waste") && r.request().method() === "POST",
      { timeout: 60_000 }
    );
    await dialog.getByRole("button", { name: "Sí, dar de baja" }).click();
    expect((await guardado).status()).toBe(200);

    // Sin reload: el dialog se cierra por invalidación del cache y la nueva
    // fila aparece detrás.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const row = page.getByRole("row", { name: new RegExp(sku) });
    await expect(row).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * Task 1 (tasks/plan-mermas-historial.md) — GET /api/inventory/waste con
 * filtros (from/to, reason, category, q), paginación y resumen para el
 * Historial de Mermas. El resumen separa merma real de consumo interno
 * (STAFF/COURTESY, criterio OQ-1) y se computa en SQL con los MISMOS filtros
 * que la lista: los totales no cambian al paginar.
 */
test.describe("Task 1 · GET historial con filtros y resumen", () => {
  /** Día local como YYYY-MM-DD, desplazado n días (convenio from/to del GET). */
  const dayISO = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const getUrl = (qs: string) => `/api/inventory/waste?branchId=${BRANCH_POLANCO}&${qs}`;

  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: UNIT });
  });

  test("from/to acotan el periodo y una fecha inválida es 400", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H1-FECHA",
    });
    const created = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 1,
      unit: UNIT,
      reason: "EXPIRED",
    });
    expect(created.status(), await created.text()).toBe(200);

    const hasOurRow = async (qs: string) => {
      const res = await page.request.get(getUrl(qs));
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      return body.data.waste.some((w: { waste: { itemId: string } }) => w.waste.itemId === itemId);
    };

    expect(await hasOurRow(`from=${dayISO(-1)}&to=${dayISO(1)}`)).toBe(true);
    expect(await hasOurRow(`from=${dayISO(2)}`)).toBe(false);

    const bad = await page.request.get(getUrl("from=ayer"));
    expect(bad.status()).toBe(400);
  });

  test("reason filtra y un motivo inválido es 400", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H1-MOTIVO",
    });
    const created = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 1,
      unit: UNIT,
      reason: "EXPIRED",
    });
    expect(created.status(), await created.text()).toBe(200);

    const rowsWith = async (reason: string | null) => {
      const qs = reason ? `reason=${reason}` : "";
      const res = await page.request.get(getUrl(qs));
      return { status: res.status(), body: await res.json() };
    };

    const valid = await rowsWith("EXPIRED");
    expect(valid.status).toBe(200);
    expect(valid.body.data.waste.some((w: { waste: { itemId: string } }) => w.waste.itemId === itemId)).toBe(true);

    const other = await rowsWith("DAMAGED");
    expect(other.status).toBe(200);
    expect(other.body.data.waste.some((w: { waste: { itemId: string } }) => w.waste.itemId === itemId)).toBe(false);

    const invalid = await rowsWith("NO_EXISTE");
    expect(invalid.status).toBe(400);
  });

  test("q busca por sku y category por categoría del ítem", async ({ page }) => {
    // Ítem con categoría propia para probar ambos filtros sobre el mismo registro.
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: UNIT, category: "E2E-CAT-H1" });
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H1-QCAT",
    });
    const created = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 1,
      unit: UNIT,
      reason: "QUALITY",
    });
    expect(created.status(), await created.text()).toBe(200);

    // El sku vive dentro del label "name (sku)" que arma findItemLabel.
    const label = await findItemLabel(itemId);
    const sku = label.slice(label.lastIndexOf("(") + 1, -1);
    expect(sku).toBeTruthy();

    const bySku = await page.request.get(getUrl(`q=${encodeURIComponent(sku)}`));
    expect(bySku.status()).toBe(200);
    const bySkuBody = await bySku.json();
    expect(bySkuBody.data.waste.some((w: { waste: { itemId: string } }) => w.waste.itemId === itemId)).toBe(true);
    // Y la fila trae la categoría para el filtro/badge del historial.
    expect(bySkuBody.data.waste.find((w: { waste: { itemId: string } }) => w.waste.itemId === itemId).item.category).toBe("E2E-CAT-H1");

    const byCategory = await page.request.get(getUrl("category=E2E-CAT-H1"));
    expect(byCategory.status()).toBe(200);
    expect((await byCategory.json()).data.waste.some((w: { waste: { itemId: string } }) => w.waste.itemId === itemId)).toBe(true);
  });

  test("el resumen separa merma real de consumo interno (deltas)", async ({ page }) => {
    // Deltas contra el summary previo: el branch puede tener mermas de otros
    // specs; lo que verificamos es exactamente lo que ESTE test agrega.
    const beforeRes = await page.request.get(getUrl(""));
    expect(beforeRes.status()).toBe(200);
    const before = (await beforeRes.json()).data.summary;

    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H1-SUMMARY",
    });

    // Merma real: EXPIRED × 1 @ 4.94 → totalLoss round(1 × 494) = 494.
    const r1 = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 1,
      unit: UNIT,
      reason: "EXPIRED",
      costPerUnit: 4.94,
    });
    expect(r1.status(), await r1.text()).toBe(200);
    // Consumo interno: STAFF × 1 @ 10.00 → totalLoss 1000, NO cuenta como merma real.
    const r2 = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 1,
      unit: UNIT,
      reason: "STAFF",
      costPerUnit: 10,
    });
    expect(r2.status(), await r2.text()).toBe(200);

    const afterRes = await page.request.get(getUrl(""));
    expect(afterRes.status()).toBe(200);
    const after = (await afterRes.json()).data.summary;

    expect(after.trueWasteLossCents - before.trueWasteLossCents).toBe(494);
    expect(after.totalLossCents - before.totalLossCents).toBe(1494);

    const expiredDelta = after.byReason.find((r: { reason: string }) => r.reason === "EXPIRED");
    const staffDelta = after.byReason.find((r: { reason: string }) => r.reason === "STAFF");
    const expiredBefore = before.byReason.find((r: { reason: string }) => r.reason === "EXPIRED")?.entries ?? 0;
    const staffBefore = before.byReason.find((r: { reason: string }) => r.reason === "STAFF")?.entries ?? 0;
    expect(expiredDelta.entries - expiredBefore).toBe(1);
    expect(staffDelta.entries - staffBefore).toBe(1);
    // byReason ordenado por pérdida descendente (para el top-motivo del historial).
    const losses = after.byReason.map((r: { lossCents: number }) => r.lossCents);
    expect([...losses].sort((a: number, b: number) => b - a)).toEqual(losses);
  });

  test("paginación: total estable entre páginas y filas newest-first", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 5,
      lotNumber: "E2E-H1-PAGINA",
    });

    const posted: string[] = [];
    for (const qty of [1, 1]) {
      const res = await postWaste(page, {
        branchId: BRANCH_POLANCO,
        batchId,
        itemId,
        quantity: qty,
        unit: UNIT,
        reason: "SPILLAGE",
      });
      expect(res.status(), await res.text()).toBe(200);
      posted.push((await res.json()).data.waste.id);
    }

    const p0 = await (await page.request.get(getUrl("limit=1&offset=0"))).json();
    const p1 = await (await page.request.get(getUrl("limit=1&offset=1"))).json();

    expect(p0.data.total).toBe(p1.data.total); // el total no cambia al paginar
    expect(p0.data.total).toBeGreaterThanOrEqual(2);
    expect(p0.data.waste).toHaveLength(1);
    expect(p1.data.waste).toHaveLength(1);
    // recordedAt DESC: las dos más nuevas son las que acabamos de crear.
    expect([p0.data.waste[0].waste.id, p1.data.waste[0].waste.id]).toEqual([...posted].reverse());
  });
});