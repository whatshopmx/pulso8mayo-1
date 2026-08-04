CREATE TYPE "public"."operating_expense_category" AS ENUM('RENTA', 'SERVICIOS', 'MANTENIMIENTO', 'PUBLICIDAD', 'SERVICIOS_PROFESIONALES', 'OTROS');--> statement-breakpoint
CREATE TYPE "public"."operating_expense_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."petty_cash_transaction_type" AS ENUM('OUT', 'REPLENISHMENT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."propina_status" AS ENUM('CALCULATED', 'DISBURSED');--> statement-breakpoint
CREATE TABLE "expense_authorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"min_amount" integer NOT NULL,
	"max_amount" integer,
	"approver_role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"category" "operating_expense_category" NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"invoice_id" uuid,
	"status" "operating_expense_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"approval_notes" text,
	"paid_at" timestamp,
	"due_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"fund_amount" integer DEFAULT 500000 NOT NULL,
	"current_balance" integer DEFAULT 500000 NOT NULL,
	"low_threshold" integer DEFAULT 100000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"type" "petty_cash_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"concept" text NOT NULL,
	"category" "operating_expense_category",
	"evidence_url" text,
	"workflow_instance_id" text,
	"registered_by" text NOT NULL,
	"approved_by" text,
	"authorization_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propina_asignaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"propina_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"hours_worked" numeric DEFAULT '0' NOT NULL,
	"points" numeric DEFAULT '1.0' NOT NULL,
	"assigned_amount_cents" integer NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"shift" "sales_cut_shift" NOT NULL,
	"total_pool_cents" integer NOT NULL,
	"distributed_cents" integer NOT NULL,
	"status" "propina_status" DEFAULT 'CALCULATED' NOT NULL,
	"registered_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_authorization_rules" ADD CONSTRAINT "expense_authorization_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_authorization_rules" ADD CONSTRAINT "expense_authorization_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ADD CONSTRAINT "petty_cash_funds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ADD CONSTRAINT "petty_cash_funds_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_fund_id_petty_cash_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."petty_cash_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propina_asignaciones" ADD CONSTRAINT "propina_asignaciones_propina_id_propinas_id_fk" FOREIGN KEY ("propina_id") REFERENCES "public"."propinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propina_asignaciones" ADD CONSTRAINT "propina_asignaciones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propinas" ADD CONSTRAINT "propinas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propinas" ADD CONSTRAINT "propinas_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propinas" ADD CONSTRAINT "propinas_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "petty_cash_fund_branch_unique" ON "petty_cash_funds" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "propinas_branch_date_shift_unique" ON "propinas" USING btree ("company_id","branch_id","business_date","shift");