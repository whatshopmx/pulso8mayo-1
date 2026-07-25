import "dotenv/config";
import { db } from "@/lib/db";
import {
  companies, users, branches,
  equipmentCatalog, branchEquipments, equipmentWarranties,
  equipmentMaintenanceHistory, equipmentMaintenanceSchedules,
  branchComplianceServices, serviceProviders, complianceServiceHistory,
  equipmentAlerts,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_SUPER_ADMIN, USER_ADMIN,
} from "./seed-constants";

const CATALOG_ITEMS = [
  { name: "Refrigerador Industrial 2 Puertas", type: "REFRIGERATOR" as const, brand: "Torrey", model: "TR-2000", specs: { capacity: "600L", voltage: "220V", temperature: "2-8°C" }, defaultMaintFreq: "MONTHLY", defaultMaintTasks: ["Limpiar condensadores", "Revisar empaques", "Verificar temperatura"] },
  { name: "Congelador Vertical", type: "FREEZER" as const, brand: "Torrey", model: "CF-500", specs: { capacity: "500L", voltage: "220V", temperature: "-18°C" }, defaultMaintFreq: "MONTHLY", defaultMaintTasks: ["Descongelar", "Limpiar condensadores", "Revisar sello"] },
  { name: "Horno Convector", type: "OVEN" as const, brand: "Rational", model: "SCC 61G", specs: { capacity: "6x GN1/1", voltage: "380V" }, defaultMaintFreq: "QUARTERLY", defaultMaintTasks: ["Calibrar temperatura", "Limpiar ventilador", "Revisar resistencias"] },
  { name: "Estufa Industrial 6 Quemadores", type: "STOVE" as const, brand: "Mabe", model: "ER-6000", specs: { burners: "6", voltage: "220V" }, defaultMaintFreq: "QUARTERLY", defaultMaintTasks: ["Limpiar quemadores", "Revisar válvulas de gas", "Verificar pilotos"] },
  { name: "Parrilla Eléctrica", type: "GRILL" as const, brand: "Garland", model: "G-36", specs: { surface: "36inch", voltage: "220V" }, defaultMaintFreq: "MONTHLY", defaultMaintTasks: ["Limpiar superficie", "Revisar termostato"] },
  { name: "Freidora Industrial", type: "FRYER" as const, brand: "Pitco", model: "Frialator 35", specs: { capacity: "35lb", voltage: "220V" }, defaultMaintFreq: "WEEKLY", defaultMaintTasks: ["Cambiar aceite", "Limpiar válvulas de drenaje", "Revisar termostato"] },
  { name: "Lavavajillas Industrial", type: "DISHWASHER" as const, brand: "Hobart", model: "AM-14", specs: { cycles: "140/h", voltage: "380V" }, defaultMaintFreq: "WEEKLY", defaultMaintTasks: ["Limpiar brazos rociadores", "Revisar bomba", "Verificar temperatura"] },
  { name: "Máquina de Café Expreso", type: "COFFEE_MACHINE" as const, brand: "La Marzocco", model: "Linea PB", specs: { groups: "3", voltage: "220V" }, defaultMaintFreq: "WEEKLY", defaultMaintTasks: ["Descalcificar", "Limpiar grupo", "Revisar presión"] },
  { name: "Licuadora Industrial", type: "BLENDER" as const, brand: "Vitamix", model: "T&G 2L", specs: { capacity: "2L", power: "1400W" }, defaultMaintFreq: "MONTHLY", defaultMaintTasks: ["Revisar cuchillas", "Limpiar sello"] },
  { name: "Batidora Industrial", type: "MIXER" as const, brand: "KitchenAid", model: "Pro 600", specs: { capacity: "6.9L", power: "575W" }, defaultMaintFreq: "MONTHLY", defaultMaintTasks: ["Lubricar engranajes", "Revisar velocidades"] },
  { name: "Campana Extractora", type: "EXHAUST_HOOD" as const, brand: "S&T", model: "CF-2000", specs: { cfm: "2000", voltage: "220V" }, defaultMaintFreq: "MONTHLY", defaultMaintTasks: ["Limpiar filtros", "Revisar motor", "Verificar flujo"] },
  { name: "Sistema POS", type: "POS_SYSTEM" as const, brand: "Zebra", model: "TC22", specs: { os: "Android", screen: "5inch" }, defaultMaintFreq: "QUARTERLY", defaultMaintTasks: ["Actualizar software", "Verificar impresora", "Respaldar datos"] },
];

