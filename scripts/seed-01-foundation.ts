import "dotenv/config";
import { db } from "@/lib/db";
import {
  companies, branches, holidays, users, serviceProviders,
  suppliers, storageLocations, tenantOperatingConfig, payees,
  supplierBankAccounts,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  COMPANY_ID,
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  BRANCH_ROMA,
  USER_SUPER_ADMIN,
  USER_ADMIN,
  USER_GERENTE,
  USER_SUPERVISOR,
  USER_EMPLEADO_1,
  USER_EMPLEADO_2,
  USER_EMPLEADO_3,
  USER_READONLY,
} from "./seed-constants";
import { validateClabe, computeClabeCheckDigit } from "@/lib/banking/clabe";
import { DekService } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { createHmac } from "node:crypto";

function fingerprintClabe(clabe: string, dek: Buffer): string {
  return createHmac("sha256", dek).update(clabe).digest("hex");
}

function makeValidClabe(bankPrefix: string, accountSeed: string): string {
  const first17 = `${bankPrefix}${accountSeed}`.padEnd(17, "0").slice(0, 17);
  const cd = computeClabeCheckDigit(first17);
  return `${first17}${cd}`;
}

const USERS = [
  {
    id: USER_SUPER_ADMIN,
    name: "Carlos Méndez",
    email: "carlos@pulso.mx",
    emailVerified: true,
    role: "SUPER_ADMIN" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    phone: "+52 55 1111 0001",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_ADMIN,
    name: "María García",
    email: "maria@pulso.mx",
    emailVerified: true,
    role: "ADMIN" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    phone: "+52 55 1111 0002",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_GERENTE,
    name: "Juan López",
    email: "juan@pulso.mx",
    emailVerified: true,
    role: "GERENTE" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    phone: "+52 55 1111 0003",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_SUPERVISOR,
    name: "Ana Martínez",
    email: "ana@pulso.mx",
    emailVerified: true,
    role: "SUPERVISOR" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_POLANCO,
    phone: "+52 55 1111 0004",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_EMPLEADO_1,
    name: "Pedro Sánchez",
    email: "pedro@pulso.mx",
    emailVerified: true,
    role: "EMPLEADO" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    phone: "+52 55 1111 0005",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_EMPLEADO_2,
    name: "Luisa Fernández",
    email: "luisa@pulso.mx",
    emailVerified: true,
    role: "EMPLEADO" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_POLANCO,
    phone: "+52 55 1111 0006",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_EMPLEADO_3,
    name: "Roberto Gutiérrez",
    email: "roberto@pulso.mx",
    emailVerified: true,
    role: "EMPLEADO" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_ROMA,
    phone: "+52 55 1111 0007",
    active: true,
    status: "ACTIVE",
  },
  {
    id: USER_READONLY,
    name: "Diana Torres",
    email: "diana@pulso.mx",
    emailVerified: true,
    role: "READONLY" as const,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    phone: "+52 55 1111 0008",
    active: true,
    status: "ACTIVE",
  },
];

const BRANCHES = [
  {
    id: BRANCH_CONDESA,
    companyId: COMPANY_ID,
    name: "Condesa",
    address: "Av. Ámsterdam 123, Col. Condesa, 06100 CDMX",
    timezone: "America/Mexico_City",
    operatingHours: {
      monday: { open: "08:00", close: "23:00" },
      tuesday: { open: "08:00", close: "23:00" },
      wednesday: { open: "08:00", close: "23:00" },
      thursday: { open: "08:00", close: "23:00" },
      friday: { open: "08:00", close: "01:00" },
      saturday: { open: "09:00", close: "01:00" },
      sunday: { open: "09:00", close: "22:00" },
    },
    location: { lat: 19.4118, lng: -99.1756 },
    managerId: USER_GERENTE,
  },
  {
    id: BRANCH_POLANCO,
    companyId: COMPANY_ID,
    name: "Polanco",
    address: "Av. Presidente Masaryk 456, Col. Polanco, 11550 CDMX",
    timezone: "America/Mexico_City",
    operatingHours: {
      monday: { open: "07:00", close: "22:00" },
      tuesday: { open: "07:00", close: "22:00" },
      wednesday: { open: "07:00", close: "22:00" },
      thursday: { open: "07:00", close: "22:00" },
      friday: { open: "07:00", close: "00:00" },
      saturday: { open: "08:00", close: "00:00" },
      sunday: { open: "08:00", close: "21:00" },
    },
    location: { lat: 19.4326, lng: -99.1912 },
    managerId: USER_SUPERVISOR,
  },
  {
    id: BRANCH_ROMA,
    companyId: COMPANY_ID,
    name: "Roma",
    address: "Av. Álvaro Obregón 789, Col. Roma, 06700 CDMX",
    timezone: "America/Mexico_City",
    operatingHours: {
      monday: { open: "09:00", close: "23:00" },
      tuesday: { open: "09:00", close: "23:00" },
      wednesday: { open: "09:00", close: "23:00" },
      thursday: { open: "09:00", close: "23:00" },
      friday: { open: "09:00", close: "02:00" },
      saturday: { open: "10:00", close: "02:00" },
      sunday: { open: "10:00", close: "22:00" },
    },
    location: { lat: 19.4178, lng: -99.1642 },
    managerId: USER_SUPER_ADMIN,
  },
];

