ALTER TABLE "payroll_payslips" ADD COLUMN "aguinaldo_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "aguinaldo_fiscal_year" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_aguinaldo_year_unique" ON "payroll_runs" USING btree ("company_id","aguinaldo_fiscal_year") WHERE "payroll_runs"."aguinaldo_fiscal_year" is not null;