CREATE TYPE "public"."bank_transaction_match_status" AS ENUM('UNMATCHED', 'MATCHED', 'IGNORED');--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_bank_account_id" uuid,
	"value_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount_cents" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"match_status" "bank_transaction_match_status" DEFAULT 'UNMATCHED' NOT NULL,
	"matched_payment_run_item_id" uuid,
	"matched_at" timestamp,
	"matched_by" text,
	"match_notes" text,
	"imported_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_source_bank_account_id_company_bank_accounts_id_fk" FOREIGN KEY ("source_bank_account_id") REFERENCES "public"."company_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_fingerprint_unique" ON "bank_transactions" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "bank_transactions_company_date_idx" ON "bank_transactions" USING btree ("company_id","value_date");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_idx" ON "bank_transactions" USING btree ("source_bank_account_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_match_status_idx" ON "bank_transactions" USING btree ("company_id","match_status");