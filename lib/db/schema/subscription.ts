/**
 * Tiering / suscripciones — docs/pulso-executive-os-v2.md §10.1.
 *
 * Dos tablas:
 *  - `subscription_tiers`: catálogo estático (foundation / growth / executive).
 *    `features` guarda el array de feature-slugs incluidos en el tier, para que
 *    un cambio comercial no requiera deploy (la matriz `TIER_FEATURES` de
 *    `lib/services/tier-service.ts` es el fallback si la fila no trae features).
 *  - `company_subscriptions`: qué tier tiene contratado cada compañía. Es un
 *    *override* del tier derivado por número de sucursales, no la única fuente:
 *    ver `TierService.getCompanyTier`.
 *
 * NOTA: `companies.plan` (text, default 'FREE') ya existía y NO se toca — es el
 * plan de facturación legacy. El tier ejecutivo vive aquí para no reinterpretar
 * un dato que otros flujos (billing-service) ya leen.
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./core";

export const subscriptionTiers = pgTable("subscription_tiers", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  /** Nombre comercial ("Foundation"). */
  name: text("name").notNull(),
  /** Slug estable usado por el código: 'foundation' | 'growth' | 'executive'. */
  slug: text("slug").notNull(),
  monthlyPriceCents: integer("monthly_price_cents").default(0).notNull(),
  /** Límite de sucursales incluidas. Define también el tier derivado. */
  maxBranches: integer("max_branches").notNull(),
  /** Array de feature-slugs (string[]). Vacío ⇒ usar TIER_FEATURES. */
  features: jsonb("features").default(sql`'[]'::jsonb`).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  subscriptionTiersSlugUnique: uniqueIndex("subscription_tiers_slug_unique").on(table.slug),
}));

export const companySubscriptions = pgTable("company_subscriptions", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  tierId: uuid("tier_id").notNull().references(() => subscriptionTiers.id),
  /** 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED'. */
  status: text("status").default("ACTIVE").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  autoRenew: boolean("auto_renew").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Una compañía tiene a lo sumo una suscripción vigente; el UPSERT de
  // `TierService.setTier` depende de esta unicidad.
  companySubscriptionsCompanyUnique: uniqueIndex(
    "company_subscriptions_company_unique",
  ).on(table.companyId),
  companySubscriptionsTierIdx: index("company_subscriptions_tier_idx").on(table.tierId),
}));
