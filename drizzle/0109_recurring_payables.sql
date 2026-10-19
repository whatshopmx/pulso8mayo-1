CREATE TYPE "public"."recurring_payable_status" AS ENUM('OPEN', 'INVOICED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "recurring_payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid,
	"label" text NOT NULL,
	"contract_type" text NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"period_key" text NOT NULL,
	"due_date" date NOT NULL,
	"estimated_amount_cents" integer NOT NULL,
	"status" "recurring_payable_status" DEFAULT 'OPEN' NOT NULL,
	"linked_invoice_id" uuid,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_payables" ADD CONSTRAINT "recurring_payables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payables" ADD CONSTRAINT "recurring_payables_contract_id_recurring_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."recurring_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_payables_contract_period_unique" ON "recurring_payables" USING btree ("contract_id","period_key");--> statement-breakpoint
CREATE INDEX "recurring_payables_company_status_idx" ON "recurring_payables" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "recurring_payables_due_date_idx" ON "recurring_payables" USING btree ("due_date");