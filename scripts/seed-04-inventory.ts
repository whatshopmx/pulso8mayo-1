import "dotenv/config";
import { db } from "@/lib/db";
import {
  inventoryItems, inventoryBatches, inventoryMovements,
  inventoryPriceHistory, inventoryAlerts, inventoryWaste,
  inventoryTransfers, inventoryTransferItems,
  temperatureLogs, costRecords, unitConversions,
  storageLocations, suppliers,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
} from "./seed-constants";

function randomDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  d.setHours(Math.floor(Math.random() * 12) + 6, Math.floor(Math.random() * 60));
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const HORECA_CONVERSIONS = [
  { fromUnit: "KG", toUnit: "G", factor: 1000, description: "Kilogramos a Gramos" },
  { fromUnit: "L", toUnit: "mL", factor: 1000, description: "Litros a Mililitros" },
  { fromUnit: "BOX", toUnit: "UNIT", factor: 12, description: "Caja a Piezas (estándar 12)" },
  { fromUnit: "DOZEN", toUnit: "UNIT", factor: 12, description: "Docena a Piezas" },
  { fromUnit: "KG", toUnit: "LB", factor: 2205, description: "Kilogramos a Libras (milésimas)" },
  { fromUnit: "BOX", toUnit: "KG", factor: 10, description: "Caja a KG (ej: harina 10kg)" },
  { fromUnit: "BOX", toUnit: "L", factor: 12, description: "Caja a Litros" },
  { fromUnit: "BULTO", toUnit: "KG", factor: 25, description: "Bulto a KG (estándar 25kg)" },
];

interface ItemDef {
  name: string; sku: string; category: string; unit: string;
  minLevel: number; maxLevel: number; storageArea: string;
  shelfLifeDays: number; lastCost: number; supplierIdx: number;
  storageReq?: string; allergenInfo?: string;
}

