CREATE TYPE "public"."sales_channel" AS ENUM('SALON', 'DELIVERY', 'EVENTOS', 'TOTAL');--> statement-breakpoint
CREATE TYPE "public"."sales_cut_shift" AS ENUM('MATUTINO', 'VESPERTINO', 'COMPLETO');--> statement-breakpoint
CREATE TYPE "public"."sales_cut_source" AS ENUM('UPLOAD', 'WHATSAPP', 'MANUAL_FORM');--> statement-breakpoint
CREATE TYPE "public"."sales_cut_status" AS ENUM('VALIDATED', 'PENDING_REVIEW', 'REJECTED');--> statement-breakpoint
CREATE TABLE "daily_sales_cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"shift" "sales_cut_shift" NOT NULL,
	"channel" "sales_channel" DEFAULT 'TOTAL' NOT NULL,
	"total_sales" integer NOT NULL,
	"cash_sales" integer,
	"card_sales" integer,
	"other_payments" integer,
	"avg_ticket" integer,
	"ticket_count" integer,
	"source" "sales_cut_source" NOT NULL,
	"raw_file_url" text,
	"status" "sales_cut_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"validation_notes" text,
	"received_by" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_mapping_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pos_system" text,
	"mapping" jsonb NOT NULL,
	"payment_method_mapping" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD CONSTRAINT "daily_sales_cuts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD CONSTRAINT "daily_sales_cuts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD CONSTRAINT "daily_sales_cuts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_mapping_templates" ADD CONSTRAINT "pos_mapping_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_mapping_templates" ADD CONSTRAINT "pos_mapping_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_sales_cut_unique" ON "daily_sales_cuts" USING btree ("company_id","branch_id","business_date","shift","channel");--> statement-breakpoint
CREATE INDEX "daily_sales_cuts_date_idx" ON "daily_sales_cuts" USING btree ("company_id","branch_id","business_date");--> statement-breakpoint
CREATE INDEX "pos_mapping_templates_company_idx" ON "pos_mapping_templates" USING btree ("company_id");