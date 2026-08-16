import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  integer,
  date,
  text,
  timestamp,
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