const HOLIDAYS_MX_2026 = [
  { name: "Año Nuevo", date: "2026-01-01", description: "Día de Año Nuevo" },
  { name: "Día de la Constitución", date: "2026-02-02", description: "Conmemoración de la Constitución Mexicana (1er lunes de febrero)" },
  { name: "Día de la Bandera", date: "2026-02-24", description: "Día de la Bandera de México" },
  { name: "Natalicio de Benito Juárez", date: "2026-03-16", description: "Natalicio de Benito Juárez (3er lunes de marzo)" },
  { name: "Jueves Santo", date: "2026-04-02", description: "Jueves Santo" },
  { name: "Viernes Santo", date: "2026-04-03", description: "Viernes Santo" },
  { name: "Día del Trabajo", date: "2026-05-01", description: "Día Internacional del Trabajo" },
  { name: "Día de la Independencia", date: "2026-09-16", description: "Día de la Independencia de México" },
  { name: "Día de la Revolución", date: "2026-11-16", description: "Conmemoración de la Revolución Mexicana (3er lunes de noviembre)" },
  { name: "Día de la Virgen de Guadalupe", date: "2026-12-12", description: "Día de la Virgen de Guadalupe" },
  { name: "Navidad", date: "2026-12-25", description: "Navidad" },
];

const STORAGE_LOCATIONS = [
  { branchId: BRANCH_CONDESA, name: "Almacén Principal", type: "DRY_STORAGE" as const },
  { branchId: BRANCH_CONDESA, name: "Refrigerador 1", type: "REFRIGERATOR" as const },
  { branchId: BRANCH_CONDESA, name: "Congelador", type: "FREEZER" as const },
  { branchId: BRANCH_CONDESA, name: "Barra de Bebidas", type: "BAR" as const },
  { branchId: BRANCH_POLANCO, name: "Almacén Principal", type: "DRY_STORAGE" as const },
  { branchId: BRANCH_POLANCO, name: "Refrigerador Principal", type: "REFRIGERATOR" as const },
  { branchId: BRANCH_POLANCO, name: "Cava de Vinos", type: "REFRIGERATOR" as const },
  { branchId: BRANCH_POLANCO, name: "Congelador", type: "FREEZER" as const },
  { branchId: BRANCH_ROMA, name: "Almacén Seco", type: "DRY_STORAGE" as const },
  { branchId: BRANCH_ROMA, name: "Refrigerador Cocina", type: "REFRIGERATOR" as const },
  { branchId: BRANCH_ROMA, name: "Bar", type: "BAR" as const },
];

