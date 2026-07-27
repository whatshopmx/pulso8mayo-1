CREATE TABLE "inventory_knowledge_graph" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"avg_daily_consumption" integer,
	"consumption_trend" integer,
	"consumption_volatility" integer,
	"avg_waste_percent" integer,
	"waste_trend" integer,
	"total_waste_loss" integer,
	"avg_stock_level" integer,
	"stockout_count" integer,
	"avg_lead_time_days" integer,
	"period" text DEFAULT 'DAILY' NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"last_movement_at" timestamp,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "kg_branch_item_idx" ON "inventory_knowledge_graph" USING btree ("branch_id","item_id");