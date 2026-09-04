CREATE TYPE "public"."payee_bank_account_status" AS ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."payment_run_item_type" ADD VALUE 'OPERATING_EXPENSE';--> statement-breakpoint
CREATE TABLE "payee_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"clabe" text NOT NULL,
	"clabe_last4" text NOT NULL,
	"clabe_fingerprint" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"status" "payee_bank_account_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp,
	"verified_by" text,
	"verification_method" text,
	"verification_evidence_url" text,
	"rejected_at" timestamp,
	"rejected_by" text,
	"rejection_reason" text,
	"registered_by" text NOT NULL,
	"replaces_account_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "service_order_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "payee_bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_replaces_account_id_fk" FOREIGN KEY ("replaces_account_id") REFERENCES "public"."payee_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payee_bank_accounts_one_verified_active" ON "payee_bank_accounts" USING btree ("payee_id") WHERE "payee_bank_accounts"."status" = 'VERIFIED' AND "payee_bank_accounts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "payee_bank_accounts_payee_clabe_unique" ON "payee_bank_accounts" USING btree ("payee_id","clabe_fingerprint") WHERE "payee_bank_accounts"."active";--> statement-breakpoint
CREATE INDEX "payee_bank_accounts_company_payee_idx" ON "payee_bank_accounts" USING btree ("company_id","payee_id");--> statement-breakpoint
CREATE INDEX "payee_bank_accounts_fingerprint_idx" ON "payee_bank_accounts" USING btree ("company_id","clabe_fingerprint");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_payee_bank_account_id_payee_bank_accounts_id_fk" FOREIGN KEY ("payee_bank_account_id") REFERENCES "public"."payee_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_service_order_idx" ON "invoices" USING btree ("service_order_id");