/**
 * Cost Center Service — Catálogo Maestro de Centros de Costo y Partidas QSR
 *
 * Basado en la arquitectura integral de control financiero (finzasordenes.md §2.1 y §6).
 * Clasifica todos los egresos en:
 *   2xxx = COGS (Insumos, materia prima y empaques)
 *   3xxx = Nómina operativa y cargas sociales
 *   4xxx = Gastos operativos por sucursal (renta, servicios, mantenimiento, caja chica)
 *   5xxx = Gastos corporativos (honorarios, software, marketing central)
 *   6xxx = CAPEX e inversión en equipamiento
 */

import { db } from "@/lib/db";
import { costCenters } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";

export interface StandardPartida {
  code: string;
  name: string;
  category: "COGS" | "NOMINA" | "OPEX" | "CORPORATIVO" | "CAPEX";
  accountingLine: string;
  isRecurring?: boolean;
}

/** Catálogo maestro estandarizado para grupos QSR (finzasordenes.md §2.1) */
export const STANDARD_QSR_PARTIDAS: readonly StandardPartida[] = [
  // ── 2xxx: Insumos y COGS ──
  { code: "2101", name: "Alimentos e Insumos Proteína / Perecederos", category: "COGS", accountingLine: "COGS-ALIMENTOS" },
  { code: "2102", name: "Abarrotes e Insumos Secos", category: "COGS", accountingLine: "COGS-ABARROTES" },
  { code: "2103", name: "Bebidas y Líquidos", category: "COGS", accountingLine: "COGS-BEBIDAS" },
  { code: "2104", name: "Empaques y Desechables de Entrega", category: "COGS", accountingLine: "COGS-EMPAQUES" },

  // ── 3xxx: Nómina y Personal ──
  { code: "3101", name: "Sueldos y Salarios Operativos", category: "NOMINA", accountingLine: "NOMINA-BASE", isRecurring: true },
  { code: "3102", name: "Horas Extra, Bonos e Incidencias", category: "NOMINA", accountingLine: "NOMINA-VARIABLES" },
  { code: "3103", name: "Cargas Patronales y Seguridad Social (IMSS/Infonavit/ISN)", category: "NOMINA", accountingLine: "NOMINA-CARGAS", isRecurring: true },

  // ── 4xxx: Gastos Operativos de Sucursal ──
  { code: "4101", name: "Renta del Local", category: "OPEX", accountingLine: "OPEX-RENTA", isRecurring: true },
  { code: "4102", name: "Cuota de Plaza / CAM", category: "OPEX", accountingLine: "OPEX-CAM", isRecurring: true },
  { code: "4103", name: "Energía Eléctrica", category: "OPEX", accountingLine: "OPEX-LUZ", isRecurring: true },
  { code: "4104", name: "Agua Potable", category: "OPEX", accountingLine: "OPEX-AGUA", isRecurring: true },
  { code: "4105", name: "Gas LP / Gas Natural", category: "OPEX", accountingLine: "OPEX-GAS", isRecurring: true },
  { code: "4106", name: "Internet y Telefonía", category: "OPEX", accountingLine: "OPEX-INTERNET", isRecurring: true },
  { code: "4107", name: "Seguridad y Monitoreo de Alarma", category: "OPEX", accountingLine: "OPEX-SEGURIDAD", isRecurring: true },
  { code: "4108", name: "Fumigación y Control de Plagas", category: "OPEX", accountingLine: "OPEX-FUMIGACION", isRecurring: true },
  { code: "4109", name: "Limpieza de Ductos y Trampas de Grasa", category: "OPEX", accountingLine: "OPEX-TRAMPAS", isRecurring: true },
  { code: "4110", name: "Mantenimiento Correctivo de Equipos", category: "OPEX", accountingLine: "OPEX-MANT-CORRECTIVO" },
  { code: "4111", name: "Mantenimiento Preventivo Programado", category: "OPEX", accountingLine: "OPEX-MANT-PREVENTIVO", isRecurring: true },
  { code: "4112", name: "Seguros de Sucursal y Pólizas Flotantes", category: "OPEX", accountingLine: "OPEX-SEGUROS", isRecurring: true },
  { code: "4113", name: "Licencias, Permisos y Protección Civil", category: "OPEX", accountingLine: "OPEX-PERMISOS", isRecurring: true },
  { code: "4114", name: "Publicidad Local y Punto de Venta", category: "OPEX", accountingLine: "OPEX-PUBLICIDAD-LOCAL" },
  { code: "4115", name: "Consumibles de Operación y Papelería", category: "OPEX", accountingLine: "OPEX-CONSUMIBLES" },
  { code: "4116", name: "Caja Chica y Gastos Menores", category: "OPEX", accountingLine: "OPEX-CAJA-CHICA" },
  { code: "4117", name: "Impuesto Predial y Contribuciones Locales", category: "OPEX", accountingLine: "OPEX-PREDIAL", isRecurring: true },

  // ── 5xxx: Gastos Corporativos ──
  { code: "5101", name: "Honorarios Contables, Fiscales y Legales", category: "CORPORATIVO", accountingLine: "CORP-HONORARIOS", isRecurring: true },
  { code: "5102", name: "Software, POS, ERP y Plataformas Cloud", category: "CORPORATIVO", accountingLine: "CORP-SOFTWARE", isRecurring: true },
  { code: "5103", name: "Marketing y Campañas Institucionales", category: "CORPORATIVO", accountingLine: "CORP-MARKETING" },

  // ── 6xxx: CAPEX e Inversiones ──
  { code: "6101", name: "Equipamiento Mayor de Cocina y Salón (CAPEX)", category: "CAPEX", accountingLine: "CAPEX-EQUIPAMIENTO" },
] as const;

/**
 * Obtiene todos los centros de costo de una empresa ordenados por código.
 */
export async function getCostCentersByCompany(companyId: string, includeInactive = false) {
  const conditions = [eq(costCenters.companyId, companyId)];
  if (!includeInactive) {
    conditions.push(eq(costCenters.active, true));
  }

  return db
    .select()
    .from(costCenters)
    .where(and(...conditions))
    .orderBy(asc(costCenters.code));
}

/**
 * Precarga el catálogo estándar QSR para una empresa si aún no lo tiene.
 */
export async function seedStandardQSRCostCenters(companyId: string) {
  const existing = await db
    .select({ code: costCenters.code })
    .from(costCenters)
    .where(eq(costCenters.companyId, companyId));

  const existingCodes = new Set(existing.map((e) => e.code));
  const toInsert = STANDARD_QSR_PARTIDAS.filter((p) => !existingCodes.has(p.code)).map((p) => ({
    companyId,
    code: p.code,
    name: p.name,
    accountingLine: p.accountingLine,
    active: true,
  }));

  if (toInsert.length > 0) {
    await db.insert(costCenters).values(toInsert).onConflictDoNothing();
  }

  return getCostCentersByCompany(companyId);
}
