/**
 * EVI-01 (Fase 2) — evidencia común durable.
 *
 * Una fila por adjunto, con empresa, sucursal, entidad de origen, autor, tipo y
 * clave de almacenamiento. Sustituye el registro en memoria de
 * `lib/services/evidence-store.ts` por una entidad consultable tras reiniciar
 * el proceso y aislada por empresa.
 *
 * No sustituye las columnas `evidence_url` que ya usan los dominios
 * (workflows, gastos, órdenes de servicio): esas siguen vigentes durante la
 * migración por dominio y la dualidad se cierra en la tarea de cada recorrido.
 * `url` guarda la KEY de R2 del modelo privado o la URL legacy tal cual.
 */
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";

export const evidenceKindEnum = pgEnum("evidence_kind", [
  "PHOTO",
  "FILE",
  "VOICE",
  "VIDEO",
  "TEXT",
]);

export const evidenceEntityTypeEnum = pgEnum("evidence_entity_type", [
  "WORKFLOW_STEP",
  "INCIDENT",
  "DOCUMENT",
  "EXPENSE",
  "SERVICE_ORDER",
  "WASTE",
  "RECEIVING",
  "GENERAL",
]);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    /** Tipo estable del sujeto (p. ej. `WORKFLOW_STEP`). */
    entityType: evidenceEntityTypeEnum("entity_type").notNull(),
    /** Id del sujeto en su tabla de dominio (uuid o texto). */
    entityId: text("entity_id").notNull(),

    kind: evidenceKindEnum("kind").notNull().default("PHOTO"),
    mimeType: text("mime_type"),

    /** KEY de R2 (modelo privado) o URL legacy (`http(s)://`, `local://`). */
    url: text("url").notNull(),
    storageKey: text("storage_key"),

    /** Metadata derivada por IA (transcripción, clasificación, verificación). */
    aiMetadata: jsonb("ai_metadata"),

    createdBy: text("created_by"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    /** Borrado lógico: la evidencia deja de listarse pero no se pierde el rastro. */
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    evidenceEntityIdx: index("evidence_company_entity_idx").on(
      table.companyId,
      table.entityType,
      table.entityId,
    ),
    evidenceBranchIdx: index("evidence_company_branch_idx").on(
      table.companyId,
      table.branchId,
    ),
    evidenceCreatedByIdx: index("evidence_created_by_idx").on(table.createdBy),
    evidenceCreatedByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "evidence_created_by_fk",
    }),
  }),
);
