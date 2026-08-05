CREATE TABLE "pnl_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"sales_cents" integer NOT NULL,
	"food_cost_cents" integer NOT NULL,
	"waste_cents" integer NOT NULL,
	"labor_cost_cents" integer NOT NULL,
	"operating_expenses_cents" integer NOT NULL,
	"operating_profit_cents" integer NOT NULL,
	"weakest_line" text NOT NULL,
	"lines" jsonb NOT NULL,
	"costing_method" text,
	"frozen_at" timestamp DEFAULT now() NOT NULL,
	"frozen_by" text
);
--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_frozen_by_users_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pnl_snapshot_branch_period_unique" ON "pnl_snapshots" USING btree ("branch_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "pnl_snapshots_company_period_idx" ON "pnl_snapshots" USING btree ("company_id","period_end");