const SUPPLIERS = [
  {
    name: "Distribuidora de Alimentos del Valle",
    contactName: "Roberto Díaz",
    email: "roberto.diaz@valle.mx",
    phone: "+52 55 2222 0001",
    address: "Av. Central 1000, Col. Industrial, 07800 CDMX",
    taxId: "DAV-850101-ABC",
  },
  {
    name: "Carnes Selectas del Norte",
    contactName: "Fernanda Ríos",
    email: "fernanda@carnesnorte.mx",
    phone: "+52 81 3333 0002",
    address: "Blvd. Ganadero 500, Monterrey, NL",
    taxId: "CSN-920202-DEF",
  },
  {
    name: "Licores y Vinos Finos SA",
    contactName: "Alejandro Paz",
    email: "apaz@licoresfinos.mx",
    phone: "+52 55 4444 0003",
    address: "Calle de la Cava 50, Col. Del Valle, 03100 CDMX",
    taxId: "LVF-780303-GHI",
  },
  {
    name: "Productos Lácteos Santa Clara",
    contactName: "Laura Mendoza",
    email: "laura@santaclara.mx",
    phone: "+52 55 5555 0004",
    address: "Carretera a Toluca 2000, Lerma, EdoMex",
    taxId: "LSC-650404-JKL",
  },
  {
    name: "Frutas y Verduras La Huerta",
    contactName: "José López",
    email: "jose@huerta.mx",
    phone: "+52 55 6666 0005",
    address: "Central de Abastos, Nave D-12, Iztapalapa, 09000 CDMX",
    taxId: "FVL-880505-MNO",
  },
  {
    name: "Equipamiento Restaurantero",
    contactName: "Patricia Soto",
    email: "patricia@equiporest.mx",
    phone: "+52 55 7777 0006",
    address: "Av. Industrias 1500, Ecatepec, EdoMex",
    taxId: "ERX-910606-PQR",
  },
];

const SERVICE_PROVIDERS = [
  {
    name: "Fumigaciones Profesionales MX",
    businessName: "Fumigaciones Profesionales de México S.A. de C.V.",
    taxId: "FPM-890707-STU",
    providerType: "CERTIFIED" as const,
    services: ["FUMIGATION" as const, "PEST_CONTROL" as const],
    specializations: ["Cucarachas", "Roedores", "Hormigas", "Moscas"],
    contactName: "Carlos Fumigador",
    phone: "+52 55 8888 0001",
    email: "carlos@fumiprof.mx",
    address: "Calle Higiene 300, Col. Seguridad, 07400 CDMX",
    isCertified: true,
    rating: 5,
  },
  {
    name: "Seguridad contra Incendios",
    businessName: "Safety Fire Systems S.A.",
    taxId: "SFS-950808-VWX",
    providerType: "CERTIFIED" as const,
    services: ["FIRE_SYSTEM_CHECK" as const, "SAFETY_INSPECTION" as const],
    specializations: ["Sistemas de rociadores", "Extintores", "Detección de humo", "Rutas de evacuación"],
    contactName: "Miguel Segura",
    phone: "+52 55 8888 0002",
    email: "miguel@safetyfire.mx",
    address: "Blvd. Prevención 200, Col. Segura, 06600 CDMX",
    isCertified: true,
    rating: 4,
  },
  {
    name: "Servicios Eléctricos y Gas",
    businessName: "ElectroGas Técnicos Asociados",
    taxId: "EGA-910909-YZA",
    providerType: "EXTERNAL" as const,
    services: ["ELECTRICAL_INSPECTION" as const, "GAS_INSPECTION" as const],
    specializations: ["Instalaciones eléctricas", "Gas LP", "Gas natural", "Sistemas de ventilación"],
    contactName: "Luisa Watts",
    phone: "+52 55 8888 0003",
    email: "luisa@electrogas.mx",
    address: "Calle Corriente 150, Col. Voltaje, 06800 CDMX",
    isCertified: true,
    rating: 4,
  },
];

