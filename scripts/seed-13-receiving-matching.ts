import "dotenv/config";
import { db } from "@/lib/db";
import {
  receivingReports, receivingReportItems, invoices, invoiceLines, inventoryBatches,
  inventoryMovements, temperatureLogs, cfdiRecibidos, recurringContracts,
  operatingExpenses, pettyCashFunds, pettyCashTransactions, cashFlowAssumptions,
  purchaseOrders, purchaseOrderItems, suppliers, payees, inventoryItems,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_EMPLEADO_1, DEMO_BRANCHES,
} from "./seed-constants";

export async function main() {
  console.log("=== Phase 13: Receiving, 3-Way Match & Treasury ===");
  await db.delete(cashFlowAssumptions).where(eq(cashFlowAssumptions.companyId, COMPANY_ID));
  await db.delete(pettyCashTransactions).where(sql`1=1`);
  await db.delete(pettyCashFunds).where(eq(pettyCashFunds.companyId, COMPANY_ID));
  await db.delete(operatingExpenses).where(eq(operatingExpenses.companyId, COMPANY_ID));
  await db.delete(recurringContracts).where(eq(recurringContracts.companyId, COMPANY_ID));
  await db.delete(cfdiRecibidos).where(eq(cfdiRecibidos.companyId, COMPANY_ID));
  await db.delete(invoiceLines).where(sql`1=1`);
  await db.delete(invoices).where(eq(invoices.companyId, COMPANY_ID));
  await db.delete(receivingReportItems).where(sql`1=1`);
  await db.delete(receivingReports).where(eq(receivingReports.companyId, COMPANY_ID));

  const allPOs = await db.select().from(purchaseOrders).where(eq(purchaseOrders.companyId, COMPANY_ID));
  const allSuppliers = await db.select().from(suppliers).where(eq(suppliers.companyId, COMPANY_ID));
  const allPayees = await db.select().from(payees).where(eq(payees.companyId, COMPANY_ID));
  const allItems = await db.select().from(inventoryItems).where(eq(inventoryItems.companyId, COMPANY_ID));
  // Conciliación exacta y discrepancia de precio sobre documentos enlazados.
  // Cantidades/precios se derivan de la OC, nunca de posiciones de SELECT.
  const targets = [
    { po: allPOs.find(p => p.poNumber.startsWith("OC-POL")), mismatch: false, uuid: "4A5B6C7D-8E9F-0123-4567-89ABCDEF0123", folio: "9842" },
    { po: allPOs.find(p => p.purchaseType === "EMERGENCIA"), mismatch: true, uuid: "9F8E7D6C-5B4A-3210-7654-3210FEDCBA98", folio: "1140" },
  ];
  for (const target of targets) {
    const po = target.po;
    if (!po) throw new Error("Falta OC demo: ejecuta la fase 11.");
    const supplier = allSuppliers.find(row => row.id === po.supplierId)!;
    const operator = DEMO_BRANCHES.find(row => row.id === po.branchId)!.operatorId;
    const lines = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, po.id));
    const receivedAt = new Date(Date.now() - 12 * 3600000);
    const [report] = await db.insert(receivingReports).values({
      companyId: COMPANY_ID, branchId: po.branchId, supplierId: po.supplierId,
      purchaseOrderId: po.id, receivedBy: operator, receivedAt,
      invoiceNumber: target.folio, notes: "Recepción demo trazada por lote y temperatura",
    }).returning();
    for (const line of lines) {
      const item = allItems.find(row => row.id === line.itemId)!;
      const temperature = item.storageType === "REFRIGERATED" ? 3.5 : null;
      const [batch] = await db.insert(inventoryBatches).values({
        itemId: item.id, branchId: po.branchId, supplierId: po.supplierId,
        lotNumber: "DEMO-REC-" + target.folio + "-" + item.sku,
        initialQuantity: String(line.orderedQuantity), currentQuantity: String(line.orderedQuantity),
        unitCost: line.unitCost, status: "AVAILABLE", origin: "RECEIVING", receivedAt,
        expirationDate: new Date(Date.now() + (item.typicalShelfLifeDays ?? 7) * 86400000),
        supplierBatchInfo: { receivingReportId: report.id, invoiceNumber: target.folio, temperature, receivedBy: operator },
      }).returning();
      await db.insert(inventoryMovements).values({
        branchId: po.branchId, itemId: item.id, batchId: batch.id, type: "RECEIVING",
        quantityChange: String(line.orderedQuantity), referenceId: report.id, performedBy: operator, timestamp: receivedAt,
      });
      if (temperature !== null) await db.insert(temperatureLogs).values({
        branchId: po.branchId, readingValue: Math.round(temperature), unit: "C",
        isCompliant: true, capturedBy: operator, timestamp: receivedAt,
        captureMethod: "RECEIVING", notes: `Recepción ${report.id}: lectura ${temperature} °C, lote ${batch.lotNumber}`,
      });
      await db.insert(receivingReportItems).values({
        receivingReportId: report.id, itemId: item.id, orderedQuantity: line.orderedQuantity,
        receivedQuantity: line.orderedQuantity, unitCost: line.unitCost,
        lineTotal: line.orderedQuantity * line.unitCost, discrepancyType: "NONE",
      });
      await db.update(purchaseOrderItems).set({ receivedQuantity: line.orderedQuantity, status: "RECEIVED" }).where(eq(purchaseOrderItems.id, line.id));
    }
    await db.update(purchaseOrders).set({ status: "CLOSED" }).where(eq(purchaseOrders.id, po.id));
    const priced = lines.map(line => ({ ...line, price: line.unitCost + (target.mismatch ? 1000 : 0) }));
    const subtotal = priced.reduce((sum, line) => sum + line.orderedQuantity * line.price, 0);
    const tax = priced.reduce((sum, line) => sum + Math.round(line.orderedQuantity * line.price * (line.taxRate ?? 0) / 100), 0);
    const [invoice] = await db.insert(invoices).values({
      companyId: COMPANY_ID, branchId: po.branchId, supplierId: po.supplierId,
      purchaseOrderId: po.id, receivingReportId: report.id, uuid: target.uuid,
      folio: target.folio, fecha: receivedAt.toISOString(), subtotal, taxAmount: tax,
      total: subtotal + tax, currency: "MXN", rfcEmisor: supplier.taxId, nombreEmisor: supplier.name,
      rfcReceptor: "PUL-101010-ABC", nombreReceptor: "Pulso HORECA Demo",
      matchStatus: target.mismatch ? "DISCREPANCY" : "MATCHED",
      hasPriceDiscrepancy: target.mismatch, hasQtyDiscrepancy: false,
    }).returning();
    await db.insert(invoiceLines).values(priced.map(line => ({
      invoiceId: invoice.id, itemId: line.itemId, cantidad: String(line.orderedQuantity),
      claveProdServ: "50100000",
      claveUnidad: allItems.find(item => item.id === line.itemId)!.unit === "KG" ? "KGM" : "LTR",
      descripcion: allItems.find(item => item.id === line.itemId)!.name,
      valorUnitario: line.price, importe: line.price * line.orderedQuantity,
      unidad: allItems.find(item => item.id === line.itemId)!.unit,
    })));
    await db.insert(cfdiRecibidos).values({
      companyId: COMPANY_ID, invoiceUuid: target.uuid, issuerTin: supplier.taxId!, issuerName: supplier.name,
      recipientTin: "PUL-101010-ABC", amountCents: subtotal + tax, currency: "MXN",
      invoiceDate: receivedAt, conciliationStatus: target.mismatch ? "SIN_MATCH" : "CONCILIADA",
      matchedPurchaseOrderId: po.id,
    });
  }
  await db.insert(invoices).values({
    companyId: COMPANY_ID, branchId: BRANCH_ROMA, uuid: "FFAABB11-2233-4455-6677-8899AABBCCDD",
    folio: "7701", fecha: new Date().toISOString(), subtotal: 420000, taxAmount: 67200, total: 487200,
    currency: "MXN", rfcEmisor: "DAV-850101-ABC", nombreEmisor: "Distribuidora de Alimentos del Valle",
    rfcReceptor: "PUL-101010-ABC", matchStatus: "PENDING",
  });

  console.log("Inserting recurring contracts (renta, servicios, etc.)...");
  await db.insert(recurringContracts).values([
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      supplierId: allSuppliers[0].id,
      contractType: "RENTA",
      title: "Arrendamiento Inmueble Sucursal Roma",
      description: "Contrato de arrendamiento comercial por 3 años",
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2027, 11, 31),
      autoRenew: true,
      baseAmountCents: 6500000, // $65,000 MXN mensuales
      currency: "MXN",
      varianceTolerancePercent: 5,
      paymentFrequency: "MONTHLY",
      paymentMethod: "TRANSFER",
      active: true,
      createdBy: USER_SUPER_ADMIN,
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      supplierId: allSuppliers[0].id,
      contractType: "SERVICIO_BASICO",
      title: "Suministro Eléctrico CFE Condesa",
      description: "Tarifa media tensión comercial",
      startDate: new Date(2025, 0, 1),
      baseAmountCents: 2400000, // $24,000 MXN mensuales
      currency: "MXN",
      varianceTolerancePercent: 15,
      paymentFrequency: "MONTHLY",
      paymentMethod: "DOMICILIADO",
      active: true,
      createdBy: USER_ADMIN,
    },
  ]);

  console.log("Inserting operating expenses...");
  const payeeMap = new Map(allPayees.map(p => [p.name, p.id]));
  await db.insert(operatingExpenses).values([
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      payeeId: payeeMap.get("Inmobiliaria y Arrendadora Roma S.A."),
      category: "RENTA",
      amount: 6500000,
      description: "Pago de renta mensual Roma - Agosto 2026",
      status: "APPROVED",
      requestedBy: USER_ADMIN,
      approvedBy: USER_SUPER_ADMIN,
      createdAt: new Date(),
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      payeeId: payeeMap.get("Comisión Federal de Electricidad"),
      category: "SERVICIOS",
      amount: 2450000,
      description: "Recibo de luz CFE Condesa - Bimestre Julio-Agosto",
      status: "APPROVED",
      requestedBy: USER_ADMIN,
      approvedBy: USER_ADMIN,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      payeeId: payeeMap.get("Totalplay Telecomunicaciones"),
      category: "SERVICIOS",
      amount: 189900,
      description: "Internet simétrico empresarial y telefonía Polanco",
      status: "PAID",
      requestedBy: USER_GERENTE,
      approvedBy: USER_ADMIN,
      paidAt: new Date(Date.now() - 9 * 86400000),
      createdAt: new Date(Date.now() - 10 * 86400000),
    },
  ]);

  console.log("Inserting petty cash funds & transactions...");
  const [fundCondesa] = await db.insert(pettyCashFunds).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    fundAmount: 500000, // $5,000 MXN
    currentBalance: 385000, // $3,850 MXN
    lowThreshold: 150000,  // $1,500 MXN
    active: true,
  }).returning();

  await db.insert(pettyCashTransactions).values([
    {
      fundId: fundCondesa.id,
      type: "OUT",
      amount: 45000, // $450 MXN
      concept: "Compra urgente de hielos y garrafón de agua en OXXO",
      category: "OTROS",
      registeredBy: USER_EMPLEADO_1,
      approvedBy: USER_GERENTE,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      fundId: fundCondesa.id,
      type: "OUT",
      amount: 70000, // $700 MXN
      concept: "Material de plomería ferretería por fuga en tarja",
      category: "MANTENIMIENTO",
      registeredBy: USER_EMPLEADO_1,
      approvedBy: USER_GERENTE,
      createdAt: new Date(Date.now() - 1 * 86400000),
    },
  ]);

  console.log("Inserting cash flow assumptions...");
  await db.insert(cashFlowAssumptions).values({
    companyId: COMPANY_ID,
    openingBalanceCents: 15000000, // $150,000 MXN saldo consolidado en bancos
    asOfDate: new Date().toISOString().slice(0, 10),
    updatedBy: USER_ADMIN,
  });

  console.log("Phase 13 complete!");
}
