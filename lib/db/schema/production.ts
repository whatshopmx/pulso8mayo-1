import { pgTable, text, timestamp, boolean, uuid, integer, pgEnum, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";

// production_plans: Plan de producción diario (Prep List) por sucursal
export const productionPlanStatusEnum = pgEnum("production_plan_status", [
  'DRAFT',
  'PUBLISHED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
]);

export const productionPlans = pgTable("production_plans", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  
  targetDate: timestamp("target_date").notNull(), // El día de producción
  shift: text("shift"), // Ej. MATUTINO, VESPERTINO (opcional)
  
  status: productionPlanStatusEnum("status").default("DRAFT").notNull(),
  
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productionPlanItemStatusEnum = pgEnum("production_plan_item_status", [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED'
]);

// production_plan_items: Detalle (receta, cantidad, lotes a usar)
export const productionPlanItems = pgTable("production_plan_items", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  planId: uuid("plan_id").notNull().references(() => productionPlans.id, { onDelete: 'cascade' }),
  
  // What are we preparing?
  recipeId: uuid("recipe_id").notNull(), 
  
  // Planned vs actual quantity
  plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 }).notNull(),
  actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
  unitOfMeasure: text("unit_of_measure").notNull(), // Ej. 'KG', 'LITERS', 'PORTIONS'
  
  status: productionPlanItemStatusEnum("status").default("PENDING").notNull(),
  
  assignedTo: text("assigned_to").references(() => users.id), // Cook assigned
  
  // When should it be ready?
  targetTime: timestamp("target_time"),
  completedAt: timestamp("completed_at"),
  
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// production_batches: Lotes generados por sub-recetas (comisariato o pre-prep)
export const productionBatches = pgTable("production_batches", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  
  productionPlanItemId: uuid("production_plan_item_id").references(() => productionPlanItems.id),
  recipeId: uuid("recipe_id").notNull(),
  
  batchNumber: text("batch_number").notNull(), // L-XXXX format
  
  quantityProduced: numeric("quantity_produced", { precision: 12, scale: 4 }).notNull(),
  unitOfMeasure: text("unit_of_measure").notNull(),
  
  productionDate: timestamp("production_date").notNull(),
  expirationDate: timestamp("expiration_date").notNull(),
  
  // Reference to the inventory batch created from this production
  inventoryBatchId: uuid("inventory_batch_id"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
