ALTER TABLE "payroll_payslips" ADD COLUMN "aguinaldo_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "aguinaldo_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payslips_aguinaldo_snapshot_employee_unique" ON "payroll_payslips" USING btree ("run_id","user_id") WHERE "payroll_payslips"."aguinaldo_snapshot" is not null;