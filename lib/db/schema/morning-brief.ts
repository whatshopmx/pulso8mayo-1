/**
 * Morning Brief del grupo — docs/pulso-executive-os-v2.md §8.5.
 *
 * Documento derivado: el cron `generate-morning-brief` (07:00 America/Mexico_City)
 * recalcula el Executive Twin, consolida los engines y persiste un brief JSON.
 * El dashboard ejecutivo lee la última fila; nunca calcula en el render.
 *
 * `brief` guarda el objeto `MorningBrief` de `lib/services/intelligence/types.ts`
 * (headline, priorities, sections). `twinSnapshot` guarda la procedencia: las
 * dimensiones del twin en el momento de generar, para poder explicar el brief
 * aunque el twin ya se haya recalculado 96 veces desde entonces.
 */
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./core";

export const morningBriefs = pgTable("morning_briefs", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  /** Fecha ISO (yyyy-mm-dd) que cubre el brief, en la zona del grupo. */
  briefDate: text("brief_date").notNull(),
  brief: jsonb("brief").default(sql`'{}'::jsonb`).notNull(),
  twinSnapshot: jsonb("twin_snapshot").default(sql`'{}'::jsonb`).notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Un brief por compañía y día: el cron es idempotente vía UPSERT sobre este
  // índice, así un retry de Inngest no duplica el brief del día.
  morningBriefsCompanyDateUnique: uniqueIndex(
    "morning_briefs_company_date_unique",
  ).on(table.companyId, table.briefDate),
  morningBriefsCompanyGeneratedIdx: index("morning_briefs_company_generated_idx").on(
    table.companyId,
    table.generatedAt,
  ),
}));