interface EquipDef {
  branchId: string; name: string; code: string; type: "REFRIGERATOR" | "FREEZER" | "OVEN" | "STOVE" | "GRILL" | "FRYER" | "DISHWASHER" | "COFFEE_MACHINE" | "BLENDER" | "MIXER" | "EXHAUST_HOOD" | "POS_SYSTEM";
  catIdx: number; brand: string; model: string; serial: string; location: string; area: string;
  purchaseDate: Date; purchasePrice: number; vendor: string; isCritical: boolean;
}
const BRANCH_EQUIPMENT_INSTANCES: EquipDef[] = [
  { branchId: BRANCH_CONDESA, name: "Refrigerador Cocina Principal", code: "REF-CND-001", type: "REFRIGERATOR", catIdx: 0, brand: "Torrey", model: "TR-2000", serial: "TR2000-2023-001", location: "Cocina Principal", area: "Back of House", purchaseDate: new Date("2023-01-20"), purchasePrice: 4500000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_CONDESA, name: "Congelador Principal", code: "FRZ-CND-001", type: "FREEZER", catIdx: 1, brand: "Torrey", model: "CF-500", serial: "CF500-2023-001", location: "Almacén", area: "Back of House", purchaseDate: new Date("2023-01-20"), purchasePrice: 3200000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_CONDESA, name: "Estufa 6 Quemadores", code: "STV-CND-001", type: "STOVE", catIdx: 3, brand: "Mabe", model: "ER-6000", serial: "ER6000-2023-001", location: "Cocina Principal", area: "Back of House", purchaseDate: new Date("2023-02-15"), purchasePrice: 2800000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_CONDESA, name: "Máquina de Café Expreso", code: "COF-CND-001", type: "COFFEE_MACHINE", catIdx: 7, brand: "La Marzocco", model: "Linea PB", serial: "LMPB-2023-001", location: "Barra Café", area: "Front of House", purchaseDate: new Date("2023-03-01"), purchasePrice: 8500000, vendor: "Café Importaciones", isCritical: false },
  { branchId: BRANCH_CONDESA, name: "Freidora Industrial", code: "FRY-CND-001", type: "FRYER", catIdx: 5, brand: "Pitco", model: "Frialator 35", serial: "PITCO-2023-001", location: "Cocina Caliente", area: "Back of House", purchaseDate: new Date("2023-02-15"), purchasePrice: 3800000, vendor: "Equipamiento Restaurantero", isCritical: false },
  { branchId: BRANCH_CONDESA, name: "Campana Extractora", code: "EXH-CND-001", type: "EXHAUST_HOOD", catIdx: 10, brand: "S&T", model: "CF-2000", serial: "CF2000-2023-001", location: "Cocina Principal", area: "Back of House", purchaseDate: new Date("2023-01-20"), purchasePrice: 2200000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_CONDESA, name: "Lavavajillas Industrial", code: "DSW-CND-001", type: "DISHWASHER", catIdx: 6, brand: "Hobart", model: "AM-14", serial: "HOBART-2023-001", location: "Área de Lavado", area: "Back of House", purchaseDate: new Date("2023-04-01"), purchasePrice: 5500000, vendor: "Equipamiento Restaurantero", isCritical: false },
  { branchId: BRANCH_CONDESA, name: "Sistema POS", code: "POS-CND-001", type: "POS_SYSTEM", catIdx: 11, brand: "Zebra", model: "TC22", serial: "ZEBRA-CND-001", location: "Caja Principal", area: "Front of House", purchaseDate: new Date("2023-01-20"), purchasePrice: 850000, vendor: "TecnoSistemas", isCritical: true },
  { branchId: BRANCH_POLANCO, name: "Refrigerador Cocina", code: "REF-POL-001", type: "REFRIGERATOR", catIdx: 0, brand: "Torrey", model: "TR-2000", serial: "TR2000-2023-002", location: "Cocina", area: "Back of House", purchaseDate: new Date("2023-05-10"), purchasePrice: 4500000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_POLANCO, name: "Congelador", code: "FRZ-POL-001", type: "FREEZER", catIdx: 1, brand: "Torrey", model: "CF-500", serial: "CF500-2023-002", location: "Almacén", area: "Back of House", purchaseDate: new Date("2023-05-10"), purchasePrice: 3200000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_POLANCO, name: "Horno Convector", code: "OVN-POL-001", type: "OVEN", catIdx: 2, brand: "Rational", model: "SCC 61G", serial: "RAT-2023-001", location: "Cocina Caliente", area: "Back of House", purchaseDate: new Date("2023-06-01"), purchasePrice: 12000000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_POLANCO, name: "Parrilla Eléctrica", code: "GRL-POL-001", type: "GRILL", catIdx: 4, brand: "Garland", model: "G-36", serial: "GARLAND-2023-001", location: "Cocina Caliente", area: "Back of House", purchaseDate: new Date("2023-06-01"), purchasePrice: 4200000, vendor: "Equipamiento Restaurantero", isCritical: false },
  { branchId: BRANCH_POLANCO, name: "Máquina de Café Expreso", code: "COF-POL-001", type: "COFFEE_MACHINE", catIdx: 7, brand: "La Marzocco", model: "Linea PB", serial: "LMPB-2023-002", location: "Barra", area: "Front of House", purchaseDate: new Date("2023-06-15"), purchasePrice: 8500000, vendor: "Café importaciones", isCritical: false },
  { branchId: BRANCH_POLANCO, name: "Campana Extractora", code: "EXH-POL-001", type: "EXHAUST_HOOD", catIdx: 10, brand: "S&T", model: "CF-2000", serial: "CF2000-2023-002", location: "Cocina", area: "Back of House", purchaseDate: new Date("2023-05-10"), purchasePrice: 2200000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_POLANCO, name: "Sistema POS", code: "POS-POL-001", type: "POS_SYSTEM", catIdx: 11, brand: "Zebra", model: "TC22", serial: "ZEBRA-POL-001", location: "Caja", area: "Front of House", purchaseDate: new Date("2023-05-10"), purchasePrice: 850000, vendor: "TecnoSistemas", isCritical: true },
  { branchId: BRANCH_ROMA, name: "Refrigerador Cocina", code: "REF-ROM-001", type: "REFRIGERATOR", catIdx: 0, brand: "Torrey", model: "TR-2000", serial: "TR2000-2024-001", location: "Cocina", area: "Back of House", purchaseDate: new Date("2024-01-15"), purchasePrice: 4500000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_ROMA, name: "Congelador", code: "FRZ-ROM-001", type: "FREEZER", catIdx: 1, brand: "Torrey", model: "CF-500", serial: "CF500-2024-001", location: "Almacén", area: "Back of House", purchaseDate: new Date("2024-01-15"), purchasePrice: 3200000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_ROMA, name: "Estufa 4 Quemadores", code: "STV-ROM-001", type: "STOVE", catIdx: 3, brand: "Mabe", model: "ER-4000", serial: "ER4000-2024-001", location: "Cocina", area: "Back of House", purchaseDate: new Date("2024-01-15"), purchasePrice: 1800000, vendor: "Equipamiento Restaurantero", isCritical: true },
  { branchId: BRANCH_ROMA, name: "Licuadora Industrial", code: "BLD-ROM-001", type: "BLENDER", catIdx: 8, brand: "Vitamix", model: "T&G 2L", serial: "VITAMIX-2024-001", location: "Barra Bebidas", area: "Front of House", purchaseDate: new Date("2024-02-01"), purchasePrice: 650000, vendor: "Equipamiento Restaurantero", isCritical: false },
  { branchId: BRANCH_ROMA, name: "Batidora Industrial", code: "MIX-ROM-001", type: "MIXER", catIdx: 9, brand: "KitchenAid", model: "Pro 600", serial: "KA-2024-001", location: "Cocina Pastelería", area: "Back of House", purchaseDate: new Date("2024-02-01"), purchasePrice: 850000, vendor: "Equipamiento Restaurantero", isCritical: false },
  { branchId: BRANCH_ROMA, name: "Sistema POS", code: "POS-ROM-001", type: "POS_SYSTEM", catIdx: 11, brand: "Zebra", model: "TC22", serial: "ZEBRA-ROM-001", location: "Caja", area: "Front of House", purchaseDate: new Date("2024-01-15"), purchasePrice: 850000, vendor: "TecnoSistemas", isCritical: true },
  { branchId: BRANCH_ROMA, name: "Freidora Industrial", code: "FRY-ROM-001", type: "FRYER", catIdx: 5, brand: "Pitco", model: "Frialator 35", serial: "PITCO-2024-001", location: "Cocina Caliente", area: "Back of House", purchaseDate: new Date("2024-03-01"), purchasePrice: 3800000, vendor: "Equipamiento Restaurantero", isCritical: false },
];

