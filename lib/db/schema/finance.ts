import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  date,
  text,
  boolean,
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

/**
 * Proveedor o adquirente de la terminal punto de venta física.
 */
export const terminalAcquirerEnum = pgEnum("terminal_acquirer", [
  "CLIP",
  "MERCADO_PAGO",
  "BBVA",
  "BANORTE",
  "SANTANDER",
  "OTHER",
]);

/**
 * Catálogo de terminales físicas autorizadas por sucursal (Módulo 6.2 - Conciliación TPV).
 *
 * Base para auditoría anti-fraude: permite identificar terminales fantasma
 * (dispositivos no autorizados cobrando dentro del restaurante) y asegurar que
 * todos los cierres de lote pertenezcan a equipos inventariados.
 */
export const branchTerminals = pgTable(
  "branch_terminals",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),

    /** Número de serie único del hardware físico. */
    serialNumber: text("serial_number").notNull(),

    /** Nombre o ubicación asignada (ej. 'Barra 1', 'Caja Salón', 'Móvil Terraza'). */
    alias: text("alias").notNull(),

    /** Pasarela o banco adquirente. */
    acquirer: terminalAcquirerEnum("acquirer").notNull(),

    /** Número de afiliación bancaria con el adquirente. */
    affiliationNumber: text("affiliation_number"),

    /** Si la terminal está activa para operar. */
    active: boolean("active").default(true).notNull(),

    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    branchTerminalsCompanySerialUnique: uniqueIndex(
      "branch_terminals_company_serial_unique"
    ).on(table.companyId, table.serialNumber),
    branchTerminalsBranchIdx: index("branch_terminals_branch_idx").on(
      table.branchId
    ),
    branchTerminalsCompanyIdx: index("branch_terminals_company_idx").on(
      table.companyId
    ),
  })
);

export type BranchTerminal = typeof branchTerminals.$inferSelect;
export type NewBranchTerminal = typeof branchTerminals.$inferInsert;

/**
 * Transacciones individuales importadas de reportes de pasarelas y adquirentes (Clip, MP, BBVA...).
 *
 * Base para conciliación a tres bandas (Banda 2 vs Banda 1 vs Banda 3) y auditoría
 * de comisiones con segregación de IVA (16%).
 */
export const gatewayTransactions = pgTable(
  "gateway_transactions",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),

    acquirer: terminalAcquirerEnum("acquirer").notNull(),

    /** Identificador único de transacción del adquirente (ej. payment_id de Clip/MP). */
    externalId: text("external_id"),

    /** Código o folio de autorización bancaria. */
    authorizationCode: text("authorization_code"),

    /** Fecha y hora exacta de la transacción según la pasarela. */
    transactionDate: timestamp("transaction_date").notNull(),

    /** Últimos 4 dígitos de la tarjeta. */
    cardLast4: text("card_last_4"),

    /** Marca (VISA, MASTERCARD, AMEX, etc.). */
    cardBrand: text("card_brand"),

    /** Tipo de tarjeta (CREDIT, DEBIT, OTHER). */
    cardType: text("card_type"),

    /** Monto bruto cobrado en centavos. */
    grossAmountCents: integer("gross_amount_cents").notNull(),

    /** Comisión retenida (sin IVA) en centavos. */
    feeAmountCents: integer("fee_amount_cents").notNull(),

    /** IVA del 16% sobre la comisión retenida en centavos. */
    feeVatCents: integer("fee_vat_cents").default(0).notNull(),

    /** Abono neto depositado o por depositar en centavos (bruto - comisión - iva). */
    netAmountCents: integer("net_amount_cents").notNull(),

    /** Fecha valor o liquidación bancaria (si el reporte la indica). */
    settlementDate: date("settlement_date"),

    /** Folio de lote de la terminal (si el reporte lo incluye). */
    batchNumber: text("batch_number"),

    /** Estatus (SETTLED, REFUNDED, DISPUTED, CANCELLED). */
    status: text("status").default("SETTLED").notNull(),

    /** Identificador del archivo fuente importado. */
    rawReportFileUrl: text("raw_report_file_url"),

    importedBy: text("imported_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    gatewayTransactionsCompanyAcquirerExtUnique: uniqueIndex(
      "gateway_transactions_company_acquirer_ext_unique"
    ).on(table.companyId, table.acquirer, table.externalId),
    gatewayTransactionsCompanyBranchDateIdx: index(
      "gateway_transactions_company_branch_date_idx"
    ).on(table.companyId, table.branchId, table.transactionDate),
    gatewayTransactionsCompanySettlementIdx: index(
      "gateway_transactions_company_settlement_idx"
    ).on(table.companyId, table.settlementDate),
  })
);

export type GatewayTransaction = typeof gatewayTransactions.$inferSelect;
export type NewGatewayTransaction = typeof gatewayTransactions.$inferInsert;

