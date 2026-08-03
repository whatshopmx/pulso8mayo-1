import { pgTable, text, timestamp, boolean, uuid, jsonb, integer, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";

export const operationalTwinStateEnum = pgEnum("operational_twin_state", [
  "CREATE",
  "ACTIVE",
  "DEGRADING",
  "CRITICAL",
  "RECOVERING"
]);

export const operationalTwins = pgTable("operational_twins", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  currentState: operationalTwinStateEnum("current_state").default("CREATE").notNull(),
  
  // Projected Scores (0-100)
  healthScore: integer("health_score").default(100).notNull(),
  driftScore: integer("drift_score").default(0).notNull(),
  confidenceScore: integer("confidence_score").default(100).notNull(),
  
  // Cost-impact leakage (stored in cents, MXN)
  marginLeakageScore: integer("margin_leakage_score").default(0).notNull(),
  
  // Detailed dimension sub-states
  executionState: jsonb("execution_state").default(sql`'{}'::jsonb`).notNull(),
  inventoryState: jsonb("inventory_state").default(sql`'{}'::jsonb`).notNull(),
  recipeState: jsonb("recipe_state").default(sql`'{}'::jsonb`).notNull(),
  laborState: jsonb("labor_state").default(sql`'{}'::jsonb`).notNull(),
  qualityState: jsonb("quality_state").default(sql`'{}'::jsonb`).notNull(),
  maintenanceState: jsonb("maintenance_state").default(sql`'{}'::jsonb`).notNull(),
  complianceState: jsonb("compliance_state").default(sql`'{}'::jsonb`).notNull(),
  financeState: jsonb("finance_state").default(sql`'{}'::jsonb`).notNull(),
  customerExperienceState: jsonb("customer_experience_state").default(sql`'{}'::jsonb`).notNull(),

  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueBranchTwin: uniqueIndex("unique_branch_twin").on(table.branchId),
}));

export const corporateTwins = pgTable("corporate_twins", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  
  healthScore: integer("health_score").default(100).notNull(),
  driftScore: integer("drift_score").default(0).notNull(),
  marginLeakageScore: integer("margin_leakage_score").default(0).notNull(),
  
  // Projected network state
  networkState: jsonb("network_state").default(sql`'{}'::jsonb`).notNull(),

  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCompanyTwin: uniqueIndex("unique_company_twin").on(table.companyId),
}));

export const domainEvents = pgTable("domain_events", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  eventType: text("event_type").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  payload: jsonb("payload").default(sql`'{}'::jsonb`).notNull(),
  processed: boolean("processed").default(false).notNull(),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
