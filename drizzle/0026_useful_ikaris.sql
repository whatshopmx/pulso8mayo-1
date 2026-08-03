CREATE TYPE "public"."operational_twin_state" AS ENUM('CREATE', 'ACTIVE', 'DEGRADING', 'CRITICAL', 'RECOVERING');--> statement-breakpoint
CREATE TABLE "corporate_twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"drift_score" integer DEFAULT 0 NOT NULL,
	"margin_leakage_score" integer DEFAULT 0 NOT NULL,
	"network_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"current_state" "operational_twin_state" DEFAULT 'CREATE' NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"drift_score" integer DEFAULT 0 NOT NULL,
	"confidence_score" integer DEFAULT 100 NOT NULL,
	"margin_leakage_score" integer DEFAULT 0 NOT NULL,
	"execution_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inventory_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recipe_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"labor_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"maintenance_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compliance_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"finance_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_experience_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD CONSTRAINT "corporate_twins_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_twins" ADD CONSTRAINT "operational_twins_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_company_twin" ON "corporate_twins" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_branch_twin" ON "operational_twins" USING btree ("branch_id");