const MAINTENANCE_SCHEDULES = [
  { catTypeIdx: 0, branchId: BRANCH_CONDESA, maintType: "PREVENTIVE" as const, freq: "MONTHLY" as const, tasks: ["Limpiar condensadores", "Revisar empaques", "Verificar temperatura", "Inspeccionar drenaje"], estDuration: 60, preferredDay: 1, preferredTime: "08:00" },
  { catTypeIdx: 0, branchId: BRANCH_CONDESA, maintType: "CLEANING" as const, freq: "WEEKLY" as const, tasks: ["Limpieza interior", "Limpieza exterior", "Revisar sello puerta"], estDuration: 30, preferredDay: 0, preferredTime: "06:00" },
  { catTypeIdx: 1, branchId: BRANCH_CONDESA, maintType: "PREVENTIVE" as const, freq: "MONTHLY" as const, tasks: ["Descongelar", "Limpiar condensadores", "Revisar sello"], estDuration: 90, preferredDay: 2, preferredTime: "08:00" },
  { catTypeIdx: 3, branchId: BRANCH_CONDESA, maintType: "PREVENTIVE" as const, freq: "QUARTERLY" as const, tasks: ["Limpiar quemadores", "Revisar válvulas de gas", "Verificar pilotos", "Calibrar flujo"], estDuration: 120, preferredDay: 3, preferredTime: "09:00" },
  { catTypeIdx: 7, branchId: BRANCH_CONDESA, maintType: "PREVENTIVE" as const, freq: "WEEKLY" as const, tasks: ["Descalcificar", "Limpiar grupo", "Revisar presión", "Cambiar filtros"], estDuration: 45, preferredDay: 5, preferredTime: "07:00" },
  { catTypeIdx: 11, branchId: BRANCH_CONDESA, maintType: "PREVENTIVE" as const, freq: "QUARTERLY" as const, tasks: ["Actualizar software", "Verificar impresora", "Respaldar datos", "Limpiar lector"], estDuration: 60, preferredDay: 6, preferredTime: "06:00" },
];

