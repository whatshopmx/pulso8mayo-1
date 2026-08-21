import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  date,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies, branches } from "./core";
import { users } from "./auth";

/**
 * Supuestos capturados que alimentan la proyección de flujo de efectivo.
 *
 * El saldo inicial **no se puede calcular**: el esquema no tiene tabla bancaria
 * ni libro mayor, así que ningún cálculo puede producir el saldo real de una
 * cuenta. Antes se resolvía con una constante —`INITIAL_BALANCE = 2000000`, los
 * mismos $20,000 para un café de 3 sucursales y para un grupo hotelero de 15—
 * renderizada como "Saldo inicial proyectado" y sembrando el saldo acumulado de
 * los 30 días. "Saldo mínimo", las bandas de color y "Te alcanza para N días"
 * heredaban todos esa invención.
 *
 * El dato se captura. Sin registro, la pantalla lo pide en vez de proyectar.
 */
export const cashFlowAssumptions = pgTable(
  "cash_flow_assumptions",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    /** `null` = supuesto del grupo completo; con valor, el de esa sucursal. */
    branchId: uuid("branch_id").references(() => branches.id),

    /** Saldo en caja y bancos al corte, en centavos. Puede ser negativo. */
    openingBalanceCents: integer("opening_balance_cents").notNull(),
    /** Fecha a la que corresponde el saldo: un saldo sin fecha no dice nada. */
    asOfDate: date("as_of_date").notNull(),

    updatedBy: text("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Un supuesto por sucursal. Postgres trata los NULL como distintos entre sí,
    // así que este índice NO cubre la fila del grupo: haría falta permitir
    // (company, NULL) repetido. De ahí el índice parcial de abajo.
    cashFlowAssumptionsBranchUnique: uniqueIndex(
      "cash_flow_assumptions_company_branch_unique"
    ).on(table.companyId, table.branchId),
    // Una sola fila de grupo por compañía.
    cashFlowAssumptionsGroupUnique: uniqueIndex(
      "cash_flow_assumptions_company_group_unique"
    )
      .on(table.companyId)
      .where(sql`${table.branchId} IS NULL`),
    cashFlowAssumptionsCompanyIdx: index("cash_flow_assumptions_company_idx").on(
      table.companyId
    ),
  })
);

/**
 * Estado real de un timbrado ante el PAC.
 *
 * `fiscal-service` devolvía `status: "TIMBRADO"` fijo, sin mirar la respuesta:
 * un rechazo del SAT se presentaba en pantalla con el mismo badge verde que un
 * comprobante válido. El estado es un dato del PAC, no una afirmación nuestra.
 */
export const cfdiTimbradoStatusEnum = pgEnum("cfdi_timbrado_status", [
  "TIMBRADO",
  "PENDIENTE",
  "RECHAZADO",
  "ERROR",
]);

/**
 * Timbrados de CFDI de nómina: lo que el PAC respondió, guardado.
 *
 * Antes no se persistía nada. El resultado del timbrado vivía en el estado de
 * React de la pantalla fiscal, así que **recargar borraba el comprobante**: el
 * folio fiscal existía ante el SAT y en Pulso no quedaba rastro. Y como la única
 * guarda contra timbrar dos veces era ese mismo estado de cliente, reintentar
 * consumía otro folio por el mismo empleado y período.
 *
 * El índice único sobre `(company_id, empleado_rfc, periodo)` es la
 * idempotencia real (AD-A4): no un guard de cliente, sino la base de datos.
 * Mismo patrón que `0055_idempotencia-extractores.sql`.
 *
 * `uuid` es nullable a propósito: un intento **rechazado** no tiene folio, y es
 * justamente el caso que hay que poder guardar para no repetirlo a ciegas. Un
 * reintento sobre una fila que no quedó en `TIMBRADO` actualiza esa fila; una
 * que sí, se devuelve tal cual sin volver a llamar al PAC.
 */
export const cfdiNominaTimbrados = pgTable(
  "cfdi_nomina_timbrados",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    /** RFC del empleado. Con `periodo`, identifica el comprobante. */
    empleadoRfc: text("empleado_rfc").notNull(),
    empleadoNombre: text("empleado_nombre").notNull(),
    /** Período de nómina tal como se mandó al PAC (ej. `2026-01`). */
    periodo: text("periodo").notNull(),

    /** Folio fiscal del SAT. `null` mientras no haya timbre válido. */
    uuid: text("uuid"),
    status: cfdiTimbradoStatusEnum("status").notNull(),
    cadenaOriginal: text("cadena_original"),
    selloDigital: text("sello_digital"),

    totalPercepcionesCents: integer("total_percepciones_cents").notNull(),
    totalDeduccionesCents: integer("total_deducciones_cents").notNull(),

    /** Respuesta cruda del PAC: la evidencia de qué se pidió y qué contestó. */
    rawResponse: jsonb("raw_response"),

    timbradoPor: text("timbrado_por").references(() => users.id),
    fechaTimbrado: timestamp("fecha_timbrado"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // La idempotencia del folio: un comprobante por empleado y período.
    cfdiNominaTimbradosUnique: uniqueIndex(
      "cfdi_nomina_timbrados_company_rfc_periodo_unique"
    ).on(table.companyId, table.empleadoRfc, table.periodo),
    cfdiNominaTimbradosCompanyIdx: index("cfdi_nomina_timbrados_company_idx").on(
      table.companyId
    ),
  })
);
