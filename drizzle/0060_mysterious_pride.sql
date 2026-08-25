CREATE TYPE "public"."cfdi_conciliation_status" AS ENUM('SIN_MATCH', 'CONCILIADA');--> statement-breakpoint
CREATE TABLE "cfdi_recibidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_uuid" text NOT NULL,
	"issuer_tin" text NOT NULL,
	"issuer_name" text,
	"recipient_tin" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'MXN',
	"invoice_date" timestamp with time zone,
	"sat_certification_date" timestamp with time zone,
	"download_request_id" text,
	"conciliation_status" "cfdi_conciliation_status" DEFAULT 'SIN_MATCH' NOT NULL,
	"matched_supplier_id" uuid,
	"matched_payee_id" uuid,
	"matched_purchase_order_id" uuid,
	"matched_expense_id" uuid,
	"raw_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cfdi_recibidos_invoice_uuid_unique" UNIQUE("invoice_uuid")
);
--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_supplier_id_suppliers_id_fk" FOREIGN KEY ("matched_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_payee_id_payees_id_fk" FOREIGN KEY ("matched_payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("matched_purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_expense_id_operating_expenses_id_fk" FOREIGN KEY ("matched_expense_id") REFERENCES "public"."operating_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cfdi_recibidos_company_date_idx" ON "cfdi_recibidos" USING btree ("company_id","invoice_date");--> statement-breakpoint
CREATE INDEX "cfdi_recibidos_company_issuer_idx" ON "cfdi_recibidos" USING btree ("company_id","issuer_tin");