export async function main() {
  console.log("=== Phase 1: Foundation ===");
  console.log("Cleaning up existing data for company...");

  await db.execute(sql`DELETE FROM "data_access_logs"`).catch(() => {});
  await db.delete(supplierBankAccounts).where(eq(supplierBankAccounts.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(suppliers).where(eq(suppliers.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(serviceProviders).where(eq(serviceProviders.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(payees).where(eq(payees.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(tenantOperatingConfig).where(eq(tenantOperatingConfig.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(holidays).where(eq(holidays.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(branches).where(eq(branches.companyId, COMPANY_ID)).catch(() => {});
  try {
    await db.execute(sql`DELETE FROM "sessions"`);
    await db.execute(sql`DELETE FROM "session"`);
  } catch (e) {}
  await db.delete(users).where(eq(users.companyId, COMPANY_ID)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, COMPANY_ID)).catch(() => {});

  console.log("Inserting company...");
  await db.insert(companies).values({
    id: COMPANY_ID,
    name: "Pulso HORECA Demo",
    taxId: "PUL-101010-ABC",
    plan: "ENTERPRISE",
    billingStatus: "ACTIVE",
  });

  console.log("Inserting tenant operating configuration...");
  await db.insert(tenantOperatingConfig).values({
    companyId: COMPANY_ID,
    purchasingStructure: "CENTRALIZADA",
    foodProduction: "IN_SITU",
    treasuryModel: "CUENTA_UNICA",
    supplierPayment: "CENTRALIZADO",
    managerAutonomy: "MEDIA",
    payrollDispersion: "CONSOLIDADA",
    tenantType: "GRUPO_PROPIO",
    managerAuthLimitCents: 500000,          // $5,000 MXN
    doubleApprovalThresholdCents: 5000000,  // $50,000 MXN
    pettyCashLimitCents: 300000,           // $3,000 MXN
    emergencyPurchaseCapCents: 3000000,     // $30,000 MXN por sucursal
    foodCostTargetPercent: "28.00",
    foodCostWarnPercent: "33.00",
    laborCostTargetPercent: "18.00",
    laborCostWarnPercent: "22.00",
    healthyMarginTargetPercent: "50.00",
    healthyMarginWarnPercent: "40.00",
    mermaVarianceThresholdPct: "5.00",
  });

  console.log("Inserting users...");
  const userValues = USERS.map(u => ({
    ...u,
    emailVerified: u.emailVerified ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.insert(users).values(userValues);

  console.log("Inserting branches...");
  const branchValues = BRANCHES.map(b => ({
    ...b,
    operatingHours: b.operatingHours as Record<string, unknown>,
    location: b.location as Record<string, unknown>,
    active: true,
    createdAt: new Date(),
  }));
  await db.insert(branches).values(branchValues);

  console.log(`Inserting ${HOLIDAYS_MX_2026.length} holidays...`);
  const holidayValues = HOLIDAYS_MX_2026.map(h => ({
    companyId: COMPANY_ID,
    name: h.name,
    date: h.date,
    description: h.description,
  }));
  await db.insert(holidays).values(holidayValues);

  console.log(`Inserting ${STORAGE_LOCATIONS.length} storage locations...`);
  const storageValues = STORAGE_LOCATIONS.map(sl => ({
    companyId: COMPANY_ID,
    branchId: sl.branchId,
    name: sl.name,
    type: sl.type,
    active: true,
  }));
  await db.insert(storageLocations).values(storageValues);

  console.log("Inserting payees (contrapartes universales)...");
  const PAYEE_DEFS = [
    // Proveedores de Insumos
    { name: "Distribuidora de Alimentos del Valle", taxId: "DAV-850101-ABC", contactName: "Roberto Díaz", email: "roberto.diaz@valle.mx", phone: "+52 55 2222 0001" },
    { name: "Carnes Selectas del Norte", taxId: "CSN-920202-DEF", contactName: "Fernanda Ríos", email: "fernanda@carnesnorte.mx", phone: "+52 81 3333 0002" },
    { name: "Licores y Vinos Finos SA", taxId: "LVF-780303-GHI", contactName: "Alejandro Paz", email: "apaz@licoresfinos.mx", phone: "+52 55 4444 0003" },
    { name: "Productos Lácteos Santa Clara", taxId: "LSC-650404-JKL", contactName: "Laura Mendoza", email: "laura@santaclara.mx", phone: "+52 55 5555 0004" },
    { name: "Frutas y Verduras La Huerta", taxId: "FVL-880505-MNO", contactName: "José López", email: "jose@huerta.mx", phone: "+52 55 6666 0005" },
    { name: "Equipamiento Restaurantero", taxId: "ERX-910606-PQR", contactName: "Patricia Soto", email: "patricia@equiporest.mx", phone: "+52 55 7777 0006" },
    // Proveedores de Servicios
    { name: "Fumigaciones Profesionales MX", taxId: "FPM-890707-STU", contactName: "Carlos Fumigador", email: "carlos@fumiprof.mx", phone: "+52 55 8888 0001" },
    { name: "Seguridad contra Incendios", taxId: "SFS-950808-VWX", contactName: "Miguel Segura", email: "miguel@safetyfire.mx", phone: "+52 55 8888 0002" },
    { name: "Servicios Eléctricos y Gas", taxId: "EGA-910909-YZA", contactName: "Luisa Watts", email: "luisa@electrogas.mx", phone: "+52 55 8888 0003" },
    // Gastos Operativos y Servicios Generales
    { name: "Comisión Federal de Electricidad", taxId: "CFE-370814-QI0", contactName: "Atención Clientes CFE", email: "servicio@cfe.mx", phone: "+52 55 0710 0000" },
    { name: "Gas Natural México S.A. de C.V.", taxId: "GNM-970601-ABC", contactName: "Ventas Corporativas", email: "contacto@gasnatural.mx", phone: "+52 55 5279 2000" },
    { name: "Inmobiliaria y Arrendadora Roma S.A.", taxId: "IAR-120505-XYZ", contactName: "Lic. Manuel Arrendador", email: "rentas@inmobiliaroma.mx", phone: "+52 55 5584 1000" },
    { name: "Totalplay Telecomunicaciones", taxId: "TTE-101010-PQR", contactName: "Soporte Empresas", email: "empresas@totalplay.mx", phone: "+52 55 1579 8000" },
  ];

  const insertedPayees = await db.insert(payees).values(
    PAYEE_DEFS.map(p => ({
      companyId: COMPANY_ID,
      name: p.name,
      taxId: p.taxId,
      contactName: p.contactName,
      email: p.email,
      phone: p.phone,
      active: true,
    }))
  ).returning({ id: payees.id, name: payees.name });

  const payeeMap = new Map(insertedPayees.map(p => [p.name, p.id]));

  console.log(`Inserting ${SUPPLIERS.length} suppliers...`);
  const supplierValues = SUPPLIERS.map(s => ({
    companyId: COMPANY_ID,
    name: s.name,
    contactName: s.contactName,
    email: s.email,
    phone: s.phone,
    address: s.address,
    taxId: s.taxId,
    payeeId: payeeMap.get(s.name) || null,
    active: true,
  }));
  const insertedSuppliers = await db.insert(suppliers).values(supplierValues).returning({ id: suppliers.id, name: suppliers.name });

  console.log(`Inserting ${SERVICE_PROVIDERS.length} service providers...`);
  const providerValues = SERVICE_PROVIDERS.map(sp => ({
    companyId: COMPANY_ID,
    name: sp.name,
    businessName: sp.businessName,
    taxId: sp.taxId,
    providerType: sp.providerType,
    services: sp.services as unknown as Record<string, unknown>,
    specializations: sp.specializations as unknown as Record<string, unknown>,
    contactName: sp.contactName,
    phone: sp.phone,
    email: sp.email,
    address: sp.address,
    isCertified: sp.isCertified,
    rating: sp.rating,
    createdBy: USER_SUPER_ADMIN,
  }));
  await db.insert(serviceProviders).values(providerValues);

  console.log("Inserting verified bank accounts (CLABEs) for suppliers...");
  await DekService.ensureDek(COMPANY_ID);
  const dek = await DekService.getDek(COMPANY_ID);
  const BANK_SEEDS = [
    { prefix: "012180", seed: "0123456789" }, // BBVA
    { prefix: "072180", seed: "0987654321" }, // Banorte
    { prefix: "014180", seed: "0555666777" }, // Santander
    { prefix: "002180", seed: "0111222333" }, // Banamex
    { prefix: "021180", seed: "0444555666" }, // HSBC
    { prefix: "044180", seed: "0777888999" }, // Scotiabank
  ];

  for (let i = 0; i < insertedSuppliers.length; i++) {
    const s = insertedSuppliers[i];
    const bDef = BANK_SEEDS[i % BANK_SEEDS.length];
    const rawClabe = makeValidClabe(bDef.prefix, bDef.seed);
    const val = validateClabe(rawClabe);
    if (!val.ok) {
      console.warn(`CLABE generation mismatch for ${s.name}: ${rawClabe}`);
      continue;
    }
    const fingerprint = fingerprintClabe(val.clabe, dek);

    await db.insert(supplierBankAccounts).values({
      companyId: COMPANY_ID,
      supplierId: s.id,
      clabe: encryptColumnWithDek(val.clabe, dek),
      clabeLast4: val.last4,
      clabeFingerprint: fingerprint,
      bankCode: val.bankCode,
      bankName: val.bankName,
      accountHolderName: s.name,
      status: "VERIFIED",
      active: true,
      registeredBy: USER_ADMIN,
      verifiedBy: USER_SUPER_ADMIN,
      verifiedAt: new Date(),
      verificationMethod: "MANUAL_CEP",
      notes: "Cuenta verificada con acuse CEP de Banxico en fase de onboarding demo.",
    });
  }

  console.log("Phase 1 complete!");
}
