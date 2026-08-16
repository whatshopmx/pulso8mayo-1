CREATE TABLE "cash_flow_assumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"opening_balance_cents" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_flow_assumptions" ADD CONSTRAINT "cash_flow_assumptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_assumptions" ADD CONSTRAINT "cash_flow_assumptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_assumptions" ADD CONSTRAINT "cash_flow_assumptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_assumptions_company_branch_unique" ON "cash_flow_assumptions" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_assumptions_company_group_unique" ON "cash_flow_assumptions" USING btree ("company_id") WHERE "cash_flow_assumptions"."branch_id" IS NULL;--> statement-breakpoint
CREATE INDEX "cash_flow_assumptions_company_idx" ON "cash_flow_assumptions" USING btree ("company_id");