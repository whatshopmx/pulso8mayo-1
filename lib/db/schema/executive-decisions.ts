/**
 * Resoluciones ejecutivas de la Cola de Decisiones (`ExecutiveDecisionDeck`).
 *
 * Cada caso (prioridad del brief matutino o anomalía de red) puede resolverse
 * inline desde la cabina: `authorized` (Dirección autoriza) o `deferred`
 * (se difiere 24 h). Persistir la resolución —y no derivarla del brief— es lo
 * que hace creíble la "rutina de 60 segundos": al recargar, lo despachado
 * permanece despachado y el contador de pendientes decrece de verdad.
 *
 * `decisionKey` es una clave estable generada en cliente a partir del origen
 * del caso (`brief-<rank>-<title>` / `anomaly-<id>`), no un FK: los briefs se
 * regeneran cada mañana y las anomalías caducan, pero la pista de auditoría de
 * quién autorizó qué debe sobrevivir a ambos.
 */
import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./core";

export const executiveDecisions = pgTable("executive_decisions", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  /** Clave estable del caso en la cola (ver docstring de la tabla). */
  decisionKey: text("decision_key").notNull(),
  /** `authorized` = despachado por Dirección; `deferred` = revisión en 24 h. */
  resolution: text("resolution").notNull(),
  resolvedBy: uuid("resolved_by"),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
}, (table) => ({
  // Un caso sólo puede tener una resolución vigente: revocar (Deshacer) borra
  // la fila, así el UPSERT sobre este índice mantiene el historial limpio.
  executiveDecisionsCompanyKeyUnique: uniqueIndex(
    "executive_decisions_company_key_unique",
  ).on(table.companyId, table.decisionKey),
  executiveDecisionsCompanyResolvedIdx: index(
    "executive_decisions_company_resolved_idx",
  ).on(table.companyId, table.resolvedAt),
}));
