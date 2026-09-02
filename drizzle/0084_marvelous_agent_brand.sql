CREATE TYPE "public"."expense_payment_method" AS ENUM('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'DOMICILIADO', 'CHEQUE');--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD COLUMN "vat_bps" integer DEFAULT 1600 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD COLUMN "tax_amount" integer;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "payment_method" "expense_payment_method";--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "tax_amount" integer;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "paid_by" text;--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN "vat_rate_percent" numeric(5, 2) DEFAULT '16.00';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN "labor_burden_factor_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN "payroll_state_tax_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD CONSTRAINT "channel_commission_rates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;