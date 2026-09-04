import { pgTable, text, timestamp, boolean, uuid, integer, pgEnum, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";
import { supplierBankAccounts, payees } from "../schema";

export const paymentRunStatusEnum = pgEnum("payment_run_status", [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'CANCELLED'
]);

// Contratos de Gastos Operativos Recurrentes (Renta, CFE, Internet, etc.)
export const recurringContracts = pgTable("recurring_contracts", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").references(() => branches.id), // Nullable for corporate contracts
  supplierId: uuid("supplier_id").notNull(), 
  
  contractType: text("contract_type").notNull(), // RENTA, SERVICIO_BASICO, MANTENIMIENTO, SOFTWARE
  title: text("title").notNull(),
  description: text("description"),
  
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  autoRenew: boolean("auto_renew").default(false).notNull(),
  
  // Monto base esperado en centavos
  baseAmountCents: integer("base_amount_cents").notNull(),
  currency: text("currency").default("MXN").notNull(),
  
  // % de tolerancia para alertas si la factura llega más ALTA (ej. 10 para 10%).
  varianceTolerancePercent: integer("variance_tolerance_percent").default(10).notNull(),

  /**
   * % de tolerancia por DEBAJO del monto base. NULLABLE, y `null` significa
   * "no alertes por debajo" — que es el comportamiento que tenían todos los
   * contratos antes de esta columna.
   *
   * Existe porque un servicio de monto variable se desvía en los dos sentidos y
   * no significan lo mismo. En agua, un consumo disparado es una fuga; en luz,
   * un recibo muy por debajo suele ser lectura estimada de CFE, y el ajuste
   * llega al doble el período siguiente. La renta, en cambio, no tiene por qué
   * alertar hacia abajo nunca: por eso el límite inferior se configura aparte y
   * no se deriva del superior.
   */
  varianceToleranceBelowPercent: integer("variance_tolerance_below_percent"),
  
  paymentFrequency: text("payment_frequency").default("MONTHLY").notNull(), // MONTHLY, QUARTERLY, ANNUAL
  paymentMethod: text("payment_method").default("TRANSFER").notNull(), // DOMICILIADO, TRANSFER
  
  active: boolean("active").default(true).notNull(),
  
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tesorería - Corridas de Pago (Programa Semanal/Quincenal de Egresos)
export const paymentRuns = pgTable("payment_runs", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").references(() => branches.id), // Nullable for corporate/all branches
  
  title: text("title").notNull(), // Ej. "Corrida Quincenal 15 Ago 2026"
  runDate: timestamp("run_date").notNull(), // Fecha en que se ejecutará el pago
  
  status: paymentRunStatusEnum("status").default("DRAFT").notNull(),
  
  totalAmountCents: integer("total_amount_cents").default(0).notNull(),
  currency: text("currency").default("MXN").notNull(),
  
  // Fuente de los fondos
  sourceAccount: text("source_account"), 
  
  preparedBy: text("prepared_by").references(() => users.id),
  approvedBy: text("approved_by").references(() => users.id),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const paymentRunItemTypeEnum = pgEnum("payment_run_item_type", [
  'INVOICE',
  'PAYROLL',
  'TAXES',
  'PETTY_CASH_REIMBURSEMENT',
  'OTHER',
  /**
   * Gasto operativo autorizado (renta, luz, honorarios...) con `payeeId`.
   *
   * Hasta aquí un gasto `APPROVED` aparecía en `/dashboard/finance/payables`
   * como "por pagar" pero no tenía ningún camino hacia el pago: el switch de
   * `assertCounterpartyPayable` no lo cubría y `OTHER` está prohibido a
   * propósito. Requiere cuenta verificada en `payee_bank_accounts`, igual que
   * una factura requiere una en `supplier_bank_accounts`.
   */
  'OPERATING_EXPENSE',
]);

export const paymentRunItems = pgTable("payment_run_items", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  paymentRunId: uuid("payment_run_id").notNull().references(() => paymentRuns.id, { onDelete: 'cascade' }),
  
  itemType: paymentRunItemTypeEnum("item_type").notNull(),
  
  // Reference IDs can point to different tables based on itemType
  referenceId: text("reference_id").notNull(), 
  
  amountCents: integer("amount_cents").notNull(),
  
  notes: text("notes"),

  /**
   * Cuenta bancaria contra la que se autorizó esta partida, congelada al
   * agregarla a la corrida.
   *
   * Sin este congelado, un proveedor que cambia de CLABE entre la aprobación y
   * la dispersión cobra en la cuenta nueva sin que nadie la vuelva a firmar —
   * que es exactamente el fraude que `supplier_bank_accounts` y su máquina de
   * verificación existen para impedir. El layout resuelve la cuenta al momento
   * de generarse, así que sin snapshot la firma de la corrida no dice nada
   * sobre a dónde va el dinero.
   *
   * Nullable y sin backfill a propósito: las corridas en `DRAFT` ya creadas
   * siguen funcionando y el generador cae a la cuenta verificada vigente,
   * declarándolo en la respuesta.
   */
  bankAccountId: uuid("bank_account_id").references(() => supplierBankAccounts.id),

  /**
   * Cuenta congelada de la contraparte cuando la partida es `OPERATING_EXPENSE`
   * (mismo criterio que `bankAccountId`, pero apuntando a `payee_bank_accounts`
   * en vez de `supplier_bank_accounts`: son dos catálogos de identidad
   * distintos y una sola columna no puede referenciar a los dos a la vez).
   */
  payeeBankAccountId: uuid("payee_bank_account_id").references(() => payeeBankAccounts.id),

  /**
   * Últimos 4 dígitos de la CLABE en el momento de agregar la partida.
   *
   * Se guardan aparte de la llave foránea porque son lo que se le muestra a una
   * persona, y porque permiten detectar el cambio aunque la cuenta congelada
   * siga existiendo: si la vigente ya no coincide con este snapshot, alguien
   * movió la cuenta después de que la corrida se armó.
   */
  clabeLast4Snapshot: text("clabe_last4_snapshot"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Cuentas bancarias de payee — espejo de `supplier_bank_accounts`
// (`lib/db/schema.ts`) para el mismo control antifraude, aplicado al catálogo
// de contrapartes de gasto operativo en vez del de proveedores.
//
// El fraude que se cierra es el mismo: no es el gasto inventado, es cambiarle
// la CLABE a un payee real (el arrendador, el despacho contable) para
// redirigir un pago legítimo. Las mismas cuatro reglas aplican aquí: validar
// antes de confiar, capturar no es verificar, capturar no desplaza, y un
// cambio siempre despierta al dueño. Ver `payee-bank-account-service.ts`.
// ---------------------------------------------------------------------------

export const payeeBankAccountStatusEnum = pgEnum("payee_bank_account_status", [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
]);

export const payeeBankAccounts = pgTable("payee_bank_accounts", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  payeeId: uuid("payee_id").notNull().references(() => payees.id),

  /** CLABE cifrada en reposo — mismo esquema de cifrado que `supplier_bank_accounts.clabe`. */
  clabe: text("clabe").notNull(),
  /** Últimos 4 dígitos en claro: es todo lo que la UI muestra jamás. */
  clabeLast4: text("clabe_last4").notNull(),
  /** HMAC-SHA256(CLABE, DEK del tenant) — mismo propósito que en `supplier_bank_accounts`. */
  clabeFingerprint: text("clabe_fingerprint").notNull(),

  bankCode: text("bank_code").notNull(),
  bankName: text("bank_name").notNull(),

  /** Titular declarado por quien captura; el paso de verificación lo contrasta contra el CEP. */
  accountHolderName: text("account_holder_name").notNull(),

  status: payeeBankAccountStatusEnum("status").default('PENDING_VERIFICATION').notNull(),
  /** Baja lógica. Una cuenta nunca se borra: es evidencia de a quién se pagó. */
  active: boolean("active").default(true).notNull(),

  verifiedAt: timestamp("verified_at"),
  verifiedBy: text("verified_by").references(() => users.id),
  verificationMethod: text("verification_method"),
  verificationEvidenceUrl: text("verification_evidence_url"),

  rejectedAt: timestamp("rejected_at"),
  rejectedBy: text("rejected_by").references(() => users.id),
  rejectionReason: text("rejection_reason"),

  /** Quién capturó. El verificador tiene que ser alguien distinto. */
  registeredBy: text("registered_by").notNull().references(() => users.id),
  /** Cuenta vigente que ésta pretende sustituir — la traza del cambio. */
  replacesAccountId: uuid("replaces_account_id"),

  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  /** Un payee no puede tener dos cuentas verificadas y activas a la vez. */
  oneVerifiedActivePerPayee: uniqueIndex("payee_bank_accounts_one_verified_active")
    .on(table.payeeId)
    .where(sql`${table.status} = 'VERIFIED' AND ${table.active}`),
  /** Recapturar la misma CLABE de un payee no crea filas duplicadas. */
  payeeClabeUnique: uniqueIndex("payee_bank_accounts_payee_clabe_unique")
    .on(table.payeeId, table.clabeFingerprint)
    .where(sql`${table.active}`),
  companyPayeeIdx: index("payee_bank_accounts_company_payee_idx").on(
    table.companyId,
    table.payeeId,
  ),
  fingerprintIdx: index("payee_bank_accounts_fingerprint_idx").on(
    table.companyId,
    table.clabeFingerprint,
  ),
  replacesAccountFk: foreignKey({
    columns: [table.replacesAccountId],
    foreignColumns: [table.id],
    name: "payee_bank_accounts_replaces_account_id_fk",
  }),
}));
