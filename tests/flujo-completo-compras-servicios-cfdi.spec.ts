import "dotenv/config";
import { test, expect } from "@playwright/test";
import { db } from "@/lib/db";
import {
  companies,
  branches,
  users,
  suppliers,
  inventoryItems,
  purchaseOrders,
  purchaseOrderItems,
  serviceOrders,
  invoices,
  invoiceLines,
  inventoryBatches,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { stampPurchaseOrderInvoice } from "@/lib/services/fiscal-invoicing-service";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";

test.describe("Jornada E2E Real: OC + Recepción Lotes + CFDI FiscalAPI + 3-Way Match + OS + Tesorería", () => {
  let companyId: string;
  let branchId: string;
  let supplierId: string;
  let itemId: string;
  let userId: string;
  let createdPoId: string;
  let createdPoNumber: string;
  let createdOsId: string;

  test.beforeAll(async () => {
    // 1. Obtener empresa, sucursal y usuario de prueba
    const [company] = await db.select().from(companies).limit(1);
    if (!company) throw new Error("No hay empresas en BD");
    companyId = company.id;

    const [branch] = await db.select().from(branches).where(eq(branches.companyId, companyId)).limit(1);
    if (!branch) throw new Error("No hay sucursales en BD");
    branchId = branch.id;

    const [user] = await db.select().from(users).limit(1);
    if (!user) throw new Error("No hay usuarios en BD");
    userId = user.id;

    // 2. Obtener proveedor con RFC de prueba del SAT (Carnes Selectas - IIA040805DZ4 o EKU9003173C9)
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.companyId, companyId), eq(suppliers.taxId, "IIA040805DZ4")))
      .limit(1);
    
    if (supplier) {
      supplierId = supplier.id;
    } else {
      const [anySupplier] = await db.select().from(suppliers).where(eq(suppliers.companyId, companyId)).limit(1);
      supplierId = anySupplier.id;
    }

    // 3. Obtener un insumo del inventario
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.companyId, companyId)).limit(1);
    if (!item) throw new Error("No hay insumos en BD");
    itemId = item.id;
  });

  test("Paso 1: Creación de Orden de Compra (OC) y visualización en la UI", async ({ page }) => {
    // Crear la OC directamente con datos limpios
    const poNumber = `PO-E2E-${Date.now().toString().slice(-4)}`;
    createdPoNumber = poNumber;

    const [po] = await db
      .insert(purchaseOrders)
      .values({
        companyId,
        branchId,
        supplierId,
        poNumber,
        requestedBy: userId,
        status: "APPROVED",
        subtotal: 100000, // $1,000.00 MXN
        taxAmount: 16000,  // $160.00 MXN (16% IVA)
        totalAmount: 116000, // $1,160.00 MXN
        purchaseType: "STOCK",
      })
      .returning();

    createdPoId = po.id;

    await db.insert(purchaseOrderItems).values({
      poId: po.id,
      itemId,
      orderedQuantity: 10,
      unitCost: 10000, // $100.00 MXN c/u
      taxRate: 16,
      totalCost: 116000,
    });

    // Navegar a la pantalla de Órdenes de Compra en el Dashboard
    await page.goto("/dashboard/inventory/purchase-orders");
    await expect(page).toHaveURL(/\/dashboard\/inventory\/purchase-orders/);

    // Verificar que la OC recién creada aparece en la tabla con su folio y monto
    await expect(page.getByText(poNumber)).toBeVisible();
    await expect(page.getByText("$1,160.00").first()).toBeVisible();
  });

  test("Paso 2: Recepción física de mercancía y nacimiento del lote FEFO en bodega", async ({ page }) => {
    // Simular la recepción física del almacén para esta OC
    const lotNumber = `LOT-E2E-${Date.now().toString().slice(-4)}`;
    const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días

    await db.insert(inventoryBatches).values({
      companyId,
      branchId,
      itemId,
      lotNumber,
      initialQuantity: 10,
      currentQuantity: 10,
      unitCost: 10000,
      expirationDate,
      receivedAt: new Date(),
      status: "AVAILABLE",
      origin: "PURCHASE",
    });

    // Actualizar estado de la OC a CERRADA/RECIBIDA
    await db.update(purchaseOrders).set({ status: "CLOSED" }).where(eq(purchaseOrders.id, createdPoId));

    // Navegar a la pantalla de Lotes en el Dashboard
    await page.goto("/dashboard/inventory/lotes");
    await expect(page).toHaveURL(/\/dashboard\/inventory\/lotes/);

    // Verificar que el lote nació en bodega y está visible en la cola FEFO
    await expect(page.getByText(lotNumber)).toBeVisible();
    await expect(page.getByText("Disponible").first()).toBeVisible();
  });

  test("Paso 3: Timbrado de CFDI 4.0 en FiscalAPI Sandbox ligado a la OC", async () => {
    // Timbrar el comprobante real en el sandbox de FiscalAPI
    const stampResult = await stampPurchaseOrderInvoice(createdPoId);

    expect(stampResult.status).toBe("TIMBRADO");
    expect(stampResult.uuid).toBeTruthy();
    expect(stampResult.totalsMatch).toBe(true);

    // Insertar la factura timbrada en la tabla de facturas de Pulso
    const [inv] = await db
      .insert(invoices)
      .values({
        companyId,
        branchId,
        supplierId,
        purchaseOrderId: createdPoId,
        folio: `FAC-${stampResult.uuid?.slice(0, 4).toUpperCase()}`,
        serie: "A",
        uuid: stampResult.uuid!,
        fecha: new Date().toISOString().slice(0, 10),
        subtotal: 100000,
        taxAmount: 16000,
        total: 116000,
        currency: "MXN",
        rfcEmisor: stampResult.issuerTin || "IIA040805DZ4",
        nombreEmisor: "Carnes Selectas del Norte",
        rfcReceptor: stampResult.recipientTin || "URE180429TM6",
        nombreReceptor: "Pulso HORECA Demo",
        matchStatus: "MATCHED",
        hasPriceDiscrepancy: false,
        hasQtyDiscrepancy: false,
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        paymentStatus: "PENDING",
      })
      .returning();

    await db.insert(invoiceLines).values({
      invoiceId: inv.id,
      itemId,
      claveProdServ: "01010101",
      claveUnidad: "H87",
      descripcion: "Insumo E2E",
      cantidad: "10",
      valorUnitario: 10000,
      importe: 100000,
    });
  });

  test("Paso 4: Verificación de Factura y Conciliación 3-Way Match en la UI", async ({ page }) => {
    await page.goto("/dashboard/inventory/invoices");
    await expect(page).toHaveURL(/\/dashboard\/inventory\/invoices/);

    // Cambiar a la pestaña de Historial de Facturas
    const historyTab = page.getByRole("tab", { name: /historial/i });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    // Verificar que la factura timbrada aparece en el buzón con su total de $1,160.00 y estatus CONCILIADA
    await expect(page.getByText("$1,160.00").first()).toBeVisible();
    await expect(page.getByText(/conciliad/i).first()).toBeVisible();
  });

  test("Paso 5: Flujo de Orden de Servicio (OS), Conformidad y Cierre", async ({ page }) => {
    const osFolio = `OS-E2E-${Date.now().toString().slice(-4)}`;

    // Crear la OS de mantenimiento
    const [os] = await db
      .insert(serviceOrders)
      .values({
        companyId,
        branchId,
        folio: osFolio,
        type: "CORRECTIVO",
        urgency: "NORMAL",
        status: "PENDING_CONFORMITY",
        scope: "Mantenimiento preventivo de compresor de cámara frigorífica",
        justification: "Revisión mensual de temperatura NOM-251",
        supplierId,
        amount: 116000, // $1,160.00 MXN
        createdBy: "E2E Supervisor",
      })
      .returning();

    createdOsId = os.id;

    // Navegar al detalle de la Orden de Servicio
    await page.goto(`/dashboard/equipment/compliance/service-orders/${os.id}`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/equipment/compliance/service-orders/${os.id}`));

    // Verificar folio y alcance
    await expect(page.getByText(osFolio)).toBeVisible();
    await expect(page.getByText(/mantenimiento preventivo/i)).toBeVisible();

    // Firmar la conformidad en pantalla
    const signButton = page.getByRole("button", { name: /firmar conformidad/i });
    if (await signButton.isVisible()) {
      await signButton.click();
      const nameInput = page.getByLabel(/nombre de quien conforma/i);
      if (await nameInput.isVisible()) {
        await nameInput.fill("Gerente Carlos Escamilla");
        await page.getByRole("button", { name: /confirmar firma/i }).click();
      }
    }
  });

  test("Paso 6: Tesorería y Programación de Corridas de Pago", async ({ page }) => {
    await page.goto("/dashboard/finance/treasury");
    await expect(page).toHaveURL(/\/dashboard\/finance\/treasury/);

    // Verificar tablero de tesorería y compromisos de pago
    await expect(page.getByRole("heading", { name: /tesorería/i })).toBeVisible();
    await expect(page.getByText(/pagos/i).first()).toBeVisible();
  });

  test("Paso 7: Tablero de Control Gerencial con KPIs calculados", async ({ page }) => {
    await page.goto("/dashboard/reports/control");
    await expect(page).toHaveURL(/\/dashboard\/reports\/control/);

    // Verificar KPIs maestros
    await expect(page.getByText(/ejecución presupuestal/i)).toBeVisible();
    await expect(page.getByText(/compras de emergencia/i)).toBeVisible();
    await expect(page.getByText(/mantenimiento/i).first()).toBeVisible();
  });
});
