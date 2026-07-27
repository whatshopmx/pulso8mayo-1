CREATE TYPE "public"."inventory_period_status" AS ENUM('OPEN', 'LOCKED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."supplier_claim_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."supplier_claim_type" AS ENUM('SHORTAGE', 'DAMAGE', 'PRICE_DIFFERENCE', 'QUALITY');--> statement-breakpoint
ALTER TYPE "public"."inventory_waste_reason" ADD VALUE 'STAFF';--> statement-breakpoint
CREATE TABLE "inventory_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" "inventory_period_status" DEFAULT 'OPEN' NOT NULL,
	"closed_by" text,
	"closed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid,
	"branch_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "supplier_claim_status" DEFAULT 'OPEN' NOT NULL,
	"type" "supplier_claim_type" NOT NULL,
	"description" text,
	"total_amount" integer,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "average_cost" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "average_cost_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "match_tolerance_percent" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "blind_stock_count" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "costing_method" text DEFAULT 'LAST_PRICE';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_rate" integer DEFAULT 16;--> statement-breakpoint
ALTER TABLE "inventory_periods" ADD CONSTRAINT "inventory_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_periods" ADD CONSTRAINT "inventory_periods_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movements_branch_item_idx" ON "inventory_movements" USING btree ("branch_id","item_id","timestamp");