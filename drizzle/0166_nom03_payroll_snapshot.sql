ALTER TABLE "payroll_payslips" ADD COLUMN "bonuses_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "isr_retenido_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "imss_obrero_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "loan_deductions_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "net_pay_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "ordinary_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "snapshot_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "input_fingerprint" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "ordinary_snapshot" jsonb;