import { pgTable, text, uuid, integer, numeric, date, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Parámetros de la Ley Federal del Trabajo con vigencia por FECHA.
 *
 * Este es el estrato "ley" del `labor-rules-resolver` (plan
 * plans/2026-correcciones-legales-config-laboral.md Task 1): tabla de
 * referencia **solo lectura para usuarios** — la ley no es editable por
 * la empresa. El seed idempotente (`scripts/seed-labor-law-rules.ts`)
 * carga las filas del decreto DOF 1-may-2026 (reducción de jornada
 * 48h→40h) y los salarios mínimos anuales publicados.
 *
 * Configurabilidad en 3 capas (Task 2):
 *   (1) LEY (esta tabla, por fecha efectiva),
 *   (2) EMPRESA (override más restrictivo, contrato colectivo),
 *   (3) ESTATUS de reformas pendientes (`labor-reform-status-catalog`).
 *
 * Trazabilidad legal: cada fila lleva la URL del DOF y la fecha de
 * publicación del decreto que la respalda, para que cualquier tope que
 * valide el sistema pueda citar su fuente.
 */
export const laborLawCalendarRules = pgTable("labor_law_calendar_rules", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),

    // Vigencia por fecha, no por bucket anual: la reforma de jornada entró
    // en vigor el 1-may-2026, pero el calendario del transitorio corre
    // por año natural (1-ene). Las filas expresan los dos tramos: 2026
    // tiene dos (pre/post decreto).
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"), // null = abierto

    // Arts. 59, 66, 68 y transitorios 2.º y 4.º (DOF 1-may-2026).
    maxWeeklyHours: integer("max_weekly_hours").notNull(),
    maxDoubleOvertimeHours: integer("max_double_overtime_hours").notNull(),
    maxTripleOvertimeHours: integer("max_triple_overtime_hours").notNull(),
    maxDailySumHours: integer("max_daily_sum_hours").notNull(),
    maxExtraHoursPerDay: integer("max_extra_hours_per_day").notNull(),
    maxExtraDaysPerWeek: integer("max_extra_days_per_week").notNull(),
    minRestBetweenShiftsHours: integer("min_rest_between_shifts_hours").notNull().default(12),

    // Días de aguinaldo legal por año de servicio (Art. 87 LFT).
    // 15 días es la cifra vigente ininterrumpida desde la LFT de 1970 —
    // por eso el default 15 es seguro incluso para filas históricas.
    // La propuesta de 30 días progresivos por antigüedad NO es ley
    // (estatus en labor-reform-status-catalog: AGUINALDO_30_DIAS).
    aguinaldoDaysMxn: integer("aguinaldo_days_mxn").notNull().default(15),

    // Salario mínimo general vigente en el rango (pesos MXN por día).
    // Conservado como numeric para el cálculo de primas tocadas a salarios mínimos.
    minimumWageMxn: numeric("minimum_wage_mxn", { precision: 8, scale: 2 }),

    // Fuente legal de esta fila (trazabilidad obligatoria).
    sourceDofUrl: text("source_dof_url"),
    sourcePublishedOn: date("source_published_on"),
    legalNote: text("legal_note"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    // Una sola fila vigente por fecha — sin traslapes.
    uniqueIndex("labor_law_rules_effective_range_idx").on(table.effectiveFrom),
    index("labor_law_rules_from_idx").on(table.effectiveFrom),
]);

/**
 * Readiness del registro electrónico de jornada (Art. 132 fr. XXXIV,
 * disposiciones STPS con vigor 1-ene-2027). Por sucursal: la ley
 * obliga a registrar inicio/fin de jornada por trabajador; los
 * lineamientos (ámbito y excepciones) aún no se publican, así que el
 * diseño tolera el vacío y no bloquea nada mientras estén pendientes.
 */
export const electronicRegistryReadiness = pgTable("electronic_registry_readiness", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    status: text("status").notNull().default("OFF"), // OFF | WIRING | READY
    registrySystemName: text("registry_system_name"),
    signedAgreementUrl: text("signed_agreement_url"), // acuerdo registro-empleado (prueba plena)
    notes: text("notes"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    uniqueIndex("electronic_registry_branch_unique").on(table.companyId, table.branchId),
]);

export type LaborLawCalendarRule = typeof laborLawCalendarRules.$inferSelect;
export type NewLaborLawCalendarRule = typeof laborLawCalendarRules.$inferInsert;
export type ElectronicRegistryReadiness = typeof electronicRegistryReadiness.$inferSelect;
