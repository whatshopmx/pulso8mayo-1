CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"user_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"kind" text NOT NULL,
	"concept_code" text NOT NULL,
	"concept_name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tax_treatment" text DEFAULT 'FULLY_TAXABLE' NOT NULL,
	"exempt_amount_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"applied_run_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"cancelled_by" text,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_loan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"run_id" uuid,
	"scheduled_cents" integer NOT NULL,
	"applied_cents" integer NOT NULL,
	"balance_before_cents" integer NOT NULL,
	"balance_after_cents" integer NOT NULL,
	"status" text DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"loan_type" text NOT NULL,
	"sat_deduction_code" text DEFAULT '004' NOT NULL,
	"concept_name" text NOT NULL,
	"principal_cents" integer NOT NULL,
	"remaining_balance_cents" integer NOT NULL,
	"installment_cents" integer NOT NULL,
	"max_deduction_pct" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"authorized_by" text NOT NULL,
	"authorized_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"cancelled_by" text,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_applied_run_id_payroll_runs_id_fk" FOREIGN KEY ("applied_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loan_installments" ADD CONSTRAINT "payroll_loan_installments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loan_installments" ADD CONSTRAINT "payroll_loan_installments_loan_id_payroll_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."payroll_loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loan_installments" ADD CONSTRAINT "payroll_loan_installments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loan_installments" ADD CONSTRAINT "payroll_loan_installments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loans" ADD CONSTRAINT "payroll_loans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_loans" ADD CONSTRAINT "payroll_loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_adjustments_company_idem_unique" ON "payroll_adjustments" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_company_period_user_idx" ON "payroll_adjustments" USING btree ("company_id","user_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_loan_installments_applied_period_unique" ON "payroll_loan_installments" USING btree ("company_id","loan_id","period_start","period_end") WHERE "payroll_loan_installments"."status" = 'APPLIED';--> statement-breakpoint
CREATE INDEX "payroll_loan_installments_company_period_user_idx" ON "payroll_loan_installments" USING btree ("company_id","user_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "payroll_loans_company_user_status_idx" ON "payroll_loans" USING btree ("company_id","user_id","status");--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payroll_adjustments_company_isolation" ON "payroll_adjustments"
  USING ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payroll_loans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_loans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payroll_loans_company_isolation" ON "payroll_loans"
  USING ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payroll_loan_installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_loan_installments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payroll_loan_installments_company_isolation" ON "payroll_loan_installments"
  USING ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "payroll_adjustments" TO pulso_app;
    GRANT SELECT, INSERT, UPDATE ON "payroll_loans" TO pulso_app;
    GRANT SELECT, INSERT, UPDATE ON "payroll_loan_installments" TO pulso_app;
  END IF;
END $$;
