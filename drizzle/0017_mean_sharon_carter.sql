CREATE TYPE "public"."production_order_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."inventory_alert_type" ADD VALUE 'HIGH_VARIANCE';--> statement-breakpoint
ALTER TYPE "public"."inventory_alert_type" ADD VALUE 'ANOMALOUS_WASTE';--> statement-breakpoint
ALTER TYPE "public"."inventory_alert_type" ADD VALUE 'YIELD_DROP';--> statement-breakpoint
CREATE TABLE "forecast_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"recipe_id" uuid NOT NULL,
	"forecast_date" timestamp NOT NULL,
	"predicted_quantity" integer NOT NULL,
	"confidence_score" integer DEFAULT 0,
	"actual_quantity" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"expected_quantity" integer NOT NULL,
	"actual_quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" integer,
	"total_cost" integer,
	"yield_percent" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"planned_quantity" integer NOT NULL,
	"unit" text DEFAULT 'PORTION' NOT NULL,
	"planned_date" timestamp NOT NULL,
	"status" "production_order_status" DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"created_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid,
	"recipe_id" uuid NOT NULL,
	"produced_quantity" integer NOT NULL,
	"unit" text DEFAULT 'PORTION' NOT NULL,
	"ingredient_cost" integer DEFAULT 0,
	"notes" text,
	"recorded_by" text NOT NULL,
	"production_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "lead_time_days" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "costing_method" text;