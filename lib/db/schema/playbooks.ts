/**
 * Playbooks corporativos — "el grupo define, las sucursales ejecutan".
 *
 * Decisión de diseño (corrige AD-2 del plan): un playbook NO se materializa como
 * una copia de `workflow_templates` por sucursal. El template corporativo es una
 * sola fila con `scope='company'`, y `playbook_publications` registra a qué
 * sucursales está publicado.
 *
 * Por qué no copias:
 *  - `workflow_templates.branch_id` no filtra nada hoy: ninguna query del repo lo
 *    usa (todas filtran por `company_id`). Lo que hace que una plantilla se
 *    ejecute en una sucursal es `workflow_schedules(template_id, branch_id)`.
 *  - Publicar v2 con copias exige propagar en cascada N filas y reconciliar
 *    huérfanas — el propio plan lo clasificaba como riesgo "High". Con una sola
 *    fila la cascada es gratis: editas el template y todas las sucursales
 *    publicadas ven la v2 en el acto.
 *
 * Semántica de visibilidad:
 *  - `scope='branch'` (default, legacy): comportamiento actual sin cambios.
 *  - `scope='company'` SIN publicaciones: visible en todas las sucursales
 *    ("🌐 Todas las sucursales").
 *  - `scope='company'` CON publicaciones: visible solo en las sucursales con una
 *    publicación `status='PUBLISHED'`.
 */
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";

export const playbookPublications = pgTable("playbook_publications", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  /** FK lógica a `workflow_templates.id` (text, no uuid — ver lib/db/schema.ts). */
  templateId: text("template_id").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  /** Versión del template al momento de publicar (trazabilidad). */
  version: integer("version").default(1).notNull(),
  /** 'PUBLISHED' | 'REVOKED'. Se conserva la fila revocada como historial. */
  status: text("status").default("PUBLISHED").notNull(),
  publishedBy: text("published_by"),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Idempotencia del publish: (template, sucursal) es único, el publish hace
  // UPSERT sobre este índice en vez de insertar duplicados.
  playbookPublicationsTemplateBranchUnique: uniqueIndex(
    "playbook_publications_template_branch_unique",
  ).on(table.templateId, table.branchId),
  playbookPublicationsCompanyIdx: index("playbook_publications_company_idx").on(
    table.companyId,
  ),
  playbookPublicationsBranchIdx: index("playbook_publications_branch_idx").on(
    table.branchId,
  ),
}));

/**
 * Historial de versiones de un playbook corporativo. Cada publicación con
 * `version` distinta deja un snapshot de los pasos, para poder auditar qué
 * ejecutó una sucursal en una fecha dada.
 */
export const playbookVersions = pgTable("playbook_versions", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  templateId: text("template_id").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  version: integer("version").notNull(),
  name: text("name"),
  description: text("description"),
  /** Snapshot de `workflow_templates.steps` en esta versión. */
  steps: jsonb("steps").default(sql`'[]'::jsonb`).notNull(),
  changeNote: text("change_note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  playbookVersionsTemplateVersionUnique: uniqueIndex(
    "playbook_versions_template_version_unique",
  ).on(table.templateId, table.version),
}));
