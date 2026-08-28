import "dotenv/config";
import { db } from "@/lib/db";
import {
  costCenters, branchBudgets, approvalMatrixRules, approvalRequests,
  folioCounters, purchaseOrders, purchaseOrderItems, requisitions,
  requisitionItems, serviceOrders, serviceOrderQuotes, serviceOrderEvidence,
  inventoryItems, suppliers, serviceProviders, branchComplianceServices,
  branchEquipments,
} from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
} from "./seed-constants";

export async function main() {
  console.log("=== Phase 11: Control Interno, Presupuestos, OC & OS ===");
  console.log("Cleaning up previous control records...");

  await db.delete(approvalRequests).where(eq(approvalRequests.companyId, COMPANY_ID));
  await db.delete(serviceOrderEvidence).where(sql`1=1`);
  await db.delete(serviceOrderQuotes).where(sql`1=1`);
  await db.delete(serviceOrders).where(eq(serviceOrders.companyId, COMPANY_ID));
  await db.delete(purchaseOrderItems).where(sql`1=1`);
  await db.delete(purchaseOrders).where(eq(purchaseOrders.companyId, COMPANY_ID));
  await db.delete(requisitionItems).where(sql`1=1`);
  await db.delete(requisitions).where(eq(requisitions.companyId, COMPANY_ID));
  await db.delete(folioCounters).where(eq(folioCounters.companyId, COMPANY_ID));
  await db.delete(approvalMatrixRules).where(eq(approvalMatrixRules.companyId, COMPANY_ID));
  await db.delete(branchBudgets).where(sql`1=1`);
  await db.delete(costCenters).where(eq(costCenters.companyId, COMPANY_ID));

  console.log("Inserting cost centers...");
  const CC_DEFS = [
    { code: "CC-ALM", name: "Alimentos y Materia Prima", accountingLine: "5010-ALM" },
    { code: "CC-BEB", name: "Bebidas y Licores", accountingLine: "5020-BEB" },
    { code: "CC-MANT", name: "Mantenimiento y Equipamiento", accountingLine: "5030-MANT" },
    { code: "CC-LIMP", name: "Limpieza y Químicos", accountingLine: "5040-LIMP" },
    { code: "CC-SERV", name: "Servicios Generales y Operativos", accountingLine: "5050-SERV" },
  ];

  const insertedCCs = await db.insert(costCenters).values(
    CC_DEFS.map(cc => ({
      companyId: COMPANY_ID,
      code: cc.code,
      name: cc.name,
      accountingLine: cc.accountingLine,
      active: true,
    }))
  ).returning({ id: costCenters.id, code: costCenters.code });

  const ccMap = new Map(insertedCCs.map(c => [c.code, c.id]));

  console.log("Inserting monthly branch budgets...");
  const currentMonth = new Date().toISOString().slice(0, 7); // e.g. "2026-08"
  const prevMonthDate = new Date();
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);

  const branchesList = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
  const budgetAmounts: Record<string, number> = {
    "CC-ALM": 35000000,  // $350,000 MXN
    "CC-BEB": 15000000,  // $150,000 MXN
    "CC-MANT": 4500000,  // $45,000 MXN
    "CC-LIMP": 2500000,  // $25,000 MXN
    "CC-SERV": 8000000,  // $80,000 MXN
  };

  const budgetValues: any[] = [];
  for (const bId of branchesList) {
    for (const m of [prevMonth, currentMonth]) {
      for (const [code, amt] of Object.entries(budgetAmounts)) {
        budgetValues.push({
          branchId: bId,
          costCenterId: ccMap.get(code)!,
          month: m,
          amount: amt,
        });
      }
    }
  }
  await db.insert(branchBudgets).values(budgetValues);

  console.log("Inserting approval matrix rules for OC and OS...");
  const MATRIX_RULES = [
    // Reglas OC
    { docType: "OC" as const, amountMin: 0, amountMax: 500000, requiredRole: "GERENTE", minQuotes: 1, sequence: 1 },
    { docType: "OC" as const, amountMin: 500001, amountMax: 2500000, requiredRole: "ADMIN", minQuotes: 2, sequence: 1 },
    { docType: "OC" as const, amountMin: 2500001, amountMax: null, requiredRole: "OWNER", minQuotes: 3, sequence: 1 },
    // Reglas OS
    { docType: "OS" as const, amountMin: 0, amountMax: 300000, requiredRole: "GERENTE", minQuotes: 1, sequence: 1 },
    { docType: "OS" as const, amountMin: 300001, amountMax: 1500000, requiredRole: "ADMIN", minQuotes: 2, sequence: 1 },
    { docType: "OS" as const, amountMin: 1500001, amountMax: null, requiredRole: "OWNER", minQuotes: 3, sequence: 1 },
  ];

  await db.insert(approvalMatrixRules).values(
    MATRIX_RULES.map(r => ({
      companyId: COMPANY_ID,
      docType: r.docType,
      amountMin: r.amountMin,
      amountMax: r.amountMax,
      requiredRole: r.requiredRole,
      minQuotes: r.minQuotes,
      sequence: r.sequence,
      active: true,
    }))
  );

  console.log("Initializing folio counters...");
  const year = new Date().getFullYear();
  for (const bId of branchesList) {
    await db.insert(folioCounters).values([
      { companyId: COMPANY_ID, branchId: bId, docType: "OC", year, lastSequence: 5 },
      { companyId: COMPANY_ID, branchId: bId, docType: "OS", year, lastSequence: 4 },
    ]);
  }

  // Cargar insumos y proveedores para armar OCs reales
  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.companyId, COMPANY_ID));
  const supps = await db.select().from(suppliers).where(eq(suppliers.companyId, COMPANY_ID));
  const provs = await db.select().from(serviceProviders).where(eq(serviceProviders.companyId, COMPANY_ID));
  const compServices = await db.select().from(branchComplianceServices).where(eq(branchComplianceServices.companyId, COMPANY_ID));
  const equipList = await db.select().from(branchEquipments);

  console.log("Inserting purchase orders (OC)...");
  // 1. OC Borrador
  const [poDraft] = await db.insert(purchaseOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    poNumber: "DRAFT-OC-001",
    supplierId: supps[0].id,
    status: "DRAFT",
    purchaseType: "PROGRAMADA",
    costCenterId: ccMap.get("CC-ALM"),
    requestedBy: USER_GERENTE,
    dateOrdered: new Date(),
    dateRequired: new Date(Date.now() + 3 * 86400000),
    expectedDeliveryDate: new Date(Date.now() + 3 * 86400000),
    subtotal: 850000,
    taxAmount: 136000,
    iepsAmount: 0,
    totalAmount: 986000,
    currency: "MXN",
    notes: "Pedido semanal de carnes y pollo",
  }).returning();

  await db.insert(purchaseOrderItems).values([
    {
      poId: poDraft.id,
      itemId: items[0].id, // Pollo
      orderedQuantity: 50,
      receivedQuantity: 0,
      unitCost: 8500,
      lineTotal: 425000,
      taxRate: 16,
      taxAmount: 68000,
      status: "PENDING",
    },
    {
      poId: poDraft.id,
      itemId: items[1].id, // Filete
      orderedQuantity: 20,
      receivedQuantity: 0,
      unitCost: 19500,
      lineTotal: 390000,
      taxRate: 16,
      taxAmount: 62400,
      status: "PENDING",
    },
  ]);

  // 2. OC Pendiente de Aprobación (con approvalRequest)
  const [poPending] = await db.insert(purchaseOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    poNumber: "OC-COND-2026-0001",
    folioYear: year,
    folioSequence: 1,
    supplierId: supps[1].id,
    status: "PENDING_APPROVAL",
    purchaseType: "STOCK",
    costCenterId: ccMap.get("CC-ALM"),
    requestedBy: USER_SUPERVISOR,
    dateOrdered: new Date(),
    dateRequired: new Date(Date.now() + 2 * 86400000),
    expectedDeliveryDate: new Date(Date.now() + 2 * 86400000),
    subtotal: 1200000,
    taxAmount: 192000,
    iepsAmount: 0,
    totalAmount: 1392000,
    notes: "Reabastecimiento de cortes para fin de semana",
  }).returning();

  await db.insert(purchaseOrderItems).values([
    {
      poId: poPending.id,
      itemId: items[1].id,
      orderedQuantity: 40,
      receivedQuantity: 0,
      unitCost: 19500,
      lineTotal: 780000,
      taxRate: 16,
      taxAmount: 124800,
      status: "PENDING",
    },
    {
      poId: poPending.id,
      itemId: items[2].id,
      orderedQuantity: 35,
      receivedQuantity: 0,
      unitCost: 12000,
      lineTotal: 420000,
      taxRate: 16,
      taxAmount: 67200,
      status: "PENDING",
    },
  ]);

  await db.insert(approvalRequests).values({
    docType: "OC",
    docId: poPending.id,
    companyId: COMPANY_ID,
    level: 1,
    requiredRole: "ADMIN",
    minQuotes: 2,
    status: "PENDING",
  });

  // 3. OC Aprobada y Enviada
  const [poApproved] = await db.insert(purchaseOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_POLANCO,
    poNumber: "OC-POL-2026-0001",
    folioYear: year,
    folioSequence: 1,
    supplierId: supps[3].id,
    status: "APPROVED",
    purchaseType: "PROGRAMADA",
    costCenterId: ccMap.get("CC-ALM"),
    requestedBy: USER_GERENTE,
    approvedBy: USER_ADMIN,
    approvedAt: new Date(Date.now() - 1 * 86400000),
    dateOrdered: new Date(Date.now() - 1 * 86400000),
    dateRequired: new Date(Date.now() + 1 * 86400000),
    expectedDeliveryDate: new Date(Date.now() + 1 * 86400000),
    subtotal: 550000,
    taxAmount: 88000,
    iepsAmount: 0,
    totalAmount: 638000,
    sentAt: new Date(Date.now() - 1 * 86400000),
    notes: "Lácteos y quesos semanales",
  }).returning();

  await db.insert(purchaseOrderItems).values([
    {
      poId: poApproved.id,
      itemId: items[5].id, // Leche
      orderedQuantity: 100,
      receivedQuantity: 0,
      unitCost: 2200,
      lineTotal: 220000,
      taxRate: 0,
      taxAmount: 0,
      status: "PENDING",
    },
    {
      poId: poApproved.id,
      itemId: items[7].id, // Queso Manchego
      orderedQuantity: 20,
      receivedQuantity: 0,
      unitCost: 14000,
      lineTotal: 280000,
      taxRate: 0,
      taxAmount: 0,
      status: "PENDING",
    },
  ]);

  // 4. OC de Emergencia (para probar consumo del tope mensual de $30,000)
  const [poEmergency] = await db.insert(purchaseOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_ROMA,
    poNumber: "OC-ROMA-2026-0001",
    folioYear: year,
    folioSequence: 1,
    supplierId: supps[4].id,
    status: "APPROVED",
    purchaseType: "EMERGENCIA",
    costCenterId: ccMap.get("CC-ALM"),
    requestedBy: USER_SUPERVISOR,
    approvedBy: USER_ADMIN,
    approvedAt: new Date(),
    dateOrdered: new Date(),
    dateRequired: new Date(),
    expectedDeliveryDate: new Date(),
    subtotal: 450000,
    taxAmount: 0,
    iepsAmount: 0,
    totalAmount: 450000,
    notes: "Compra urgente de aguacate y tomate por quiebre de stock en turno vespertino",
  }).returning();

  await db.insert(purchaseOrderItems).values([
    {
      poId: poEmergency.id,
      itemId: items[10].id,
      orderedQuantity: 50,
      receivedQuantity: 50,
      unitCost: 2800,
      lineTotal: 140000,
      taxRate: 0,
      taxAmount: 0,
      status: "RECEIVED",
    },
    {
      poId: poEmergency.id,
      itemId: items[12].id,
      orderedQuantity: 50,
      receivedQuantity: 50,
      unitCost: 5500,
      lineTotal: 275000,
      taxRate: 0,
      taxAmount: 0,
      status: "RECEIVED",
    },
  ]);

  console.log("Inserting service orders (OS)...");
  // 1. OS Mantenimiento Campana (Vinculada a compliance service)
  const compSvc = compServices[0];
  const [osCompliance] = await db.insert(serviceOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    folio: "OS-COND-2026-0001",
    type: "PREVENTIVO",
    urgency: "NORMAL",
    status: "PENDING_CONFORMITY",
    equipmentId: equipList[0]?.id,
    complianceServiceId: compSvc?.id,
    scope: "Limpieza y desengrase profundo de campana extractora y ductos principales",
    justification: "Cumplimiento normativo NOM-251 y prevención de incendios",
    technicalReport: "Se realizó servicio completo de extracción de grasa, cambio de filtros y prueba de tiro. Sistema operando al 100%.",
    serviceProviderId: provs[0]?.id,
    amount: 350000, // $3,500 MXN
    scheduledDate: new Date(Date.now() - 2 * 86400000),
    completedAt: new Date(Date.now() - 1 * 86400000),
    costCenterId: ccMap.get("CC-MANT"),
    createdBy: USER_GERENTE,
  }).returning();

  await db.insert(serviceOrderQuotes).values({
    serviceOrderId: osCompliance.id,
    url: "/mock/quotes/cotizacion-fumiprof-001.pdf",
    supplierName: "Fumigaciones Profesionales MX",
    amount: 350000,
    notes: "Cotización autorizada por contrato anual",
  });

  await db.insert(serviceOrderEvidence).values([
    {
      serviceOrderId: osCompliance.id,
      type: "ANTES",
      url: "/mock/evidence/campana-antes.jpg",
      description: "Acumulación de grasa en filtros y plenum",
      uploadedBy: USER_EMPLEADO_1,
    },
    {
      serviceOrderId: osCompliance.id,
      type: "DESPUES",
      url: "/mock/evidence/campana-despues.jpg",
      description: "Superficie de acero inoxidable libre de grasa y sanitizada",
      uploadedBy: USER_EMPLEADO_1,
    },
  ]);

  // 2. OS Correctiva Urgente de Refrigeración
  const [osUrgent] = await db.insert(serviceOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_POLANCO,
    folio: "OS-POL-2026-0001",
    type: "CORRECTIVO",
    urgency: "URGENTE",
    status: "PENDING_APPROVAL",
    scope: "Reparación de compresor y recarga de gas refrigerante en cámara de congelación",
    justification: "Temperatura subió a -8°C poniendo en riesgo producto congelado",
    serviceProviderId: provs[2]?.id,
    amount: 850000, // $8,500 MXN
    costCenterId: ccMap.get("CC-MANT"),
    createdBy: USER_SUPERVISOR,
  }).returning();

  await db.insert(serviceOrderQuotes).values([
    {
      serviceOrderId: osUrgent.id,
      url: "/mock/quotes/electrogas-cotizacion.pdf",
      supplierName: "Servicios Eléctricos y Gas",
      amount: 850000,
      notes: "Diagnóstico urgente incluye refacción original y gas R404A",
    },
    {
      serviceOrderId: osUrgent.id,
      url: "/mock/quotes/refrigeracion-mexico.pdf",
      supplierName: "Refrigeración Industrial MX",
      amount: 980000,
      notes: "Cotización comparativa #2",
    },
  ]);

  await db.insert(approvalRequests).values({
    docType: "OS",
    docId: osUrgent.id,
    companyId: COMPANY_ID,
    level: 1,
    requiredRole: "ADMIN",
    minQuotes: 2,
    status: "PENDING",
  });

  // 3. OS Finalizada y Cerrada con Conformidad
  const [osClosed] = await db.insert(serviceOrders).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_ROMA,
    folio: "OS-ROMA-2026-0001",
    type: "CONTRACTUAL",
    urgency: "NORMAL",
    status: "CLOSED",
    scope: "Inspección mensual de extintores y sistema contra incendios",
    justification: "Programa de protección civil",
    technicalReport: "Recarga de 6 extintores PQS de 6kg y revisión de manómetros. Sellos colocados.",
    serviceProviderId: provs[1]?.id,
    amount: 180000,
    scheduledDate: new Date(Date.now() - 10 * 86400000),
    completedAt: new Date(Date.now() - 8 * 86400000),
    conformitySignedBy: USER_GERENTE,
    conformitySignedAt: new Date(Date.now() - 8 * 86400000),
    costCenterId: ccMap.get("CC-MANT"),
    createdBy: USER_GERENTE,
  }).returning();

  console.log("Phase 11 complete!");
}
