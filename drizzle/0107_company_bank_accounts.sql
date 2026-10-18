CREATE TABLE "company_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"account_number" text NOT NULL,
	"account_last_four" text NOT NULL,
	"account_fingerprint" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"clabe" text,
	"clabe_last_four" text,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"registered_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "company_bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "company_bank_accounts_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_bank_accounts_active_number_unique" ON "company_bank_accounts" USING btree ("company_id","account_fingerprint") WHERE "company_bank_accounts"."active";--> statement-breakpoint
CREATE INDEX "company_bank_accounts_company_idx" ON "company_bank_accounts" USING btree ("company_id");