const ITEMS: ItemDef[] = [
  { name: "Pechuga de Pollo", sku: "CAR-001", category: "Carnes", unit: "KG", minLevel: 10, maxLevel: 50, storageArea: "REFRIGERATOR", shelfLifeDays: 7, lastCost: 8500, supplierIdx: 1 },
  { name: "Filete de Res", sku: "CAR-002", category: "Carnes", unit: "KG", minLevel: 8, maxLevel: 40, storageArea: "REFRIGERATOR", shelfLifeDays: 10, lastCost: 19500, supplierIdx: 1 },
  { name: "Costilla de Cerdo", sku: "CAR-003", category: "Carnes", unit: "KG", minLevel: 5, maxLevel: 30, storageArea: "REFRIGERATOR", shelfLifeDays: 8, lastCost: 12000, supplierIdx: 1 },
  { name: "Carne Molida de Res", sku: "CAR-004", category: "Carnes", unit: "KG", minLevel: 5, maxLevel: 25, storageArea: "REFRIGERATOR", shelfLifeDays: 5, lastCost: 11000, supplierIdx: 1 },
  { name: "Salchicha para Asar", sku: "CAR-005", category: "Carnes", unit: "KG", minLevel: 3, maxLevel: 20, storageArea: "REFRIGERATOR", shelfLifeDays: 14, lastCost: 6500, supplierIdx: 1 },
  { name: "Leche Entera", sku: "LAC-001", category: "Lácteos", unit: "L", minLevel: 15, maxLevel: 60, storageArea: "REFRIGERATOR", shelfLifeDays: 7, lastCost: 2200, supplierIdx: 3 },
  { name: "Crema Ácida", sku: "LAC-002", category: "Lácteos", unit: "KG", minLevel: 3, maxLevel: 15, storageArea: "REFRIGERATOR", shelfLifeDays: 14, lastCost: 4500, supplierIdx: 3 },
  { name: "Queso Manchego", sku: "LAC-003", category: "Lácteos", unit: "KG", minLevel: 3, maxLevel: 15, storageArea: "REFRIGERATOR", shelfLifeDays: 30, lastCost: 14000, supplierIdx: 3 },
  { name: "Mantequilla", sku: "LAC-004", category: "Lácteos", unit: "KG", minLevel: 2, maxLevel: 10, storageArea: "REFRIGERATOR", shelfLifeDays: 45, lastCost: 5200, supplierIdx: 3 },
  { name: "Yogurt Natural", sku: "LAC-005", category: "Lácteos", unit: "KG", minLevel: 2, maxLevel: 12, storageArea: "REFRIGERATOR", shelfLifeDays: 10, lastCost: 3800, supplierIdx: 3 },
  { name: "Tomate Saladet", sku: "VER-001", category: "Verduras", unit: "KG", minLevel: 10, maxLevel: 40, storageArea: "DRY_STORAGE", shelfLifeDays: 5, lastCost: 2800, supplierIdx: 4 },
  { name: "Cebolla Blanca", sku: "VER-002", category: "Verduras", unit: "KG", minLevel: 10, maxLevel: 40, storageArea: "DRY_STORAGE", shelfLifeDays: 14, lastCost: 1800, supplierIdx: 4 },
  { name: "Aguacate Hass", sku: "VER-003", category: "Verduras", unit: "KG", minLevel: 5, maxLevel: 25, storageArea: "DRY_STORAGE", shelfLifeDays: 4, lastCost: 5500, supplierIdx: 4 },
  { name: "Lechuga Romana", sku: "VER-004", category: "Verduras", unit: "UNIT", minLevel: 10, maxLevel: 40, storageArea: "REFRIGERATOR", shelfLifeDays: 5, lastCost: 1500, supplierIdx: 4 },
  { name: "Limón Verde", sku: "VER-005", category: "Verduras", unit: "KG", minLevel: 5, maxLevel: 20, storageArea: "DRY_STORAGE", shelfLifeDays: 7, lastCost: 2500, supplierIdx: 4 },
  { name: "Agua Purificada", sku: "BEB-001", category: "Bebidas", unit: "L", minLevel: 20, maxLevel: 100, storageArea: "DRY_STORAGE", shelfLifeDays: 365, lastCost: 1000, supplierIdx: 0 },
  { name: "Refresco Cola", sku: "BEB-002", category: "Bebidas", unit: "L", minLevel: 15, maxLevel: 80, storageArea: "DRY_STORAGE", shelfLifeDays: 180, lastCost: 1800, supplierIdx: 0 },
  { name: "Cerveza Clara", sku: "BEB-003", category: "Bebidas", unit: "BOX", minLevel: 3, maxLevel: 20, storageArea: "DRY_STORAGE", shelfLifeDays: 180, lastCost: 24000, supplierIdx: 2 },
  { name: "Vino Tinto", sku: "BEB-004", category: "Bebidas", unit: "UNIT", minLevel: 6, maxLevel: 30, storageArea: "DRY_STORAGE", shelfLifeDays: 730, lastCost: 15000, supplierIdx: 2 },
  { name: "Jugo de Naranja", sku: "BEB-005", category: "Bebidas", unit: "L", minLevel: 5, maxLevel: 25, storageArea: "REFRIGERATOR", shelfLifeDays: 14, lastCost: 3200, supplierIdx: 0 },
  { name: "Aceite Vegetal", sku: "DIS-001", category: "Diversos", unit: "L", minLevel: 5, maxLevel: 30, storageArea: "DRY_STORAGE", shelfLifeDays: 365, lastCost: 2800, supplierIdx: 0 },
  { name: "Harina de Trigo", sku: "DIS-002", category: "Diversos", unit: "KG", minLevel: 10, maxLevel: 50, storageArea: "DRY_STORAGE", shelfLifeDays: 180, lastCost: 1500, supplierIdx: 0 },
  { name: "Arroz Blanco", sku: "DIS-003", category: "Diversos", unit: "KG", minLevel: 10, maxLevel: 50, storageArea: "DRY_STORAGE", shelfLifeDays: 365, lastCost: 2200, supplierIdx: 0 },
  { name: "Frijol Negro", sku: "DIS-004", category: "Diversos", unit: "KG", minLevel: 5, maxLevel: 30, storageArea: "DRY_STORAGE", shelfLifeDays: 365, lastCost: 2800, supplierIdx: 0 },
  { name: "Huevo Blanco", sku: "DIS-005", category: "Diversos", unit: "DOZEN", minLevel: 5, maxLevel: 30, storageArea: "REFRIGERATOR", shelfLifeDays: 21, lastCost: 3500, supplierIdx: 0 },
  { name: "Tortilla de Maíz", sku: "DIS-006", category: "Diversos", unit: "KG", minLevel: 5, maxLevel: 25, storageArea: "DRY_STORAGE", shelfLifeDays: 2, lastCost: 1600, supplierIdx: 0 },
  { name: "Jabón Líquido", sku: "LIM-001", category: "Limpieza", unit: "L", minLevel: 2, maxLevel: 10, storageArea: "DRY_STORAGE", shelfLifeDays: 365, lastCost: 3500, supplierIdx: 5 },
  { name: "Desinfectante", sku: "LIM-002", category: "Limpieza", unit: "L", minLevel: 2, maxLevel: 10, storageArea: "DRY_STORAGE", shelfLifeDays: 365, lastCost: 2800, supplierIdx: 5 },
  { name: "Papel Higiénico", sku: "LIM-003", category: "Limpieza", unit: "UNIT", minLevel: 20, maxLevel: 100, storageArea: "DRY_STORAGE", shelfLifeDays: 730, lastCost: 800, supplierIdx: 5 },
  { name: "Servilletas", sku: "DES-001", category: "Desechables", unit: "BOX", minLevel: 5, maxLevel: 30, storageArea: "DRY_STORAGE", shelfLifeDays: 730, lastCost: 4500, supplierIdx: 5 },
];