const MAINTENANCE_HISTORY_DATA = [
  { equipIdx: 0, maintType: "PREVENTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-06-01"), completedDate: new Date("2025-06-01"), desc: "Mantenimiento preventivo mensual", work: "Se limpiaron condensadores, se revisaron empaques, temperatura OK", totalCost: 0, providerType: "INTERNAL" as const },
  { equipIdx: 0, maintType: "PREVENTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-05-01"), completedDate: new Date("2025-05-01"), desc: "Mantenimiento preventivo mensual", work: "Limpieza general, revisión de componentes", totalCost: 0, providerType: "INTERNAL" as const },
  { equipIdx: 0, maintType: "CORRECTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-03-15"), completedDate: new Date("2025-03-15"), desc: "Fuga de agua en refrigerador", work: "Se reemplazó manguera de drenaje y empaque de puerta", totalCost: 250000, providerType: "INTERNAL" as const },
  { equipIdx: 1, maintType: "PREVENTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-06-10"), completedDate: new Date("2025-06-10"), desc: "Mantenimiento preventivo mensual", work: "Descongelamiento, limpieza de condensadores", totalCost: 0, providerType: "INTERNAL" as const },
  { equipIdx: 3, maintType: "PREVENTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-04-01"), completedDate: new Date("2025-04-01"), desc: "Mantenimiento trimestral estufa", work: "Limpieza de quemadores, revisión de válvulas de gas", totalCost: 350000, providerType: "INTERNAL" as const },
  { equipIdx: 7, maintType: "PREVENTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-06-12"), completedDate: new Date("2025-06-12"), desc: "Descalcificación y limpieza", work: "Se descalcificó máquina, limpieza de grupo, presión OK", totalCost: 0, providerType: "INTERNAL" as const },
  { equipIdx: 7, maintType: "CORRECTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-02-20"), completedDate: new Date("2025-02-20"), desc: "Reparación bomba de agua", work: "Se reemplazó bomba de agua y sello", totalCost: 450000, providerType: "EXTERNAL" as const, providerName: "Café importaciones" },
  { equipIdx: 11, maintType: "PREVENTIVE" as const, status: "COMPLETED" as const, scheduledDate: new Date("2025-05-15"), completedDate: new Date("2025-05-15"), desc: "Actualización trimestral POS", work: "Actualización de software, respaldo de ventas", totalCost: 0, providerType: "INTERNAL" as const },
];

