CREATE TYPE "public"."discrepancy_type" AS ENUM('NONE', 'QUANTITY', 'PRICE', 'QUALITY', 'SUBSTITUTION');--> statement-breakpoint
CREATE TABLE "receiving_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid,
	"purchase_order_id" uuid,
	"received_by" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"discrepancy_notes" text,
	"signature_url" text,
	"photo_urls" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receiving_report_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receiving_report_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ordered_quantity" integer,
	"received_quantity" integer NOT NULL,
	"unit_cost" integer,
	"line_total" integer,
	"discrepancy_type" "discrepancy_type" DEFAULT 'NONE' NOT NULL,
	"discrepancy_qty" integer DEFAULT 0,
	"discrepancy_notes" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);