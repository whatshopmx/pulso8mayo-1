import { pgTable, text, timestamp, boolean, uuid, integer, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";
import { supplierBankAccounts } from "../schema";

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
  'OTHER'
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