const COMPLIANCE_SERVICES = [
  { branchId: BRANCH_CONDESA, serviceType: "FUMIGATION" as const, name: "Fumigación Mensual", freq: "MONTHLY" as const, regRef: "NOM-251-SSA1-2009", areas: ["Cocina Principal", "Almacén", "Comedor", "Baños"], nextService: new Date("2026-07-15"), lastService: new Date("2026-06-15") },
  { branchId: BRANCH_CONDESA, serviceType: "FIRE_SYSTEM_CHECK" as const, name: "Revisión Sistema Contra Incendios", freq: "QUARTERLY" as const, regRef: "NOM-002-STPS-2010", areas: ["Todas las áreas"], nextService: new Date("2026-08-01"), lastService: new Date("2026-05-01") },
  { branchId: BRANCH_CONDESA, serviceType: "HYGIENE_AUDIT" as const, name: "Auditoría de Higiene", freq: "MONTHLY" as const, regRef: "NOM-251-SSA1-2009", areas: ["Cocina", "Almacén", "Barra", "Comedor"], nextService: new Date("2026-07-01"), lastService: new Date("2026-06-01") },
  { branchId: BRANCH_POLANCO, serviceType: "FUMIGATION" as const, name: "Fumigación Mensual", freq: "MONTHLY" as const, regRef: "NOM-251-SSA1-2009", areas: ["Cocina", "Almacén", "Comedor", "Baños"], nextService: new Date("2026-07-20"), lastService: new Date("2026-06-20") },
  { branchId: BRANCH_POLANCO, serviceType: "FIRE_SYSTEM_CHECK" as const, name: "Revisión Sistema Contra Incendios", freq: "QUARTERLY" as const, regRef: "NOM-002-STPS-2010", areas: ["Todas las áreas"], nextService: new Date("2026-09-01"), lastService: new Date("2026-06-01") },
  { branchId: BRANCH_POLANCO, serviceType: "ELECTRICAL_INSPECTION" as const, name: "Inspección Eléctrica", freq: "SEMIANNUAL" as const, regRef: "NOM-001-SEDE-2020", areas: ["Tableros", "Cocina", "Barra"], nextService: new Date("2026-10-01"), lastService: new Date("2026-04-01") },
  { branchId: BRANCH_ROMA, serviceType: "FUMIGATION" as const, name: "Fumigación Mensual", freq: "MONTHLY" as const, regRef: "NOM-251-SSA1-2009", areas: ["Cocina", "Almacén", "Comedor", "Baños"], nextService: new Date("2026-07-25"), lastService: new Date("2026-06-25") },
  { branchId: BRANCH_ROMA, serviceType: "GAS_INSPECTION" as const, name: "Inspección de Gas", freq: "SEMIANNUAL" as const, regRef: "NOM-009-STPS-2010", areas: ["Cocina"], nextService: new Date("2026-11-01"), lastService: new Date("2026-05-01") },
];

