CREATE TABLE "electronic_registry_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'OFF' NOT NULL,
	"registry_system_name" text,
	"signed_agreement_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "labor_law_calendar_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"max_weekly_hours" integer NOT NULL,
	"max_double_overtime_hours" integer NOT NULL,
	"max_triple_overtime_hours" integer NOT NULL,
	"max_daily_sum_hours" integer NOT NULL,
	"max_extra_hours_per_day" integer NOT NULL,
	"max_extra_days_per_week" integer NOT NULL,
	"min_rest_between_shifts_hours" integer DEFAULT 12 NOT NULL,
	"minimum_wage_mxn" numeric(8, 2),
	"source_dof_url" text,
	"source_published_on" date,
	"legal_note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "electronic_registry_branch_unique" ON "electronic_registry_readiness" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labor_law_rules_effective_range_idx" ON "labor_law_calendar_rules" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "labor_law_rules_from_idx" ON "labor_law_calendar_rules" USING btree ("effective_from");