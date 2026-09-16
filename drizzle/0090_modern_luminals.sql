CREATE TYPE "public"."aggregator_settlement_status" AS ENUM('PENDING', 'RECONCILED', 'DISCREPANCY');--> statement-breakpoint
CREATE TYPE "public"."financial_period_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."terminal_acquirer" AS ENUM('CLIP', 'MERCADO_PAGO', 'BBVA', 'BANORTE', 'SANTANDER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_run_item_settlement" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."operating_expense_status" ADD VALUE 'PENDING_OVERBUDGET_APPROVAL' BEFORE 'APPROVED';--> statement-breakpoint
CREATE TABLE "aggregator_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"gross_sales_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"net_deposited_cents" integer NOT NULL,
	"pos_sales_cents" integer,
	"variance_cents" integer,
	"status" "aggregator_settlement_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "financial_period_status" DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_cut_cashiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_cut_id" uuid NOT NULL,
	"cashier_name" text NOT NULL,
	"cashier_user_id" text,
	"declared_cash_cents" integer NOT NULL,
	"expected_cash_cents" integer,
	"variance_cents" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tpv_shift_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sales_cut_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"card_amount_cents" integer NOT NULL,
	"tip_amount_cents" integer DEFAULT 0 NOT NULL,
	"voucher_photo_url" text,
	"notes" text,
	"captured_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"alias" text NOT NULL,
	"acquirer" "terminal_acquirer" NOT NULL,
	"affiliation_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"acquirer" "terminal_acquirer" NOT NULL,
	"external_id" text,
	"authorization_code" text,
	"transaction_date" timestamp NOT NULL,
	"card_last_4" text,
	"card_brand" text,
	"card_type" text,
	"gross_amount_cents" integer NOT NULL,
	"fee_amount_cents" integer NOT NULL,
	"fee_vat_cents" integer DEFAULT 0 NOT NULL,
	"net_amount_cents" integer NOT NULL,
	"settlement_date" date,
	"batch_number" text,
	"status" text DEFAULT 'SETTLED' NOT NULL,
	"raw_report_file_url" text,
	"imported_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "break_compliance_rules" ADD COLUMN "requires_backrest_chair" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "break_compliance_rules" ADD COLUMN "standing_risk_level" text DEFAULT 'PROLONGADA';--> statement-breakpoint
ALTER TABLE "break_compliance_rules" ADD COLUMN "rest_area_location" text DEFAULT 'WORKSTATION';--> statement-breakpoint
ALTER TABLE "break_compliance_rules" ADD COLUMN "rit_pause_interval_minutes" integer DEFAULT 120;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "business_date" date;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "overbudget_approved_by" text;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "overbudget_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "holiday_pay_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD COLUMN "overtime_pay_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "is_mandatory" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "settlement_status" "payment_run_item_settlement" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "settled_by" text;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "settlement_reference" text;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "settlement_notes" text;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD CONSTRAINT "aggregator_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD CONSTRAINT "aggregator_settlements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_cut_cashiers" ADD CONSTRAINT "sales_cut_cashiers_sales_cut_id_daily_sales_cuts_id_fk" FOREIGN KEY ("sales_cut_id") REFERENCES "public"."daily_sales_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_cut_cashiers" ADD CONSTRAINT "sales_cut_cashiers_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_sales_cut_id_daily_sales_cuts_id_fk" FOREIGN KEY ("sales_cut_id") REFERENCES "public"."daily_sales_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_terminal_id_branch_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."branch_terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_periods_company_year_month_unique" ON "financial_periods" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE INDEX "financial_periods_company_idx" ON "financial_periods" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tpv_shift_batches_cut_terminal_unique" ON "tpv_shift_batches" USING btree ("sales_cut_id","terminal_id");--> statement-breakpoint
CREATE INDEX "tpv_shift_batches_company_branch_idx" ON "tpv_shift_batches" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "tpv_shift_batches_sales_cut_idx" ON "tpv_shift_batches" USING btree ("sales_cut_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_terminals_company_serial_unique" ON "branch_terminals" USING btree ("company_id","serial_number");--> statement-breakpoint
CREATE INDEX "branch_terminals_branch_idx" ON "branch_terminals" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "branch_terminals_company_idx" ON "branch_terminals" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_transactions_company_acquirer_ext_unique" ON "gateway_transactions" USING btree ("company_id","acquirer","external_id");--> statement-breakpoint
CREATE INDEX "gateway_transactions_company_branch_date_idx" ON "gateway_transactions" USING btree ("company_id","branch_id","transaction_date");--> statement-breakpoint
CREATE INDEX "gateway_transactions_company_settlement_idx" ON "gateway_transactions" USING btree ("company_id","settlement_date");--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_overbudget_approved_by_users_id_fk" FOREIGN KEY ("overbudget_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_run_items_run_settlement_idx" ON "payment_run_items" USING btree ("payment_run_id","settlement_status");