const EQUIPMENT_ALERTS_DATA = [
  { branchId: BRANCH_CONDESA, equipIdx: 0, alertType: "MAINTENANCE_DUE", severity: "MEDIUM", title: "Mantenimiento preventivo próximo", description: "El refrigerador de Cocina Principal requiere mantenimiento mensual en los próximos 7 días", dueDate: new Date("2026-08-01") },
  { branchId: BRANCH_CONDESA, equipIdx: undefined, alertType: "SERVICE_DUE", severity: "HIGH", title: "Fumigación programada para mañana", description: "La fumigación mensual en Condesa está programada para mañana. Coordinar con el proveedor.", dueDate: new Date("2026-07-16") },
  { branchId: BRANCH_ROMA, equipIdx: 21, alertType: "MAINTENANCE_DUE", severity: "LOW", title: "Mantenimiento de freidora", description: "La freidora Roma requiere cambio de aceite", dueDate: new Date("2026-07-30") },
];

export async function main() {
  console.log("=== Phase 3: Equipment ===");
  console.log("Cleaning up...");

  await db.delete(equipmentAlerts).where(eq(equipmentAlerts.companyId, COMPANY_ID));
  await db.delete(equipmentMaintenanceHistory).where(eq(equipmentMaintenanceHistory.companyId, COMPANY_ID));
  await db.delete(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.companyId, COMPANY_ID));
  await db.delete(equipmentWarranties).where(eq(equipmentWarranties.companyId, COMPANY_ID));
  await db.delete(branchEquipments).where(eq(branchEquipments.companyId, COMPANY_ID));
  await db.delete(equipmentCatalog).where(eq(equipmentCatalog.companyId, COMPANY_ID));
  await db.delete(complianceServiceHistory).where(eq(complianceServiceHistory.companyId, COMPANY_ID));
  await db.delete(branchComplianceServices).where(eq(branchComplianceServices.companyId, COMPANY_ID));

  console.log(`Inserting ${CATALOG_ITEMS.length} equipment catalog items...`);
  const catalogValues = CATALOG_ITEMS.map(item => ({
    companyId: COMPANY_ID,
    name: item.name,
    type: item.type,
    brand: item.brand,
    model: item.model,
    specifications: item.specs as Record<string, unknown>,
    defaultMaintenanceFrequency: item.defaultMaintFreq,
    defaultMaintenanceTasks: item.defaultMaintTasks as unknown as Record<string, unknown>,
    isActive: true,
    createdBy: USER_ADMIN,
  }));
  const catalogRows = await db.insert(equipmentCatalog).values(catalogValues).returning({ id: equipmentCatalog.id });
  const catalogIds = catalogRows.map(r => r.id);

  console.log(`Inserting ${BRANCH_EQUIPMENT_INSTANCES.length} branch equipment instances...`);
  const branchEquipmentValues = BRANCH_EQUIPMENT_INSTANCES.map(eqp => ({
    companyId: COMPANY_ID,
    branchId: eqp.branchId,
    catalogId: catalogIds[eqp.catIdx],
    name: eqp.name,
    equipmentCode: eqp.code,
    type: eqp.type,
    brand: eqp.brand,
    model: eqp.model,
    serialNumber: eqp.serial,
    location: eqp.location,
    area: eqp.area,
    purchaseDate: eqp.purchaseDate,
    purchasePrice: eqp.purchasePrice,
    vendor: eqp.vendor,
    status: "ACTIVE" as const,
    isCritical: eqp.isCritical,
    createdBy: USER_ADMIN,
  }));
  const allBE = await db.insert(branchEquipments).values(branchEquipmentValues).returning({ id: branchEquipments.id });

  console.log("Inserting warranties...");
  if (allBE.length >= 4) {
    await db.insert(equipmentWarranties).values([
      { equipmentId: allBE[0].id, companyId: COMPANY_ID, warrantyNumber: "WAR-TOR-001", warrantyType: "MANUFACTURER", provider: "Torrey", startDate: new Date("2023-01-20"), endDate: new Date("2026-01-20"), coverageDescription: "Cobertura total de partes y mano de obra", status: "ACTIVE" as const, claimsMade: 1, maxClaims: 3, alertDaysBefore: 30, createdBy: USER_ADMIN },
      { equipmentId: allBE[3].id, companyId: COMPANY_ID, warrantyNumber: "WAR-LMZ-001", warrantyType: "MANUFACTURER", provider: "La Marzocco", startDate: new Date("2023-03-01"), endDate: new Date("2028-03-01"), coverageDescription: "Cobertura de partes mecánicas y eléctricas", status: "ACTIVE" as const, claimsMade: 1, maxClaims: 5, alertDaysBefore: 30, createdBy: USER_ADMIN },
      { equipmentId: allBE[8].id, companyId: COMPANY_ID, warrantyNumber: "WAR-TOR-002", warrantyType: "MANUFACTURER", provider: "Torrey", startDate: new Date("2023-05-10"), endDate: new Date("2026-05-10"), coverageDescription: "Cobertura total de partes y mano de obra", status: "ACTIVE" as const, claimsMade: 0, maxClaims: 3, alertDaysBefore: 30, createdBy: USER_ADMIN },
      { equipmentId: allBE[15].id, companyId: COMPANY_ID, warrantyNumber: "WAR-TOR-003", warrantyType: "MANUFACTURER", provider: "Torrey", startDate: new Date("2024-01-15"), endDate: new Date("2027-01-15"), coverageDescription: "Cobertura total de partes y mano de obra", status: "ACTIVE" as const, claimsMade: 0, maxClaims: 3, alertDaysBefore: 30, createdBy: USER_ADMIN },
    ]);
  }

  console.log("Inserting maintenance schedules...");
  const scheduleValues: any[] = [];
  for (const ms of MAINTENANCE_SCHEDULES) {
    const target = BRANCH_EQUIPMENT_INSTANCES.find((e, idx) => e.catIdx === ms.catTypeIdx && e.branchId === ms.branchId);
    if (!target) continue;
    const targetIdx = BRANCH_EQUIPMENT_INSTANCES.indexOf(target);
    scheduleValues.push({
      equipmentId: allBE[targetIdx].id,
      companyId: COMPANY_ID,
      branchId: ms.branchId,
      maintenanceType: ms.maintType,
      frequency: ms.freq,
      tasks: ms.tasks as unknown as Record<string, unknown>,
      estimatedDurationMinutes: ms.estDuration,
      preferredDayOfWeek: ms.preferredDay,
      preferredTimeOfDay: ms.preferredTime,
      isActive: true,
      createdBy: USER_ADMIN,
    });
  }
  if (scheduleValues.length > 0) {
    await db.insert(equipmentMaintenanceSchedules).values(scheduleValues);
  }

  console.log("Inserting maintenance history...");
  const historyValues = MAINTENANCE_HISTORY_DATA.map(mh => ({
    equipmentId: allBE[mh.equipIdx].id,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    maintenanceType: mh.maintType,
    status: mh.status,
    scheduledDate: mh.scheduledDate,
    completedDate: mh.completedDate,
    description: mh.desc,
    workPerformed: mh.work,
    totalCost: mh.totalCost,
    providerType: mh.providerType,
    providerName: (mh as any).providerName,
    createdBy: USER_ADMIN,
  }));
  await db.insert(equipmentMaintenanceHistory).values(historyValues);

  console.log("Inserting branch compliance services...");
  const complianceValues = COMPLIANCE_SERVICES.map(cs => ({
    companyId: COMPANY_ID,
    branchId: cs.branchId,
    serviceType: cs.serviceType,
    serviceName: cs.name,
    frequency: cs.freq,
    regulationReference: cs.regRef,
    isMandatory: true,
    serviceAreas: cs.areas as unknown as Record<string, unknown>,
    nextServiceDate: cs.nextService,
    lastServiceDate: cs.lastService,
    isActive: true,
    createdBy: USER_ADMIN,
  }));
  await db.insert(branchComplianceServices).values(complianceValues);

  console.log("Inserting equipment alerts...");
  const alertValues = EQUIPMENT_ALERTS_DATA.map(a => ({
    companyId: COMPANY_ID,
    branchId: a.branchId,
    equipmentId: a.equipIdx !== undefined ? allBE[a.equipIdx]?.id : undefined,
    alertType: a.alertType,
    severity: a.severity,
    title: a.title,
    description: a.description,
    dueDate: a.dueDate,
    status: "ACTIVE",
  }));
  await db.insert(equipmentAlerts).values(alertValues);

  console.log("Phase 3 complete!");
}
