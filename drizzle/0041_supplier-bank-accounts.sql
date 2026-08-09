CREATE TYPE "public"."supplier_bank_account_status" AS ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "supplier_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"clabe" text NOT NULL,
	"clabe_last4" text NOT NULL,
	"clabe_fingerprint" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"status" "supplier_bank_account_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
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
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_replaces_account_id_fk" FOREIGN KEY ("replaces_account_id") REFERENCES "public"."supplier_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bank_accounts_one_verified_active" ON "supplier_bank_accounts" USING btree ("supplier_id") WHERE "supplier_bank_accounts"."status" = 'VERIFIED' AND "supplier_bank_accounts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bank_accounts_supplier_clabe_unique" ON "supplier_bank_accounts" USING btree ("supplier_id","clabe_fingerprint") WHERE "supplier_bank_accounts"."active";--> statement-breakpoint
CREATE INDEX "supplier_bank_accounts_company_supplier_idx" ON "supplier_bank_accounts" USING btree ("company_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_bank_accounts_fingerprint_idx" ON "supplier_bank_accounts" USING btree ("company_id","clabe_fingerprint");