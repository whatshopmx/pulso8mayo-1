import "dotenv/config";
import { db } from "@/lib/db";
import {
  receivingReports, receivingReportItems, invoices, invoiceLines,
  cfdiRecibidos, recurringContracts, operatingExpenses, pettyCashFunds,
  pettyCashTransactions, cashFlowAssumptions, purchaseOrders,
  purchaseOrderItems, suppliers, payees, inventoryItems,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2,
} from "./seed-constants";

export async function main() {
  console.log("=== Phase 13: Receiving, 3-Way Match & Treasury ===");
  console.log("Cleaning up previous receiving, invoice, and treasury records...");

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

  const poApproved = allPOs.find(p => p.status === "APPROVED" && p.poNumber.startsWith("OC-POL"));
  const poEmergency = allPOs.find(p => p.purchaseType === "EMERGENCIA");

  console.log("Inserting receiving reports (entradas de almacén)...");
  // 1. Recepción para OC Polanco
  let recReport1Id: string | null = null;
  if (poApproved) {
    const [rec] = await db.insert(receivingReports).values({
      companyId: COMPANY_ID,
      branchId: poApproved.branchId,
      supplierId: poApproved.supplierId,
      purchaseOrderId: poApproved.id,
      receivedBy: USER_EMPLEADO_2,
      receivedAt: new Date(Date.now() - 12 * 3600000),
      invoiceNumber: "FAC-9842",
      notes: "Recepción completa con checklist NOM-251 y temperatura verificada en 3.5°C.",
    }).returning();
    recReport1Id = rec.id;

    const poItems = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, poApproved.id));
    for (const item of poItems) {
      await db.insert(receivingReportItems).values({
        receivingReportId: rec.id,
        itemId: item.itemId,
        orderedQuantity: item.orderedQuantity,
        receivedQuantity: item.orderedQuantity,
        unitCost: item.unitCost,
        lineTotal: item.orderedQuantity * item.unitCost,
        discrepancyType: "NONE",
        discrepancyQty: 0,
      });
    }
  }

  console.log("Inserting CFDI recibidos (buzón fiscal SAT)...");
  const CFDI_DATA = [
    {
      uuid: "4A5B6C7D-8E9F-0123-4567-89ABCDEF0123",
      issuerTin: "LSC-650404-JKL",
      issuerName: "Productos Lácteos Santa Clara",
      amountCents: 638000,
      date: new Date(Date.now() - 10 * 3600000),
      status: "CONCILIADA" as const,
      matchedPoId: poApproved?.id,
    },
    {
      uuid: "9F8E7D6C-5B4A-3210-7654-3210FEDCBA98",
      issuerTin: "CSN-920202-DEF",
      issuerName: "Carnes Selectas del Norte",
      amountCents: 1540000, // Discrepancia de precio
      date: new Date(Date.now() - 24 * 3600000),
      status: "SIN_MATCH" as const,
    },
    {
      uuid: "11223344-5566-7788-99AA-BBCCDDEEFF00",
      issuerTin: "CFE-370814-QI0",
      issuerName: "Comisión Federal de Electricidad",
      amountCents: 2450000,
      date: new Date(Date.now() - 48 * 3600000),
      status: "CONCILIADA" as const,
    },
    {
      uuid: "AABBCCDD-EEFF-0011-2233-445566778899",
      issuerTin: "IAR-120505-XYZ",
      issuerName: "Inmobiliaria y Arrendadora Roma S.A.",
      amountCents: 6500000,
      date: new Date(Date.now() - 5 * 86400000),
      status: "CONCILIADA" as const,
    },
  ];

  for (const c of CFDI_DATA) {
    await db.insert(cfdiRecibidos).values({
      companyId: COMPANY_ID,
      invoiceUuid: c.uuid,
      issuerTin: c.issuerTin,
      issuerName: c.issuerName,
      recipientTin: "PUL-101010-ABC",
      amountCents: c.amountCents,
      currency: "MXN",
      invoiceDate: c.date,
      satCertificationDate: c.date,
      downloadRequestId: "REQ-SAT-2026-08",
      conciliationStatus: c.status,
      matchedPurchaseOrderId: c.matchedPoId || null,
    });
  }

  console.log("Inserting invoices and 3-Way Match test cases...");
  // Caso 1: Match Perfecto (OC Polanco + Recepción + Factura)
  if (poApproved && recReport1Id) {
    const [invPerfect] = await db.insert(invoices).values({
      companyId: COMPANY_ID,
      branchId: poApproved.branchId,
      supplierId: poApproved.supplierId,
      purchaseOrderId: poApproved.id,
      receivingReportId: recReport1Id,
      uuid: "4A5B6C7D-8E9F-0123-4567-89ABCDEF0123",
      folio: "9842",
      serie: "F",
      fecha: new Date(Date.now() - 10 * 3600000).toISOString(),
      subtotal: 550000,
      taxAmount: 88000,
      total: 638000,
      currency: "MXN",
      rfcEmisor: "LSC-650404-JKL",
      nombreEmisor: "Productos Lácteos Santa Clara",
      rfcReceptor: "PUL-101010-ABC",
      nombreReceptor: "Pulso HORECA Demo",
      matchStatus: "MATCHED",
      hasPriceDiscrepancy: false,
      hasQtyDiscrepancy: false,
    }).returning();

    await db.insert(invoiceLines).values([
      {
        invoiceId: invPerfect.id,
        itemId: allItems[5]?.id,
        claveProdServ: "50131700",
        cantidad: "100.0000",
        claveUnidad: "LTR",
        unidad: "Litro",
        descripcion: "Leche Entera 1L",
        valorUnitario: 2200,
        importe: 220000,
      },
      {
        invoiceId: invPerfect.id,
        itemId: allItems[7]?.id,
        claveProdServ: "50131800",
        cantidad: "20.0000",
        claveUnidad: "KGM",
        unidad: "Kilogramo",
        descripcion: "Queso Manchego Barra",
        valorUnitario: 14000,
        importe: 280000,
      },
    ]);
  }

  // Caso 2: Discrepancia de Precio (Factura más cara que la OC)
  const [invPriceDisc] = await db.insert(invoices).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    supplierId: allSuppliers[1]?.id,
    uuid: "9F8E7D6C-5B4A-3210-7654-3210FEDCBA98",
    folio: "1140",
    serie: "A",
    fecha: new Date(Date.now() - 24 * 3600000).toISOString(),
    subtotal: 1327586,
    taxAmount: 212414,
    total: 1540000,
    currency: "MXN",
    rfcEmisor: "CSN-920202-DEF",
    nombreEmisor: "Carnes Selectas del Norte",
    rfcReceptor: "PUL-101010-ABC",
    nombreReceptor: "Pulso HORECA Demo",
    matchStatus: "DISCREPANCY",
    hasPriceDiscrepancy: true,
    hasQtyDiscrepancy: false,
  }).returning();

  await db.insert(invoiceLines).values([
    {
      invoiceId: invPriceDisc.id,
      itemId: allItems[1]?.id,
      claveProdServ: "50111500",
      cantidad: "40.0000",
      claveUnidad: "KGM",
      unidad: "Kilogramo",
      descripcion: "Filete de Res Calidad Sonora (Precio pactado $195 -> Facturado $215)",
      valorUnitario: 21500,
      importe: 860000,
    },
  ]);

  // Caso 3: Factura Huérfana (Sin OC asociada)
  await db.insert(invoices).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_ROMA,
    uuid: "FFAABB11-2233-4455-6677-8899AABBCCDD",
    folio: "7701",
    fecha: new Date(Date.now() - 3 * 86400000).toISOString(),
    subtotal: 420000,
    taxAmount: 67200,
    total: 487200,
    currency: "MXN",
    rfcEmisor: "DAV-850101-ABC",
    nombreEmisor: "Distribuidora de Alimentos del Valle",
    rfcReceptor: "PUL-101010-ABC",
    matchStatus: "PENDING",
    hasPriceDiscrepancy: false,
    hasQtyDiscrepancy: false,
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
