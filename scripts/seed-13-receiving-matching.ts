import "dotenv/config";
import { db } from "@/lib/db";
import {
  receivingReports, receivingReportItems, invoices, invoiceLines, inventoryBatches,
  inventoryMovements, temperatureLogs, cfdiRecibidos, recurringContracts,
  operatingExpenses, expensePayments, pettyCashFunds, pettyCashTransactions, cashFlowAssumptions,
  purchaseOrders, purchaseOrderItems, suppliers, payees, inventoryItems, costCenters,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { withCompanyContext } from "@/lib/db/tenant-context";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, DEMO_BRANCHES,
} from "./seed-constants";
import { seedDate } from "./seed-scenarios";

export async function main() {
  console.log("=== Phase 13: Receiving, 3-Way Match & Treasury ===");
  await withCompanyContext({ companyId: COMPANY_ID, actorId: USER_SUPER_ADMIN }, async (tx) => {
    await tx.delete(expensePayments).where(eq(expensePayments.companyId, COMPANY_ID));
  });
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
  const allCostCenters = await db.select().from(costCenters).where(eq(costCenters.companyId, COMPANY_ID));
  const ccMap = new Map(allCostCenters.map(c => [c.code, c.id]));

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

  console.log("Inserting operating expenses & payment applications...");
  const now = new Date();
  const dateRentStr = seedDate(-4, now).toISOString().slice(0, 10);
  const dateCfeStr = seedDate(-2, now).toISOString().slice(0, 10);
  const dateTplayStr = seedDate(-9, now).toISOString().slice(0, 10);
  const dateMantStr = seedDate(-1, now).toISOString().slice(0, 10);
  const dueSoonStr = seedDate(5, now).toISOString().slice(0, 10);

  const payeeMap = new Map(allPayees.map(p => [p.name, p.id]));
  const insertedExpenses = await db.insert(operatingExpenses).values([
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      payeeId: payeeMap.get("Inmobiliaria y Arrendadora Roma S.A."),
      costCenterId: ccMap.get("CC-SERV"),
      category: "RENTA",
      amount: 6500000,
      taxAmount: 896552,
      paymentMethod: "TRANSFERENCIA",
      businessDate: dateRentStr,
      dueDate: dueSoonStr,
      voucherReference: "CFDI-RENTA-ROMA-2026",
      description: "Pago de renta mensual sucursal Roma",
      status: "APPROVED",
      requestedBy: USER_ADMIN,
      approvedBy: USER_SUPER_ADMIN,
      createdAt: new Date(now.getTime() - 4 * 86400000),
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      payeeId: payeeMap.get("Comisión Federal de Electricidad"),
      costCenterId: ccMap.get("CC-SERV"),
      category: "SERVICIOS",
      amount: 2450000,
      taxAmount: 337931,
      paymentMethod: "DOMICILIADO",
      businessDate: dateCfeStr,
      dueDate: dueSoonStr,
      voucherReference: "CFDI-CFE-COND-2026",
      description: "Recibo de suministro eléctrico CFE Condesa",
      status: "APPROVED",
      requestedBy: USER_ADMIN,
      approvedBy: USER_ADMIN,
      createdAt: new Date(now.getTime() - 2 * 86400000),
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      payeeId: payeeMap.get("Totalplay Telecomunicaciones"),
      costCenterId: ccMap.get("CC-SERV"),
      category: "SERVICIOS",
      amount: 189900,
      taxAmount: 26193,
      paymentMethod: "TRANSFERENCIA",
      businessDate: dateTplayStr,
      dueDate: dateTplayStr,
      voucherReference: "CFDI-TPLAY-POL-2026",
      description: "Internet simétrico empresarial y telefonía Polanco",
      status: "PAID",
      requestedBy: USER_GERENTE,
      approvedBy: USER_ADMIN,
      paidBy: USER_ADMIN,
      paidAt: new Date(now.getTime() - 9 * 86400000),
      createdAt: new Date(now.getTime() - 10 * 86400000),
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      costCenterId: ccMap.get("CC-MANT"),
      category: "MANTENIMIENTO",
      amount: 348000,
      taxAmount: 48000,
      paymentMethod: "TRANSFERENCIA",
      businessDate: dateMantStr,
      dueDate: dueSoonStr,
      voucherReference: "CFDI-MANT-CAMPANA-2026",
      description: "Limpieza profunda de ductos y campana de extracción cocina Condesa",
      status: "PENDING_APPROVAL",
      requestedBy: USER_GERENTE,
      createdAt: new Date(now.getTime() - 1 * 86400000),
    },
  ]).returning();

  const paidExpense = insertedExpenses.find(e => e.status === "PAID");
  if (paidExpense) {
    await withCompanyContext({ companyId: COMPANY_ID, actorId: USER_ADMIN }, async (tx) => {
      await tx.insert(expensePayments).values({
        companyId: COMPANY_ID,
        branchId: paidExpense.branchId,
        expenseId: paidExpense.id,
        amountCents: paidExpense.amount,
        paidAt: dateTplayStr,
        paymentMethod: "TRANSFERENCIA",
        status: "CONFIRMED",
        source: "MANUAL",
        reference: "SPEI-TPLAY-00981",
        createdBy: USER_ADMIN,
        confirmedBy: USER_ADMIN,
        confirmedAt: new Date(now.getTime() - 9 * 86400000),
      });
    });
  }

  console.log("Inserting petty cash funds & transactions across all 3 branches...");
  const [fundCondesa, fundPolanco, fundRoma] = await db.insert(pettyCashFunds).values([
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      fundAmount: 500000,     // $5,000 MXN
      currentBalance: 385000, // $3,850 MXN
      lowThreshold: 150000,   // $1,500 MXN
      active: true,
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      fundAmount: 500000,     // $5,000 MXN
      currentBalance: 418000, // $4,180 MXN
      lowThreshold: 150000,
      active: true,
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      fundAmount: 500000,     // $5,000 MXN
      currentBalance: 125000, // $1,250 MXN (bajo umbral -> alerta de reposición)
      lowThreshold: 150000,
      active: true,
    },
  ]).returning();

  const pcDate2Str = seedDate(-2, now).toISOString().slice(0, 10);
  const pcDate1Str = seedDate(-1, now).toISOString().slice(0, 10);

  await db.insert(pettyCashTransactions).values([
    {
      fundId: fundCondesa.id,
      type: "OUT",
      amount: 45000, // $450 MXN
      taxAmount: 0,
      businessDate: pcDate2Str,
      voucherReference: "TICKET-OXXO-CND-001",
      costCenterId: ccMap.get("CC-SERV"),
      concept: "Compra urgente de bolsas de hielo y garrafón de agua",
      category: "OTROS",
      registeredBy: USER_EMPLEADO_1,
      approvedBy: USER_GERENTE,
      createdAt: new Date(now.getTime() - 2 * 86400000),
    },
    {
      fundId: fundCondesa.id,
      type: "OUT",
      amount: 70000, // $700 MXN
      taxAmount: 9655,
      businessDate: pcDate1Str,
      voucherReference: "TICKET-FERR-CND-002",
      costCenterId: ccMap.get("CC-MANT"),
      concept: "Material de plomería y empaque por fuga en tarja de lavado",
      category: "MANTENIMIENTO",
      registeredBy: USER_EMPLEADO_1,
      approvedBy: USER_GERENTE,
      createdAt: new Date(now.getTime() - 1 * 86400000),
    },
    {
      fundId: fundPolanco.id,
      type: "OUT",
      amount: 82000, // $820 MXN
      taxAmount: 11310,
      businessDate: pcDate1Str,
      voucherReference: "TICKET-LIMP-POL-001",
      costCenterId: ccMap.get("CC-LIMP"),
      concept: "Reposición urgente de desengrasante y guantes de nitrilo",
      category: "OTROS",
      registeredBy: USER_EMPLEADO_2,
      approvedBy: USER_SUPERVISOR,
      createdAt: new Date(now.getTime() - 1 * 86400000),
    },
    {
      fundId: fundRoma.id,
      type: "OUT",
      amount: 95000, // $950 MXN
      taxAmount: 13103,
      businessDate: pcDate2Str,
      voucherReference: "TICKET-CERRAJ-ROM-001",
      costCenterId: ccMap.get("CC-MANT"),
      concept: "Reparación de chapa en puerta de almacén seco Roma",
      category: "MANTENIMIENTO",
      registeredBy: USER_EMPLEADO_3,
      approvedBy: USER_GERENTE,
      createdAt: new Date(now.getTime() - 2 * 86400000),
    },
  ]);

  console.log("Inserting cash flow assumptions...");
  await db.insert(cashFlowAssumptions).values({
    companyId: COMPANY_ID,
    openingBalanceCents: 15000000, // $150,000 MXN saldo consolidado en bancos
    asOfDate: now.toISOString().slice(0, 10),
    updatedBy: USER_ADMIN,
  });

  console.log("Phase 13 complete!");
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error("Error in Phase 13:", err);
    process.exit(1);
  });
}