export async function main() {
  console.log("=== Phase 4: Inventory ===");
  console.log("Cleaning up...");

  await db.delete(inventoryWaste).where(eq(inventoryWaste.companyId, COMPANY_ID));
  await db.delete(inventoryAlerts).where(eq(inventoryAlerts.companyId, COMPANY_ID));
  await db.delete(inventoryMovements).where(eq(inventoryMovements.branchId, BRANCH_CONDESA));
  await db.delete(inventoryMovements).where(eq(inventoryMovements.branchId, BRANCH_POLANCO));
  await db.delete(inventoryMovements).where(eq(inventoryMovements.branchId, BRANCH_ROMA));
  await db.delete(inventoryBatches).where(eq(inventoryBatches.branchId, BRANCH_CONDESA));
  await db.delete(inventoryBatches).where(eq(inventoryBatches.branchId, BRANCH_POLANCO));
  await db.delete(inventoryBatches).where(eq(inventoryBatches.branchId, BRANCH_ROMA));
  await db.delete(costRecords).where(eq(costRecords.companyId, COMPANY_ID));
  await db.delete(temperatureLogs).where(eq(temperatureLogs.branchId, BRANCH_CONDESA));
  await db.delete(temperatureLogs).where(eq(temperatureLogs.branchId, BRANCH_POLANCO));
  await db.delete(temperatureLogs).where(eq(temperatureLogs.branchId, BRANCH_ROMA));
  await db.delete(inventoryTransfers).where(sql`1=1`); // Cascade handles transfer items
  await db.delete(inventoryPriceHistory).where(sql`1=1`);
  await db.delete(unitConversions).where(eq(unitConversions.companyId, COMPANY_ID));
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, COMPANY_ID));

  console.log("Querying storage locations and suppliers...");
  const storageRows = await db.select().from(storageLocations)
    .where(and(eq(storageLocations.companyId, COMPANY_ID), eq(storageLocations.active, true)));
  const supplierRows = await db.select().from(suppliers)
    .where(and(eq(suppliers.companyId, COMPANY_ID), eq(suppliers.active, true)));

  const findStorage = (branchId: string, namePart: string) =>
    storageRows.find(s => s.branchId === branchId && s.name.includes(namePart))?.id || storageRows[0].id;
  const findSupplier = (idx: number) => supplierRows[idx]?.id || supplierRows[0].id;

  console.log(`Inserting ${ITEMS.length} inventory items...`);
  const itemValues = ITEMS.map(item => ({
    companyId: COMPANY_ID,
    name: item.name,
    sku: item.sku,
    category: item.category,
    unit: item.unit,
    minLevel: item.minLevel,
    maxLevel: item.maxLevel,
    storageArea: item.storageArea,
    allergenInfo: item.allergenInfo,
    storageRequirements: item.storageReq,
    typicalShelfLifeDays: item.shelfLifeDays,
    supplierId: findSupplier(item.supplierIdx),
    lastCost: item.lastCost,
    active: true,
  }));
  const itemRows = await db.insert(inventoryItems).values(itemValues).returning({ id: inventoryItems.id });

  console.log(`Inserting ${HORECA_CONVERSIONS.length} unit conversions...`);
  const convValues = HORECA_CONVERSIONS.map(conv => ({
    companyId: COMPANY_ID,
    fromUnit: conv.fromUnit,
    toUnit: conv.toUnit,
    factor: conv.factor,
    description: conv.description,
  }));
  await db.insert(unitConversions).values(convValues);

  console.log("Inserting inventory batches (2-3 per item)...");
  const batchValues: any[] = [];
  const branchIds = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
  const branchStorage = branchIds.map(bid => ({
    bid,
    dryId: findStorage(bid, "Almacén"),
    fridgeId: findStorage(bid, "Refrigerador"),
    freezerId: findStorage(bid, "Congelador"),
  }));

  for (let i = 0; i < itemRows.length; i++) {
    const itemId = itemRows[i].id;
    const item = ITEMS[i];
    const numBatches = item.category === "Carnes" ? 3 : 2;
    const batchForBranch = branchIds[i % 3];

    for (let b = 0; b < numBatches; b++) {
      const receivedDate = new Date();
      receivedDate.setDate(receivedDate.getDate() - randomInt(1, item.shelfLifeDays > 30 ? 60 : 20));
      const expiresDate = new Date(receivedDate);
      expiresDate.setDate(expiresDate.getDate() + item.shelfLifeDays);
      const qty = randomInt(item.minLevel * 2, item.maxLevel * 2);
      const used = randomInt(0, Math.floor(qty * 0.7));
      const cost = item.lastCost + randomInt(-1000, 1000);

      batchValues.push({
        itemId,
        branchId: batchForBranch,
        supplierId: findSupplier(item.supplierIdx),
        lotNumber: `LOTE-${String(randomInt(1, 999)).padStart(4, "0")}`,
        productionDate: new Date(receivedDate.getTime() - randomInt(1, 5) * 86400000),
        expirationDate: expiresDate,
        receivedAt: receivedDate,
        initialQuantity: qty,
        currentQuantity: Math.max(0, qty - used),
        unitCost: cost,
        status: expiresDate < new Date() ? "EXPIRED" as const : "AVAILABLE" as const,
      });
    }
  }
  const batchRows = await db.insert(inventoryBatches).values(batchValues).returning({ id: inventoryBatches.id });
  console.log(`  Created ${batchRows.length} batches`);

  console.log("Inserting inventory movements (50+)...");
  const usageValues: any[] = [];
  const receivingValues: any[] = [];
  let batchIdx = 0;
  for (let i = 0; i < itemRows.length; i++) {
    const itemId = itemRows[i].id;
    const item = ITEMS[i];
    const bid = branchIds[i % 3];
    const bStorage = branchStorage[i % 3];
    const numMovements = randomInt(1, 3);
    const itemBatches = batchRows.slice(batchIdx, batchIdx + (item.category === "Carnes" ? 3 : 2));
    batchIdx += item.category === "Carnes" ? 3 : 2;

    for (let m = 0; m < numMovements; m++) {
      const batch = itemBatches[m % itemBatches.length];
      const qty = -randomInt(1, Math.max(2, Math.floor(item.maxLevel / 3)));
      const ts = randomDate(30);

      usageValues.push({
        branchId: bid,
        itemId,
        batchId: batch.id,
        type: "USAGE",
        quantityChange: qty,
        fromLocationId: bStorage.fridgeId,
        reason: "Consumo en cocina",
        referenceId: null,
        performedBy: [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3][i % 3],
        timestamp: ts,
      });
    }

    const receivingBatch = itemBatches[0];
    if (receivingBatch) {
      const ts = randomDate(30);
      receivingValues.push({
        branchId: bid,
        itemId,
        batchId: receivingBatch.id,
        type: "RECEIVING",
        quantityChange: (itemBatches.length > 1 ? itemBatches : [receivingBatch]).reduce((s, b) => s + (itemBatches.find(r => r.id === b.id) ? 1 : 0), 0) > 0 ? randomInt(item.minLevel * 2, item.maxLevel * 2) : randomInt(item.minLevel, item.maxLevel * 2),
        toLocationId: bStorage.dryId,
        reason: "Recepción de proveedor",
        performedBy: USER_ADMIN,
        timestamp: ts,
      });
    }
  }
  if (usageValues.length > 0) await db.insert(inventoryMovements).values(usageValues);
  if (receivingValues.length > 0) await db.insert(inventoryMovements).values(receivingValues);

  console.log("Inserting price history...");
  const priceValues: any[] = [];
  for (let i = 0; i < itemRows.length; i++) {
    const prevCost = ITEMS[i].lastCost - randomInt(1000, 4000);
    priceValues.push({
      itemId: itemRows[i].id,
      previousCost: Math.max(0, prevCost),
      newCost: ITEMS[i].lastCost,
      changedBy: USER_ADMIN,
      changedAt: randomDate(60),
    });
    if (i % 3 === 0) {
      const olderCost = prevCost - randomInt(500, 2000);
      priceValues.push({
        itemId: itemRows[i].id,
        previousCost: Math.max(0, olderCost),
        newCost: Math.max(0, prevCost),
        changedBy: USER_ADMIN,
        changedAt: randomDate(120),
      });
    }
  }
  await db.insert(inventoryPriceHistory).values(priceValues);

  console.log("Inserting inventory alerts...");
  const alertItems = [0, 2, 5, 9, 11, 15, 18, 22];
  const alertTypes = ["LOW_STOCK", "EXPIRING_SOON", "LOW_STOCK", "EXPIRING_SOON", "LOW_STOCK", "EXPIRED", "LOW_STOCK", "OUT_OF_STOCK"] as const;
  const alertSeverities = ["ALTA", "MEDIA", "MEDIA", "BAJA", "CRITICA", "ALTA", "MEDIA", "CRITICA"];

  const alertValues: any[] = [];
  for (let a = 0; a < alertItems.length; a++) {
    const idx = alertItems[a];
    const item = ITEMS[idx];
    const bid = branchIds[idx % 3];
    const stock = alertTypes[a] === "OUT_OF_STOCK" ? 0 : randomInt(0, item.minLevel);
    alertValues.push({
      companyId: COMPANY_ID,
      branchId: bid,
      itemId: itemRows[idx].id,
      type: alertTypes[a],
      severity: alertSeverities[a],
      status: a < 4 ? "ACTIVE" : "RESOLVED",
      currentStock: stock,
      minLevel: item.minLevel,
      batchId: batchRows[idx * 2]?.id,
      detectedAt: randomDate(7),
      viewedAt: a >= 2 ? randomDate(5) : null,
      resolvedAt: a >= 4 ? randomDate(2) : null,
      resolvedBy: a >= 4 ? USER_ADMIN : null,
      notes: `Alerta generada por nivel de ${item.name}`,
    });
  }
  await db.insert(inventoryAlerts).values(alertValues);

  console.log("Inserting waste records...");
  const wasteReasons = ["EXPIRED", "DAMAGED", "QUALITY", "SPILLAGE", "OTHER"] as const;
  const wasteValues: any[] = [];
  for (let w = 0; w < 7; w++) {
    const idx = wasteReasons.length > w ? w * 3 : w * 4;
    if (idx >= itemRows.length) break;
    const itemIdx = idx % itemRows.length;
    const bid = branchIds[itemIdx % 3];
    const item = ITEMS[itemIdx];
    const qty = randomInt(1, 5);
    const reason = wasteReasons[w % wasteReasons.length];
    const cost = item.lastCost;
    const batch = batchRows[itemIdx * 2];

    wasteValues.push({
      companyId: COMPANY_ID,
      branchId: bid,
      batchId: batch?.id,
      itemId: itemRows[itemIdx].id,
      quantity: qty,
      unit: item.unit,
      reason,
      costPerUnit: cost,
      totalLoss: qty * cost,
      recordedBy: [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_SUPERVISOR][itemIdx % 3],
      recordedAt: randomDate(15),
      notes: `Merma por ${reason === "EXPIRED" ? "caducidad" : reason === "DAMAGED" ? "daño" : reason === "QUALITY" ? "calidad" : reason === "SPILLAGE" ? "derrame" : "otro motivo"} - ${item.name}`,
    });
  }
  await db.insert(inventoryWaste).values(wasteValues);

  console.log("Inserting transfers...");
  await db.insert(inventoryTransfers).values({
    transferNumber: "TRF-2026-001",
    fromBranchId: BRANCH_CONDESA,
    toBranchId: BRANCH_POLANCO,
    status: "COMPLETED",
    requestedBy: USER_GERENTE,
    approvedBy: USER_ADMIN,
    shippedBy: USER_EMPLEADO_1,
    receivedBy: USER_EMPLEADO_2,
    requestedAt: new Date(Date.now() - 7 * 86400000),
    approvedAt: new Date(Date.now() - 6 * 86400000),
    shippedAt: new Date(Date.now() - 6 * 86400000),
    receivedAt: new Date(Date.now() - 5 * 86400000),
    notes: "Transferencia de insumos por excedente en Condesa",
  });
  const [transfer1] = await db.select({ id: inventoryTransfers.id })
    .from(inventoryTransfers)
    .where(eq(inventoryTransfers.transferNumber, "TRF-2026-001"))
    .limit(1);

  await db.insert(inventoryTransfers).values({
    transferNumber: "TRF-2026-002",
    fromBranchId: BRANCH_POLANCO,
    toBranchId: BRANCH_ROMA,
    status: "IN_TRANSIT",
    requestedBy: USER_SUPERVISOR,
    approvedBy: USER_ADMIN,
    shippedBy: USER_EMPLEADO_2,
    requestedAt: new Date(Date.now() - 2 * 86400000),
    approvedAt: new Date(Date.now() - 1 * 86400000),
    shippedAt: new Date(Date.now() - 1 * 86400000),
    notes: "Transferencia urgente de productos para evento especial",
  });
  const [transfer2] = await db.select({ id: inventoryTransfers.id })
    .from(inventoryTransfers)
    .where(eq(inventoryTransfers.transferNumber, "TRF-2026-002"))
    .limit(1);

  const transferItemValues: any[] = [];
  if (transfer1) {
    for (let t = 0; t < 3; t++) {
      const idx = t * 5;
      if (idx >= itemRows.length) break;
      const qty = randomInt(5, 20);
      transferItemValues.push({
        transferId: transfer1.id,
        itemId: itemRows[idx].id,
        batchId: batchRows[idx * 2]?.id,
        requestedQuantity: qty,
        approvedQuantity: qty,
        shippedQuantity: qty,
        receivedQuantity: qty,
        notes: null,
      });
    }
  }
  if (transfer2) {
    for (let t = 0; t < 2; t++) {
      const idx = t * 7 + 2;
      if (idx >= itemRows.length) break;
      const qty = randomInt(3, 10);
      transferItemValues.push({
        transferId: transfer2.id,
        itemId: itemRows[idx].id,
        batchId: batchRows[idx * 2]?.id,
        requestedQuantity: qty,
        notes: null,
      });
    }
  }
  if (transferItemValues.length > 0) {
    await db.insert(inventoryTransferItems).values(transferItemValues);
  }

  console.log("Inserting temperature logs...");
  const branchList = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
  const tempValues: any[] = [];
  for (let t = 0; t < 24; t++) {
    const bid = branchList[t % 3];
    const temp = t % 6 === 0 ? randomInt(10, 15) : randomInt(2, 8);
    tempValues.push({
      branchId: bid,
      readingValue: temp,
      unit: "C",
      location: "Refrigerador Cocina",
      isCompliant: temp <= 8,
      minThreshold: 0,
      maxThreshold: 8,
      capturedBy: [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3][t % 3],
      captureMethod: "MANUAL",
      notes: temp > 8 ? "TEMPERATURA ELEVADA - revisar equipo" : "Temperatura normal",
      timestamp: randomDate(7),
    });
  }
  await db.insert(temperatureLogs).values(tempValues);

  console.log("Inserting cost records...");
  const costCategories = ["INSUMOS", "OPERATIVOS", "LOGISTICA", "ALMACENAJE"];
  const costValues: any[] = [];
  for (let c = 0; c < 12; c++) {
    const bid = branchList[c % 3];
    const cat = costCategories[c % costCategories.length];
    costValues.push({
      companyId: COMPANY_ID,
      branchId: bid,
      category: cat,
      amount: randomInt(50000, 500000),
      description: `Costo de ${cat.toLowerCase()} - periodo ${c + 1}`,
      recordedBy: USER_ADMIN,
      periodStart: new Date(2026, c % 6, 1),
      periodEnd: new Date(2026, (c % 6) + 1, 0),
      recordedAt: randomDate(30),
    });
  }
  await db.insert(costRecords).values(costValues);

  console.log("Phase 4 complete!");
}
